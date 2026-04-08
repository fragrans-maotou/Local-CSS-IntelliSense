const path = require("path");
const vscode = require("vscode");
const postcss = require("postcss");
const postcssLess = require("postcss-less");
const safeParser = require("postcss-safe-parser");
const postcssScss = require("postcss-scss");
const selectorParser = require("postcss-selector-parser");

const EXTENSION_PREFIX = "localCssIntelliSense";
const DEFAULT_INCLUDE = [
  "**/src/styles/**/*.css",
  "**/src/styles/**/*.scss",
  "**/src/styles/**/*.less",
  "**/src/assets/styles/**/*.css",
  "**/src/assets/styles/**/*.scss",
  "**/src/assets/styles/**/*.less",
  "**/styles/**/*.css",
  "**/styles/**/*.scss",
  "**/styles/**/*.less",
  "**/style/**/*.css",
  "**/style/**/*.scss",
  "**/style/**/*.less",
  "**/global.css",
  "**/global.scss",
  "**/global.less",
  "**/globals.css",
  "**/globals.scss",
  "**/globals.less",
  "**/base.css",
  "**/base.scss",
  "**/base.less",
  "**/common.css",
  "**/common.scss",
  "**/common.less",
  "**/theme.css",
  "**/theme.scss",
  "**/theme.less",
  "**/reset.css",
  "**/reset.scss",
  "**/reset.less",
  "**/variables.css",
  "**/variables.scss",
  "**/variables.less"
];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
  "**/.git/**",
  "**/out/**",
  "**/vendor/**",
  "**/vendors/**",
  "**/*.module.css",
  "**/*.module.scss",
  "**/*.module.less",
  "**/*.min.css",
  "**/*.min.scss",
  "**/*.min.less"
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
      include: uniqueItems(normalizeArray(config.get("include", DEFAULT_INCLUDE))),
      exclude: uniqueItems([...DEFAULT_EXCLUDE, ...normalizeArray(config.get("exclude", []))]),
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
        if (shouldIndexStyleUri(uri)) {
          fileMap.set(uri.toString(), uri);
        }
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
    if (!isWorkspaceFile(uri) || !shouldIndexStyleUri(uri)) {
      this.removeFile(uri);
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
      const parsedEntries = parseCssEntries(source, uri.fsPath, {
        sourceKind: "global"
      });
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

class DocumentStyleResolver {
  constructor(outputChannel) {
    this.outputChannel = outputChannel;
    this.documentCache = new Map();
    this.styleFileCache = new Map();
  }

  dispose() {
    this.documentCache.clear();
    this.styleFileCache.clear();
  }

  invalidateDocument(uri) {
    if (!uri) {
      return;
    }
    this.documentCache.delete(uri.toString());
  }

  invalidateStyle(uri) {
    if (!uri) {
      return;
    }
    this.styleFileCache.delete(uri.toString());
  }

  async getContext(document) {
    const key = document.uri.toString();
    const cached = this.documentCache.get(key);
    if (cached && cached.version === document.version) {
      return cached.value;
    }

    const inlineResult = extractInlineStyleContext(document);
    const importedUris = await this.resolveDocumentStyleUris(document, inlineResult.dependencies);
    const entries = [...inlineResult.entries];
    const visited = new Set();

    for (const uri of importedUris) {
      const fileEntries = await this.collectStyleEntriesFromFile(uri, visited);
      for (const entry of fileEntries) {
        entries.push(entry);
      }
    }

    const value = {
      entries,
      entriesByClass: groupEntriesByClass(entries)
    };

    this.documentCache.set(key, {
      version: document.version,
      value
    });

    return value;
  }

  async resolveDocumentStyleUris(document, seedDependencies) {
    const dependencies = seedDependencies ? [...seedDependencies] : [];
    const source = document.getText();
    const importRegex = /\bimport\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+\.(?:css|scss|less))["'`]/g;
    const requireRegex = /\brequire\(\s*["'`]([^"'`]+\.(?:css|scss|less))["'`]\s*\)/g;
    const dynamicImportRegex = /\bimport\(\s*["'`]([^"'`]+\.(?:css|scss|less))["'`]\s*\)/g;
    const linkRegex = /<link\b[^>]*href=["']([^"']+\.(?:css|scss|less))["'][^>]*>/gi;
    const styleSrcRegex = /<style\b[^>]*src=["']([^"']+\.(?:css|scss|less))["'][^>]*>/gi;

    collectRegexMatches(importRegex, source, dependencies);
    collectRegexMatches(requireRegex, source, dependencies);
    collectRegexMatches(dynamicImportRegex, source, dependencies);
    collectRegexMatches(linkRegex, source, dependencies);
    collectRegexMatches(styleSrcRegex, source, dependencies);

    const uris = [];
    for (const spec of uniqueItems(dependencies)) {
      const resolved = await resolveStyleSpec(spec, document.uri);
      if (resolved) {
        uris.push(resolved);
      }
    }

    return uniqueUris(uris);
  }

  async collectStyleEntriesFromFile(uri, visited) {
    const key = uri.toString();
    if (visited.has(key)) {
      return [];
    }
    visited.add(key);

    const fileInfo = await this.loadStyleFile(uri);
    if (!fileInfo) {
      return [];
    }

    const entries = [...fileInfo.entries];

    for (const dependency of fileInfo.dependencies) {
      const resolvedDependency = await resolveStyleSpec(dependency, uri);
      if (!resolvedDependency) {
        continue;
      }

      const dependencyEntries = await this.collectStyleEntriesFromFile(resolvedDependency, visited);
      for (const entry of dependencyEntries) {
        entries.push(entry);
      }
    }

    return entries;
  }

  async loadStyleFile(uri) {
    if (!shouldIndexStyleUri(uri)) {
      return undefined;
    }

    const cacheKey = uri.toString();
    const stat = await vscode.workspace.fs.stat(uri);
    const cached = this.styleFileCache.get(cacheKey);
    if (cached && cached.mtime === stat.mtime && cached.size === stat.size) {
      return cached.value;
    }

    const bytes = await vscode.workspace.fs.readFile(uri);
    const source = Buffer.from(bytes).toString("utf8");
    const value = {
      entries: parseCssEntries(source, uri.fsPath, {
        sourceKind: "imported"
      }),
      dependencies: extractStyleDependencies(source)
    };

    this.styleFileCache.set(cacheKey, {
      mtime: stat.mtime,
      size: stat.size,
      value
    });

    return value;
  }
}

function activate(context) {
  const outputChannel = vscode.window.createOutputChannel("Local CSS IntelliSense");
  const cssIndex = new CssIndex(outputChannel);
  const styleResolver = new DocumentStyleResolver(outputChannel);
  const suggestController = createSuggestController();

  context.subscriptions.push(outputChannel);
  context.subscriptions.push({
    dispose: () => {
      cssIndex.dispose();
      styleResolver.dispose();
    }
  });

  cssIndex.initialize().catch((error) => {
    outputChannel.appendLine(`[Local CSS IntelliSense] Initial indexing failed: ${error instanceof Error ? error.stack : String(error)}`);
  });

  const completionProvider = vscode.languages.registerCompletionItemProvider(
    SUPPORTED_DOCUMENTS,
    {
      async provideCompletionItems(document, position) {
        const classContext = getClassValueContext(document, position);
        if (!classContext) {
          return undefined;
        }

        const tokenInfo = getCurrentClassToken(document, position, classContext);
        const prefix = tokenInfo.text.toLowerCase();
        const documentContext = await styleResolver.getContext(document);
        const localClasses = Array.from(documentContext.entriesByClass.keys()).sort((left, right) => left.localeCompare(right));
        const globalClasses = cssIndex.getClasses();
        const seen = new Set();
        const items = [];

        for (const className of [...localClasses, ...globalClasses]) {
          if (seen.has(className)) {
            continue;
          }
          seen.add(className);

          if (prefix && !className.toLowerCase().includes(prefix)) {
            continue;
          }

          const entries = sortEntriesByPriority(
            mergeEntries(documentContext.entriesByClass.get(className) || [], cssIndex.getEntries(className))
          );
          items.push(createCompletionItem(className, entries, tokenInfo.range, documentContext.entriesByClass.has(className)));
        }

        return items.slice(0, 200);
      }
    },
    " ",
    "\"",
    "'",
    "-"
  );

  const hoverProvider = vscode.languages.registerHoverProvider(SUPPORTED_DOCUMENTS, {
    async provideHover(document, position) {
      const className = getClassNameAtPosition(document, position);
      if (!className) {
        return undefined;
      }

      const documentContext = await styleResolver.getContext(document);
      const localEntries = sortEntriesByPriority(documentContext.entriesByClass.get(className) || []);
      const globalEntries = sortEntriesByPriority(removeDuplicateEntries(cssIndex.getEntries(className), localEntries));
      if (!localEntries.length && !globalEntries.length) {
        return undefined;
      }

      return new vscode.Hover(buildContextualHoverMarkdown(localEntries, globalEntries, cssIndex.getHoverLimit()));
    }
  });

  const definitionProvider = vscode.languages.registerDefinitionProvider(SUPPORTED_DOCUMENTS, {
    async provideDefinition(document, position) {
      const className = getClassNameAtPosition(document, position);
      if (!className) {
        return undefined;
      }

      const documentContext = await styleResolver.getContext(document);
      const localEntries = sortEntriesByPriority(documentContext.entriesByClass.get(className) || []);
      const globalEntries = sortEntriesByPriority(removeDuplicateEntries(cssIndex.getEntries(className), localEntries));
      const entries = sortEntriesByPriority([...localEntries, ...globalEntries]);
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
    styleResolver.dispose();
    await cssIndex.refreshAll("manual refresh");
    cssIndex.resetWatchers();
    vscode.window.showInformationMessage(`Local CSS IntelliSense indexed ${cssIndex.getClasses().length} global class name(s).`);
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(EXTENSION_PREFIX)) {
      styleResolver.dispose();
      cssIndex.resetWatchers();
      cssIndex.scheduleFullRefresh("configuration change");
    }
  });

  const typingListener = vscode.workspace.onDidChangeTextDocument((event) => {
    styleResolver.invalidateDocument(event.document.uri);
    if (SUPPORTED_STYLE_EXTENSIONS.has(path.extname(event.document.uri.fsPath || "").toLowerCase())) {
      styleResolver.invalidateStyle(event.document.uri);
    }

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

  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    styleResolver.invalidateDocument(document.uri);
  });

  const styleWatcher = vscode.workspace.createFileSystemWatcher("**/*.{css,scss,less}");
  styleWatcher.onDidCreate((uri) => {
    styleResolver.invalidateStyle(uri);
  });
  styleWatcher.onDidChange((uri) => {
    styleResolver.invalidateStyle(uri);
  });
  styleWatcher.onDidDelete((uri) => {
    styleResolver.invalidateStyle(uri);
  });

  context.subscriptions.push(
    completionProvider,
    hoverProvider,
    definitionProvider,
    refreshCommand,
    configListener,
    typingListener,
    closeListener,
    styleWatcher
  );
}

function deactivate() {}

function createCompletionItem(className, entries, range, isContextual) {
  const item = new vscode.CompletionItem(className, vscode.CompletionItemKind.Class);
  const primary = entries[0];
  const localEntries = entries.filter((entry) => (entry.sourceKind || "global") !== "global");
  const globalEntries = entries.filter((entry) => (entry.sourceKind || "global") === "global");
  item.range = range;
  item.insertText = className;
  item.filterText = className;
  item.sortText = `${isContextual ? "0" : "1"}-${className}`;
  item.detail = primary ? createEntrySummary(primary) : "Local CSS class";
  item.description = primary ? path.basename(primary.filePath) : "Local CSS";
  item.documentation = buildContextualHoverMarkdown(localEntries.slice(0, 2), globalEntries.slice(0, 1), 3, true);
  return item;
}

function parseCssEntries(source, filePath, options = {}) {
  const root = postcss.parse(source, {
    from: filePath,
    parser: resolveParser(options.languageExtension || filePath)
  });
  const entries = [];
  const lineOffset = options.lineOffset || 0;
  const columnOffset = options.columnOffset || 0;
  const extraContextLabel = options.contextLabel || "";

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
    const adjustedLine = (location.line || 1) + lineOffset;
    const adjustedColumn = (location.line || 1) === 1 ? (location.column || 1) + columnOffset : (location.column || 1);

    for (const className of classNames) {
      entries.push({
        className,
        selector: rule.selector,
        filePath,
        line: adjustedLine,
        column: adjustedColumn,
        declarations: declarationBlock,
        contextLabel: combineContextLabels(extraContextLabel, contextLabel),
        sourceKind: options.sourceKind || "global"
      });
    }
  });

  return entries;
}

function extractInlineStyleContext(document) {
  const source = document.getText();
  const regex = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
  const entries = [];
  const dependencies = [];
  let match;

  while ((match = regex.exec(source)) !== null) {
    const attributes = match[1] || "";
    const content = match[2] || "";
    if (/src\s*=/i.test(attributes)) {
      continue;
    }

    const contentOffset = match.index + match[0].indexOf(content);
    const contentPosition = document.positionAt(contentOffset);
    const languageExtension = resolveStyleLanguageExtension(attributes, document.languageId);
    const inlineEntries = parseCssEntries(content, document.uri.fsPath, {
      languageExtension,
      lineOffset: contentPosition.line,
      columnOffset: contentPosition.character,
      contextLabel: "inline style",
      sourceKind: "inline"
    });

    for (const entry of inlineEntries) {
      entries.push(entry);
    }

    for (const dependency of extractStyleDependencies(content)) {
      dependencies.push(dependency);
    }
  }

  return {
    entries,
    dependencies
  };
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

function combineContextLabels(left, right) {
  if (left && right) {
    return `${left} -> ${right}`;
  }
  return left || right || "";
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

function buildContextualHoverMarkdown(localEntries, globalEntries, limit, compact = false) {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = false;
  markdown.supportHtml = false;

  const localGroups = splitEntriesBySource(localEntries);
  appendHoverSection(markdown, compact ? "" : "Current File Styles", localGroups.inline, limit, compact);
  appendHoverSection(markdown, compact ? "" : "Imported Styles", localGroups.imported, limit, compact);
  appendHoverSection(markdown, compact ? "" : "Global Styles", globalEntries, limit, compact);

  if (!compact && !localEntries.length && !globalEntries.length) {
    markdown.appendMarkdown("_No matching styles_");
  }

  return markdown;
}

function appendHoverSection(markdown, title, entries, limit, compact) {
  if (!entries.length) {
    return;
  }

  if (!compact && title) {
    markdown.appendMarkdown(`**${title}**\n\n`);
  }

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
    markdown.appendMarkdown(`_+${entries.length - limit} more match(es)_\n\n`);
  }
}

function getClassNameAtPosition(document, position) {
  const classContext = getClassValueContext(document, position);
  if (!classContext) {
    return undefined;
  }

  const source = document.getText();
  const offset = document.offsetAt(position);
  const tokenRange = getClassTokenOffsetRange(source, offset, classContext);
  if (!tokenRange) {
    return undefined;
  }

  const token = source.slice(tokenRange.start, tokenRange.end);
  if (!token) {
    return undefined;
  }

  return normalizeClassName(token);
}

function getCurrentClassToken(document, position, classContext) {
  const source = document.getText();
  const offset = document.offsetAt(position);
  let start = offset;
  let end = offset;

  while (start > classContext.valueStartOffset && /[\w-]/.test(source[start - 1])) {
    start -= 1;
  }

  while (end < classContext.valueEndOffset && /[\w-]/.test(source[end])) {
    end += 1;
  }

  return {
    text: source.slice(start, offset),
    range: new vscode.Range(document.positionAt(start), document.positionAt(end))
  };
}

function getClassValueContext(document, position) {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const openingQuoteIndex = findMatchingClassQuoteStart(source, offset);
  if (openingQuoteIndex < 0) {
    return undefined;
  }

  const quoteChar = source[openingQuoteIndex];
  const closingQuoteIndex = findClosingQuote(source, openingQuoteIndex, quoteChar);
  const valueStartOffset = openingQuoteIndex + 1;
  const valueEndOffset = closingQuoteIndex >= 0 ? closingQuoteIndex : source.length;

  if (offset < valueStartOffset || offset > valueEndOffset) {
    return undefined;
  }

  return {
    valueStartOffset,
    valueEndOffset,
    quoteChar
  };
}

function normalizeClassName(token) {
  return token.trim().replace(/^\./, "");
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueItems(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function uniqueUris(uris) {
  const map = new Map();
  for (const uri of uris) {
    map.set(uri.toString(), uri);
  }
  return Array.from(map.values());
}

function groupEntriesByClass(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!map.has(entry.className)) {
      map.set(entry.className, []);
    }
    map.get(entry.className).push(entry);
  }
  return map;
}

function mergeEntries(leftEntries, rightEntries) {
  return dedupeEntries([...leftEntries, ...rightEntries]);
}

function removeDuplicateEntries(entries, duplicates) {
  const duplicateSignatures = new Set(duplicates.map((entry) => getEntrySignature(entry)));
  return entries.filter((entry) => !duplicateSignatures.has(getEntrySignature(entry)));
}

function dedupeEntries(entries) {
  const seen = new Set();
  const result = [];

  for (const entry of entries) {
    const signature = getEntrySignature(entry);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    result.push(entry);
  }

  return result;
}

function getEntrySignature(entry) {
  return `${entry.filePath}|${entry.line}|${entry.column}|${entry.selector}`;
}

function splitEntriesBySource(entries) {
  const inline = [];
  const imported = [];

  for (const entry of entries) {
    if ((entry.sourceKind || "global") === "inline") {
      inline.push(entry);
    } else {
      imported.push(entry);
    }
  }

  return { inline, imported };
}

function sortEntriesByPriority(entries) {
  return [...entries].sort((left, right) => {
    const priorityDiff = getEntryPriority(left) - getEntryPriority(right);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const fileDiff = left.filePath.localeCompare(right.filePath);
    if (fileDiff !== 0) {
      return fileDiff;
    }

    if (left.line !== right.line) {
      return left.line - right.line;
    }

    return left.column - right.column;
  });
}

function getEntryPriority(entry) {
  if (!entry || !entry.sourceKind) {
    return 2;
  }
  if (entry.sourceKind === "inline") {
    return 0;
  }
  if (entry.sourceKind === "imported") {
    return 1;
  }
  return 2;
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

function resolveStyleLanguageExtension(attributes, documentLanguageId) {
  const languageMatch = attributes.match(/\blang\s*=\s*["']([^"']+)["']/i);
  if (languageMatch) {
    const language = languageMatch[1].toLowerCase();
    if (language === "scss" || language === "sass") {
      return ".scss";
    }
    if (language === "less") {
      return ".less";
    }
  }

  if (documentLanguageId === "vue" || documentLanguageId === "svelte" || documentLanguageId === "astro" || documentLanguageId === "html") {
    return ".css";
  }

  return ".css";
}

async function resolveStyleSpec(spec, fromUri) {
  if (!spec) {
    return undefined;
  }

  const normalizedSpec = spec.trim();
  if (/^(https?:)?\/\//i.test(normalizedSpec)) {
    return undefined;
  }

  const candidates = [];
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  if (normalizedSpec.startsWith("/")) {
    for (const folder of workspaceFolders) {
      candidates.push(vscode.Uri.joinPath(folder.uri, normalizedSpec.slice(1)));
    }
  } else if (normalizedSpec.startsWith("@/")) {
    for (const folder of workspaceFolders) {
      candidates.push(vscode.Uri.joinPath(folder.uri, "src", normalizedSpec.slice(2)));
      candidates.push(vscode.Uri.joinPath(folder.uri, normalizedSpec.slice(2)));
    }
  } else if (normalizedSpec.startsWith("~/")) {
    for (const folder of workspaceFolders) {
      candidates.push(vscode.Uri.joinPath(folder.uri, normalizedSpec.slice(2)));
      candidates.push(vscode.Uri.joinPath(folder.uri, "src", normalizedSpec.slice(2)));
    }
  } else {
    const baseDirectory = vscode.Uri.file(path.dirname(fromUri.fsPath));
    candidates.push(vscode.Uri.joinPath(baseDirectory, normalizedSpec));

    if (!normalizedSpec.startsWith("./") && !normalizedSpec.startsWith("../")) {
      for (const folder of workspaceFolders) {
        candidates.push(vscode.Uri.joinPath(folder.uri, normalizedSpec));
        candidates.push(vscode.Uri.joinPath(folder.uri, "src", normalizedSpec));
      }
    }
  }

  for (const candidate of buildStyleResolutionCandidates(candidates)) {
    try {
      const stat = await vscode.workspace.fs.stat(candidate);
      if (stat.type & vscode.FileType.File && shouldIndexStyleUri(candidate)) {
        return candidate;
      }
    } catch (error) {
      continue;
    }
  }

  return undefined;
}

function buildStyleResolutionCandidates(baseCandidates) {
  const allCandidates = [];
  for (const candidate of baseCandidates) {
    allCandidates.push(candidate);

    const extension = path.extname(candidate.fsPath).toLowerCase();
    if (!extension) {
      for (const candidateExtension of SUPPORTED_STYLE_EXTENSIONS) {
        allCandidates.push(vscode.Uri.file(`${candidate.fsPath}${candidateExtension}`));
      }
    }
  }

  return uniqueUris(allCandidates);
}

function extractStyleDependencies(source) {
  const dependencies = [];
  const importRegex = /@import\s+(?:url\(\s*)?["']([^"')]+(?:\.css|\.scss|\.less))["']\s*\)?/gi;
  const useRegex = /@(use|forward)\s+["']([^"']+(?:\.css|\.scss|\.less))["']/gi;

  collectRegexMatches(importRegex, source, dependencies, 1);
  collectRegexMatches(useRegex, source, dependencies, 2);

  return uniqueItems(dependencies);
}

function collectRegexMatches(regex, source, target, captureIndex = 1) {
  let match;
  while ((match = regex.exec(source)) !== null) {
    if (match[captureIndex]) {
      target.push(match[captureIndex]);
    }
  }
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

function shouldIndexStyleUri(uri) {
  if (!uri || uri.scheme !== "file") {
    return false;
  }

  const normalizedPath = uri.fsPath.replace(/\\/g, "/").toLowerCase();
  const extension = path.extname(normalizedPath);
  if (!SUPPORTED_STYLE_EXTENSIONS.has(extension)) {
    return false;
  }

  if (
    normalizedPath.includes("/node_modules/") ||
    normalizedPath.includes("/dist/") ||
    normalizedPath.includes("/build/") ||
    normalizedPath.includes("/coverage/") ||
    normalizedPath.includes("/.next/") ||
    normalizedPath.includes("/.nuxt/") ||
    normalizedPath.includes("/out/") ||
    normalizedPath.includes("/vendor/") ||
    normalizedPath.includes("/vendors/")
  ) {
    return false;
  }

  if (
    normalizedPath.includes(".module.css") ||
    normalizedPath.includes(".module.scss") ||
    normalizedPath.includes(".module.less") ||
    normalizedPath.includes(".min.css") ||
    normalizedPath.includes(".min.scss") ||
    normalizedPath.includes(".min.less")
  ) {
    return false;
  }

  return true;
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

function getClassTokenOffsetRange(source, offset, classContext) {
  let start = offset;
  let end = offset;

  while (start > classContext.valueStartOffset && /[\w-]/.test(source[start - 1])) {
    start -= 1;
  }

  while (end < classContext.valueEndOffset && /[\w-]/.test(source[end])) {
    end += 1;
  }

  if (start === end) {
    return undefined;
  }

  return { start, end };
}

function findMatchingClassQuoteStart(source, offset) {
  const minIndex = Math.max(0, offset - 4000);
  for (let index = Math.min(offset - 1, source.length - 1); index >= minIndex; index -= 1) {
    const char = source[index];
    if (!isQuoteCharacter(char) || isEscapedCharacter(source, index)) {
      continue;
    }

    const prefix = source.slice(Math.max(0, index - 160), index);
    const isAttributeValue = /(?:^|[\s<(])(?:class|className|:class)\s*=\s*$/i.test(prefix);
    const isClsxValue = /(?:clsx|classnames)\(\s*$/.test(prefix);
    if (!isAttributeValue && !isClsxValue) {
      continue;
    }

    const closingQuoteIndex = findClosingQuote(source, index, char);
    if (closingQuoteIndex >= 0 && closingQuoteIndex < offset) {
      continue;
    }

    return index;
  }

  return -1;
}

function findClosingQuote(source, openingIndex, quoteChar) {
  for (let index = openingIndex + 1; index < source.length; index += 1) {
    if (source[index] === quoteChar && !isEscapedCharacter(source, index)) {
      return index;
    }
  }
  return -1;
}

function isEscapedCharacter(source, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isQuoteCharacter(char) {
  return char === "\"" || char === "'" || char === "`";
}
