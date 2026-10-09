# Mermaid 浏览器依赖

- 包：`mermaid`，固定版本 `12.1.0`。
- 文件：`mermaid.min.js`，经典浏览器构建，可直接以 `<script>` 加载。
- 下载地址：<https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js>
- SHA-256：`6484afc32872a3aa16cac9a76ba1816a1ed4cc870a6593cc2e17757750f518b2`
- 获取日期：2026-10-08。
- 许可证：MIT，原文见同目录 `LICENSE`，来自同版本包的 `/LICENSE`。

原型直接加载本地副本，无需连接 CDN 或安装 npm 依赖。请与 HTML、`assets/book-graph.js` 一起保留。它负责 Mermaid 的语法校验和 SVG 渲染，不负责概念提取或 AI 调用。

Reador 使用 `securityLevel: strict`、关闭 HTML 标签、限制源码长度与边数，并限制为基础 flowchart / graph 语法。源码前置检查只是额外限制，不应被当作通用安全沙箱。升级版本时复核许可证、校验和、SVG 节点定位、导出和浏览器交互。
