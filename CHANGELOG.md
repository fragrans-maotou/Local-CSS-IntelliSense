# Changelog

## 0.0.10

- 兼容 `src/style/**` 这类目录型 glob 配置，自动转换成只匹配样式文件的 glob / Normalize directory-style glob patterns such as `src/style/**` into style-file-only globs.
- 将默认单文件大小上限提升到 `2048KB`，减少大型 `index.less` / `global.scss` 被直接跳过的情况 / Raise the default per-file size limit to `2048KB` so large `index.less` and `global.scss` files are less likely to be skipped.

## 0.0.9

- 扩大默认自动索引目录，补充 `packages`、`apps`、`shared`、`theme` 等大仓常见样式位置 / Expand the default auto-index paths to cover common monorepo style locations such as `packages`, `apps`, `shared`, and `theme`.
- 在默认命中较少时增加受控的工作区兜底扫描，降低“大项目里完全扫不到”的概率 / Add a controlled workspace fallback scan when the default matches are too few, reducing the chance of finding nothing in large projects.
- 将全量索引改为分批处理，改善大型工作区的启动与刷新卡顿 / Batch global indexing work to improve startup and refresh performance in large workspaces.
- 新增 `maxIndexedFiles` 配置，用于控制大型项目的全局索引规模 / Add `maxIndexedFiles` so large projects can cap global index size for better performance.

## 0.0.8

- 重构源码结构，将入口、索引、解析、上下文识别、展示逻辑拆分到独立模块中 / Refactor the source tree by splitting entry, indexing, parsing, context detection, and presentation into separate modules.
- 新增项目设计文档，方便后续维护和二次开发 / Add a project design document for easier maintenance and extension.
- 调整 README 为中文优先，并补全双语说明 / Rewrite the README with Chinese-first bilingual documentation.
- 调整 CHANGELOG 为中英文双语记录 / Rewrite the changelog in bilingual Chinese and English.

## 0.0.7

- 修复多行 `class`、`className`、`:class` 场景下的悬停、跳转与类名识别 / Fix hover, definition, and class detection for multi-line `class`, `className`, and `:class` values.
- 将匹配结果按当前文件样式、引入样式、全局样式排序 / Sort matching rules as current-file styles, imported styles, then global styles.
- 监听本地样式文件变化，保持悬停和跳转结果及时更新 / Watch local style-file changes so hover and definition stay in sync.
- 支持 `@/`、`~/` 等常见样式别名路径解析 / Resolve common workspace aliases such as `@/` and `~/` for imported style files.

## 0.0.6

- 将插件入口收敛为单个 `src/extension.js` 文件 / Consolidate the extension into a single `src/extension.js` entry file.
- 默认自动索引范围收敛到更像全局样式的路径 / Narrow default auto-indexing to likely global style paths.
- 默认排除构建产物、`node_modules`、压缩样式和 CSS Modules / Keep build output, `node_modules`, minified files, and CSS Modules out of the index by default.
- 支持解析当前文档内联样式和直接引入的样式文件 / Resolve current-document inline styles and directly imported style files for hover and definition.
- 同时展示当前文档相关样式与全局样式 / Show current-document-related styles alongside global styles for the same class.

## 0.0.5

- 新增面向 Marketplace 的双语 README / Add bilingual Marketplace-facing README files.
- 调整插件描述，兼顾中文和英文读者 / Update extension description for both Chinese and English readers.

## 0.0.4

- 在补全项里显示样式声明摘要 / Show a short CSS declaration summary in completion items.
- `entryFiles` 支持文件夹配置 / Allow `entryFiles` to accept folders in addition to files and glob patterns.

## 0.0.3

- 在 `class`、`className`、`:class` 中输入时主动触发提示 / Trigger class suggestions while typing inside `class`, `className`, and `:class` values.
- 简化 hover 样式展示，更接近原始 CSS 代码块 / Simplify hover preview so it looks closer to the original CSS rule block.
- 收紧激活范围，减少不必要的启动开销 / Tighten activation events to reduce unnecessary startup work.

## 0.0.2

- 增加仓库元信息和打包能力 / Add repository metadata and release packaging support.

## 0.0.1

- 初始 MVP 版本 / Initial MVP release.
- 支持工作区 CSS、SCSS、Less 索引 / Workspace CSS, SCSS, and Less indexing.
- 支持常见 `class` 与 `className` 场景下的类名补全 / Class completion inside common `class` and `className` contexts.
- 支持 hover 查看样式规则 / Hover preview for matching CSS declarations.
- 支持跳转定义 / Go to definition and peek definition support.
- 支持文件监听和手动刷新命令 / File watching plus manual refresh command.
