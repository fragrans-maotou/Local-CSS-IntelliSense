# Local CSS IntelliSense

简体中文 | [English](./README.md)

`Local CSS IntelliSense` 是一个面向本地全局样式项目的 VS Code 插件，适合团队维护自己的 `css / scss / less` 样式体系时使用。

它会索引当前工作区里的本地样式类名，并提供：

- 在 `class=""`、`className=""` 和常见 Vue class 绑定中的类名补全
- 悬停查看原始 CSS 规则内容
- 跳转到类名定义 / Peek Definition
- 自动索引，以及手动配置文件、文件夹、glob 的索引方式

## 适用场景

这个插件更适合下面这类项目：

- 团队长期维护自定义全局样式
- 类名很多，但并不是 Tailwind 这类原子化方案
- 经常忘记某个类写在哪里、具体长什么样
- 希望在写模板时直接看到已有样式，而不是频繁切换文件

## 功能说明

- 索引当前工作区中的 `css`、`scss`、`less`
- 文件变更后自动更新缓存
- 在补全列表中显示样式摘要
- 悬停时展示完整规则块
- 支持直接跳转到样式定义位置

## 配置项

在 VS Code 设置中搜索 `Local CSS IntelliSense`。

- `localCssIntelliSense.enableAutoIndex`
- `localCssIntelliSense.entryFiles`
- `localCssIntelliSense.include`
- `localCssIntelliSense.exclude`
- `localCssIntelliSense.maxFileSizeKB`
- `localCssIntelliSense.maxEntriesPerHover`

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

`entryFiles` 现在支持三种写法：

- 单个文件，例如 `src/styles/global.css`
- 单个文件夹，例如 `src/styles`
- glob 模式，例如 `src/styles/**/*.scss`

## 本地开发

1. 安装依赖：

```bash
npm install
```

2. 用 VS Code 打开当前目录。
3. 按 `F5` 启动 Extension Development Host。
4. 打开任意包含 CSS 文件的项目并测试：
   - 在 `class=""` 里输入类名
   - 悬停在类名上看样式
   - 对类名执行 `Go to Definition`

## 命令

- `Local CSS IntelliSense: Refresh Index`

## 当前范围

当前版本主要聚焦“本地全局样式”，暂时不打算完整覆盖：

- CSS Modules
- 运行时动态拼接类名
- 各框架非常复杂的 class 表达式分析

## 打包

如果你要本地生成 `.vsix` 安装包：

```bash
npm install -g @vscode/vsce
vsce package
```
