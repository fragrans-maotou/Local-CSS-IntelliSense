# Local CSS IntelliSense

VS Code extension that indexes your workspace CSS classes and exposes:

- class name completion inside `class=""` and `className=""`
- hover previews that show the matching CSS declarations
- go to definition / peek definition for local global classes
- automatic indexing plus manual entry file configuration

## Features

This extension is designed for projects that maintain their own global CSS files instead of utility-only workflows such as Tailwind.

It scans CSS, SCSS, and Less files in the current workspace, extracts class selectors, keeps them in memory, and updates the cache whenever indexed files change.

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

`entryFiles` now accepts three forms:

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
   - `Go to Definition` on a class name

## Commands

- `Local CSS IntelliSense: Refresh Index`

## Current Scope

This MVP focuses on local global styles. It intentionally does not try to fully understand:

- CSS Modules
- runtime-generated class strings
- advanced framework-specific class expression analysis

## Packaging

If you want to package the extension later:

```bash
npm install -g @vscode/vsce
vsce package
```
