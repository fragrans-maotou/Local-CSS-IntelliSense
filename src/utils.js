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

module.exports = {
  normalizeArray,
  uniqueItems,
  uniqueUris,
  groupEntriesByClass,
  mergeEntries,
  removeDuplicateEntries,
  dedupeEntries,
  getEntrySignature,
  splitEntriesBySource,
  sortEntriesByPriority,
  getEntryPriority,
  hasGlobSyntax,
  normalizeGlobSlashes,
  toDirectoryGlob,
  toGlobUnion,
  escapeMarkdown
};
