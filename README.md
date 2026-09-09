# EZShell

跨端 SSH 运维工具 + SaaS 会员平台（pnpm monorepo）。

> 正式产品名：**EZShell**。技术栈：Electron / uni-app(H5 壳) / NestJS / Vue3 / PostgreSQL / Redis。

## 我能用它做什么（当前）

- 本地启动 API，完成**邮箱注册 / 登录 / 刷新令牌 / 登出**
- 查询当前用户资料与 **Free/Pro/Team 权益快照**
- **桌面端 P1**：主机/分组、密钥、真实 SSH、多标签终端、记住密码、指纹确认
- 打开管理后台空壳、移动端底栏空壳

## 环境要求

- Node.js ≥ 20
- pnpm 9（仓库已锁定 `packageManager`）
- Docker Desktop（用于 Postgres / Redis）

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 环境变量（根目录 + API）
cp .env.example .env
cp .env.example apps/api/.env
# 确认 apps/api/.env 中 DATABASE_URL=file:./dev.db

# 3. 构建共享包
pnpm build:packages

# 4. 初始化数据库（本地默认 SQLite）
pnpm --filter @ezshell/api prisma:generate
pnpm --filter @ezshell/api exec prisma migrate dev
pnpm db:seed

# 5. 启动各端（另开终端）
pnpm dev:api        # http://localhost:3000/api
pnpm dev:admin      # http://localhost:5173
pnpm dev:desktop    # Electron 窗口
pnpm dev:mobile     # http://localhost:5175
```

> **数据库说明**：因部分环境 Docker Hub 镜像拉取受限，本地 P0 默认使用 **SQLite**（`apps/api/dev.db`）。生产目标仍为 PostgreSQL：将 Prisma `provider` 改回 `postgresql`，配置 `DATABASE_URL`，再执行 `pnpm db:up`（`docker-compose.yml` 已使用 DaoCloud 镜像前缀）。Redis 可复用本机已有实例（默认 `6379`）。

### 验证 API

```bash
curl http://localhost:3000/api/health
```

注册示例：

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"demo@ezshell.local\",\"password\":\"Demo123456\",\"nickname\":\"演示\"}"
```

## 目录结构

```text
apps/
  api/          NestJS SaaS API
  desktop/      Electron + Vue3
  mobile/       移动端 H5 壳（P4 对齐 uni-app）
  web-admin/    运营管理后台
packages/
  shared/       类型、枚举、错误码、校验
  core/         纯业务逻辑（导入/片段等）
  ui-tokens/    设计 token
  sdk/          API TypeScript SDK
docs/           需求与开发计划
```

## 常用脚本

| 命令 | 说明 |
|---|---|
| `pnpm dev:api` | 启动 API（热重载） |
| `pnpm dev:desktop` | 启动桌面端 |
| `pnpm dev:mobile` | 启动移动端 H5 |
| `pnpm dev:admin` | 启动管理后台 |
| `pnpm db:up` / `pnpm db:down` | 启停 Docker 依赖 |
| `pnpm db:migrate` | Prisma 迁移 |
| `pnpm db:seed` | 写入默认套餐等种子数据 |
| `pnpm build:packages` | 编译 packages/* |

## 环境变量

见 [.env.example](./.env.example)。敏感值勿提交仓库。

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串 |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | JWT 密钥 |
| `VITE_API_BASE_URL` | 前端 API 地址 |

## 文档

- [需求说明书](./docs/EZShell需求说明书.md)
- [开发计划](./docs/EZShell开发计划.md)
- [下一步做什么](./docs/下一步做什么.md)（当前阶段行动清单）

## 许可

私有项目，未开源。
