# Reador

AI 辅助阅读与学习应用：导入原书，阅读与核对来源，通过总结、概念图、问答、主动回忆及 FSRS 复习留下理解。

## 已实现

- 邮箱密码注册、登录、退出；服务端会话与账号数据隔离。
- PDF / EPUB 私有导入、真实解析、原书目录 / 页码定位、阅读位置持久化及原书下载；重复上传不重复建书。EPUB 自动提取书内封面，PDF 生成首页缩略图，失败时保留文字封面；旧书再次上传可单独补提取封面。
- 多组 Agent 配置、默认模型、官方 / 第三方接入；支持 Chat Completions、Responses、Messages 三种协议。API Key 由服务端 AES-256-GCM 加密保存，不回传给浏览器。支持读取 `.env` 中的服务器默认模型，个人配置优先。
- 基于原文的分批总结、带来源的概念图、章节 / 全书 / 选段问答与渐进教学；生成任务持久保存进度，可取消或重试失败批次。
- 简答题、逐点评分、用户纠正评分、换题补救；作答前不返回参考答案。
- 真实 `ts-fsrs` 排期、按书籍查看到期 / 后续复习与学习记录；重复评级只更新一次。
- PostgreSQL 迁移、Docker Compose、自动检查与独立数据库集成测试。

当前是可运行的本地首版，并非静态原型。根目录的 `dashboard.html` / `reader.html` 保留为历史设计参考，正式入口是下面的 Web 应用。

## 本地运行：应用和数据库都在 Docker 中

需要 Docker / Docker Compose 2.24+，以及一次性的 Node.js 22.13+ 配置生成环境（建议 Node.js 24 LTS）。

```bash
npm ci
npm run setup:env
docker compose --env-file .env.local up -d --build
```

打开 **[http://localhost:3112](http://localhost:3112)**，注册自己的账号。首次启动会自动执行数据库迁移，不创建默认账号或虚构学习数据。

`setup:env` 只在 `.env.local` 不存在时创建配置，生成随机数据库密码与密钥加密参数；保留已有文件。数据库使用命名卷 `postgres_data`；原书保存于项目 `storage/`，挂载到容器 `/app/storage`。配置中的 `LOCAL_UID` / `LOCAL_GID` 用于本机目录权限。

检查运行情况：

```bash
docker compose --env-file .env.local ps
docker compose --env-file .env.local logs --tail=80 app
```

停止应用时使用 `docker compose --env-file .env.local down`，数据卷和原书保留。请妥善备份 `.env.local` 中的 `ENCRYPTION_KEY`：更换或丢失后，已有模型凭据和七牛原书将无法解密。

默认仅绑定本机：应用端口 `3112`，数据库端口 `5433`。如修改端口，同时更新 `.env.local` 中的 `APP_PORT` 和 `APP_ORIGIN`。本次使用 3112 是为了避开本机已有服务。

## Tag 发布镜像与服务端部署

推送指向 `main` 中提交的 Git tag 后，GitHub Actions 自动构建 amd64 / arm64 镜像并推送到 `ghcr.io/yueyefengs/reador:<tag>`，例如 `ghcr.io/yueyefengs/reador:v0.1.0`。使用 GitHub 自带令牌发布，无需额外配置 Registry 密钥；私有镜像的服务端拉取需要登录 GHCR。

服务端使用 `compose.production.yaml` 与 `.env.production.example` 拉取已构建镜像，数据库和原书使用独立命名卷，启动时自动迁移。完整的打 tag、权限配置、首次部署与更新步骤见 [服务端部署指南](docs/deployment.md)。

## 开发运行：Node.js 应用 + Docker PostgreSQL

```bash
npm ci
npm run setup:env
docker compose --env-file .env.local up -d db
npm run db:migrate
npm run dev
```

访问同一地址。开发服务器默认使用 `127.0.0.1:3112`；浏览器请通过 `http://localhost:3112` 进入，以匹配 `APP_ORIGIN`。切换到 Docker 应用前停止开发服务器，避免端口冲突。

数据库连接参数在 `.env.local` 中；不要把真实 API Key 写入仓库、截图、日志或聊天。`storage/`、`.env*` 和构建产物已忽略。

## 配置 DeepSeek / GLM 并体验完整流程

1. 注册并登录 → **系统设置** → 选择 DeepSeek 或智谱 / GLM。
2. 使用官方预设，或选择第三方 / 自建网关并填写 API 前缀、协议和网关模型别名。
3. 模型 ID 会随官方厂商自动预填；可按账户权限修改。填写 API Key，设为默认 Agent，保存后点击 **测试连接**。连接测试仅发送最小消息，不发送书籍。
4. 导入有文本层的 PDF 或无 DRM 的 EPUB，等待解析完成。
5. 进入阅读工作台，生成本章总结 / 图谱 / 练习。生成时会把所选范围原文发送给默认模型。
6. 在复习计划选择该书，先独立作答，再核对反馈与原文，确认评级后更新真实 FSRS 排期。
7. 查看讲解后可以换题再测；补救练习独立保存，不额外制造成功复习记录。

新建 Agent 与切换官方厂商时，按 2026-10-08 核对的官方通用模型预填：OpenAI [`gpt-6.1-sol`](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、Anthropic [`claude-opus-5-5`](https://platform.claude.com/docs/en/models/overview)、智谱 [`glm-5.3`](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)、DeepSeek [`deepseek-flash`](https://api-docs.deepseek.com/)。这些是核对日的预设，不会定时联网追踪新品；已保存的个人 Agent 与环境模型不自动改写。第三方网关与自定义厂商按其实际模型别名填写。

新建 Agent、切换厂商以及服务器模型的期望最大输出默认 1,000,000 tokens（1M），填写范围为 256–1,000,000。上下文窗口与单次输出上限不同；对已核实的官方型号，发送值取填写值与官方输出上限的较小值：DeepSeek Flash / V4 为 393,216，GPT-6.1 Sol 为 128,000，Claude Opus 5.5 与 GLM-5.3 为 131,072。设置页显示实际发送上限。依据：[DeepSeek API](https://api-docs.deepseek.com/api/create-chat-completion/)、[OpenAI 模型说明](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[Claude 上下文说明](https://platform.claude.com/docs/en/build-with-claude/context-windows)、[GLM-5.3 官方说明](https://docs.z.ai/guides/llm/glm-5.3)。此能力表与模型预设同日核对，不自动联网更新。

已保存的个人配置保留原值，可在编辑页点击“使用 1M 默认值”并保存。未知型号与第三方网关按填写值发送，需依据其文档调整输出限制。提高上限不会扩大每批原文范围，也不要求模型写满；请求仍受配置超时、结构化输出校验和有限响应体边界约束。已有生成任务使用创建时的配置快照，需要按新配置新建任务才能使用新上限。

首次上传依次校验扩展名、文件签名与 50 MB 限额，按账号计算 SHA-256 去重，私有保存原文件并创建持久化解析任务。后台读取正文、提取封面并一次性写入目录及带位置的原文片段；失败可重试。上传不调用 LLM，也不自动生成总结、图谱、题目或复习卡。

EPUB 优先读取 EPUB 3 导航或 EPUB 2 NCX 目录，按阅读顺序合并跨文件章节，支持文件内锚点与父子层级；点击父目录会覆盖子章节。目录缺失、损坏、顺序错误或目标无法定位时，回退为按正文标题 / 文件分节，并明确标注为推断；不会拿重复书名冒充章节名。PDF 优先使用可定位的书签目录，无可靠书签时按实际页码分段；页码来源始终保留。纯图片目录项保留为空，当前不提供 OCR。

旧书阅读页提供“更新原书目录”。更新任务不调用模型，只有全部原文片段的文本和位置能与旧版一一匹配时才提交：保留来源 ID，更新章节归属与阅读进度，不重置作答或 FSRS；旧章节归档并保留来源范围，历史会话不因合并而扩大引用范围。匹配失败则完整保留旧目录，可安全重试。

没有个人默认模型时使用当前账号获准访问的服务器默认模型；两者都不可用时，仍可导入、提取目录与封面、阅读、保存进度和查看已有记录，AI 生成 / 问答 / 评分会提示配置模型，不产生模拟结果。

点击生成总结、概念图或练习后，正文片段按顺序组合为每批最多 10,000 字符，逐批调用并保存进度；图片和电子书原始二进制不发送。这里是正文字符限额，另有提示词和 JSON 开销，不是精确 token 计数。超过 50 MB 的文件仍须先拆分；长范围问答走检索片段，不逐批通读全书。

概念图谱页以卡片展示已生成版本和进行中的任务，点击进入独立详情，可刷新、返回或复制详情地址。取消 / 无结果的历史任务、重复错误、生成说明、概念与关系的原文依据默认收起；阅读工作台右侧不展示概念图任务历史，图谱的重试与取消入口集中在详情页。来源点击及导出仍可使用，部分完成状态保持明确。

图谱引用必须属于当前批次且与原文逐字匹配；首次引用失配时，依据错误位置和原因最多自动重生成一次。再次失败不发布该批次，不做模糊匹配或摘录自动改写；成功批次保留，手动重试只处理未完成批次。

Base URL 填写 API 前缀，例如 `https://api.openai.com/v1` 或 `https://open.bigmodel.cn/api/paas/v4`，不包含 `/responses`、`/messages` 或 `/chat/completions`。应用只追加协议对应路径，不额外添加 `/v1`。

应用默认拒绝模型地址指向私有网络，并固定 DNS 解析结果防止地址切换。 本机 Docker 的代理 DNS 会返回 `198.18.*` Fake-IP，因此当前本机配置 `AI_DNS_MODE=doh`，通过固定 HTTPS 公网 DNS 查询模型域名，再校验与固定公网地址。默认 `system` 使用系统 DNS；此设置只向解析服务发送域名，不发送模型密钥或书籍。确需连接自己信任的本机模型服务时，可显式在开发环境设置 `AI_ALLOW_PRIVATE_NETWORK=true`；不要在不可信多用户环境开放这一选项。

## 服务端环境模型与七牛存储

应用在开发环境读取 `.env` / `.env.local`；Compose 也以运行时 `env_file` 读取它们，密钥不复制到镜像。修改后重新创建应用容器：

```bash
docker compose --env-file .env.local up -d --force-recreate app
```

配置 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` 以及 `GLM_*`。使用策略由 `ENV_MODEL_ACCESS` 决定：`shared` 向所有已登录账号提供服务器模型；`owner` 只向 `ENV_MODEL_OWNER_EMAIL` 指定账号提供；`disabled` 关闭。`DEFAULT_MODEL_PROVIDER` 指定服务器默认厂商，默认优先 DeepSeek。个人默认 Agent 始终优先。系统设置只显示服务器模型元数据，可测试或另存为当前账号的个人默认配置；另存的是当时的凭据快照，不随环境轮换自动更新。

当前本机设置为 `shared`，默认 DeepSeek；将使用服务器账户的调用额度。书籍、作答和个人配置仍按账号隔离。生产环境应由部署者明确配置访问策略，不在源码中默认开放。

文件默认通过 `STORAGE_BACKEND=local` 保存在本机。启用七牛时设置 `STORAGE_BACKEND=qiniu`，并提供 `QINIU_ACCESS_KEY`、`QINIU_SECRET_KEY`、`QINIU_BUCKET`。默认 `QINIU_DOWNLOAD_MODE=s3` 使用七牛官方签名 API 读回原书，不要求自定义下载域名；区域自动查询，也可用 `QINIU_S3_REGION` 指定。若空间的 S3 名称不同，可配置 `QINIU_S3_BUCKET`。选择 `QINIU_DOWNLOAD_MODE=domain` 才需要已绑定、可解析的 HTTPS `QINIU_DOMAIN`（不含路径）。建议先运行 `npm run eval:storage` 验证加密上传、签名下载、原书字节一致及 PDF 解析；脚本只删除自己新建的验收对象。

七牛对象路径为 `reador/v1/<账号>/<书籍>.<格式>.enc`。服务端在上传前以 AES-256-GCM 加密并绑定对象位置，即使空间公开也不上传可读原书。下载仍先检查登录及书籍拥有者，服务端通过 S3 签名请求（域名模式使用短期签名 URL）取回密文后解密；浏览器不获得云端下载凭证。数据库保存 `qiniu://<空间>/<对象>` 位置，解析直接读取云端字节。既有本地文件仍能读取，不自动搬迁或删除；启用后新导入的书籍保存到七牛。

请同时备份数据库、原书和 `ENCRYPTION_KEY`；更换存储空间不会迁移旧对象。当前本机已启用七牛，真实加密上传、S3 读取、解密字节一致、PDF 解析及临时对象清理均已验证通过。配置的下载域名 DNS 解析失败，当前使用官方 S3 接口，不依赖该域名。GLM 返回 HTTP 429 / 1113，需检查接口对应账户余额或资源包；DeepSeek 的微型材料评估已通过。

## 验证

```bash
npm run typecheck
npm test
npm run test:integration
npm run build
```

集成测试创建并删除独立的临时 PostgreSQL 数据库，在端口 3114 启动独立测试应用和本地协议模拟服务，不使用真实模型凭据；要求开发数据库账号具有创建数据库权限（本地 Compose 的初始化账号具备）。模拟通过仅证明协议与业务契约，不等于真实模型质量通过。

可选的真实模型小样例评估：在本地环境配置对应的 `DEEPSEEK_API_KEY` / `GLM_API_KEY`、`DEEPSEEK_MODEL` / `GLM_MODEL`，然后执行：

```bash
npm run eval:live -- deepseek
npm run eval:live -- glm
```

可选使用 `DEEPSEEK_BASE_URL` / `GLM_BASE_URL` 覆盖接口前缀。评估会产生真实调用费用，使用原创微型材料测试引用、出题和评分，输出不包含凭据。正式验收仍需人工核对模型结果。用户通过系统设置保存的密钥不会自动导出给命令行评估。

## 首版边界

- PDF 按实际页码分段，暂未自动恢复原书目录或版式；EPUB 按 spine 阅读顺序提取正文。暂不支持扫描件 OCR、加密 / DRM 书籍，文件最大 50 MB、800 页 / 节、正文 200 万字符。
- 图谱按原文批次生成；总览最多显示 20 个概念，完整结果分批查看，跨批次同义概念尚未自动合并。人工编辑源码后不沿用旧引用。
- 长章 / 整书问答使用范围内的基础关键词检索，尚未接入语义向量检索。引用存在与摘录一致不代表模型结论一定正确。
- 邮箱密码认证暂不含邮件验证、密码找回、第三方登录和管理后台。
- 当前为本机部署；Linux 公网部署前需配置域名、HTTPS、`APP_ORIGIN`、安全 Cookie、注册策略和备份。没有自动部署到远程服务器。
- DeepSeek 已通过小型真实样例评估，完整教学质量仍需人工核对。GLM 当前返回 429 / 1113，尚未通过真实验收。

## 文档与代码

- [产品方案](docs/product.md)、[实际架构与数据约束](docs/architecture.md)
- [原型验证记录](docs/prototype-verification.md)、[应用验收记录](docs/application-verification.md)
- [书籍概念 Agent 设计](docs/book-concept-agent.md)、[上游研究](docs/references.md)
- `src/app`：页面与服务端 API；`src/components`：正式前端。
- `src/modules`：解析、模型适配、任务执行与学习调度；`src/lib`：认证、加密、数据库与结构。
- `drizzle/`：有序 SQL 迁移；复合拥有者约束等由自定义迁移维护，勿使用 schema push 替代正式迁移。

Mermaid 固定版本与许可证保留于 `assets/vendor/`；用户指定的上游规则保留于 `skills/mermaid-visualizer/`。
