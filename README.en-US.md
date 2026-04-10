# Local CSS IntelliSense

[中文](./README.zh-CN.md) | [English](./README.en-US.md)

`Local CSS IntelliSense` is a VS Code extension for teams that maintain their own local `css / scss / less` style systems.

It is designed for projects where developers often need to answer questions like:

- Which class names already exist in this project?
- What does this class actually do?
- Is this class defined in the current file, an imported stylesheet, or a global stylesheet?

## Features

- class name completion inside `class=""`, `className=""`, and common `:class` bindings
- hover previews with the original CSS rule content
- go to definition / peek definition support
- grouped results for current-file styles, imported styles, and global styles
- automatic indexing for likely global-style locations
- manual configuration for files, folders, and glob patterns

## Default Indexing Strategy

By default, the extension focuses on style locations that are more likely to contain useful project-level styles, such as:

- `src/styles`
- `src/assets/styles`
- `styles`
- `style`
- common entry files like `global.css`, `global.scss`, `base.css`, `common.scss`, and `theme.css`

The following content is ignored by default:

- `node_modules`
- `dist`
- `build`
- `.next`
- `.nuxt`
- `coverage`
- CSS Modules
- `.min.css / .min.scss / .min.less`

## Configuration

Search for `Local CSS IntelliSense` in VS Code settings.

Common settings:

- `localCssIntelliSense.enableAutoIndex`
- `localCssIntelliSense.entryFiles`
- `localCssIntelliSense.include`
- `localCssIntelliSense.exclude`
- `localCssIntelliSense.maxFileSizeKB`
- `localCssIntelliSense.maxEntriesPerHover`
- `localCssIntelliSense.maxIndexedFiles`

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

1. Install dependencies

```bash
npm install
```

2. Open this folder in VS Code
3. Press `F5` to start the Extension Development Host
4. Test common scenarios in a frontend project:

- type inside `class=""`
- hover on a class name
- run `Go to Definition` on a class name

## Command

- `Local CSS IntelliSense: Refresh Index`

## Architecture

If you want to understand how the extension is structured internally, see:

- [Architecture Document](./docs/ARCHITECTURE.md)

## Packaging

```bash
npm install -g @vscode/vsce
vsce package
```
