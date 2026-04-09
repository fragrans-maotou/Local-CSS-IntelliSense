const path = require("path");
const vscode = require("vscode");
const { SUPPORTED_STYLE_EXTENSIONS } = require("./constants");
const { hasGlobSyntax, normalizeGlobSlashes, toDirectoryGlob, uniqueUris } = require("./utils");

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
  expandConfiguredPatterns,
  expandConfiguredPatternsSync,
  resolveStyleSpec,
  isWorkspaceFile,
  shouldIndexStyleUri
};
