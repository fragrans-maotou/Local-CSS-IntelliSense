const selectorParser = require("postcss-selector-parser");
const { getEntryPriority } = require("./utils");

function filterEntriesForElement(className, entries, currentClassNames) {
  if (!entries.length) {
    return [];
  }

  const currentClassSet = new Set((currentClassNames || []).filter(Boolean));
  const ranked = entries.map((entry) => {
    return {
      entry,
      rank: getSelectorRelevance(entry.selector, className, currentClassSet)
    };
  });

  const finite = ranked.filter((item) => Number.isFinite(item.rank));
  if (!finite.length) {
    return sortRankedEntries(ranked).map((item) => item.entry);
  }

  const bestRank = Math.min(...finite.map((item) => item.rank));
  const threshold = getRankThreshold(bestRank);
  return sortRankedEntries(finite.filter((item) => item.rank <= threshold)).map((item) => item.entry);
}

function getSelectorRelevance(selector, className, currentClassSet) {
  try {
    const root = selectorParser().astSync(selector);
    let bestRank = Infinity;

    root.each((selectorNode) => {
      bestRank = Math.min(bestRank, evaluateSelectorNode(selectorNode, className, currentClassSet));
    });

    return bestRank;
  } catch (error) {
    return fallbackSelectorRelevance(selector, className);
  }
}

function evaluateSelectorNode(selectorNode, className, currentClassSet) {
  const nodes = selectorNode.nodes || [];
  let bestRank = Infinity;

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node || node.type !== "class" || node.value !== className) {
      continue;
    }

    const compoundStart = findCompoundStart(nodes, index);
    const compoundEnd = findCompoundEnd(nodes, index);

    if (hasMeaningfulNodes(nodes, compoundEnd + 1, nodes.length)) {
      continue;
    }

    const compoundNodes = nodes.slice(compoundStart, compoundEnd + 1);
    const requiredClasses = uniqueNonTargetClasses(compoundNodes, className);
    const missingClasses = requiredClasses.filter((value) => !currentClassSet.has(value));
    const hasAncestorContext = hasMeaningfulNodes(nodes, 0, compoundStart);
    const hasExtraSameElementRequirement = compoundNodes.some((item) => isExtraSameElementRequirement(item, className));

    let rank;
    if (!hasAncestorContext) {
      if (!hasExtraSameElementRequirement && requiredClasses.length === 0) {
        rank = 0;
      } else if (missingClasses.length === 0) {
        rank = 1;
      } else {
        rank = 2;
      }
    } else if (missingClasses.length === 0) {
      rank = 3;
    } else {
      rank = 4;
    }

    bestRank = Math.min(bestRank, rank);
  }

  return bestRank;
}

function findCompoundStart(nodes, index) {
  let cursor = index;
  while (cursor > 0 && nodes[cursor - 1].type !== "combinator") {
    cursor -= 1;
  }
  return cursor;
}

function findCompoundEnd(nodes, index) {
  let cursor = index;
  while (cursor + 1 < nodes.length && nodes[cursor + 1].type !== "combinator") {
    cursor += 1;
  }
  return cursor;
}

function hasMeaningfulNodes(nodes, start, end) {
  for (let index = start; index < end; index += 1) {
    const node = nodes[index];
    if (node && node.type !== "combinator" && node.type !== "comment") {
      return true;
    }
  }
  return false;
}

function uniqueNonTargetClasses(nodes, className) {
  const result = new Set();
  for (const node of nodes) {
    if (node && node.type === "class" && node.value !== className) {
      result.add(node.value);
    }
  }
  return Array.from(result);
}

function isExtraSameElementRequirement(node, className) {
  if (!node || node.type === "comment" || node.type === "combinator") {
    return false;
  }

  if (node.type === "class") {
    return node.value !== className;
  }

  return node.type === "tag" || node.type === "id" || node.type === "attribute" || node.type === "universal" || node.type === "nesting";
}

function fallbackSelectorRelevance(selector, className) {
  const normalizedSelector = selector.trim();
  if (normalizedSelector === `.${className}` || normalizedSelector.startsWith(`.${className}:`) || normalizedSelector.startsWith(`.${className}::`)) {
    return 0;
  }

  if (normalizedSelector.includes(`.${className}`)) {
    return /[\s>+~]/.test(normalizedSelector) ? 3 : 1;
  }

  return Number.POSITIVE_INFINITY;
}

function getRankThreshold(bestRank) {
  if (bestRank <= 1) {
    return 1;
  }
  if (bestRank <= 2) {
    return 2;
  }
  if (bestRank <= 3) {
    return 3;
  }
  return 4;
}

function sortRankedEntries(items) {
  return [...items].sort((left, right) => {
    if (left.rank !== right.rank) {
      return left.rank - right.rank;
    }

    const priorityDiff = getEntryPriority(left.entry) - getEntryPriority(right.entry);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const fileDiff = left.entry.filePath.localeCompare(right.entry.filePath);
    if (fileDiff !== 0) {
      return fileDiff;
    }

    if (left.entry.line !== right.entry.line) {
      return left.entry.line - right.entry.line;
    }

    return left.entry.column - right.entry.column;
  });
}

module.exports = {
  filterEntriesForElement
};
