const path = require("path");
const vscode = require("vscode");
const { CLASS_INPUT_TRIGGER_CHARS, EXTENSION_PREFIX, SUPPORTED_DOCUMENTS, SUPPORTED_STYLE_EXTENSIONS } = require("./constants");
const { CssIndex } = require("./css-index");
const { DocumentStyleResolver } = require("./document-style-resolver");
const { getClassNameAtPosition, getClassValueContext, getCurrentClassToken } = require("./document-context");
const { buildContextualHoverMarkdown, createCompletionItem } = require("./presentation");
const { mergeEntries, removeDuplicateEntries, sortEntriesByPriority } = require("./utils");

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

module.exports = {
  activate,
  deactivate
};
