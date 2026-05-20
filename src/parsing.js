const path = require("path");
const { fileURLToPath, pathToFileURL } = require("url");
const less = require("less");
const postcss = require("postcss");
const postcssLess = require("postcss-less");
const safeParser = require("postcss-safe-parser");
const postcssScss = require("postcss-scss");
const sass = require("sass");
const selectorParser = require("postcss-selector-parser");
const { SourceMapConsumer } = require("source-map-js");

async function parseCssEntries(source, filePath, options = {}) {
  const extension = normalizeStyleExtension(options.languageExtension || filePath);
  const compiledResult = await compileStyleSource(source, filePath, extension);
  if (compiledResult) {
    try {
      return collectEntriesFromCompiledCss(compiledResult.css, filePath, compiledResult.sourceMap, options);
    } catch (error) {
      // Fall back to direct AST parsing if compiled CSS mapping cannot be read.
    }
  }

  const root = parseStyleRoot(source, filePath, extension);
  return collectEntriesFromRoot(root, filePath, options);
}

async function extractInlineStyleContext(document) {
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
    const inlineEntries = await parseCssEntries(content, document.uri.fsPath, {
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

async function compileStyleSource(source, filePath, extension) {
  if (!shouldCompilePreprocessorSource(source, extension)) {
    return undefined;
  }

  if (extension === ".scss") {
    return compileScssSource(source, filePath);
  }

  if (extension === ".less") {
    return compileLessSource(source, filePath);
  }

  return undefined;
}

async function compileScssSource(source, filePath) {
  try {
    const result = sass.compileString(source, {
      url: pathToFileURL(filePath),
      loadPaths: [path.dirname(filePath), process.cwd()],
      sourceMap: true,
      style: "expanded"
    });

    return {
      css: result.css || "",
      sourceMap: result.sourceMap || undefined
    };
  } catch (error) {
    return undefined;
  }
}

async function compileLessSource(source, filePath) {
  try {
    const result = await less.render(source, {
      filename: filePath,
      paths: [path.dirname(filePath), process.cwd()],
      javascriptEnabled: true,
      sourceMap: {
        outputSourceFiles: true
      }
    });

    return {
      css: stripSourceMappingComment(result.css || ""),
      sourceMap: result.map ? JSON.parse(result.map) : undefined
    };
  } catch (error) {
    return undefined;
  }
}

function stripSourceMappingComment(css) {
  return css.replace(/\/\*# sourceMappingURL=.*?\*\/\s*$/s, "");
}

function parseStyleRoot(source, filePath, extension) {
  if (extension === ".scss") {
    return postcssScss.parse(source, { from: filePath });
  }

  if (extension === ".less") {
    return postcssLess.parse(source, { from: filePath });
  }

  return postcss.parse(source, {
    from: filePath,
    parser: safeParser
  });
}

function collectEntriesFromRoot(root, filePath, options = {}) {
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

    const location = rule.source && rule.source.start ? rule.source.start : { line: 1, column: 1 };
    const adjustedLocation = applyInlineOffsets(filePath, filePath, location.line || 1, location.column || 1, lineOffset, columnOffset);
    pushEntries(entries, {
      rule,
      classNames,
      filePath: adjustedLocation.filePath,
      line: adjustedLocation.line,
      column: adjustedLocation.column,
      contextLabel: extraContextLabel,
      sourceKind: options.sourceKind || "global"
    });
  });

  return entries;
}

function collectEntriesFromCompiledCss(source, generatedFilePath, sourceMap, options = {}) {
  const root = postcss.parse(source, {
    from: generatedFilePath,
    parser: safeParser
  });
  const entries = [];
  const consumer = sourceMap ? new SourceMapConsumer(sourceMap) : undefined;

  try {
    root.walkRules((rule) => {
      if (!rule.selector || isInsideKeyframes(rule)) {
        return;
      }

      const classNames = extractClassNames(rule.selector);
      if (!classNames.length) {
        return;
      }

      const generatedLocation = rule.source && rule.source.start ? rule.source.start : { line: 1, column: 1 };
      const mappedLocation = mapGeneratedLocation(consumer, generatedLocation, generatedFilePath);
      const adjustedLocation = applyInlineOffsets(
        mappedLocation.filePath,
        generatedFilePath,
        mappedLocation.line,
        mappedLocation.column,
        options.lineOffset || 0,
        options.columnOffset || 0
      );

      pushEntries(entries, {
        rule,
        classNames,
        filePath: adjustedLocation.filePath,
        line: adjustedLocation.line,
        column: adjustedLocation.column,
        contextLabel: options.contextLabel || "",
        sourceKind: options.sourceKind || "global"
      });
    });
  } finally {
    if (consumer && typeof consumer.destroy === "function") {
      consumer.destroy();
    }
  }

  return entries;
}

function pushEntries(target, payload) {
  const declarationBlock = collectDeclarations(payload.rule);
  const parentContext = collectParentAtRules(payload.rule);
  const finalContextLabel = combineContextLabels(payload.contextLabel, parentContext);

  for (const className of payload.classNames) {
    target.push({
      className,
      selector: payload.rule.selector,
      filePath: payload.filePath,
      line: payload.line,
      column: payload.column,
      declarations: declarationBlock,
      contextLabel: finalContextLabel,
      sourceKind: payload.sourceKind
    });
  }
}

function mapGeneratedLocation(consumer, generatedLocation, generatedFilePath) {
  if (!consumer) {
    return {
      filePath: generatedFilePath,
      line: generatedLocation.line || 1,
      column: generatedLocation.column || 1
    };
  }

  const original = consumer.originalPositionFor({
    line: generatedLocation.line || 1,
    column: Math.max(0, (generatedLocation.column || 1) - 1)
  });

  if (!original || !original.source || !original.line) {
    return {
      filePath: generatedFilePath,
      line: generatedLocation.line || 1,
      column: generatedLocation.column || 1
    };
  }

  return {
    filePath: resolveOriginalSourcePath(original.source, generatedFilePath),
    line: original.line,
    column: (original.column || 0) + 1
  };
}

function resolveOriginalSourcePath(source, generatedFilePath) {
  if (!source) {
    return generatedFilePath;
  }

  if (/^file:/i.test(source)) {
    try {
      return fileURLToPath(source);
    } catch (error) {
      return generatedFilePath;
    }
  }

  if (path.isAbsolute(source)) {
    return source;
  }

  return path.resolve(path.dirname(generatedFilePath), source);
}

function applyInlineOffsets(entryFilePath, baseFilePath, line, column, lineOffset, columnOffset) {
  const resolvedEntryPath = path.resolve(entryFilePath);
  const resolvedBasePath = path.resolve(baseFilePath);
  if (resolvedEntryPath !== resolvedBasePath) {
    return {
      filePath: entryFilePath,
      line,
      column
    };
  }

  return {
    filePath: entryFilePath,
    line: line + lineOffset,
    column: line === 1 ? column + columnOffset : column
  };
}

function normalizeStyleExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

function shouldCompilePreprocessorSource(source, extension) {
  if (extension === ".scss") {
    return /#\{\s*\$|@(use|forward|import|include|mixin|function|each|for|while|if|extend|at-root)\b/.test(source);
  }

  if (extension === ".less") {
    return /@\{[\w-]+\}|(?:^|[\s;{])each\s*\(|@import\b|[.#][\w-]+\s*\([^)]*\)\s*;/m.test(source);
  }

  return false;
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
