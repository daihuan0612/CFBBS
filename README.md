# CFBBS

> 本仓库根据 [adysec/cforum](https://github.com/adysec/cforum) 原版代码进行二次开发改造，在原论坛基础上新增邀请码注册、加密网盘链接、功能开关、LSB 盲水印、编辑器增强、独立插件体系等功能。**已移除 SMTP 邮件服务**，密码重置改为管理员后台生成临时密码。

基于 Cloudflare Workers + Pages + D1 + R2 的论坛系统。

---

## 🏗️ 架构设计

### 单域名 + 智能网关方案

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

---

## ✨ 功能特性

### 核心功能（原版）
- ✅ **帖子管理** — 发布、编辑、删除、置顶、分类
- ✅ **评论系统** — 多级评论、支持回复
- ✅ **用户认证** — 注册、登录、2FA
- ✅ **图片上传** — 前端 Luban 压缩 + WebP 转码 + 非图片拦截，存储到 R2
- ✅ **用户资料** — 头像、个人资料
- ✅ **管理后台** — 用户管理、分类管理、设置管理
- ✅ **访问统计** — 浏览量统计
- ✅ **点赞系统** — 点赞/取消点赞
- ✅ **验证码** — 集成 Cloudflare Turnstile

### 二次开发新增
- ✅ **邀请码注册** — 管理员生成邀请码，支持 `invite_only` 模式开关
- ✅ **加密网盘链接** — 仅录入第三方网盘链接（非本地文件），支持设置访问密码验证
- ✅ **功能开关** — 后台一键开关：点赞、评论、发帖、收藏、水印、邀请码、加密附件
- ✅ **LSB 盲水印** — 1×1 Canvas 像素级用户标识，零视觉占用，注入到每个页面
- ✅ **编辑器增强** — 加粗/斜体/引用/居中/首行缩进/视频插入/网盘链接工具栏按钮，支持 Markdown 实时预览
- ✅ **管理员重置密码** — 生成 24h 有效临时密码，自动记录密码历史
- ✅ **独立插件体系** — 前置速率限制、定时清理、统一 API 工具、Markdown 预处理

### 独立插件目录 `src/plugins/`

| 插件 | 功能 | 说明 |
|------|------|------|
| `rate-limiter.ts` | 前置速率限制 | 登录 5次/分，注册 3次/分，上传 10次/分，默认 60次/分，不修改原路由 |
| `scheduled-cleanup.ts` | 定时清理 | Worker `scheduled` 事件触发，清理过期 nonce、临时密码、限流记录 |
| `utils.ts` | 统一 API 工具库 | `extractUrlParams`、`ApiError` 错误类、日期格式化、`timeAgo` |
| `markdown.ts` | Markdown 预处理 | 解码 HTML 实体编码，修复后端双倍转义问题，仅新页面启用 |

---

## 🚀 部署指南

### 环境配置

#### 必需配置

| 配置项 | 说明 |
|--------|------|
| **Cloudflare Account** | 需开通 Workers Paid（或免费版）、D1、R2、Pages |
| **Node.js** | 18+ |
| **npm / pnpm** | 包管理器 |
| **wrangler CLI** | `npm install -g wrangler` |

#### Worker 环境变量 (wrangler.jsonc / Cloudflare Dashboard)

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `JWT_SECRET` | **是** | 至少 32 字符随机字符串，用于签发 JWT Token |
| `BASE_URL` | 推荐 | 站点完整 URL，如 `https://forum.example.com` |
| `TURNSTILE_SITE_KEY` | 可选 | Cloudflare Turnstile Site Key |
| `TURNSTILE_SECRET_KEY` | 可选 | Cloudflare Turnstile Secret Key |
| `ADMIN_EMAIL` | 可选 | 首次部署自动创建管理员（如不设置需自行注册） |
| `ADMIN_PASSWORD` | 可选 | 管理员密码，与 ADMIN_EMAIL 配对使用 |
| `ADMIN_NICKNAME` | 可选 | 管理员昵称（默认 `Admin`） |

> 硬编码默认管理员已彻底移除，不再有 `admin@adysec.com / Admin@123`。管理员账号通过环境变量配置，**部署后首次初始化生效**，之后修改环境变量不会重新创建。

#### D1 数据库绑定

wrangler.jsonc 中已预配置：

```jsonc
"d1_databases": [
  {
    "binding": "cforum_db",
    "database_name": "cforum-db",
    "database_id": "your-database-id"
  }
]
```

需将 `database_id` 替换为实际创建的 D1 数据库 ID。

#### R2 存储桶绑定

```jsonc
"r2_buckets": [
  {
    "binding": "BUCKET",
    "bucket_name": "cforum-uploads"
  }
]
```

需在 Cloudflare Dashboard 中创建名为 `cforum-uploads` 的 R2 存储桶。

### 部署步骤

#### 方式一：本地 wrangler 部署（推荐开发调试）

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

#### 方式二：GitHub Actions 自动化部署

项目内置 `.github/workflows/deploy.yml`，配置好 GitHub Secrets 后推送即可自动部署。

**GitHub Secrets 配置表：**

| Secret 名称 | 必需 | 说明 |
|-----------|------|------|
| `CF_API_TOKEN` | 是 | Cloudflare API Token（权限：Workers/D1/R2/Pages 均为 Edit） |
| `CF_ACCOUNT_ID` | 是 | Cloudflare Account ID（Dashboard 首页查看） |
| `JWT_SECRET` | 是 | 随机 32 位 Base64 字符串 |
| `BASE_URL` | 推荐 | 站点 URL |
| `TURNSTILE_SITE_KEY` | 可选 | Turnstile Site Key |
| `TURNSTILE_SECRET_KEY` | 可选 | Turnstile Secret Key |
| `ADMIN_EMAIL` | 推荐 | 部署后自动创建管理员（如不设置需自行注册） |
| `ADMIN_PASSWORD` | 推荐 | 管理员密码 |
| `ADMIN_NICKNAME` | 可选 | 管理员昵称 |

### 首次初始化

**管理员账号由环境变量控制：**

部署时设置 `ADMIN_EMAIL` + `ADMIN_PASSWORD`，首次部署会自动创建管理员。不设置则不创建，需自行注册（此时建议关闭 `invite_only`）。

部署完成后，访问 `/admin` 管理后台：
1. **生成邀请码** — 开启 `invite_only` 模式后新用户需邀请码注册
2. **功能开关** — 按需开启/关闭点赞、评论、发帖、收藏、水印等功能
3. **加密附件** — 开启后用户可在帖子中添加网盘链接

---

## 🗄️ 数据库变更

### 新增表（二次开发）

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `invitation_codes` | 邀请码管理 | `code`, `created_by`, `used_by`, `expires_at`, `is_active` |
| `password_history` | 密码变更历史 | `user_id`, `password_hash` |
| `temp_passwords` | 管理员生成的 24h 临时密码 | `user_id`, `temp_password`, `temp_password_hash`, `expires_at` |
| `encrypted_attachments` | 网盘链接存储（纯文本） | `link_url`, `file_name`, `extract_code`, `password_hash` |
| `user_watermarks` | LSB 盲水印元数据 | `user_id`, `watermark_data` |
| `rate_limits` | 速率限制记录 | `ip`, `endpoint`, `count`, `window_start` |

### 新增系统设置项

| Key | 默认值 | 说明 |
|-----|--------|------|
| `invite_only` | `1` | 邀请码注册模式 |
| `encrypted_attachments_enabled` | `0` | 加密网盘附件功能 |
| `feature_likes` | `1` | 点赞功能 |
| `feature_bookmarks` | `1` | 收藏功能 |
| `feature_comments` | `1` | 评论功能 |
| `feature_posts` | `1` | 发帖功能 |
| `watermark_enabled` | `1` | LSB 盲水印 |

---

## ⚠️ 技术债务说明

### 本次改造引入的已知问题

| 级别 | 问题 | 文件 | 说明 | 影响 |
|------|------|------|------|------|
| LOW | 明文临时密码存留 DB | `src/index.ts:2095` | `temp_passwords.temp_password` 字段存明文，已通过定时清理 + `is_used` 标记减轻影响 | 极小，管理员操作后可标记已使用 |
| LOW | 错误提示静默吞掉 | `frontend/src/pages/post-page.tsx:153` | `saveAttachmentLink` catch 无用户反馈 | 用户感知不到保存失败 |
| LOW | DOM 查询取密码 | `frontend/src/pages/post-page.tsx:659` | 使用 `document.getElementById` 而非 React state | 非标准做法，不影响功能 |
| LOW | 限流失效无告警 | `src/plugins/rate-limiter.ts:43` | `catch {}` 全量吞噬 | 数据库异常时限流失效但不影响业务 |

### 原版框架固有债务（本次未修改）

| 问题 | 位置 | 不改原因 |
|------|------|---------|
| HTML 实体编码破坏 Markdown | 后端 `escapeHtml` 存储 + 前端 `dangerouslySetInnerHTML` | 修改会波及全部历史帖子，插件 `markdown.ts` 仅新页面启用 |
| Nonce 表仅 1% 概率清理 | `src/security.ts:94` | 原始设计，插件 `scheduled-cleanup.ts` 已提供定时清理替代 |
| 密码异或 bug | `hashPassword()` 中 `replace` 回调 `^` 非预期 | 原始代码遗留，不触发运行时异常 |
| 错误消息字符串匹配 | `handleError` 用 `includes` 匹配后端消息 | 原始设计，耦合度高 |
| `feature_bookmarks` 无前端消费方 | 全站 | 原始代码未实现收藏按钮，设置为预留 |

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