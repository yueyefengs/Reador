# 上游来源与 Reador 使用方式

- 上游：[axtonliu/axton-obsidian-visual-skills](https://github.com/axtonliu/axton-obsidian-visual-skills)
- 固定提交：`1265976d9746a84858b4b7b42fb86a215aa93de9`
- 目录：`mermaid-visualizer/`
- 引入日期：2026-10-08
- 许可证：MIT，见同目录 `LICENSE`。
- `SKILL.md` 和 `references/syntax-rules.md` 保留上游原文；本文件为 Reador 的补充说明。

此 skill 提供内容分析、图表选择、布局与 Mermaid 语法指导。它不是书籍解析器、模型 API、Agent 运行时或渲染引擎。仅保存 skill 不会让浏览器自动具备 AI 生成功能。

Reador 的生成 Agent 应在图表规划阶段读取该 skill，并遵守项目对原文引用、结构化输出、所属书籍及内容版本的校验约束。浏览器使用固定版本的 Mermaid 渲染器负责最终语法校验和展示。

书籍关系图默认采用 `flowchart TB`：节点是概念，边有关系名称；只有纯层级结构才使用思维导图。复杂书籍拆成全书总览和章节子图。样式采用 Reador 的绿灰配色，不直接采用上游多色默认方案。

上游属于实验性提示词资源，文档中的语法经验不等于解析器保证。实际输出应交给所固定版本的 Mermaid 解析器校验；面向 Obsidian / GitHub 的 Markdown 采用基础语法，不承诺跨版本像素一致。
