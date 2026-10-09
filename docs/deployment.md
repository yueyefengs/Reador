# Tag 镜像发布与服务端部署

## 发布方式

`.github/workflows/publish-image.yml` 在 Git tag 推送到 GitHub 后运行，使用现有 Dockerfile 构建 `linux/amd64` 和 `linux/arm64` 镜像，推送到 `ghcr.io/<仓库拥有者>/<仓库名的小写>`。当前仓库地址为 `ghcr.io/yueyefengs/reador`，镜像标签与 Git tag 完全一致，例如 `v0.1.0`；不额外维护 `latest` 别名。

Git tag 本身没有所属分支，因此流程会获取最新 `main`，通过 `git merge-base --is-ancestor` 检查 tag 对应提交是否已进入 `main`。允许发布 `main` 历史提交，拒绝尚未合入 `main` 的提交。轻量与附注 tag 均可；tag 必须符合 Docker 标签规则，不能含 `/`、`+` 等字符。

先将 workflow 和部署文件提交、合入并推送到 `main`，然后在本地执行以下命令（版本号换成实际版本）：

```bash
git switch main
git pull --ff-only origin main
git tag -a v0.1.0 -m '发布 v0.1.0'
git push origin v0.1.0
```

只在本地打 tag 不会触发；日常推送 `main` 也不会构建发布镜像。tag 对应提交必须已经包含 workflow。每次发布使用新版本号，不移动或覆盖已发布 tag。

在 GitHub 仓库 **Actions → 构建并发布镜像** 查看结果，成功后的运行摘要提供版本地址和固定 digest。Docker 构建缓存保存在 GitHub Actions；第三方 Actions 固定到已核对的 commit SHA。`.dockerignore` 排除 `.env*`、本地原书和 Git 历史，模型、存储与数据库凭据只在容器运行时注入。

## GHCR 权限

workflow 使用 GitHub 自动提供的 `GITHUB_TOKEN`，仅申请 `contents: read` 与 `packages: write`，无需额外配置发布用的密钥。仓库或组织策略需允许这些 Actions 及包写入权限。已有同名包时，确认该仓库在包的 **Manage Actions access** 中具有写入权限。

GHCR 首次发布的包默认私有。可在包设置中改为公开以便服务器匿名拉取；私有包需要在服务器使用有该包读取权限、含 `read:packages` scope 的 classic PAT 登录：

```bash
read -rsp 'GitHub PAT: ' GHCR_TOKEN
echo
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
unset GHCR_TOKEN
```

此令牌只用于服务器拉取镜像，不填入应用环境文件。参考 [GitHub 镜像发布说明](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images) 与 [GHCR 认证及权限说明](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。

## 首次部署

服务器需要 Docker / Docker Compose 2.24+；不需要安装 Node.js 或在服务器构建源码。将发布版本中的 `compose.production.yaml` 和 `.env.production.example` 放在同一个固定部署目录（例如 `/opt/reador`）。

```bash
cd /opt/reador
umask 077
cp .env.production.example .env.production
openssl rand -hex 24
openssl rand -hex 32
```

编辑 `.env.production`：

- `READOR_IMAGE`：填写已发布镜像，如 `ghcr.io/yueyefengs/reador:v0.1.0`；也可使用运行摘要里的 `ghcr.io/yueyefengs/reador@sha256:...` 固定内容。
- `POSTGRES_PASSWORD`：填写第一个命令生成的 48 位十六进制密码。
- `ENCRYPTION_KEY`：填写第二个命令生成的 64 位十六进制密钥，备份并在升级时保留。
- `APP_ORIGIN`：填写实际 HTTPS 域名，如 `https://reador.example.com`；`COOKIE_SECURE=true`。
- 如需服务器默认模型或七牛存储，按 README 填写对应配置并明确 `ENV_MODEL_ACCESS` 策略；也可保留默认值，登录后在系统设置配置个人模型。

准备完成后启动：

```bash
docker compose --env-file .env.production -f compose.production.yaml pull
docker compose --env-file .env.production -f compose.production.yaml up -d
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=80 app
curl --fail http://127.0.0.1:3112/api/health
```

首次启动等待数据库健康后，应用自动执行有序迁移。生产配置使用镜像内的非 root `node` 用户和命名卷，免去宿主机 UID / GID 设置：数据库为 `reador-production_postgres_data`，本地原书为 `reador-production_book_storage`。应用仅监听宿主机 `127.0.0.1:3112`，数据库不暴露宿主机端口。

通过服务器上的 Nginx / Caddy 等反向代理将公开 HTTPS 域名转发到 `http://127.0.0.1:3112`；上传请求体上限应至少为 50 MB，并为长时间 AI 请求配置合理超时。若代理也在容器内，需另行配置容器网络。仅做 HTTP 连通性检查时可临时设置匹配的 `APP_ORIGIN` 和 `COOKIE_SECURE=false`，公网访问应使用 HTTPS。现有应用允许注册，公网开放前需由部署者明确访问范围和注册策略。

这是新的独立部署。若服务器已有本地 Compose 数据，先备份并迁移数据库、原书及原 `ENCRYPTION_KEY`，不要直接将空的生产卷当成原有数据。

## 更新与恢复

每次推送新 tag 并等待 Actions 发布成功后，先备份数据库、本地原书（或七牛对象）和加密密钥，再只修改 `.env.production` 中的 `READOR_IMAGE`：

```bash
docker compose --env-file .env.production -f compose.production.yaml pull app
docker compose --env-file .env.production -f compose.production.yaml up -d app
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=80 app
```

应用启动时执行新迁移。若新迁移兼容旧程序，可把 `READOR_IMAGE` 改回旧版本再执行同样命令；数据库迁移不会随镜像回退而撤销，不兼容时需按发布说明恢复备份。已有 PostgreSQL 卷初始化后，修改 `POSTGRES_PASSWORD` 不会自动修改数据库中的密码，升级时保持原值。

停止用 `docker compose --env-file .env.production -f compose.production.yaml down`，保留命名卷；`down -v` 会删除数据库与本地原书。保留固定的 Compose 项目名和部署目录。此流程只自动发布镜像，服务端更新由部署者执行。

## 验证边界

2026-10-09 本地检查通过：actionlint 1.7.12 校验 workflow；临时 Git 仓库验证 main 当前 / 历史提交、轻量 / 附注 tag 可发布，非法标签和未合入提交被拒绝；生产 Compose 配置校验；现有 Dockerfile 在本机构建 Linux arm64 镜像；使用独立临时 PostgreSQL 和命名卷启动生产 Compose，自动迁移、HTTP 健康检查及 UID 1000 用户写入原书卷通过。构建保留现有两处动态文件路径追踪警告，不影响构建完成。

本地语法与镜像构建检查不能代替 GitHub 上的 GHCR 推送、双架构构建及服务器真实部署验收。首次发布后请确认 Actions 成功、服务器能够拉取镜像、健康检查通过，并实际核对登录、原书读取与已有学习记录。
