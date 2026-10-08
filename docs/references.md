# Learny 与 Tutor 参考研究

研究日期：2026-10-07。依据仓库 README、架构决策与关键源代码进行静态核对，未运行两个应用，也未验证其真实模型效果。下文区分上游已观察到的实现与 Reador 的设计建议。

## 参考版本

| 项目 | 核对版本 | 定位 | 许可证 |
| --- | --- | --- | --- |
| [Learny](https://github.com/augusto-dmh/learny) | `ccfb37da4f72330ca3ec1aec016733365dee04d7` | 导入原书，保留结构与引用，支持问答、教学和复习 | Apache-2.0 |
| [Tutor](https://github.com/rsml/tutor) | `e3fce17bf0f4aceeb24d5e7d0bfbfdf88bd95a8e` | 依据个人档案与学习反馈生成、调整学习书籍 | GPL-3.0 |

本次采用产品与架构思路，没有复制上游代码。后续如直接复用代码，应记录来源并遵守相应许可证；Tutor 的 GPL 条件需要结合实际复用和分发方式处理。参考项目的许可证不会自动成为 Reador 的许可证。

## 借鉴方向

Reador 的组合方向是：**Learny 的原书阅读与证据链 + Tutor 的反馈驱动教学 + 知识点图谱与主动回忆评分**。

| 能力 | Learny 中观察到的做法 | Tutor 中观察到的做法 | Reador 的选择 |
| --- | --- | --- | --- |
| 内容来源 | EPUB / PDF 解析成结构化语料，再派生检索片段 [L1][L2] | 输入主题生成目录与章节，也支持 EPUB 导入 [T1] | 首版围绕用户导入的书；保留原文，生成独立的辅助内容 |
| 阅读工作台 | 阅读器为中心，问答、教学、笔记、复习在侧边面板 [L1] | 选中文字后在阅读中发起解释 [T1][T3] | 原文常驻，选段触发解释、教学或检测 |
| 可追溯性 | 保留章节锚点；引用与题目摘录经服务端核对 [L2][L4][L7] | 选段解释使用章节上下文生成回答 [T3] | 采用原文定位和引用校验；长章节不静默截断 |
| 个性化 | 章节范围内的渐进提示教学 [L5][L6] | 下一章生成结合个人档案、历史反馈、测验得分和错题 [T2] | 按已有基础、错误类型和用户偏好调整讲解与练习 |
| 学习检测 | 自由回忆与填空卡，用户用四档评级 [L4] | 章节选择题按正确选项确定性评分 [T4] | 主动回忆和简答优先，按评分要点提供 AI 反馈，最终记忆评级另行确认 |
| 复习 | 真正的 FSRS 适配层，内容、调度、历史分离 [L3][L4] | Smart Review 从最近一次答题中挑出错题并按章节排序 [T5] | FSRS 负责长期排期，错题用于当前补救和练习选择 |
| 工程结构 | Python / FastAPI、Next.js、PostgreSQL、独立任务执行进程 [L1] | TypeScript、React / Fastify、Electron、本地 Markdown / YAML [T1] | 首版维持 TypeScript Web 单体，外部依赖通过接口适配 |
| 测试 | 确定性 AI 适配器与引用、调度测试 [L1][L3] | 业务依赖接口，使用假适配器和契约测试 [T6] | 无密钥测试验证流程，真实模型样例另行评估质量 |

### 已核实的两个差别

**Tutor 的自适应对象是生成的后续章节。** `generate-next-chapter.ts` 会把历史喜欢 / 不喜欢的反馈、测验得分、错题以及学习档案放入生成上下文。Reador 面对已有原书，将这种机制用于讲解、例子、练习和下一步学习建议；原文及作者论点不能随用户水平改变。

**Tutor 的 Smart Review 不能等同于 FSRS。** README 将其描述为间隔复习，但所核对的队列实现仅选择最近一次答错的问题并按章节排序，没有按到期时间、记忆稳定性或难度计算复习日程。Learny 的适配器则直接使用 `fsrs.Scheduler`，保存并恢复卡片状态。Reador 采用后者的调度思路。

在本次核对的 README 和核心代码中，没有确认两者具备满足 Reador 要求的“带来源的概念关系图谱”。Tutor 的 Mermaid 内容渲染也不等于知识点掌握图谱。图谱、简答 AI 评分与评分纠正需要单独实现和验收。

## 首版交互落点

### 阅读工作台

桌面端保留目录、原文和辅助面板，辅助面板可折叠。选中一段文字时显示三个动作：

- **解释这段**：给出简洁解释与引用，支持继续追问。
- **引导我理解**：先问一个诊断问题，依据回答逐步提示，用户随时可以选择直接讲解或结束。
- **测测我**：进入独立检测状态，收起答案、讲解和原文；提交后展示评分依据与返回原文入口。

总结、图谱、问答和教学共享当前书籍及章节上下文。界面显示回答范围；选段或章节内证据不足时，提供扩大范围的动作，由用户主动选择，不能静默搜索后续章节。

### 适应用户的教学

首版只需可跳过的学习目标、已有基础与解释偏好，无需长问卷。教学优先使用用户已确认的偏好和本章实际作答证据，资料缺省不阻碍阅读。

以“把两个概念混淆”为例：先定位各自定义和差异，再给一个针对差异的对比例子，随后用不同情境提问。例子若为 AI 补充，应与原书内容区分。换题保持知识目标不变，不能通过降低评分标准来制造掌握感。

引导教学与正式检测使用不同状态。教学中可以先提示；检测中请求提示、查看原文或直接看答案都要记录，不能与无提示回忆混为一谈。

### 复习与内容更新

题面、知识目标、卡片身份、调度状态分别建模。重生成题面或重导入同一本书时，验证旧来源是否还能匹配；匹配失败则标记需要核对并暂停该卡自动出题，保留已有学习记录与 FSRS 状态。

图谱上的节点可显示“尚未检测 / 需要巩固 / 本轮通过”等状态，并进入该知识点的解释与练习。图谱状态依据学习记录生成，长期掌握判断需要跨时间证据。

## 对现有方案的调整

1. 导入链路增加原文结构块与稳定锚点，检索片段只是派生索引。
2. 问答和教学共用会话结构，以检索范围和每轮模式区分行为。
3. 教学策略记录提示阶段、错误点、辅助内容版本及采用的学习证据。
4. 题目内容、卡片调度和复习历史独立持久化，重生成不能重置进度。
5. 先完成单章阅读、选段讲解、主动回忆和 FSRS，再扩大整书检索与个性化能力。

保留现有 TypeScript / Next.js + PostgreSQL 技术建议。Learny 的 OCR、Celery、Anki / Obsidian 导出，以及 Tutor 的整书生成、Electron、有声书与封面生成，不进入当前首版。

## 固定版本的证据入口

- **L1**：[Learny README][L1]，产品流程与整体架构。
- **L2**：[结构化原文决策][L2]，原文结构与派生 Markdown / 片段的关系。
- **L3**：[FSRS 适配器][L3]，实际使用的调度库与状态转换。
- **L4**：[主动回忆设计][L4]，卡片来源、四档评级及内容 / 调度 / 历史分离。
- **L5**：[统一会话模型][L5]，范围、回答模式与教学模式。
- **L6**：[渐进提示状态策略][L6]，提示升级、直接讲解与检测转换。
- **L7**：[题目质量校验][L7]，摘录验证与题面校验。
- **T1**：[Tutor README][T1]，个人档案、创建、阅读、测验与适应流程。
- **T2**：[下一章生成][T2]，学习档案与历史反馈如何进入生成上下文。
- **T3**：[选段解释][T3]，选中文字与周边章节的问答方式。
- **T4**：[选择题评分][T4]，按正确选项比较的评分逻辑。
- **T5**：[Smart Review 队列][T5]，最近一次错题筛选与章节排序。
- **T6**：[外部依赖接口与契约测试][T6]，真实适配器和假适配器的边界。

[L1]: https://github.com/augusto-dmh/learny/blob/ccfb37da4f72330ca3ec1aec016733365dee04d7/README.md
[L2]: https://github.com/augusto-dmh/learny/blob/ccfb37da4f72330ca3ec1aec016733365dee04d7/docs/adr/0002-canonical-document-format.md
[L3]: https://github.com/augusto-dmh/learny/blob/ccfb37da4f72330ca3ec1aec016733365dee04d7/backend/app/infrastructure/scheduling/fsrs.py
[L4]: https://github.com/augusto-dmh/learny/blob/ccfb37da4f72330ca3ec1aec016733365dee04d7/docs/adr/0021-active-recall-design.md
[L5]: https://github.com/augusto-dmh/learny/blob/ccfb37da4f72330ca3ec1aec016733365dee04d7/docs/adr/0029-unified-grounded-conversations.md
[L6]: https://github.com/augusto-dmh/learny/blob/ccfb37da4f72330ca3ec1aec016733365dee04d7/backend/app/application/teaching_policy.py
[L7]: https://github.com/augusto-dmh/learny/blob/ccfb37da4f72330ca3ec1aec016733365dee04d7/backend/app/application/quiz_qc.py
[T1]: https://github.com/rsml/tutor/blob/e3fce17bf0f4aceeb24d5e7d0bfbfdf88bd95a8e/README.md
[T2]: https://github.com/rsml/tutor/blob/e3fce17bf0f4aceeb24d5e7d0bfbfdf88bd95a8e/server/services/generate-next-chapter.ts
[T3]: https://github.com/rsml/tutor/blob/e3fce17bf0f4aceeb24d5e7d0bfbfdf88bd95a8e/server/services/explain-passage.ts
[T4]: https://github.com/rsml/tutor/blob/e3fce17bf0f4aceeb24d5e7d0bfbfdf88bd95a8e/server/domain/quiz-scoring.ts
[T5]: https://github.com/rsml/tutor/blob/e3fce17bf0f4aceeb24d5e7d0bfbfdf88bd95a8e/client/store/quizHistorySelectors.ts
[T6]: https://github.com/rsml/tutor/blob/e3fce17bf0f4aceeb24d5e7d0bfbfdf88bd95a8e/server/ports/README.md
