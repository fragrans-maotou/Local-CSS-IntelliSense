const vscode = require("vscode");

function getClassNameAtPosition(document, position) {
  const classContext = getClassValueContext(document, position);
  if (!classContext) {
    return undefined;
  }

  const source = document.getText();
  const offset = document.offsetAt(position);
  const tokenRange = getClassTokenOffsetRange(source, offset, classContext);
  if (!tokenRange) {
    return undefined;
  }

  const token = source.slice(tokenRange.start, tokenRange.end);
  if (!token) {
    return undefined;
  }

  return normalizeClassName(token);
}

function getCurrentClassToken(document, position, classContext) {
  const source = document.getText();
  const offset = document.offsetAt(position);
  let start = offset;
  let end = offset;

  while (start > classContext.valueStartOffset && /[\w-]/.test(source[start - 1])) {
    start -= 1;
  }

  while (end < classContext.valueEndOffset && /[\w-]/.test(source[end])) {
    end += 1;
  }

  return {
    text: source.slice(start, offset),
    range: new vscode.Range(document.positionAt(start), document.positionAt(end))
  };
}

function getClassValueContext(document, position) {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const openingQuoteIndex = findMatchingClassQuoteStart(source, offset);
  if (openingQuoteIndex < 0) {
    return undefined;
  }

  const quoteChar = source[openingQuoteIndex];
  const closingQuoteIndex = findClosingQuote(source, openingQuoteIndex, quoteChar);
  const valueStartOffset = openingQuoteIndex + 1;
  const valueEndOffset = closingQuoteIndex >= 0 ? closingQuoteIndex : source.length;

  if (offset < valueStartOffset || offset > valueEndOffset) {
    return undefined;
  }

  return {
    valueStartOffset,
    valueEndOffset,
    quoteChar
  };
}

function getClassNamesInContext(document, classContext) {
  if (!classContext) {
    return [];
  }

  const source = document.getText();
  const value = source.slice(classContext.valueStartOffset, classContext.valueEndOffset);
  return value
    .split(/\s+/)
    .map((token) => normalizeClassName(token))
    .filter((token) => /^[A-Za-z0-9_-]+$/.test(token));
}

function getClassTokenOffsetRange(source, offset, classContext) {
  let start = offset;
  let end = offset;

  while (start > classContext.valueStartOffset && /[\w-]/.test(source[start - 1])) {
    start -= 1;
  }

  while (end < classContext.valueEndOffset && /[\w-]/.test(source[end])) {
    end += 1;
  }

  if (start === end) {
    return undefined;
  }

  return { start, end };
}

function findMatchingClassQuoteStart(source, offset) {
  const minIndex = Math.max(0, offset - 4000);
  for (let index = Math.min(offset - 1, source.length - 1); index >= minIndex; index -= 1) {
    const char = source[index];
    if (!isQuoteCharacter(char) || isEscapedCharacter(source, index)) {
      continue;
    }

    const prefix = source.slice(Math.max(0, index - 160), index);
    const isAttributeValue = /(?:^|[\s<(])(?:class|className|:class)\s*=\s*$/i.test(prefix);
    const isClsxValue = /(?:clsx|classnames)\(\s*$/.test(prefix);
    if (!isAttributeValue && !isClsxValue) {
      continue;
    }

    const closingQuoteIndex = findClosingQuote(source, index, char);
    if (closingQuoteIndex >= 0 && closingQuoteIndex < offset) {
      continue;
    }

    return index;
  }

  return -1;
}

function findClosingQuote(source, openingIndex, quoteChar) {
  for (let index = openingIndex + 1; index < source.length; index += 1) {
    if (source[index] === quoteChar && !isEscapedCharacter(source, index)) {
      return index;
    }
  }
  return -1;
}

function isEscapedCharacter(source, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isQuoteCharacter(char) {
  return char === "\"" || char === "'" || char === "`";
}

function normalizeClassName(token) {
  return token.trim().replace(/^\./, "");
}

module.exports = {
  getClassNameAtPosition,
  getCurrentClassToken,
  getClassValueContext,
  getClassNamesInContext
};
