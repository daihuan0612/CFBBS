# CFBBS

> 基于 Cloudflare Workers + Pages + D1 + R2 的轻量论坛系统。
> 原始项目：[adysec/cforum](https://github.com/adysec/cforum)，本仓库在此基础上进行了二次开发。

---

## 🏗️ 架构设计

```
用户访问：forum.example.com
         ↓
    Cloudflare Pages（Edge 网络）
         ↓
  ┌─ Pages Functions 判断路由
  │
  ├─ /api/* ?
  │  ├─ YES → 转发给 Worker（处理业务逻辑 + 数据库）
  │  │         返回 JSON
  │  │
  │  └─ NO  → 返回静态文件或 index.html
  │           前端 React Router 接管
  │
  └─ 用户看到页面
```

- **后端**：Cloudflare Workers（单 Worker 处理全部 API）
- **前端**：React + TypeScript + Tailwind CSS + shadcn/ui（Pages 托管）
- **数据库**：Cloudflare D1（SQLite）
- **存储**：Cloudflare R2（图片/文件）
- **CDN**：Cloudflare Edge（静态资源 + API 响应缓存）

---

## ✨ 功能特性

### 核心功能

| 功能 | 说明 |
|------|------|
| 帖子管理 | 发布、编辑、删除、置顶、分类 |
| 评论系统 | 多级评论、支持回复 |
| 用户认证 | 账号注册/登录、2FA 二次验证 |
| 图片上传 | 前端压缩 + WebP 转码 + 非图片拦截，存储到 R2 |
| 用户资料 | 头像、昵称、个人资料 |
| 管理后台 | 用户管理、分类管理、设置管理 |
| 访问统计 | 浏览量统计 |
| 点赞系统 | 点赞/取消点赞 |
| 验证码 | 集成 Cloudflare Turnstile |

### 二次开发新增

| # | 功能 | 说明 |
|---|------|------|
| 1 | **R2 存储清理** | 管理后台扫描孤立文件，批量删除未关联的图片/文件，节省存储空间 |
| 2 | **通知系统** | 点赞、置顶、回复等事件触发站内通知，铃铛图标下拉查看，支持全部已读/单条删除 |
| 3 | **智能视频嵌入** | 自动识别 YouTube/Bilibili/MP4/WebM 链接，代理转发播放，居中展示 |
| 4 | **自定义 Worker 域名** | 通过 `WORKER_URL` 环境变量支持自定义域名部署 |
| 5 | **账号登录体系** | 弃用邮箱登录，改用用户名/账号登录，自动激活，居中登录页 |
| 6 | **私密论坛模式** | 未认证用户自动跳转登录页 |
| 7 | **管理员环境变量配置** | 管理员账号通过 `ADMIN_EMAIL` + `ADMIN_PASSWORD` 环境变量配置 |
| 8 | **移动端适配** | 导航栏头像下拉菜单、首页筛选栏自适应布局 |
| 9 | **中文错误提示** | 所有登录/注册/上传/2FA 等用户可见错误提示均改为中文 |
| 10 | **编辑器工具栏** | 加粗、斜体、引用、居中、首行缩进、小说格式化、视频插入、图片链接等按钮 |
| 11 | **条件缓存 (304)** | `Last-Modified` + `If-Modified-Since` 条件请求，内存缓存 5 分钟 |
| 12 | **R2 图片 CDN 边缘缓存** | `s-maxage` 边缘缓存策略，跨站加载秒开 |
| 13 | **API 全局速率限制** | 登录/注册/上传等接口独立限流，默认 60 次/分 |
| 14 | **错误提示本地化** | 登录、注册、2FA、上传等所有用户可见错误均改为中文 |

### 前端技术栈

| 技术 | 用途 |
|------|------|
| React 18 | 前端框架 |
| TypeScript | 类型安全 |
| Tailwind CSS | 原子化 CSS |
| shadcn/ui | UI 组件库 |
| lucide-react | 图标库 |
| marked | Markdown 解析 |
| DOMPurify | HTML 安全过滤 |

---

## 🚀 部署指南

### 环境要求

- **Cloudflare Account** — 需开通 Workers、D1、R2、Pages
- **Node.js** 18+
- **wrangler CLI** — `npm install -g wrangler`

### 环境变量配置

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `JWT_SECRET` | **是** | 至少 32 字符随机字符串，用于签发 JWT Token |
| `BASE_URL` | 推荐 | 站点完整 URL，如 `https://forum.example.com` |
| `WORKER_URL` | 可选 | 自定义 Worker 域名（如使用默认 Workers 域名可留空） |
| `TURNSTILE_SITE_KEY` | 可选 | Cloudflare Turnstile Site Key |
| `TURNSTILE_SECRET_KEY` | 可选 | Cloudflare Turnstile Secret Key |
| `ADMIN_EMAIL` | 可选 | 首次部署自动创建管理员（如不设置需自行注册） |
| `ADMIN_PASSWORD` | 可选 | 管理员密码，与 `ADMIN_EMAIL` 配对使用 |
| `ADMIN_NICKNAME` | 可选 | 管理员昵称（默认 `Admin`） |
| `IMGBED_DOMAIN` | 是 | 图床（网盘）域名，在 Cloudflare Worker 后台设置 |
| `IMGBED_AUTH_CODE` | 必填 | 图床的上传密码（存在 GitHub Secrets 里，部署时自动写入 Worker，改法见下文"改上传密码"） |
| `IMGBED_ADMIN_TOKEN` | 可选 | 图床管理 Token（删除帖子时自动删图用） |

> 管理员账号通过环境变量配置，部署后首次初始化生效。之后修改环境变量不会重新创建管理员。

### D1 数据库绑定

```jsonc
"d1_databases": [
  {
    "binding": "cforum_db",
    "database_name": "cforum-db",
    "database_id": "your-database-id"
  }
]
```

将 `database_id` 替换为实际创建的 D1 数据库 ID。

### R2 存储桶绑定

```jsonc
"r2_buckets": [
  {
    "binding": "BUCKET",
    "bucket_name": "cforum-uploads"
  }
]
```

需在 Cloudflare Dashboard 中创建名为 `cforum-uploads` 的 R2 存储桶。

---

### 方式一：GitHub Actions 自动化部署（推荐）

项目内置 `.github/workflows/deploy.yml`，配置好 GitHub Secrets 后推送即可自动部署。

**GitHub Secrets 配置：**

| Secret 名称 | 必需 | 说明 |
|-----------|------|------|
| `CF_API_TOKEN` | 是 | Cloudflare API Token（权限：Workers/D1/R2/Pages 均为 Edit） |
| `CF_ACCOUNT_ID` | 是 | Cloudflare Account ID（Dashboard 首页查看） |
| `JWT_SECRET` | 是 | 随机 32 位 Base64 字符串 |
| `BASE_URL` | 推荐 | 站点 URL |
| `TURNSTILE_SITE_KEY` | 可选 | Turnstile Site Key |
| `TURNSTILE_SECRET_KEY` | 可选 | Turnstile Secret Key |
| `ADMIN_EMAIL` | 可选 | 部署后自动创建管理员 |
| `ADMIN_PASSWORD` | 可选 | 管理员密码 |
| `ADMIN_NICKNAME` | 可选 | 管理员昵称 |
| `IMGBED_AUTH_CODE` | 是 | 图床的上传密码（部署时自动写入 Worker，改法见下文） |

---

### 方式二：本地 wrangler 部署（开发调试）

```bash
# 1. 安装依赖
npm install

# 2. 登录 Cloudflare
npx wrangler login

# 3. 创建 D1 数据库
npx wrangler d1 create cforum-db
# → 将输出的 database_id 写入 wrangler.jsonc

# 4. 创建 R2 存储桶
npx wrangler r2 bucket create cforum-uploads

# 5. 执行数据库迁移
npx wrangler d1 migrations apply cforum-db --remote

# 6. 构建前端
cd frontend
npm install
npm run build
cd ..

# 7. 部署 Worker
npx wrangler deploy

# 8. 部署 Pages（静态前端 + Functions 代理）
npx wrangler pages deploy public --branch production
```

---

## 🗄️ 数据库

### 数据库迁移

项目内置 D1 迁移脚本（`wrangler d1 migrations apply`），自动创建所有表、索引和初始配置。

## 部署维护与常见问题

> 详细运维文档见 [部署维护说明.md](部署维护说明.md)

### 怎么重新部署

改动代码（或改配置）后，推送到 GitHub `master` 分支即自动部署，约 1~2 分钟生效。查看是否成功：仓库 → **Actions** 页面，最新一条是绿色对勾 = 成功。

### 改图床上传密码

上传密码只通过 GitHub Actions Secrets 注入 Worker，不写入仓库，也不会返回到浏览器。

1. GitHub → 本仓库 → **Settings** → **Secrets and variables** → **Actions**
2. 更新 `IMGBED_AUTH_CODE`，并同步修改图床端密码
3. 推送一次变更触发部署

### 上传限制（安全设计）

- 浏览器将文件上传给论坛 Worker，Worker 才会使用图床凭据转发至固定的 `tucao` 文件夹和 Telegram 渠道
- 图床凭据不通过公开或登录接口下发
- SVG 和其他可执行图片格式被拒绝；仅允许受支持的图片、视频和压缩包格式

### 上传不了排查

1. 部署是否成功（GitHub → Actions）
2. `IMGBED_AUTH_CODE` 是否已设置为 GitHub Actions Secret
3. `IMGBED_DOMAIN` 是否与图床域名完全一致（不带多余斜杠）
4. 图床端上传密码是否与 `IMGBED_AUTH_CODE` 一致
5. 浏览器 F12 → 网络，检查 `/api/media/upload` 的响应

### 常见问题

**Q：部署失败，提示 secret 相关错误？**
A：工作流使用 `wrangler versions secret put` 写入密钥。若仍失败，在 Cloudflare Workers 控制台处理未部署版本后重试。

**Q：改了代码但没生效？**
A：确认推送到 `master` 且 Actions 成功；Cloudflare CDN 缓存通常在 1~2 分钟内刷新。

---

## 数据库

### 核心数据表

| 表名 | 用途 |
|------|------|
| `users` | 用户信息、登录凭证、2FA |
| `posts` | 帖子内容、分类、浏览量 |
| `comments` | 评论数据 |
| `categories` | 帖子分类 |
| `notifications` | 站内通知 |
| `rate_limits` | 速率限制记录 |
| `settings` | 系统配置（点赞、评论、通知等开关） |

---

## 🧪 本地开发

```bash
# 前端 dev server（热更新）
cd frontend
npm run dev

# Worker 本地调试
npx wrangler dev src/index.ts --remote

# 数据库迁移（本地）
npx wrangler d1 migrations apply cforum-db --local

# 数据库迁移（远程）
npx wrangler d1 migrations apply cforum-db --remote
```

---

## 📄 许可证

MIT License — 详见 [LICENSE](LICENSE)

## 🔗 相关链接

- 原版仓库：[adysec/cforum](https://github.com/adysec/cforum)
- Cloudflare Workers 文档：https://developers.cloudflare.com/workers/
- Cloudflare D1 文档：https://developers.cloudflare.com/d1/
