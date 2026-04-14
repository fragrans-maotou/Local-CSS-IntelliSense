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
  item.command = "localCssIntelliSense.selectSources";

  return {
    item,
    update() {
      const count = store.getPaths().length;
      if (count) {
        item.text = `$(symbol-class) Local CSS: ${count} source${count === 1 ? "" : "s"}`;
        item.tooltip = "Manage Local CSS IntelliSense scan sources";
      } else {
        item.text = "$(search) Local CSS: Select Sources";
        item.tooltip = "Choose the CSS files or folders that Local CSS IntelliSense should scan";
      }
      item.show();
    }
  };
}

function workspaceRelativePath(uri) {
  const relative = vscode.workspace.asRelativePath(uri, false);
  return relative.split(path.sep).join("/");
}

function readStoredPaths(context) {
  return context.workspaceState.get(STORAGE_KEY, []);
}

module.exports = {
  createSourceSelectionStore,
  createSourceStatusBar
};
