const path = require("path");
const vscode = require("vscode");
const postcss = require("postcss");
const postcssLess = require("postcss-less");
const safeParser = require("postcss-safe-parser");
const postcssScss = require("postcss-scss");
const selectorParser = require("postcss-selector-parser");

const EXTENSION_PREFIX = "localCssIntelliSense";
const DEFAULT_INCLUDE = ["**/*.css", "**/*.scss", "**/*.less"];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/.git/**",
  "**/out/**"
];
const CLASS_INPUT_TRIGGER_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".split("");
const SUPPORTED_STYLE_EXTENSIONS = new Set([".css", ".scss", ".less"]);
const SUPPORTED_DOCUMENTS = [
  { language: "html", scheme: "file" },
  { language: "html", scheme: "untitled" },
  { language: "javascriptreact", scheme: "file" },
  { language: "javascriptreact", scheme: "untitled" },
  { language: "typescriptreact", scheme: "file" },
  { language: "typescriptreact", scheme: "untitled" },
  { language: "vue", scheme: "file" },
  { language: "vue", scheme: "untitled" },
  { language: "svelte", scheme: "file" },
  { language: "svelte", scheme: "untitled" },
  { language: "astro", scheme: "file" },
  { language: "astro", scheme: "untitled" },
  { language: "php", scheme: "file" },
  { language: "php", scheme: "untitled" },
  { language: "javascript", scheme: "file" },
  { language: "javascript", scheme: "untitled" },
  { language: "typescript", scheme: "file" },
  { language: "typescript", scheme: "untitled" }
];

class CssIndex {
  constructor(outputChannel) {
    this.outputChannel = outputChannel;
    this.entriesByClass = new Map();
    this.entriesByFile = new Map();
    this.watchers = [];
    this.fullRefreshTimer = undefined;
  }

  getSettings() {
    const config = vscode.workspace.getConfiguration(EXTENSION_PREFIX);
    return {
      enableAutoIndex: config.get("enableAutoIndex", true),
      entryFiles: normalizeArray(config.get("entryFiles", [])),
      include: normalizeArray(config.get("include", DEFAULT_INCLUDE)),
      exclude: normalizeArray(config.get("exclude", DEFAULT_EXCLUDE)),
      maxFileSizeKB: Number(config.get("maxFileSizeKB", 500)) || 500,
      maxEntriesPerHover: Number(config.get("maxEntriesPerHover", 5)) || 5
    };
  }

  async initialize() {
    await this.refreshAll("initial scan");
    this.resetWatchers();
  }

  dispose() {
    clearTimeout(this.fullRefreshTimer);
    this.fullRefreshTimer = undefined;
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
  }

  getClasses() {
    return Array.from(this.entriesByClass.keys()).sort((left, right) => left.localeCompare(right));
  }

  getEntries(className) {
    return this.entriesByClass.get(className) || [];
  }

  getHoverLimit() {
    return this.getSettings().maxEntriesPerHover;
  }

  scheduleFullRefresh(reason) {
    clearTimeout(this.fullRefreshTimer);
    this.fullRefreshTimer = setTimeout(() => {
      this.refreshAll(reason).catch((error) => {
        this.log(`Full refresh failed: ${error instanceof Error ? error.stack : String(error)}`);
      });
    }, 250);
  }

  async refreshAll(reason) {
    const files = await this.collectFiles();
    this.entriesByClass.clear();
    this.entriesByFile.clear();

    await Promise.all(files.map((uri) => this.indexFile(uri)));
    this.log(`Indexed ${files.length} file(s) for ${reason}. Total classes: ${this.entriesByClass.size}.`);
  }

  async collectFiles() {
    const settings = this.getSettings();
    const globs = new Set(await expandConfiguredPatterns(settings.entryFiles));

    if (settings.enableAutoIndex) {
      for (const pattern of settings.include.length ? settings.include : DEFAULT_INCLUDE) {
        globs.add(pattern);
      }
    }

    const exclude = toGlobUnion(settings.exclude);
    const fileMap = new Map();

    for (const pattern of globs) {
      const matches = await vscode.workspace.findFiles(pattern, exclude || undefined);
      for (const uri of matches) {
        fileMap.set(uri.toString(), uri);
      }
    }

    return Array.from(fileMap.values());
  }

  resetWatchers() {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];

    const settings = this.getSettings();
    const watchPatterns = new Set([
      ...expandConfiguredPatternsSync(settings.entryFiles),
      ...(settings.enableAutoIndex ? settings.include : [])
    ]);

    for (const pattern of watchPatterns.size ? watchPatterns : DEFAULT_INCLUDE) {
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidCreate((uri) => {
        this.indexFile(uri).catch((error) => this.logError("create", uri, error));
      });
      watcher.onDidChange((uri) => {
        this.indexFile(uri).catch((error) => this.logError("change", uri, error));
      });
      watcher.onDidDelete((uri) => {
        this.removeFile(uri);
      });
      this.watchers.push(watcher);
    }
  }

  async indexFile(uri) {
    if (!isWorkspaceFile(uri)) {
      return;
    }

    const settings = this.getSettings();
    const fileSizeLimitBytes = settings.maxFileSizeKB * 1024;

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > fileSizeLimitBytes) {
        this.removeFile(uri);
        this.log(`Skipped large file: ${uri.fsPath}`);
        return;
      }

      const bytes = await vscode.workspace.fs.readFile(uri);
      const source = Buffer.from(bytes).toString("utf8");
      const parsedEntries = parseCssEntries(source, uri.fsPath);
      this.replaceFileEntries(uri, parsedEntries);
    } catch (error) {
      this.removeFile(uri);
      this.log(`Failed to index ${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  replaceFileEntries(uri, nextEntries) {
    this.removeFile(uri);

    const key = uri.toString();
    this.entriesByFile.set(key, nextEntries);

    for (const entry of nextEntries) {
      if (!this.entriesByClass.has(entry.className)) {
        this.entriesByClass.set(entry.className, []);
      }
      this.entriesByClass.get(entry.className).push(entry);
    }
  }

  removeFile(uri) {
    const key = uri.toString();
    const existing = this.entriesByFile.get(key);
    if (!existing) {
      return;
    }

    for (const entry of existing) {
      const bucket = this.entriesByClass.get(entry.className);
      if (!bucket) {
        continue;
      }

      const nextBucket = bucket.filter((item) => {
        return !(item.filePath === entry.filePath && item.selector === entry.selector && item.line === entry.line);
      });

      if (nextBucket.length) {
        this.entriesByClass.set(entry.className, nextBucket);
      } else {
        this.entriesByClass.delete(entry.className);
      }
    }

    this.entriesByFile.delete(key);
  }

  log(message) {
    this.outputChannel.appendLine(`[Local CSS IntelliSense] ${message}`);
  }

  logError(action, uri, error) {
    this.log(`Watcher ${action} failed for ${uri.fsPath}: ${error instanceof Error ? error.stack : String(error)}`);
  }
}

function activate(context) {
  const outputChannel = vscode.window.createOutputChannel("Local CSS IntelliSense");
  const cssIndex = new CssIndex(outputChannel);
  const suggestController = createSuggestController();

  context.subscriptions.push(outputChannel);
  context.subscriptions.push({
    dispose: () => cssIndex.dispose()
  });

  cssIndex.initialize().catch((error) => {
    outputChannel.appendLine(`[Local CSS IntelliSense] Initial indexing failed: ${error instanceof Error ? error.stack : String(error)}`);
  });

  const completionProvider = vscode.languages.registerCompletionItemProvider(
    SUPPORTED_DOCUMENTS,
    {
      provideCompletionItems(document, position) {
        const classContext = getClassValueContext(document, position);
        if (!classContext) {
          return undefined;
        }

        const tokenInfo = getCurrentClassToken(document, position, classContext);
        const classes = cssIndex.getClasses();
        const prefix = tokenInfo.text.toLowerCase();

        return classes
          .filter((className) => !prefix || className.toLowerCase().includes(prefix))
          .slice(0, 200)
          .map((className) => createCompletionItem(className, cssIndex.getEntries(className), tokenInfo.range));
      }
    },
    " ",
    "\"",
    "'",
    "-"
  );

  const hoverProvider = vscode.languages.registerHoverProvider(SUPPORTED_DOCUMENTS, {
    provideHover(document, position) {
      const className = getClassNameAtPosition(document, position);
      if (!className) {
        return undefined;
      }

      const entries = cssIndex.getEntries(className);
      if (!entries.length) {
        return undefined;
      }

      return new vscode.Hover(buildHoverMarkdown(entries, cssIndex.getHoverLimit()));
    }
  });

  const definitionProvider = vscode.languages.registerDefinitionProvider(SUPPORTED_DOCUMENTS, {
    provideDefinition(document, position) {
      const className = getClassNameAtPosition(document, position);
      if (!className) {
        return undefined;
      }

      const entries = cssIndex.getEntries(className);
      if (!entries.length) {
        return undefined;
      }

      return entries.map((entry) => {
        const targetUri = vscode.Uri.file(entry.filePath);
        const targetPosition = new vscode.Position(Math.max(0, entry.line - 1), Math.max(0, entry.column - 1));
        return new vscode.Location(targetUri, targetPosition);
      });
    }
  });

  const refreshCommand = vscode.commands.registerCommand("localCssIntelliSense.refreshIndex", async () => {
    await cssIndex.refreshAll("manual refresh");
    cssIndex.resetWatchers();
    vscode.window.showInformationMessage(`Local CSS IntelliSense indexed ${cssIndex.getClasses().length} class name(s).`);
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(EXTENSION_PREFIX)) {
      cssIndex.resetWatchers();
      cssIndex.scheduleFullRefresh("configuration change");
    }
  });

  const typingListener = vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
      return;
    }

    if (editor.selections.length !== 1 || !editor.selection.isEmpty) {
      return;
    }

    const change = event.contentChanges[event.contentChanges.length - 1];
    if (!change || change.text.length !== 1 || !CLASS_INPUT_TRIGGER_CHARS.includes(change.text)) {
      return;
    }

    if (!getClassValueContext(editor.document, editor.selection.active)) {
      return;
    }

    suggestController.schedule();
  });

  context.subscriptions.push(completionProvider, hoverProvider, definitionProvider, refreshCommand, configListener, typingListener);
}

function deactivate() {}

function createCompletionItem(className, entries, range) {
  const item = new vscode.CompletionItem(className, vscode.CompletionItemKind.Class);
  const primary = entries[0];
  item.range = range;
  item.insertText = className;
  item.filterText = className;
  item.sortText = className;
  item.detail = primary ? createEntrySummary(primary) : "Local CSS class";
  item.description = primary ? path.basename(primary.filePath) : "Local CSS";
  item.documentation = buildHoverMarkdown(entries, 3, true);
  return item;
}

function parseCssEntries(source, filePath) {
  const root = postcss.parse(source, {
    from: filePath,
    parser: resolveParser(filePath)
  });
  const entries = [];

  root.walkRules((rule) => {
    if (!rule.selector || isInsideKeyframes(rule)) {
      return;
    }

    const classNames = extractClassNames(rule.selector);
    if (!classNames.length) {
      return;
    }

    const declarationBlock = collectDeclarations(rule);
    const contextLabel = collectParentAtRules(rule);
    const location = rule.source && rule.source.start ? rule.source.start : { line: 1, column: 1 };

    for (const className of classNames) {
      entries.push({
        className,
        selector: rule.selector,
        filePath,
        line: location.line || 1,
        column: location.column || 1,
        declarations: declarationBlock,
        contextLabel
      });
    }
  });

  return entries;
}

function extractClassNames(selector) {
  const result = new Set();

  try {
    selectorParser((root) => {
      root.walkClasses((classNode) => {
        if (classNode && classNode.value) {
          result.add(classNode.value);
        }
      });
    }).processSync(selector);
  } catch (error) {
    const fallback = selector.match(/\.([_a-zA-Z]+[\w-]*)/g) || [];
    for (const token of fallback) {
      result.add(token.slice(1));
    }
  }

  return Array.from(result);
}

function collectDeclarations(rule) {
  const declarations = [];

  for (const node of rule.nodes || []) {
    if (node.type === "decl") {
      declarations.push(`${node.prop}: ${node.value};`);
    }
  }

  return declarations.length ? declarations.join("\n") : "/* No direct declarations */";
}

function collectParentAtRules(rule) {
  const labels = [];
  let current = rule.parent;

  while (current) {
    if (current.type === "atrule") {
      labels.unshift(`@${current.name}${current.params ? ` ${current.params}` : ""}`);
    }
    current = current.parent;
  }

  return labels.join(" -> ");
}

function isInsideKeyframes(rule) {
  let current = rule.parent;
  while (current) {
    if (current.type === "atrule" && /keyframes$/i.test(current.name || "")) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function buildHoverMarkdown(entries, limit, compact = false) {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = false;
  markdown.supportHtml = false;

  for (const entry of entries.slice(0, limit)) {
    markdown.appendCodeblock(formatRulePreview(entry), "css");
    if (!compact) {
      const relativePath = vscode.workspace.asRelativePath(entry.filePath, false).replace(/\\/g, "/");
      markdown.appendMarkdown(`Source: \`${escapeMarkdown(relativePath)}:${entry.line}\``);
      if (entry.contextLabel) {
        markdown.appendMarkdown(`  \nContext: \`${escapeMarkdown(entry.contextLabel)}\``);
      }
      markdown.appendMarkdown("\n\n");
    }
  }

  if (entries.length > limit) {
    markdown.appendMarkdown(`_+${entries.length - limit} more match(es)_`);
  }

  return markdown;
}

function getClassNameAtPosition(document, position) {
  if (!getClassValueContext(document, position)) {
    return undefined;
  }

  const range = document.getWordRangeAtPosition(position, /[_a-zA-Z][\w-]*/);
  if (!range) {
    return undefined;
  }

  const token = document.getText(range);
  if (!token) {
    return undefined;
  }

  return normalizeClassName(token);
}

function getCurrentClassToken(document, position, classContext) {
  const line = document.lineAt(position.line).text;
  let start = Math.max(classContext.valueStart, position.character);
  let end = position.character;

  while (start > classContext.valueStart && /[\w-]/.test(line[start - 1])) {
    start -= 1;
  }

  while (end < classContext.valueEnd && /[\w-]/.test(line[end])) {
    end += 1;
  }

  return {
    text: line.slice(start, position.character),
    range: new vscode.Range(position.line, start, position.line, end)
  };
}

function getClassValueContext(document, position) {
  const line = document.lineAt(position.line).text;
  const beforeCursor = line.slice(0, position.character);
  const quoteIndex = Math.max(beforeCursor.lastIndexOf("\""), beforeCursor.lastIndexOf("'"), beforeCursor.lastIndexOf("`"));
  if (quoteIndex < 0) {
    return undefined;
  }

  const quoteChar = beforeCursor[quoteIndex];
  const attributePrefix = beforeCursor.slice(Math.max(0, quoteIndex - 40), quoteIndex);
  const isAttributeValue = /(?:^|[\s<(])(?:class|className|:class)\s*=\s*$/i.test(attributePrefix);
  const isClsxValue = /clsx\(\s*$/.test(attributePrefix);
  if (!isAttributeValue && !isClsxValue) {
    return undefined;
  }

  const afterQuote = line.slice(quoteIndex + 1);
  const closingRelativeIndex = afterQuote.indexOf(quoteChar);
  const valueStart = quoteIndex + 1;
  const valueEnd = closingRelativeIndex >= 0 ? valueStart + closingRelativeIndex : line.length;

  if (position.character < valueStart || position.character > valueEnd) {
    return undefined;
  }

  return {
    valueStart,
    valueEnd
  };
}

function normalizeClassName(token) {
  return token.trim().replace(/^\./, "");
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

async function expandConfiguredPatterns(patterns) {
  const expanded = [];
  for (const pattern of patterns) {
    const resolved = await resolveConfiguredPattern(pattern);
    for (const item of resolved) {
      expanded.push(item);
    }
  }
  return expanded;
}

function expandConfiguredPatternsSync(patterns) {
  const expanded = [];
  for (const pattern of patterns) {
    for (const item of resolveConfiguredPatternSync(pattern)) {
      expanded.push(item);
    }
  }
  return expanded;
}

async function resolveConfiguredPattern(pattern) {
  if (!pattern) {
    return [];
  }

  if (hasGlobSyntax(pattern)) {
    return [normalizeGlobSlashes(pattern)];
  }

  const ext = path.extname(pattern).toLowerCase();
  if (SUPPORTED_STYLE_EXTENSIONS.has(ext)) {
    return [normalizeGlobSlashes(pattern)];
  }

  const candidates = getWorkspaceCandidateUris(pattern);
  for (const uri of candidates) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.Directory) {
        return [toDirectoryGlob(pattern)];
      }
      if (stat.type & vscode.FileType.File) {
        return [normalizeGlobSlashes(pattern)];
      }
    } catch (error) {
      continue;
    }
  }

  return [toDirectoryGlob(pattern)];
}

function resolveConfiguredPatternSync(pattern) {
  if (!pattern) {
    return [];
  }

  if (hasGlobSyntax(pattern)) {
    return [normalizeGlobSlashes(pattern)];
  }

  const ext = path.extname(pattern).toLowerCase();
  if (SUPPORTED_STYLE_EXTENSIONS.has(ext)) {
    return [normalizeGlobSlashes(pattern)];
  }

  return [toDirectoryGlob(pattern)];
}

function resolveParser(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".scss") {
    return postcssScss;
  }
  if (ext === ".less") {
    return postcssLess;
  }
  return safeParser;
}

function toGlobUnion(items) {
  if (!items || !items.length) {
    return undefined;
  }
  if (items.length === 1) {
    return items[0];
  }
  return `{${items.join(",")}}`;
}

function escapeMarkdown(value) {
  return value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}

function isWorkspaceFile(uri) {
  if (!uri || uri.scheme !== "file") {
    return false;
  }
  return Boolean(vscode.workspace.getWorkspaceFolder(uri));
}

function formatRulePreview(entry) {
  const lines = [`${entry.selector} {`];
  for (const declarationLine of entry.declarations.split("\n")) {
    lines.push(`  ${declarationLine}`);
  }
  lines.push("}");
  return lines.join("\n");
}

function createSuggestController() {
  let timer = undefined;

  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        vscode.commands.executeCommand("editor.action.triggerSuggest");
      }, 40);
    }
  };
}

function createEntrySummary(entry) {
  const oneLine = entry.declarations.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    return entry.selector;
  }
  if (oneLine.length <= 72) {
    return oneLine;
  }
  return `${oneLine.slice(0, 69)}...`;
}

function hasGlobSyntax(pattern) {
  return /[*?[\]{}]/.test(pattern);
}

function normalizeGlobSlashes(value) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function toDirectoryGlob(pattern) {
  const normalized = normalizeGlobSlashes(pattern);
  return `${normalized}/**/*.{css,scss,less}`;
}

function getWorkspaceCandidateUris(pattern) {
  const normalized = pattern.replace(/\//g, path.sep);
  if (path.isAbsolute(normalized)) {
    return [vscode.Uri.file(normalized)];
  }

  return (vscode.workspace.workspaceFolders || []).map((folder) => {
    return vscode.Uri.joinPath(folder.uri, normalized);
  });
}

module.exports = {
  activate,
  deactivate
};
