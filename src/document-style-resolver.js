const vscode = require("vscode");
const { extractInlineStyleContext, extractStyleDependencies, collectRegexMatches, parseCssEntries } = require("./parsing");
const { resolveStyleSpec, shouldIndexStyleUri } = require("./path-utils");
const { groupEntriesByClass, uniqueItems, uniqueUris } = require("./utils");

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

module.exports = {
  DocumentStyleResolver
};
