# CFBBS

> 基于 Cloudflare Workers + D1 + R2 的轻量论坛系统。
> 原始项目：[adysec/cforum](https://github.com/adysec/cforum)，本仓库在此基础上进行了二次开发。

---

## 架构设计

```
用户访问：bbs.example.com / api.example.com
         ↓
    Cloudflare Workers（Edge 网络）
         ↓
  ┌─ Worker 判断路由
  │
  ├─ /api/* ?
  │  ├─ YES → 处理业务逻辑 + 数据库，返回 JSON
  │  │
  │  └─ NO  → 返回静态前端文件（assets 内嵌）
  │           前端 React Router 接管
  │
  └─ 用户看到页面
```

- **后端 + 前端托管**：Cloudflare Workers（单 Worker 处理全部 API + 静态文件）
- **前端**：React 18 + TypeScript + Tailwind CSS + shadcn/ui
- **数据库**：Cloudflare D1（SQLite）
- **存储**：Cloudflare R2（图片/文件/缩略图）
- **CDN**：Cloudflare Edge（静态资源 + API 响应缓存）

> 不再依赖 Cloudflare Pages。Worker 通过 `assets` 配置直接托管前端静态文件，部署只需一步 `wrangler deploy`。

---

## 功能特性

### 核心功能

| 功能 | 说明 |
|------|------|
| 帖子管理 | 发布、编辑、删除、置顶、分类 |
| 评论系统 | 多级评论、支持回复 |
| 用户认证 | 用户名注册/登录、2FA 二次验证 |
| 文件上传 | 前端压缩 + WebP/JPEG 转码，存储到 R2 |
| 用户资料 | 头像、昵称、个人资料 |
| 管理后台 | 用户管理、分类管理、设置管理 |
| 访问统计 | 浏览量统计 |
| 点赞系统 | 点赞/取消点赞 |
| 验证码 | 集成 Cloudflare Turnstile |

### 二次开发新增

| # | 功能 | 说明 |
|---|------|------|
| 1 | **R2 存储清理** | 管理后台扫描孤立文件，批量删除未关联的文件，节省存储空间 |
| 2 | **通知系统** | 点赞、置顶、回复等事件触发站内通知，铃铛图标下拉查看 |
| 3 | **视频缩略图** | 前端 canvas 截帧 → 上传 R2 → DB 永久缓存，支持 ImgBed/R2/Twitter 视频 |
| 4 | **智能视频嵌入** | 自动识别 YouTube/Bilibili/MP4/WebM 链接，代理转发播放 |
| 5 | **Worker 一体化托管** | Worker `assets` 内嵌前端静态文件，不再依赖 Pages |
| 6 | **账号登录体系** | 用户名/账号登录，自动激活 |
| 7 | **私密论坛模式** | 未认证用户自动跳转登录页 |
| 8 | **管理员环境变量配置** | 管理员账号通过 `ADMIN_EMAIL` + `ADMIN_PASSWORD` 配置 |
| 9 | **移动端适配** | 导航栏下拉菜单、首页筛选栏自适应布局 |
| 10 | **中文错误提示** | 登录/注册/上传/2FA 等用户可见错误均改为中文 |
| 11 | **编辑器工具栏** | 加粗、斜体、引用、居中、首行缩进、视频插入、图片链接等 |
| 12 | **条件缓存 (304)** | `Last-Modified` + `If-Modified-Since` 条件请求 |
| 13 | **R2 图片 CDN 缓存** | `s-maxage` 边缘缓存策略，跨站加载秒开 |
| 14 | **API 速率限制** | 登录/注册/上传等接口独立限流 |

---

## 部署指南

### 环境要求

- **Cloudflare Account** — 需开通 Workers、D1、R2
- **Node.js** 18+
- **wrangler CLI** — `npm install -g wrangler`

### 环境变量

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `JWT_SECRET` | 是 | 至少 32 字符，用于签发 JWT |
| `BASE_URL` | 推荐 | 站点完整 URL，如 `https://bbs.example.com` |
| `WORKER_URL` | 可选 | 自定义 Worker 域名 |
| `ADMIN_EMAIL` | 可选 | 首次部署自动创建管理员 |
| `ADMIN_PASSWORD` | 可选 | 管理员密码 |
| `ADMIN_NICKNAME` | 可选 | 管理员昵称（默认 `Admin`） |

### 方式一：GitHub Actions 自动化部署（推荐）

推送 `main` 分支即可自动部署。CI 流程：D1 初始化 → R2 初始化 → 构建前端 → 部署 Worker。

**GitHub Secrets：**

| Secret | 必需 | 说明 |
|--------|------|------|
| `CF_API_TOKEN` | 是 | Cloudflare API Token（Workers/D1/R2 Edit） |
| `CF_ACCOUNT_ID` | 是 | Cloudflare Account ID |
| `JWT_SECRET` | 是 | 随机 32 位字符串 |
| `WORKER_URL` | 推荐 | Worker 域名，如 `https://api.example.com` |
| `ADMIN_EMAIL` | 可选 | 管理员邮箱 |
| `ADMIN_PASSWORD` | 可选 | 管理员密码 |
| `ADMIN_NICKNAME` | 可选 | 管理员昵称 |

### 方式二：本地部署

```bash
# 1. 安装依赖
npm install

# 2. 登录 Cloudflare
npx wrangler login

# 3. 创建 D1 数据库
npx wrangler d1 create cforum-db
# → 将输出的 database_id 写入 wrangler.jsonc

# 4. 创建 R2 存储桶
npx wrangler r2 bucket create cforum-images

# 5. 执行数据库迁移
npx wrangler d1 migrations apply cforum-db --remote

# 6. 构建前端 + 部署 Worker
npm run build:frontend
npx wrangler deploy
```

---

## 数据库

### 核心数据表

| 表名 | 用途 |
|------|------|
| `users` | 用户信息、登录凭证、2FA |
| `posts` | 帖子内容、分类、浏览量、缩略图URL |
| `comments` | 评论数据 |
| `media_files` | 上传文件记录（R2/ImgBed） |
| `post_media` | 帖子-媒体关联表 |
| `categories` | 帖子分类 |
| `notifications` | 站内通知 |
| `settings` | 系统配置 |

---

## 本地开发

```bash
# 前端 dev server（热更新）
cd frontend
npm run dev

# Worker 本地调试
npx wrangler dev src/index.ts --remote

# 数据库迁移（远程）
npx wrangler d1 migrations apply cforum-db --remote
```

---

## 许可证

MIT License — 详见 [LICENSE](LICENSE)

## 相关链接

- 原版仓库：[adysec/cforum](https://github.com/adysec/cforum)
- Cloudflare Workers 文档：https://developers.cloudflare.com/workers/
- Cloudflare D1 文档：https://developers.cloudflare.com/d1/
- Cloudflare R2 文档：https://developers.cloudflare.com/r2/
