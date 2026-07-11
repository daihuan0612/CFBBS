# CFBBS

基于 Cloudflare Workers + Pages + D1 + R2 的论坛，增强版。

**二次开发特性**：邀请码注册、加密网盘链接、功能开关、LSB 盲水印、编辑器增强、独立插件体系。

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

## ✨ 功能特性

### 核心功能
- ✅ **帖子管理** - 发布、编辑、删除、置顶、分类
- ✅ **评论系统** - 多级评论、支持回复
- ✅ **用户认证** - 注册、登录、2FA
- ✅ **图片上传** - 前端 Luban 压缩 + WebP 转码 + 非图片拦截，存储到 R2
- ✅ **用户资料** - 头像、个人资料
- ✅ **管理后台** - 用户管理、分类管理、设置管理
- ✅ **访问统计** - 浏览量统计
- ✅ **点赞系统** - 灵活的点赞/取消点赞
- ✅ **验证码** - 集成 Cloudflare Turnstile

### 二次开发新增
- ✅ **邀请码注册** - 管理员生成邀请码，支持 invite_only 模式开关
- ✅ **加密网盘链接** - 仅录入第三方网盘链接（非本地文件），支持设置访问密码验证
- ✅ **功能开关** - 后台一键开关：点赞、评论、发帖、收藏、水印、邀请码、加密附件
- ✅ **LSB 盲水印** - 1×1 Canvas 像素级用户标识，零视觉占用
- ✅ **编辑器增强** - 居中/缩进/视频插入/网盘链接插入工具栏按钮
- ✅ **管理员重置密码** - 生成 24h 有效临时密码，自动记录密码历史
- ✅ **独立插件体系** - 前置速率限制、定时清理、统一 API 工具、Markdown 预处理

### 独立插件目录 `src/plugins/`

| 插件 | 功能 | 说明 |
|------|------|------|
| `rate-limiter.ts` | 前置速率限制 | 登录 5次/分，注册 3次/分，上传 10次/分，默认 60次/分，不修改原路由 |
| `scheduled-cleanup.ts` | 定时清理 | Worker scheduled 事件触发，清理过期 nonce、临时密码、限流记录 |
| `utils.ts` | 统一 API 工具库 | `extractUrlParams`、`ApiError` 错误类、日期格式化、时间友好显示 |
| `markdown.ts` | Markdown 预处理 | 解码 HTML 实体编码，修复双倍转义问题，仅新页面启用 |

## 🚀 部署说明

### 前置准备

1. 拥有 [Cloudflare](https://dash.cloudflare.com/) 账号
2. 开通 D1 数据库、R2 存储（免费额度足够）
3. Node.js 18+

### 第一步：Fork 仓库

Fork 本项目到你的 GitHub 账号。

### 第二步：获取 Cloudflare 凭证

#### API Token
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **My Profile > API Tokens > Create Token**
3. 权限配置：
   - Account > Workers Scripts — Edit
   - Account > D1 — Edit
   - Account > R2 — Edit
   - Account > Pages — Edit

#### Account ID
- Cloudflare Dashboard 首页右侧栏可查看

### 第三步：配置 GitHub Secrets

在你的 GitHub 仓库 **Settings > Secrets and variables > Actions** 中添加：

| Secret 名称 | 是否必需 | 说明 |
|-----------|---------|------|
| `CF_API_TOKEN` | 必需 | Cloudflare API Token |
| `CF_ACCOUNT_ID` | 必需 | Cloudflare Account ID |
| `JWT_SECRET` | 必需 | 随机 32 位字符串 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `BASE_URL` | 推荐 | 站点 URL，如 `https://forum.example.com` |
| `TURNSTILE_SITE_KEY` | 可选 | Cloudflare Turnstile Site Key |
| `TURNSTILE_SECRET_KEY` | 可选 | Cloudflare Turnstile Secret |

> **注意**：本版本已移除 SMTP 邮件服务。密码重置改为管理员后台生成临时密码，无需配置邮件服务器。

### 第四步：手动触发部署

在 GitHub Actions 页面选择 **Deploy to Cloudflare**，点击 **Run workflow**。

### 第五步：初始化数据库

部署完成后，执行数据库迁移：

```bash
# 安装依赖
npm install

# 执行迁移
npx wrangler d1 migrations apply cforum-db --remote
```

### 第六步：首次登录

默认管理员账号（首次登录后请立即修改密码）：
- 邮箱：`admin@adysec.com`
- 密码：`Admin@123`

登录后进入管理后台（`/admin`）：
1. 生成邀请码用于新用户注册
2. 根据需要开启/关闭功能开关
3. 配置加密网盘附件等选项

## 🌐 自定义域名

1. Cloudflare Dashboard → Pages → 选择项目 → **Custom domains**
2. 添加域名（如 `forum.example.com`）
3. 等待 DNS 生效

## 🗄️ 数据库结构

### 新增表（二次开发）

| 表名 | 说明 |
|------|------|
| `invitation_codes` | 邀请码管理 |
| `password_history` | 密码变更历史 |
| `temp_passwords` | 管理员生成的临时密码 |
| `encrypted_attachments` | 网盘链接（仅存文本，无文件存储） |
| `user_watermarks` | LSB 盲水印元数据 |
| `rate_limits` | 速率限制记录 |

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)