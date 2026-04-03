# Local CSS IntelliSense

[简体中文](./README.zh-CN.md) | English

Local CSS IntelliSense is a VS Code extension for teams that maintain their own global CSS, SCSS, or Less files.

It indexes local style classes in your workspace and provides:

- class name completion inside `class=""`, `className=""`, and common Vue class bindings
- hover previews that show the original CSS rule content
- go to definition / peek definition for local global classes
- automatic indexing, plus manual file, folder, or glob-based configuration

## Why This Extension

This extension is built for projects that rely on local global styles instead of utility-only workflows such as Tailwind CSS.

It helps you answer these questions without constantly switching files:

- Which classes already exist in this project?
- What does this class actually look like?
- Where is this class defined?

## Features

- Index `css`, `scss`, and `less` files in the current workspace
- Watch indexed files and update the cache automatically
- Show a short declaration summary in the completion list
- Preview the full rule block on hover
- Jump directly to the source style definition

## Configuration

Open VS Code settings and search for `Local CSS IntelliSense`.

- `localCssIntelliSense.enableAutoIndex`
- `localCssIntelliSense.entryFiles`
- `localCssIntelliSense.include`
- `localCssIntelliSense.exclude`
- `localCssIntelliSense.maxFileSizeKB`
- `localCssIntelliSense.maxEntriesPerHover`

Example:

```json
{
  "localCssIntelliSense.entryFiles": [
    "src/styles/global.css",
    "src/styles",
    "src/styles/**/*.scss"
  ],
  "localCssIntelliSense.exclude": [
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**"
  ]
}
```

`entryFiles` supports:

- a single file, such as `src/styles/global.css`
- a folder, such as `src/styles`
- a glob, such as `src/styles/**/*.scss`

## Development

1. Install dependencies:

```bash
npm install
```

2. Open this folder in VS Code.
3. Press `F5` to launch the Extension Development Host.
4. Open any project that contains CSS files and try:
   - typing inside `class=""`
   - hovering on a class name
   - using `Go to Definition` on a class name

## Commands

- `Local CSS IntelliSense: Refresh Index`

## Current Scope

This extension currently focuses on local global styles. It does not aim to fully understand:

- CSS Modules
- runtime-generated class strings
- advanced framework-specific class expression analysis

## Packaging

To generate a local `.vsix` package:

```bash
npm install -g @vscode/vsce
vsce package
```
