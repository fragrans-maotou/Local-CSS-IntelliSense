const path = require("path");
const postcss = require("postcss");
const postcssLess = require("postcss-less");
const safeParser = require("postcss-safe-parser");
const postcssScss = require("postcss-scss");
const selectorParser = require("postcss-selector-parser");

function parseCssEntries(source, filePath, options = {}) {
  const root = postcss.parse(source, {
    from: filePath,
    parser: resolveParser(options.languageExtension || filePath)
  });
  const entries = [];
  const lineOffset = options.lineOffset || 0;
  const columnOffset = options.columnOffset || 0;
  const extraContextLabel = options.contextLabel || "";

  root.walkRules((rule) => {
    if (!rule.selector || isInsideKeyframes(rule)) {
      return;
    }

    const classNames = extractClassNames(rule.selector);
    if (!classNames.length) {
      return;
    }

    const declarationBlock = collectDeclarations(rule);
    const contextLabel = collectParentAtRules(rule);
    const location = rule.source && rule.source.start ? rule.source.start : { line: 1, column: 1 };
    const adjustedLine = (location.line || 1) + lineOffset;
    const adjustedColumn = (location.line || 1) === 1 ? (location.column || 1) + columnOffset : (location.column || 1);

    for (const className of classNames) {
      entries.push({
        className,
        selector: rule.selector,
        filePath,
        line: adjustedLine,
        column: adjustedColumn,
        declarations: declarationBlock,
        contextLabel: combineContextLabels(extraContextLabel, contextLabel),
        sourceKind: options.sourceKind || "global"
      });
    }
  });

  return entries;
}

function extractInlineStyleContext(document) {
  const source = document.getText();
  const regex = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
  const entries = [];
  const dependencies = [];
  let match;

  while ((match = regex.exec(source)) !== null) {
    const attributes = match[1] || "";
    const content = match[2] || "";
    if (/src\s*=/i.test(attributes)) {
      continue;
    }

    const contentOffset = match.index + match[0].indexOf(content);
    const contentPosition = document.positionAt(contentOffset);
    const languageExtension = resolveStyleLanguageExtension(attributes, document.languageId);
    const inlineEntries = parseCssEntries(content, document.uri.fsPath, {
      languageExtension,
      lineOffset: contentPosition.line,
      columnOffset: contentPosition.character,
      contextLabel: "inline style",
      sourceKind: "inline"
    });

    for (const entry of inlineEntries) {
      entries.push(entry);
    }

    for (const dependency of extractStyleDependencies(content)) {
      dependencies.push(dependency);
    }
  }

  return {
    entries,
    dependencies
  };
}

function extractStyleDependencies(source) {
  const dependencies = [];
  const importRegex = /@import\s+(?:url\(\s*)?["']([^"')]+(?:\.css|\.scss|\.less))["']\s*\)?/gi;
  const useRegex = /@(use|forward)\s+["']([^"']+(?:\.css|\.scss|\.less))["']/gi;

  collectRegexMatches(importRegex, source, dependencies, 1);
  collectRegexMatches(useRegex, source, dependencies, 2);

  return Array.from(new Set(dependencies));
}

function collectRegexMatches(regex, source, target, captureIndex = 1) {
  let match;
  while ((match = regex.exec(source)) !== null) {
    if (match[captureIndex]) {
      target.push(match[captureIndex]);
    }
  }
}

function resolveStyleLanguageExtension(attributes, documentLanguageId) {
  const languageMatch = attributes.match(/\blang\s*=\s*["']([^"']+)["']/i);
  if (languageMatch) {
    const language = languageMatch[1].toLowerCase();
    if (language === "scss" || language === "sass") {
      return ".scss";
    }
    if (language === "less") {
      return ".less";
    }
  }

  if (documentLanguageId === "vue" || documentLanguageId === "svelte" || documentLanguageId === "astro" || documentLanguageId === "html") {
    return ".css";
  }

  return ".css";
}

function resolveParser(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".scss") {
    return postcssScss;
  }
  if (ext === ".less") {
    return postcssLess;
  }
  return safeParser;
}

function extractClassNames(selector) {
  const result = new Set();

  try {
    selectorParser((root) => {
      root.walkClasses((classNode) => {
        if (classNode && classNode.value) {
          result.add(classNode.value);
        }
      });
    }).processSync(selector);
  } catch (error) {
    const fallback = selector.match(/\.([_a-zA-Z]+[\w-]*)/g) || [];
    for (const token of fallback) {
      result.add(token.slice(1));
    }
  }

  return Array.from(result);
}

function collectDeclarations(rule) {
  const declarations = [];

  for (const node of rule.nodes || []) {
    if (node.type === "decl") {
      declarations.push(`${node.prop}: ${node.value};`);
    }
  }

  return declarations.length ? declarations.join("\n") : "/* No direct declarations */";
}

function collectParentAtRules(rule) {
  const labels = [];
  let current = rule.parent;

  while (current) {
    if (current.type === "atrule") {
      labels.unshift(`@${current.name}${current.params ? ` ${current.params}` : ""}`);
    }
    current = current.parent;
  }

  return labels.join(" -> ");
}

function combineContextLabels(left, right) {
  if (left && right) {
    return `${left} -> ${right}`;
  }
  return left || right || "";
}

function isInsideKeyframes(rule) {
  let current = rule.parent;
  while (current) {
    if (current.type === "atrule" && /keyframes$/i.test(current.name || "")) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

module.exports = {
  parseCssEntries,
  extractInlineStyleContext,
  extractStyleDependencies,
  collectRegexMatches
};
