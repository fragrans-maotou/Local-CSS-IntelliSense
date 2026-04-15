const path = require("path");
const vscode = require("vscode");
const { uniqueItems } = require("./utils");

const STORAGE_KEY = "localCssIntelliSense.selectedSources";

function createSourceSelectionStore(context) {
  return {
    getPaths() {
      return uniqueItems(readStoredPaths(context));
    },
    async selectPaths() {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: true,
        canSelectMany: true,
        openLabel: "Select CSS Sources",
        filters: {
          Styles: ["css", "scss", "less"]
        }
      });

      if (!picked || !picked.length) {
        return undefined;
      }

      const workspaceUris = picked.filter((uri) => Boolean(vscode.workspace.getWorkspaceFolder(uri)));
      if (!workspaceUris.length) {
        vscode.window.showWarningMessage("Please select CSS files or folders inside the current workspace.");
        return undefined;
      }

      const normalized = uniqueItems(workspaceUris.map((uri) => workspaceRelativePath(uri)));
      await context.workspaceState.update(STORAGE_KEY, normalized);
      return normalized;
    },
    async clearPaths() {
      await context.workspaceState.update(STORAGE_KEY, []);
    }
  };
}

function createSourceStatusBar(store) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  item.command = "localCssIntelliSense.manageSources";
  let scanStatus = {
    state: "idle",
    sourceCount: store.getPaths().length,
    fileCount: 0,
    classCount: 0,
    scannedFiles: 0,
    totalFiles: 0,
    message: ""
  };

  function update() {
    const sourceCount = Number.isFinite(scanStatus.sourceCount) ? scanStatus.sourceCount : store.getPaths().length;

    if (scanStatus.state === "scanning") {
      const progressText = scanStatus.totalFiles
        ? `${scanStatus.scannedFiles || 0}/${scanStatus.totalFiles}`
        : "Starting";
      item.text = `$(sync~spin) Local CSS: ${progressText}`;
    } else if (!sourceCount) {
      item.text = "$(search) Local CSS: Select Sources";
    } else if (scanStatus.state === "empty") {
      item.text = `$(warning) Local CSS: 0 files`;
    } else if (scanStatus.state === "error") {
      item.text = "$(error) Local CSS";
    } else if (scanStatus.fileCount) {
      item.text = `$(symbol-class) Local CSS: ${scanStatus.fileCount} files`;
    } else {
      item.text = `$(symbol-class) Local CSS: ${sourceCount} source${sourceCount === 1 ? "" : "s"}`;
    }

    item.tooltip = buildStatusTooltip(sourceCount, scanStatus);
    item.show();
  }

  return {
    item,
    update,
    setScanStatus(nextStatus) {
      scanStatus = {
        ...scanStatus,
        ...nextStatus
      };
      update();
    },
    getScanStatus() {
      return { ...scanStatus };
    }
  };
}

async function showSourceManager(options) {
  const { sourceStore, statusBar, cssIndex, onSelectSources, onRefreshIndex, onClearSources } = options;
  const selectedPaths = sourceStore.getPaths();
  const scanStatus = statusBar.getScanStatus();
  const indexedFiles = cssIndex.getIndexedFileSummaries();

  const picked = await vscode.window.showQuickPick(
    [
      {
        label: "$(folder-opened) Select CSS Sources",
        description: selectedPaths.length ? `${selectedPaths.length} saved source(s)` : "Choose files or folders to scan",
        action: "select"
      },
      {
        label: "$(sync) Refresh Index",
        description: describeRefreshAction(scanStatus, indexedFiles.length),
        action: "refresh"
      },
      {
        label: "$(list-tree) Show Scanned Files",
        description: indexedFiles.length ? `${indexedFiles.length} indexed file(s)` : "No indexed files yet",
        action: "files"
      },
      {
        label: "$(symbol-file) Show Selected Sources",
        description: selectedPaths.length ? `${selectedPaths.length} saved path(s)` : "No saved sources yet",
        action: "sources"
      },
      {
        label: "$(clear-all) Clear CSS Sources",
        description: "Remove saved source paths and clear the global index",
        action: "clear"
      }
    ],
    {
      ignoreFocusOut: true,
      placeHolder: buildManagerPlaceHolder(scanStatus, selectedPaths.length, indexedFiles.length)
    }
  );

  if (!picked) {
    return;
  }

  if (picked.action === "select") {
    await onSelectSources();
    return;
  }

  if (picked.action === "refresh") {
    await onRefreshIndex();
    return;
  }

  if (picked.action === "clear") {
    await onClearSources();
    return;
  }

  if (picked.action === "files") {
    await showIndexedFilePicker(indexedFiles);
    return;
  }

  if (picked.action === "sources") {
    await showSelectedSourcePicker(selectedPaths);
  }
}

function workspaceRelativePath(uri) {
  const relative = vscode.workspace.asRelativePath(uri, false);
  return relative.split(path.sep).join("/");
}

function readStoredPaths(context) {
  return context.workspaceState.get(STORAGE_KEY, []);
}

function buildStatusTooltip(sourceCount, scanStatus) {
  const lines = ["Manage Local CSS IntelliSense sources and index status"];

  lines.push(`Sources: ${sourceCount}`);
  lines.push(`Indexed files: ${scanStatus.fileCount || 0}`);
  lines.push(`Indexed classes: ${scanStatus.classCount || 0}`);

  if (scanStatus.state === "scanning") {
    const progressText = scanStatus.totalFiles
      ? `${scanStatus.scannedFiles || 0}/${scanStatus.totalFiles}`
      : "starting";
    lines.push(`Status: scanning (${progressText})`);
  } else if (scanStatus.state === "empty") {
    lines.push(`Status: waiting for matching CSS files`);
  } else if (scanStatus.state === "error") {
    lines.push(`Status: error`);
  } else if (scanStatus.state === "ready") {
    lines.push(`Status: ready`);
  }

  if (scanStatus.message) {
    lines.push(scanStatus.message);
  }

  return lines.join("\n");
}

function buildManagerPlaceHolder(scanStatus, sourceCount, indexedFileCount) {
  if (scanStatus.state === "scanning") {
    const progressText = scanStatus.totalFiles
      ? `${scanStatus.scannedFiles || 0}/${scanStatus.totalFiles}`
      : "starting";
    return `Local CSS is scanning ${progressText}. Sources: ${sourceCount}, indexed files: ${indexedFileCount}.`;
  }

  if (!sourceCount) {
    return "Choose the CSS files or folders you want Local CSS IntelliSense to scan.";
  }

  if (scanStatus.state === "empty") {
    return `Sources saved: ${sourceCount}, but no matching CSS files are indexed yet.`;
  }

  return `Sources: ${sourceCount}. Indexed files: ${indexedFileCount}. Indexed classes: ${scanStatus.classCount || 0}.`;
}

function describeRefreshAction(scanStatus, indexedFileCount) {
  if (scanStatus.state === "scanning") {
    return "Scanning is already in progress";
  }

  if (!indexedFileCount) {
    return "Run a fresh scan now";
  }

  return `Rebuild the current index (${indexedFileCount} file(s))`;
}

async function showIndexedFilePicker(indexedFiles) {
  if (!indexedFiles.length) {
    vscode.window.showInformationMessage("Local CSS IntelliSense has not indexed any CSS files yet.");
    return;
  }

  const picked = await vscode.window.showQuickPick(
    indexedFiles.map((item) => {
      return {
        label: vscode.workspace.asRelativePath(item.filePath, false).replace(/\\/g, "/"),
        description: `${item.classCount} class(es)`,
        detail: `${item.ruleCount} rule(s)`,
        filePath: item.filePath
      };
    }),
    {
      ignoreFocusOut: true,
      placeHolder: "Indexed CSS files"
    }
  );

  if (!picked) {
    return;
  }

  const document = await vscode.workspace.openTextDocument(picked.filePath);
  await vscode.window.showTextDocument(document, {
    preview: false
  });
}

async function showSelectedSourcePicker(selectedPaths) {
  if (!selectedPaths.length) {
    vscode.window.showInformationMessage("No custom CSS sources are saved yet.");
    return;
  }

  await vscode.window.showQuickPick(
    selectedPaths.map((item) => {
      return {
        label: item,
        description: "Saved scan source"
      };
    }),
    {
      ignoreFocusOut: true,
      placeHolder: "Saved CSS source paths"
    }
  );
}

module.exports = {
  createSourceSelectionStore,
  createSourceStatusBar,
  showSourceManager
};
