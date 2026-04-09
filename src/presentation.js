const path = require("path");
const vscode = require("vscode");
const { escapeMarkdown, splitEntriesBySource } = require("./utils");

function buildContextualHoverMarkdown(localEntries, globalEntries, limit, compact = false) {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.isTrusted = false;
  markdown.supportHtml = false;

  const localGroups = splitEntriesBySource(localEntries);
  appendHoverSection(markdown, compact ? "" : "当前文件样式 / Current File Styles", localGroups.inline, limit, compact);
  appendHoverSection(markdown, compact ? "" : "引入样式 / Imported Styles", localGroups.imported, limit, compact);
  appendHoverSection(markdown, compact ? "" : "全局样式 / Global Styles", globalEntries, limit, compact);

  if (!compact && !localEntries.length && !globalEntries.length) {
    markdown.appendMarkdown("_No matching styles_");
  }

  return markdown;
}

function createCompletionItem(className, entries, range, isContextual) {
  const item = new vscode.CompletionItem(className, vscode.CompletionItemKind.Class);
  const primary = entries[0];
  const localEntries = entries.filter((entry) => (entry.sourceKind || "global") !== "global");
  const globalEntries = entries.filter((entry) => (entry.sourceKind || "global") === "global");
  item.range = range;
  item.insertText = className;
  item.filterText = className;
  item.sortText = `${isContextual ? "0" : "1"}-${className}`;
  item.detail = primary ? createEntrySummary(primary) : "Local CSS class";
  item.description = primary ? path.basename(primary.filePath) : "Local CSS";
  item.documentation = buildContextualHoverMarkdown(localEntries.slice(0, 2), globalEntries.slice(0, 1), 3, true);
  return item;
}

function appendHoverSection(markdown, title, entries, limit, compact) {
  if (!entries.length) {
    return;
  }

  if (!compact && title) {
    markdown.appendMarkdown(`**${title}**\n\n`);
  }

  for (const entry of entries.slice(0, limit)) {
    markdown.appendCodeblock(formatRulePreview(entry), "css");
    if (!compact) {
      const relativePath = vscode.workspace.asRelativePath(entry.filePath, false).replace(/\\/g, "/");
      markdown.appendMarkdown(`Source: \`${escapeMarkdown(relativePath)}:${entry.line}\``);
      if (entry.contextLabel) {
        markdown.appendMarkdown(`  \nContext: \`${escapeMarkdown(entry.contextLabel)}\``);
      }
      markdown.appendMarkdown("\n\n");
    }
  }

  if (entries.length > limit) {
    markdown.appendMarkdown(`_+${entries.length - limit} more match(es)_\n\n`);
  }
}

function formatRulePreview(entry) {
  const lines = [`${entry.selector} {`];
  for (const declarationLine of entry.declarations.split("\n")) {
    lines.push(`  ${declarationLine}`);
  }
  lines.push("}");
  return lines.join("\n");
}

function createEntrySummary(entry) {
  const oneLine = entry.declarations.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    return entry.selector;
  }
  if (oneLine.length <= 72) {
    return oneLine;
  }
  return `${oneLine.slice(0, 69)}...`;
}

module.exports = {
  buildContextualHoverMarkdown,
  createCompletionItem
};
