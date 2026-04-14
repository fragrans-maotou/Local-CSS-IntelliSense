# Local CSS IntelliSense

[中文](./README.zh-CN.md) | [English](./README.en-US.md)

## 中文说明

`Local CSS IntelliSense` 是一个面向本地样式体系的 VS Code 插件，适合团队维护自己的 `css / scss / less` 全局样式、页面样式和局部引入样式时使用。

它主要解决 3 个问题：

- 记不住项目里已经有哪些类名
- 鼠标指到 class 时，看不到样式内容
- 想跳到样式定义时，不知道它来自当前文件、引入文件，还是全局样式

### 当前能力

- 在 `class=""`、`className=""`、常见 `:class` 场景里提供类名补全
- 鼠标悬停类名时展示对应 CSS 规则内容
- 支持 `Go to Definition / Peek Definition`
- 同时展示当前文件样式、当前文件引入的样式、全局样式
- 自动索引工作区中更像“全局样式入口”的目录和文件
- 支持手动配置文件、文件夹、glob 作为索引入口

### 默认索引范围

插件默认优先扫描这些更像全局样式的路径：

- `src/styles`
- `src/assets/styles`
- `styles`
- `style`
- `global.css / global.scss / base.css / common.scss / theme.css` 等常见入口

默认会忽略这些内容：

- `node_modules`
- `dist`
- `build`
- `.next`
- `.nuxt`
- `coverage`
- CSS Modules
- `.min.css / .min.scss / .min.less`

### 配置项

在 VS Code 设置中搜索 `Local CSS IntelliSense`，常用配置有：

- `localCssIntelliSense.enableAutoIndex`
- `localCssIntelliSense.entryFiles`
- `localCssIntelliSense.include`
- `localCssIntelliSense.exclude`
- `localCssIntelliSense.maxFileSizeKB`
- `localCssIntelliSense.maxEntriesPerHover`
- `localCssIntelliSense.maxIndexedFiles`

`maxIndexedFiles` 默认是 `400`，更适合大项目的轻量索引。

示例：

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

`entryFiles` 支持三种写法：

- 单个文件：`src/styles/global.css`
- 单个文件夹：`src/styles`
- glob：`src/styles/**/*.scss`

### 开发与调试

1. 安装依赖

```bash
npm install
```

2. 用 VS Code 打开当前目录
3. 按 `F5` 启动 Extension Development Host
4. 在测试项目里试这些场景：

- 在 `class=""` 中输入类名
- 鼠标悬停类名
- 对类名执行 `Go to Definition`

### 命令

- `Local CSS IntelliSense: Refresh Index`

### 设计文档

如果你想看插件是怎么设计和拆分的，可以直接看：

- [插件设计文档](./docs/ARCHITECTURE.md)

## English

`Local CSS IntelliSense` is a VS Code extension for projects that maintain their own `css / scss / less` styles instead of relying only on utility-first workflows.

It helps with three common problems:

- remembering which local classes already exist
- previewing what a class actually does without opening the style file
- jumping to the matching definition when styles may come from the current file, imported files, or global styles

### Features

- completion inside `class=""`, `className=""`, and common `:class` bindings
- hover previews with real CSS rule content
- go to definition / peek definition
- grouped matches for current-file styles, imported styles, and global styles
- automatic indexing for likely global-style locations
- configurable file, folder, and glob-based indexing

### Common Settings

- `localCssIntelliSense.enableAutoIndex`
- `localCssIntelliSense.entryFiles`
- `localCssIntelliSense.include`
- `localCssIntelliSense.exclude`
- `localCssIntelliSense.maxFileSizeKB`
- `localCssIntelliSense.maxEntriesPerHover`
- `localCssIntelliSense.maxIndexedFiles`

### Packaging

```bash
npm install -g @vscode/vsce
vsce package
```
