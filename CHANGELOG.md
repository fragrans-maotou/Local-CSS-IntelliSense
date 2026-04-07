# Changelog

## 0.0.6

- consolidate the extension into a single `src/extension.js` entry file
- narrow default auto-indexing to likely global style paths
- keep build output, `node_modules`, minified files, and CSS Modules out of the index by default
- resolve current-document inline styles and directly imported style files for hover and definition
- show current-document-related styles alongside global styles for the same class

## 0.0.5

- add bilingual Marketplace-facing README files
- update extension description for both Chinese and English readers

## 0.0.4

- show a short CSS declaration summary in completion items
- allow `entryFiles` to accept folders in addition to files and glob patterns

## 0.0.3

- trigger class suggestions while typing inside `class`, `className`, and `:class` values
- simplify hover preview so it looks closer to the original CSS rule block
- tighten activation events to reduce unnecessary startup work

## 0.0.2

- add repository metadata and release packaging support

## 0.0.1

- Initial MVP release
- Workspace CSS, SCSS, and Less indexing
- Class completion inside common `class` and `className` contexts
- Hover preview for matching CSS declarations
- Go to definition / peek definition support
- File watching plus manual refresh command
