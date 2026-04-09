const vscode = require("vscode");
const { EXTENSION_PREFIX, DEFAULT_INCLUDE, DEFAULT_EXCLUDE } = require("./constants");
const { parseCssEntries } = require("./parsing");
const { expandConfiguredPatterns, expandConfiguredPatternsSync, isWorkspaceFile, shouldIndexStyleUri } = require("./path-utils");
const { normalizeArray, uniqueItems, toGlobUnion } = require("./utils");

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

module.exports = {
  CssIndex
};
