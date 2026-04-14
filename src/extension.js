const path = require("path");
const vscode = require("vscode");
const { CLASS_INPUT_TRIGGER_CHARS, EXTENSION_PREFIX, SUPPORTED_DOCUMENTS, SUPPORTED_STYLE_EXTENSIONS } = require("./constants");
const { CssIndex } = require("./css-index");
const { DocumentStyleResolver } = require("./document-style-resolver");
const { getClassNameAtPosition, getClassValueContext, getCurrentClassToken } = require("./document-context");
const { buildContextualHoverMarkdown, createCompletionItem } = require("./presentation");
const { createSourceSelectionStore, createSourceStatusBar } = require("./source-selection");
const { mergeEntries, removeDuplicateEntries, sortEntriesByPriority } = require("./utils");

function activate(context) {
  const outputChannel = vscode.window.createOutputChannel("Local CSS IntelliSense");
  const sourceStore = createSourceSelectionStore(context);
  const statusBar = createSourceStatusBar(sourceStore);
  const cssIndex = new CssIndex(outputChannel, {
    getSelectedSources: () => sourceStore.getPaths()
  });
  const styleResolver = new DocumentStyleResolver(outputChannel);
  const suggestController = createSuggestController();
  const warmupController = createWarmupController(styleResolver);

  context.subscriptions.push(outputChannel);
  context.subscriptions.push(statusBar.item);
  context.subscriptions.push({
    dispose: () => {
      cssIndex.dispose();
      styleResolver.dispose();
    }
  });

  statusBar.update();
  cssIndex.initialize().catch((error) => {
    outputChannel.appendLine(`[Local CSS IntelliSense] Initial indexing failed: ${error instanceof Error ? error.stack : String(error)}`);
  });
  warmupController.schedule(vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined);

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
        const documentContext = styleResolver.getCachedContext(document) || EMPTY_CONTEXT;
        if (documentContext === EMPTY_CONTEXT) {
          warmupController.schedule(document);
        }
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

      let documentContext = styleResolver.getCachedContext(document);
      if (!documentContext) {
        warmupController.schedule(document);
      }

      let localEntries = sortEntriesByPriority((documentContext || EMPTY_CONTEXT).entriesByClass.get(className) || []);
      const globalEntries = sortEntriesByPriority(removeDuplicateEntries(cssIndex.getEntries(className), localEntries));
      if (!localEntries.length && !globalEntries.length) {
        documentContext = await styleResolver.getContext(document);
        localEntries = sortEntriesByPriority(documentContext.entriesByClass.get(className) || []);
        if (!localEntries.length) {
          return undefined;
        }
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

      let documentContext = styleResolver.getCachedContext(document);
      if (!documentContext) {
        warmupController.schedule(document);
      }

      let localEntries = sortEntriesByPriority((documentContext || EMPTY_CONTEXT).entriesByClass.get(className) || []);
      const globalEntries = sortEntriesByPriority(removeDuplicateEntries(cssIndex.getEntries(className), localEntries));
      const entries = sortEntriesByPriority([...localEntries, ...globalEntries]);
      if (!entries.length) {
        documentContext = await styleResolver.getContext(document);
        localEntries = sortEntriesByPriority(documentContext.entriesByClass.get(className) || []);
        if (!localEntries.length) {
          return undefined;
        }
      }

      return sortEntriesByPriority([...localEntries, ...globalEntries]).map((entry) => {
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
    statusBar.update();
    warmupController.schedule(vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined);
    vscode.window.showInformationMessage(`Local CSS IntelliSense indexed ${cssIndex.getClasses().length} global class name(s).`);
  });

  const selectSourcesCommand = vscode.commands.registerCommand("localCssIntelliSense.selectSources", async () => {
    const selected = await sourceStore.selectPaths();
    if (!selected) {
      return;
    }

    statusBar.update();
    styleResolver.dispose();
    await cssIndex.refreshAll("source selection");
    cssIndex.resetWatchers();
    warmupController.schedule(vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined);
    vscode.window.showInformationMessage(`Local CSS IntelliSense selected ${selected.length} source path(s).`);
  });

  const clearSourcesCommand = vscode.commands.registerCommand("localCssIntelliSense.clearSources", async () => {
    await sourceStore.clearPaths();
    statusBar.update();
    styleResolver.dispose();
    await cssIndex.refreshAll("clear sources");
    cssIndex.resetWatchers();
    vscode.window.showInformationMessage("Local CSS IntelliSense cleared custom scan sources.");
  });

  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(EXTENSION_PREFIX)) {
      styleResolver.dispose();
      cssIndex.resetWatchers();
      cssIndex.scheduleFullRefresh("configuration change");
      statusBar.update();
      warmupController.schedule(vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined);
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

    warmupController.schedule(editor.document);
    suggestController.schedule();
  });

  const openListener = vscode.workspace.onDidOpenTextDocument((document) => {
    warmupController.schedule(document);
  });

  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    styleResolver.invalidateDocument(document.uri);
  });

  const saveListener = vscode.workspace.onDidSaveTextDocument((document) => {
    if (SUPPORTED_STYLE_EXTENSIONS.has(path.extname(document.uri.fsPath || "").toLowerCase())) {
      styleResolver.invalidateStyle(document.uri);
    }
    warmupController.schedule(vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document : undefined);
  });

  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    warmupController.schedule(editor ? editor.document : undefined);
  });

  context.subscriptions.push(
    completionProvider,
    hoverProvider,
    definitionProvider,
    refreshCommand,
    selectSourcesCommand,
    clearSourcesCommand,
    configListener,
    typingListener,
    openListener,
    closeListener,
    saveListener,
    activeEditorListener,
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

function createWarmupController(styleResolver) {
  let timer = undefined;
  let latestDocument = undefined;

  return {
    schedule(document) {
      if (!isSupportedDocument(document)) {
        return;
      }

      latestDocument = document;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const target = latestDocument;
        latestDocument = undefined;
        if (target) {
          styleResolver.primeContext(target);
        }
      }, 120);
    }
  };
}

function isSupportedDocument(document) {
  if (!document) {
    return false;
  }

  return SUPPORTED_DOCUMENTS.some((selector) => {
    return selector.language === document.languageId && selector.scheme === document.uri.scheme;
  });
}

const EMPTY_CONTEXT = {
  entries: [],
  entriesByClass: new Map()
};

module.exports = {
  activate,
  deactivate
};
