const vscode = require("vscode");
const { EXTENSION_PREFIX, DEFAULT_INCLUDE, DEFAULT_EXCLUDE } = require("./constants");
const { extractStyleDependencies, parseCssEntries } = require("./parsing");
const { expandConfiguredPatterns, expandConfiguredPatternsSync, isWorkspaceFile, resolveStyleSpec, shouldIndexStyleUri } = require("./path-utils");
const { normalizeArray, uniqueItems, toGlobUnion } = require("./utils");

class CssIndex {
  constructor(outputChannel, options = {}) {
    this.outputChannel = outputChannel;
    this.getSelectedSources = options.getSelectedSources || (() => []);
    this.onStatusChange = options.onStatusChange || (() => {});
    this.entriesByClass = new Map();
    this.entriesByFile = new Map();
    this.watchers = [];
    this.fullRefreshTimer = undefined;
    this.isRefreshing = false;
  }

  getSettings() {
    const config = vscode.workspace.getConfiguration(EXTENSION_PREFIX);
    const selectedSources = normalizeArray(this.getSelectedSources());
    return {
      enableAutoIndex: config.get("enableAutoIndex", false),
      entryFiles: uniqueItems([...selectedSources, ...normalizeArray(config.get("entryFiles", []))]),
      include: uniqueItems(normalizeArray(config.get("include", DEFAULT_INCLUDE))),
      exclude: uniqueItems([...DEFAULT_EXCLUDE, ...normalizeArray(config.get("exclude", []))]),
      maxFileSizeKB: Number(config.get("maxFileSizeKB", 2048)) || 2048,
      maxEntriesPerHover: Number(config.get("maxEntriesPerHover", 5)) || 5,
      maxIndexedFiles: Number(config.get("maxIndexedFiles", 400)) || 400
    };
  }

  async initialize() {
    this.resetWatchers();
    await this.refreshAll("initial scan");
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

  getIndexedFileSummaries() {
    return Array.from(this.entriesByFile.values())
      .map((entries) => {
        const filePath = entries[0] ? entries[0].filePath : undefined;
        if (!filePath) {
          return undefined;
        }

        return {
          filePath,
          ruleCount: entries.length,
          classCount: new Set(entries.map((entry) => entry.className)).size
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.filePath.localeCompare(right.filePath));
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
    if (this.isRefreshing) {
      this.log(`Skipped overlapping refresh for ${reason}.`);
      return;
    }

    this.isRefreshing = true;
    try {
      const settings = this.getSettings();
      this.emitStatus({
        state: "scanning",
        reason,
        sourceCount: settings.entryFiles.length,
        scannedFiles: 0,
        totalFiles: 0,
        fileCount: this.entriesByFile.size,
        classCount: this.entriesByClass.size
      });

      const files = await this.collectFiles(settings);
      this.emitStatus({
        state: "scanning",
        reason,
        sourceCount: settings.entryFiles.length,
        scannedFiles: 0,
        totalFiles: files.length,
        fileCount: this.entriesByFile.size,
        classCount: this.entriesByClass.size
      });
      this.entriesByClass.clear();
      this.entriesByFile.clear();

      if (!files.length) {
        this.log("No global CSS sources selected. Use the status bar button or the command palette to choose CSS files or folders.");
        this.emitStatus({
          state: "empty",
          reason,
          sourceCount: settings.entryFiles.length,
          fileCount: 0,
          classCount: 0,
          message: "No CSS files matched the selected sources yet."
        });
        return;
      }

      await this.indexFilesInBatches(files, settings);
      this.log(`Indexed ${files.length} file(s) for ${reason}. Total classes: ${this.entriesByClass.size}.`);
      this.emitStatus({
        state: "ready",
        reason,
        sourceCount: settings.entryFiles.length,
        fileCount: this.entriesByFile.size,
        classCount: this.entriesByClass.size,
        totalFiles: files.length,
        scannedFiles: files.length
      });
    } catch (error) {
      this.emitStatus({
        state: "error",
        reason,
        sourceCount: this.getSettings().entryFiles.length,
        fileCount: this.entriesByFile.size,
        classCount: this.entriesByClass.size,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      this.isRefreshing = false;
    }
  }

  async collectFiles(settings = this.getSettings()) {
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

    const rankedFiles = Array.from(fileMap.values()).sort((left, right) => scoreStyleUri(right) - scoreStyleUri(left));
    return rankedFiles.slice(0, settings.maxIndexedFiles);
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

    if (!watchPatterns.size) {
      return;
    }

    for (const pattern of watchPatterns) {
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

  async indexFile(uri, visited = new Set()) {
    if (!isWorkspaceFile(uri) || !shouldIndexStyleUri(uri)) {
      this.removeFile(uri);
      return;
    }

    const visitKey = uri.toString();
    if (visited.has(visitKey)) {
      return;
    }
    visited.add(visitKey);

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

      const dependencies = extractStyleDependencies(source);
      for (const dependency of dependencies) {
        const resolvedDependency = await resolveStyleSpec(dependency, uri);
        if (!resolvedDependency) {
          continue;
        }
        await this.indexFile(resolvedDependency, visited);
      }
    } catch (error) {
      this.removeFile(uri);
      this.log(`Failed to index ${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async indexFilesInBatches(files, settings = this.getSettings()) {
    const batchSize = 16;
    for (let index = 0; index < files.length; index += batchSize) {
      const batch = files.slice(index, index + batchSize);
      await Promise.all(batch.map((uri) => this.indexFile(uri)));
      this.emitStatus({
        state: "scanning",
        sourceCount: settings.entryFiles.length,
        scannedFiles: Math.min(index + batch.length, files.length),
        totalFiles: files.length,
        fileCount: this.entriesByFile.size,
        classCount: this.entriesByClass.size
      });

      if (index + batchSize < files.length) {
        await yieldToEventLoop();
      }
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

  emitStatus(status) {
    this.onStatusChange(status);
  }
}

function scoreStyleUri(uri) {
  const normalizedPath = uri.fsPath.replace(/\\/g, "/").toLowerCase();
  let score = 0;

  const strongPathHints = [
    "/src/styles/",
    "/src/style/",
    "/src/assets/styles/",
    "/src/assets/style/",
    "/styles/",
    "/style/"
  ];

  const strongNameHints = [
    "/global.",
    "/globals.",
    "/base.",
    "/common.",
    "/theme.",
    "/reset.",
    "/variables.",
    "/index.",
    "/app."
  ];

  for (const hint of strongPathHints) {
    if (normalizedPath.includes(hint)) {
      score += 12;
    }
  }

  for (const hint of strongNameHints) {
    if (normalizedPath.includes(hint)) {
      score += 20;
    }
  }

  if (normalizedPath.endsWith(".scss")) {
    score += 2;
  } else if (normalizedPath.endsWith(".less")) {
    score += 1;
  }

  return score;
}

function yieldToEventLoop() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

module.exports = {
  CssIndex
};
