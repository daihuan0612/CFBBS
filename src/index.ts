
import { sendEmail } from './smtp';
import { generateIdenticon } from './identicon';
import { uploadImage, deleteImage, listAllKeys, getPublicUrl, getKeyFromUrl, S3Env } from './s3';
import * as OTPAuth from 'otpauth';
import { Security, UserPayload } from './security';
import { checkRateLimit, RATE_LIMITS_DDL } from './plugins/rate-limiter';
import { runScheduledCleanup } from './plugins/scheduled-cleanup';

// 内存缓存：减少重复 D1 查询（Worker 实例内跨请求共享）
interface MemCache { data: any; expiry: number; }
const caches = new Map<string, MemCache>();
function getFromCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
	const cached = caches.get(key);
	if (cached && Date.now() < cached.expiry) return Promise.resolve(cached.data as T);
	return fetcher().then(data => { caches.set(key, { data, expiry: Date.now() + ttlMs }); return data; });
}
function invalidateCache(key: string) { caches.delete(key); }

interface DBUser {
    id: number;
    email: string;
    username: string;
    password: string;
    verified: number;
    role?: string;
    avatar_url?: string;
    totp_secret?: string;
    totp_enabled?: number;
    email_notifications?: number;
    reset_token?: string;
    reset_token_expires?: number;
    pending_email?: string;
    verification_token?: string;
    email_change_token?: string;
}

interface PostAuthorInfo {
    title: string;
    author_id: number;
    email: string;
    email_notifications: number;
    username: string;
}

interface DBUserEmail { email: string; }
interface DBUserTotp { totp_secret: string; }
interface DBCount { count: number; }
interface DBSetting { value: string; }

// Utility to extract image URLs from Markdown content
function extractImageUrls(content: string): string[] {
	if (!content) return [];
	const urls: string[] = [];
	const regex = /!\[.*?\]\((.*?)\)/g;
	let match;
	while ((match = regex.exec(content)) !== null) {
		urls.push(match[1]);
	}
	return urls;
}

// Utility to hash password
async function hashPassword(password: string): Promise<string> {
	const myText = new TextEncoder().encode(password);
	const myDigest = await crypto.subtle.digest(
		{
			name: 'SHA-256',
		},
		myText
	);
	const hashArray = Array.from(new Uint8Array(myDigest));
	const hashHex = hashArray
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return hashHex;
}

function generateToken(): string {
	return crypto.randomUUID();
}

function hasControlCharacters(str: string): boolean {
	return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(str);
}

function isVisuallyEmpty(str: string): boolean {
	if (!str) return true;
	const stripped = str.replace(/[\s\u200B-\u200F\uFEFF\u2028\u2029\u180E\u3164\u115F\u1160\x00-\x1F\x7F]+/g, '');
	return stripped.length === 0;
}

function hasInvisibleCharacters(str: string): boolean {
	return /[\u200B-\u200F\uFEFF\u2028\u2029\u180E\u3164\u115F\u1160]/.test(str);
}

function hasRestrictedKeywords(username: string): boolean {
	const restricted = ['管理', 'admin', 'sudo', 'test'];
	return restricted.some(keyword => username.toLowerCase().includes(keyword.toLowerCase()));
}

async function verifyTurnstile(token: string, ip: string, secretKey: string): Promise<boolean> {
	const formData = new FormData();
	formData.append('secret', secretKey);
	formData.append('response', token);
	formData.append('remoteip', ip);

	const url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
	const result = await fetch(url, {
		body: formData,
		method: 'POST',
	});

	const outcome = await result.json() as any;
	return outcome.success;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const method = request.method;

		// Helper function to get base URL
		const getBaseUrl = () => {
			// Priority: 1. Env var 2. X-Original-URL header (from Pages Functions) 3. Request origin
			if (env.BASE_URL) {
				console.log(`✅ Using BASE_URL from env: ${env.BASE_URL}`);
				return env.BASE_URL;
			}

			const xOriginalUrl = request.headers.get('X-Original-URL');
			if (xOriginalUrl) {
				console.log(`✅ Using X-Original-URL from Pages Functions: ${xOriginalUrl}`);
				return xOriginalUrl;
			}

			console.warn(`⚠️ BASE_URL not configured and no X-Original-URL header, falling back to request origin: ${url.origin}`);
			return url.origin;
		};

		// CORS headers helper — 返回请求来源的 Origin，支持跨域带 Authorization 请求
		const getCorsOrigin = () => {
			const origin = request.headers.get('Origin');
			return origin || '*';
		};
		const corsHeaders = () => ({
			'Access-Control-Allow-Origin': getCorsOrigin(),
			'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS, DELETE, PUT',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Timestamp, X-Nonce',
		});

		// Handle OPTIONS (CORS preflight)
		if (method === 'OPTIONS') {
			return new Response(null, {
				headers: corsHeaders(),
			});
		}

		// Ensure ALL API responses carry CORS headers (cross-origin direct access from Pages)
		const withCors = (r: Response): Response => {
			const h = new Headers(r.headers);
			h.set('Access-Control-Allow-Origin', getCorsOrigin());
			h.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS, DELETE, PUT');
			h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Timestamp, X-Nonce');
			return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
		};

		// Helper to return JSON response with CORS
		const jsonResponse = (data: any, status = 200, cacheOverride?: string) => {
			const headers = new Headers(corsHeaders());
			headers.set('Content-Type', 'application/json');
			if (cacheOverride) {
				headers.set('Cache-Control', cacheOverride);
			} else {
				// 缓存策略: GET 请求按路径区分缓存时间
				const cacheablePaths: [string, string][] = [
					['/api/posts', 'public, max-age=120, stale-while-revalidate=3600'],
					['/api/users', 'public, max-age=60, stale-while-revalidate=600'],
				];
				const matched = method === 'GET' && status < 400 ? cacheablePaths.find(([p]) => url.pathname.startsWith(p)) : undefined;
				if (matched) {
					headers.set('Cache-Control', matched[1]);
				} else if (method === 'GET' && status < 400) {
					headers.set('Cache-Control', 'no-cache, must-revalidate');
				} else {
					headers.set('Cache-Control', 'no-store');
				}
			}
			return new Response(JSON.stringify(data), {
				status,
				headers,
			});
		};

		// Serve R2 objects through Worker when using bucket binding
		if (url.pathname.startsWith('/r2/') && (method === 'GET' || method === 'HEAD')) {
			const bucket = (env as any).BUCKET as R2Bucket | undefined;
			if (!bucket) return new Response('R2 bucket not configured', { status: 404 });
			const key = decodeURIComponent(url.pathname.slice('/r2/'.length));
			if (!key) return new Response('Not Found', { status: 404 });
			const object = await bucket.get(key);
			if (!object) return new Response('Not Found', { status: 404 });
			const headers = new Headers();
			object.writeHttpMetadata(headers);
			if (object.httpEtag) headers.set('etag', object.httpEtag);
			headers.set('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');
			headers.set('CDN-Cache-Control', 'public, max-age=86400');
			headers.set('Access-Control-Allow-Origin', getCorsOrigin());
			return new Response(method === 'HEAD' ? null : object.body, { headers });
		}

		// Ensure the database schema exists before anything else.
		const ensureSchema = async () => {
			try {
				await env.cforum_db.prepare('SELECT 1 FROM posts LIMIT 1').first();
				return;
			} catch (err: any) {
				console.warn('Database schema missing, initializing', err);
			}

			// using prepare().run() instead of exec ensures each statement is committed
			const stmts = [
				`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
   role TEXT DEFAULT 'user',
   verified INTEGER DEFAULT 0,
  verification_token TEXT,
  totp_secret TEXT,
  totp_enabled INTEGER DEFAULT 0,
  reset_token TEXT,
  reset_token_expires INTEGER,
  pending_email TEXT,
  email_change_token TEXT,
  avatar_url TEXT,
  nickname TEXT,
  email_notifications INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`,
				`CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`,
				`CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category_id INTEGER,
  is_pinned INTEGER DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES users(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);`,
				`CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  parent_id INTEGER,
  author_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (parent_id) REFERENCES comments(id),
  FOREIGN KEY (author_id) REFERENCES users(id)
);`,
				`CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);`,
				`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);`,
				`CREATE TABLE IF NOT EXISTS nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);`,
				`CREATE TABLE IF NOT EXISTS sessions (
  jti TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);`,
				`CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details TEXT,
  ip_address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`,
				`CREATE TABLE IF NOT EXISTS invitation_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL,
  used_by INTEGER DEFAULT NULL,
  used_at TIMESTAMP DEFAULT NULL,
  expires_at INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (used_by) REFERENCES users(id)
);`,
			`CREATE TABLE IF NOT EXISTS password_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);`,
			`CREATE TABLE IF NOT EXISTS temp_passwords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  temp_password TEXT NOT NULL,
  temp_password_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  is_used INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);`,
			`CREATE TABLE IF NOT EXISTS encrypted_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  user_id INTEGER NOT NULL,
  link_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  extract_code TEXT DEFAULT '',
  password_hash TEXT DEFAULT '',
  is_encrypted INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);`,
			`CREATE TABLE IF NOT EXISTS user_watermarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  watermark_data TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`,
			`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  actor_id INTEGER,
  is_read INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);`,
			`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);`,
			`CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read);`,
			`CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes(code);`,
			`CREATE INDEX IF NOT EXISTS idx_invitation_codes_active ON invitation_codes(is_active);`,
			`CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id);`,
			`CREATE INDEX IF NOT EXISTS idx_temp_passwords_user ON temp_passwords(user_id);`,
			`CREATE INDEX IF NOT EXISTS idx_temp_passwords_expires ON temp_passwords(expires_at);`,
			`CREATE INDEX IF NOT EXISTS idx_encrypted_attachments_post ON encrypted_attachments(post_id);`,
			RATE_LIMITS_DDL,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('turnstile_enabled', '0');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('invite_only', '0');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('encrypted_attachments_enabled', '0');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_likes', '1');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_bookmarks', '1');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_comments', '1');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('feature_posts', '1');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('watermark_enabled', '1');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_user_delete', '1');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_username_change', '1');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_avatar_change', '1');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_manual_verify', '1');`,
			`INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_on_comment', '1');`
			];
			for (const stmt of stmts) {
				try {
					await env.cforum_db.prepare(stmt).run();
				} catch (e) {
					console.error('Error running schema statement', e, stmt);
				}
			}
			// verify posts table exists now
			try {
				await env.cforum_db.prepare('SELECT 1 FROM posts LIMIT 1').first();
			} catch (e) {
				console.error('Failed to verify posts table after init', e);
			}
		};

		// Seed admin from env vars — runs on every deployment, not just first schema creation.
		const seedAdmin = async () => {
			const adminEmail = env.ADMIN_EMAIL || '';
			const adminPassword = env.ADMIN_PASSWORD || '';
			const adminNickname = env.ADMIN_NICKNAME || '';
			if (!adminEmail || !adminPassword) return;
			const encoder = new TextEncoder();
			const data = encoder.encode(adminPassword);
			const hashBuffer = await crypto.subtle.digest('SHA-256', data);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			const adminHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
			await env.cforum_db.prepare(
				`INSERT INTO users (email, username, password, role, verified, nickname) VALUES (?, ?, ?, 'admin', 1, ?)
				 ON CONFLICT(email) DO UPDATE SET password = excluded.password`
			).bind(adminEmail, adminNickname || 'Admin', adminHash, adminNickname || 'Admin').run();
			console.log('Admin user seeded:', adminEmail);
		};

		// perform initialization before security setup (runs only once per isolate)
		const initOnce = async () => {
			await ensureSchema();
			await seedAdmin();
			// Seed admin-only "公告" category
			try {
				await env.cforum_db.prepare("INSERT OR IGNORE INTO categories (name) VALUES ('公告')").run();
			} catch { /* ignore if already exists */ }
		};
		const INIT_KEY = '__cfbbs_init_done';
		if (!(globalThis as any)[INIT_KEY]) {
			(globalThis as any)[INIT_KEY] = true;
			await initOnce();
		}

		let security: Security;
		try {
			security = new Security(env);
		} catch (e) {
			console.error('Security initialization failed:', e);
			return Response.json(
				{ error: 'Server misconfigured' },
				{ status: 500, headers: corsHeaders() }
			);
		}

		// authentication helper - throws on failure
		const authenticate = async (req: Request) => {
			const authHeader = req.headers.get('Authorization');
			if (!authHeader || !authHeader.startsWith('Bearer ')) {
				throw new Error('Unauthorized');
			}
			const token = authHeader.split(' ')[1];
			const payload = await security.verifyToken(token);
			if (!payload) {
				throw new Error('Unauthorized');
			}
			return payload;
		};

		// Helper to handle errors
		const handleError = (e: any) => {
			const errString = String(e);
			if (errString.includes('Unauthorized') || errString.includes('Invalid Token')) {
				return jsonResponse({ error: 'Unauthorized' }, 401);
			}
			return jsonResponse({ error: errString }, 500);
		};

		// Helper: create in-site notification
		const createNotification = async (userId: number, type: string, title: string, message: string, actorId?: number) => {
			try {
				await env.cforum_db.prepare(
					'INSERT INTO notifications (user_id, type, title, message, actor_id) VALUES (?, ?, ?, ?, ?)'
				).bind(userId, type, title, message, actorId || null).run();
			} catch (e) {
				console.error('Failed to create notification', e);
			}
		};

		// 插件: 前置速率限制
		const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';
		const rateCheck = await checkRateLimit(env.cforum_db, clientIp, url.pathname, method);
		if (rateCheck) return rateCheck;

        const publicPaths = [
            '/api/config', '/api/login', '/api/register', '/api/verify',
            '/api/auth/forgot-password', '/api/auth/reset-password', '/api/verify-email-change',
             // Static/Public GETs
            '/api/posts', '/api/categories', '/api/users'
        ];

        // However, user specifically asked for "Replay protection for sensitive operations".
        // We will apply strict checks for mutation methods (POST, PUT, DELETE)
        if (['POST', 'PUT', 'DELETE'].includes(method)) {
             const validation = await security.validateRequest(request);
             if (!validation.valid) {
                 return jsonResponse({ error: validation.error || '安全验证失败' }, 400);
             }
        }

		// GET /api/config
		if (url.pathname === '/api/config' && method === 'GET') {
			try {
				const data = await getFromCache('config', 300_000, async () => {
					const [setting, userCount, settingsAll] = await Promise.all([
						env.cforum_db.prepare("SELECT value FROM settings WHERE key = 'turnstile_enabled'").first<DBSetting>(),
						env.cforum_db.prepare('SELECT COUNT(*) as count FROM users').first('count'),
						env.cforum_db.prepare("SELECT key, value FROM settings").all()
					]);
					const dbEnabled = setting ? setting.value === '1' : false;
					const siteKey = (env as any).TURNSTILE_SITE_KEY || '';
					const secretKey = (env as any).TURNSTILE_SECRET_KEY || '';
					const turnstileFullyConfigured = !!(dbEnabled && siteKey && secretKey);
					const featureFlags: Record<string, boolean> = {
						invite_only: false, encrypted_attachments_enabled: false,
						feature_likes: true, feature_bookmarks: true,
						feature_comments: true, feature_posts: true, watermark_enabled: true
					};
					if (settingsAll.results) {
						for (const row of settingsAll.results) {
							const key = row.key as string;
							if (key in featureFlags) featureFlags[key] = row.value === '1';
						}
					}
					return {
						turnstile_enabled: turnstileFullyConfigured, turnstile_site_key: siteKey,
						user_count: userCount || 0,
						jwt_secret_configured: !!env.JWT_SECRET && String(env.JWT_SECRET).length >= 32,
						r2_public_url: (env as any).R2_PUBLIC_BASE_URL || '',
						...featureFlags
					};
				});
				return jsonResponse(data, 200, 'public, max-age=300');
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /api/admin/settings
		if (url.pathname === '/api/admin/settings' && method === 'GET') {
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const settings = await env.cforum_db.prepare("SELECT key, value FROM settings").all();
				const config: any = {
					turnstile_enabled: false,
					notify_on_user_delete: false,
					notify_on_username_change: false,
					notify_on_avatar_change: false,
					notify_on_manual_verify: false,
					invite_only: true,
					encrypted_attachments_enabled: false,
					feature_likes: true,
					feature_bookmarks: true,
					feature_comments: true,
					feature_posts: true,
					watermark_enabled: true
				};

				if (settings.results) {
					for (const row of settings.results) {
						config[row.key as string] = row.value === '1';
					}
				}

				return jsonResponse(config, 200, 'no-store, private');
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/admin/settings
		if (url.pathname === '/api/admin/settings' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const body = await request.json() as any;
				const { turnstile_enabled, notify_on_user_delete, notify_on_username_change, notify_on_avatar_change, notify_on_manual_verify, notify_on_comment,
					invite_only, encrypted_attachments_enabled, feature_likes, feature_bookmarks, feature_comments, feature_posts, watermark_enabled } = body;

				const stmt = env.cforum_db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
				const batch = [];

				if (turnstile_enabled !== undefined) batch.push(stmt.bind('turnstile_enabled', turnstile_enabled ? '1' : '0'));
				if (notify_on_user_delete !== undefined) batch.push(stmt.bind('notify_on_user_delete', notify_on_user_delete ? '1' : '0'));
				if (notify_on_username_change !== undefined) batch.push(stmt.bind('notify_on_username_change', notify_on_username_change ? '1' : '0'));
				if (notify_on_avatar_change !== undefined) batch.push(stmt.bind('notify_on_avatar_change', notify_on_avatar_change ? '1' : '0'));
				if (notify_on_manual_verify !== undefined) batch.push(stmt.bind('notify_on_manual_verify', notify_on_manual_verify ? '1' : '0'));
				if (notify_on_comment !== undefined) batch.push(stmt.bind('notify_on_comment', notify_on_comment ? '1' : '0'));
				if (invite_only !== undefined) batch.push(stmt.bind('invite_only', invite_only ? '1' : '0'));
				if (encrypted_attachments_enabled !== undefined) batch.push(stmt.bind('encrypted_attachments_enabled', encrypted_attachments_enabled ? '1' : '0'));
				if (feature_likes !== undefined) batch.push(stmt.bind('feature_likes', feature_likes ? '1' : '0'));
				if (feature_bookmarks !== undefined) batch.push(stmt.bind('feature_bookmarks', feature_bookmarks ? '1' : '0'));
				if (feature_comments !== undefined) batch.push(stmt.bind('feature_comments', feature_comments ? '1' : '0'));
				if (feature_posts !== undefined) batch.push(stmt.bind('feature_posts', feature_posts ? '1' : '0'));
				if (watermark_enabled !== undefined) batch.push(stmt.bind('watermark_enabled', watermark_enabled ? '1' : '0'));

				if (batch.length > 0) await env.cforum_db.batch(batch);

				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// Helper to check Turnstile if enabled
		const checkTurnstile = async (reqBody: any, ip: string) => {
			const setting = await env.cforum_db.prepare("SELECT value FROM settings WHERE key = 'turnstile_enabled'").first<DBSetting>();
			// 只有数据库启用且两个环境变量都配置时才要求验证（与前端逻辑一致）
			const dbEnabled = setting && setting.value === '1';
			const siteKey = (env as any).TURNSTILE_SITE_KEY;
			const secretKey = (env as any).TURNSTILE_SECRET_KEY;
			const fullyConfigured = dbEnabled && siteKey && secretKey;

			if (fullyConfigured) {
				const token = reqBody['cf-turnstile-response'];
				if (!token) return false;
				return await verifyTurnstile(token, ip, secretKey);
			}
			return true;
		};

		// POST /api/upload (Image Upload)
		if (url.pathname === '/api/upload' && method === 'POST') {
			try {
				const user = await authenticate(request);

				const formData = await request.formData();
				const file = formData.get('file');
				const userId = user.id.toString(); // Use verified user ID
				const postId = formData.get('post_id') || 'general';
				const type = formData.get('type') || 'post';

				if (!file || !(file instanceof File)) {
					return jsonResponse({ error: '未上传文件' }, 400);
				}

				if (!file.type.startsWith('image/')) {
					return jsonResponse({ error: '仅允许上传图片' }, 400);
				}

// Check file size (2MB = 2 * 1024 * 1024 bytes)
			const MAX_SIZE = 2 * 1024 * 1024;
			if (file.size > MAX_SIZE) {
				return jsonResponse({ error: '文件大小超过限制（最大 2MB）' }, 400);
				}

				const imageKey = await uploadImage(env as unknown as S3Env, file, userId, postId.toString(), type as 'post' | 'avatar');
			const r2PublicUrl = (env as any).R2_PUBLIC_BASE_URL as string | undefined;
			const publicBase = (env as any).BUCKET ? (r2PublicUrl || `${getBaseUrl()}/r2`) : undefined;
			const imageUrl = getPublicUrl(env as unknown as S3Env, imageKey, publicBase);
				return jsonResponse({ success: true, url: imageUrl });
			} catch (e) {
				console.error('Upload error:', e);
				return handleError(e); // 401/403 will be caught here if auth fails
			}
		}

		// --- AUTH ROUTES ---

		// POST /api/login
		if (url.pathname === '/api/login' && method === 'POST') {
			try {
				const body = await request.json() as any;

				// Turnstile Check
				const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
				if (!(await checkTurnstile(body, ip))) {
					return jsonResponse({ error: '验证码验证失败' }, 403);
				}

				const { email, password, totp_code } = body;
				if (!email || !password) {
					return jsonResponse({ error: '请输入用户名和密码' }, 400);
				}

				const user = await env.cforum_db
					.prepare('SELECT id, email, username, password, role, verified, totp_secret, totp_enabled, avatar_url, email_notifications FROM users WHERE email = ?')
					.bind(email)
					.first<DBUser>();
				if (!user) {
					return jsonResponse({ error: '用户名或密码错误' }, 401);
				}

				const passwordHash = await hashPassword(password);
				if (user.password !== passwordHash) {
					return jsonResponse({ error: '用户名或密码错误' }, 401);
				}

				// TOTP Check
				if (user.totp_enabled) {
					if (!totp_code) {
						return jsonResponse({ error: 'TOTP_REQUIRED' }, 403);
					}
					if (!user.totp_secret) {
						return jsonResponse({ error: '2FA 未配置' }, 500);
					}

					const totp = new OTPAuth.TOTP({
						algorithm: 'SHA1',
						digits: 6,
						period: 30,
						secret: OTPAuth.Secret.fromBase32(String(user.totp_secret)),
					});

					const delta = totp.validate({ token: totp_code, window: 1 });
					if (delta === null) {
						return jsonResponse({ error: '2FA 验证码错误' }, 401);
					}
				}

				const { token, jti, expiresAt } = await security.generateToken({
					id: user.id,
					role: user.role || 'user',
					email: user.email
				});

				await env.cforum_db.prepare('INSERT INTO sessions (jti, user_id, expires_at) VALUES (?, ?, ?)').bind(jti, user.id, expiresAt).run();
				await security.logAudit(user.id, 'LOGIN', 'user', String(user.id), { email }, request);

				return jsonResponse({
					token,
					user: {
						id: user.id,
						email: user.email,
						username: user.username,
						avatar_url: user.avatar_url,
						role: user.role || 'user',
						totp_enabled: !!user.totp_enabled,
						email_notifications: user.email_notifications === 1
					}
				});
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/user/profile
		if (url.pathname === '/api/user/profile' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				const body = await request.json() as any;
				const { username, avatar_url, email_notifications } = body;

				const user_id = userPayload.id;

				if (username) {
					if (username.length > 20) return jsonResponse({ error: '昵称过长（最多 20 个字符）' }, 400);
					if (isVisuallyEmpty(username)) return jsonResponse({ error: '昵称不能为空' }, 400);
					if (hasInvisibleCharacters(username)) return jsonResponse({ error: '昵称包含不可见字符' }, 400);
					if (hasControlCharacters(username)) return jsonResponse({ error: '昵称包含控制字符' }, 400);
					if (hasRestrictedKeywords(username)) return jsonResponse({ error: '昵称包含敏感词' }, 400);

					// Check Uniqueness
					const existingUser = await env.cforum_db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').bind(username, user_id).first<{id:number}>();
					if (existingUser) {
						return jsonResponse({ error: '该昵称已被使用' }, 409);
					}
				}

				// Fetch current user
				const currentUser = await env.cforum_db.prepare('SELECT id, email, username, avatar_url, role, totp_enabled, email_notifications, nickname, password FROM users WHERE id = ?').bind(user_id).first<DBUser>();
				if (!currentUser) return jsonResponse({ error: '用户不存在' }, 404);

				let newUsername = currentUser.username;
				if (username !== undefined) {
					newUsername = username;
				}

				let newAvatarUrl = currentUser.avatar_url;
				if (avatar_url !== undefined) {
					if (avatar_url === '' || avatar_url === null) {
						// Generate Identicon
						newAvatarUrl = await generateIdenticon(String(user_id));
					} else {
						if (avatar_url.length > 2000) return jsonResponse({ error: '头像链接过长（最多 2000 个字符）' }, 400);
						if (!/^https?:\/\//i.test(avatar_url) && !avatar_url.startsWith('data:image/svg+xml')) return jsonResponse({ error: '头像链接格式无效（需以 http:// 或 https:// 开头）' }, 400);
						newAvatarUrl = avatar_url;
					}
				}

				let newEmailNotif = currentUser.email_notifications;
				if (email_notifications !== undefined) {
					newEmailNotif = email_notifications ? 1 : 0;
				}

				await env.cforum_db.prepare('UPDATE users SET username = ?, avatar_url = ?, email_notifications = ? WHERE id = ?')
					.bind(newUsername, newAvatarUrl, newEmailNotif, user_id).run();

				// Notifications for profile changes
				if (username !== undefined && username !== currentUser.username) {
					const setting = await env.cforum_db.prepare("SELECT value FROM settings WHERE key = 'notify_on_username_change'").first<DBSetting>();
					if (setting && setting.value === '1') {
						ctx.waitUntil(createNotification(userPayload.id, 'username_changed', '用户名已修改', `您的用户名已从 "${currentUser.username}" 修改为 "${username}"。`));
					}
				}

				if (avatar_url !== undefined && avatar_url !== currentUser.avatar_url) {
					const setting = await env.cforum_db.prepare("SELECT value FROM settings WHERE key = 'notify_on_avatar_change'").first<DBSetting>();
					if (setting && setting.value === '1') {
						ctx.waitUntil(createNotification(userPayload.id, 'avatar_changed', '头像已修改', '您的头像已成功更新。'));
					}
				}

			const user = await env.cforum_db.prepare('SELECT * FROM users WHERE id = ?').bind(user_id).first<DBUser>();
			if (!user) return jsonResponse({ error: '用户不存在' }, 404);
				return jsonResponse({
					success: true,
					user: {
						id: user.id,
						email: user.email,
						username: user.username,
						avatar_url: user.avatar_url,
						role: user.role || 'user',
						totp_enabled: !!user.totp_enabled,
						email_notifications: user.email_notifications === 1
					}
				});
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /api/user/me — 调试端点：从数据库返回当前用户完整信息
		if (url.pathname === '/api/user/me' && method === 'GET') {
			try {
				const payload = await authenticate(request);
				const user = await env.cforum_db.prepare('SELECT id, email, username, avatar_url, role, totp_enabled, email_notifications FROM users WHERE id = ?').bind(payload.id).first<any>();
				if (!user) return jsonResponse({ error: '用户不存在' }, 404);
				return jsonResponse({
					username: user.username,
					email: user.email,
					db_id: user.id,
				});
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/user/delete
		if (url.pathname === '/api/user/delete' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				const body = await request.json() as any;
				const { password, totp_code } = body;

				if (!password) return jsonResponse({ error: '请输入密码' }, 400);

				const user_id = userPayload.id;

				const user = await env.cforum_db.prepare('SELECT * FROM users WHERE id = ?').bind(user_id).first<DBUser>();
				if (!user) return jsonResponse({ error: '用户不存在' }, 404);

				// Verify Password (Double check for sensitive delete op)
				const passwordHash = await hashPassword(password);
				if (user.password !== passwordHash) {
					return jsonResponse({ error: '密码错误' }, 401);
				}

				// Verify TOTP if enabled
				if (user.totp_enabled) {
					if (!totp_code) return jsonResponse({ error: 'TOTP_REQUIRED' }, 403);
					if (!user.totp_secret) return jsonResponse({ error: '2FA 未配置' }, 500);
					const totp = new OTPAuth.TOTP({
						algorithm: 'SHA1',
						digits: 6,
						period: 30,
						secret: OTPAuth.Secret.fromBase32(String(user.totp_secret))
					});
					if (totp.validate({ token: totp_code, window: 1 }) === null) {
						return jsonResponse({ error: '2FA 验证码错误' }, 401);
					}
				}

				// Delete User and Data

				// 1. Delete images (Avatar + Post images)
				const posts: any = await env.cforum_db.prepare('SELECT content FROM posts WHERE author_id = ?').bind(user_id).all();
				const deletionPromises: Promise<any>[] = [];

				if (user.avatar_url) {
					deletionPromises.push(deleteImage(env as unknown as S3Env, user.avatar_url, user_id));
				}

				if (posts.results) {
					for (const post of posts.results) {
						const imageUrls = extractImageUrls(post.content as string);
						imageUrls.forEach(url => deletionPromises.push(deleteImage(env as unknown as S3Env, url, user_id)));
					}
				}

				if (deletionPromises.length > 0) {
					 ctx.waitUntil(Promise.all(deletionPromises).catch(err => console.error('Failed to delete user images', err)));
				}

				// 2. Delete likes/comments ON user's posts (Cascade manually)
				await env.cforum_db.prepare('DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE author_id = ?)').bind(user_id).run();
				await env.cforum_db.prepare('DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE author_id = ?)').bind(user_id).run();

				// 3. Delete user's activity
				await env.cforum_db.prepare('DELETE FROM likes WHERE user_id = ?').bind(user_id).run();
				await env.cforum_db.prepare('DELETE FROM comments WHERE author_id = ?').bind(user_id).run();

				// 4. Clean up all other FK references before deleting the user
				await env.cforum_db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user_id).run();
				await env.cforum_db.prepare('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?').bind(user_id, user_id).run();
				await env.cforum_db.prepare('DELETE FROM user_watermarks WHERE user_id = ?').bind(user_id).run();
				await env.cforum_db.prepare('DELETE FROM password_history WHERE user_id = ?').bind(user_id).run();
				await env.cforum_db.prepare('DELETE FROM temp_passwords WHERE user_id = ? OR created_by = ?').bind(user_id, user_id).run();
				await env.cforum_db.prepare('DELETE FROM invitation_codes WHERE created_by = ? OR used_by = ?').bind(user_id, user_id).run();
				await env.cforum_db.prepare('DELETE FROM encrypted_attachments WHERE user_id = ?').bind(user_id).run();

				// 5. Delete posts and user
				await env.cforum_db.prepare('DELETE FROM posts WHERE author_id = ?').bind(user_id).run();
				await env.cforum_db.prepare('DELETE FROM users WHERE id = ?').bind(user_id).run();

				await security.logAudit(userPayload.id, 'DELETE_ACCOUNT', 'user', String(user_id), {}, request);

				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/user/change-password
		if (url.pathname === '/api/user/change-password' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				const body = await request.json() as any;
				const { current_password, new_password, confirm_password } = body;

				if (!current_password || !new_password) return jsonResponse({ error: '请输入当前密码和新密码' }, 400);
				if (new_password !== confirm_password) return jsonResponse({ error: '两次输入的新密码不一致' }, 400);
				if (new_password.length < 8 || new_password.length > 16) return jsonResponse({ error: '密码长度需 8-16 个字符' }, 400);

				const user_id = userPayload.id;
				const user = await env.cforum_db.prepare('SELECT * FROM users WHERE id = ?').bind(user_id).first<DBUser>();
				if (!user) return jsonResponse({ error: '用户不存在' }, 404);

				// 验证当前密码
				const currentHash = await hashPassword(current_password);
				if (user.password !== currentHash) {
					return jsonResponse({ error: '当前密码错误' }, 401);
				}

				// 检查新密码是否与旧密码相同（用密码历史表检查重复）
				const lastUsed = await env.cforum_db.prepare(
					"SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
				).bind(user_id).first();
				const newHash = await hashPassword(new_password);
				if (lastUsed && lastUsed.password_hash === newHash) {
					return jsonResponse({ error: '新密码不能与上次使用的密码相同' }, 400);
				}

				// 记录旧密码到历史
				await env.cforum_db.prepare(
					"INSERT INTO password_history (user_id, password_hash, created_at) VALUES (?, ?, ?)"
				).bind(user_id, user.password, Date.now() / 1000).run();

				// 更新密码
				await env.cforum_db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(newHash, user_id).run();

				await security.logAudit(user_id, 'CHANGE_PASSWORD', 'user', String(user_id), {}, request);

				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/user/totp/setup
		if (url.pathname === '/api/user/totp/setup' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				const user_id = userPayload.id; // Force use of authenticated ID

				const secret = new OTPAuth.Secret({ size: 20 });
				const secretBase32 = secret.base32;

				await env.cforum_db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').bind(secretBase32, user_id).run();

				const user = await env.cforum_db.prepare('SELECT email FROM users WHERE id = ?').bind(user_id).first<DBUserEmail>();
			if (!user) return jsonResponse({ error: '用户不存在' }, 404);

				await security.logAudit(userPayload.id, 'SETUP_TOTP', 'user', String(user_id), {}, request);

				const totp = new OTPAuth.TOTP({
					issuer: 'CloudflareForum',
					label: user.email,
					algorithm: 'SHA1',
					digits: 6,
					period: 30,
					secret: secret
				});

				return jsonResponse({
					secret: secretBase32,
					uri: totp.toString()
				});
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/user/totp/verify
		if (url.pathname === '/api/user/totp/verify' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				const body = await request.json() as any;
				const { token } = body;
				const user_id = userPayload.id; // Force use of authenticated ID

				if (!token) return jsonResponse({ error: '缺少参数' }, 400);

				const user = await env.cforum_db.prepare('SELECT totp_secret FROM users WHERE id = ?').bind(user_id).first<DBUserTotp>();

				if (!user || !user.totp_secret) return jsonResponse({ error: '2FA 未设置' }, 400);

				const totp = new OTPAuth.TOTP({
					algorithm: 'SHA1',
					digits: 6,
					period: 30,
					secret: OTPAuth.Secret.fromBase32(user.totp_secret)
				});

				const delta = totp.validate({ token: token, window: 1 });

				if (delta !== null) {
					await env.cforum_db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').bind(user_id).run();
					await security.logAudit(userPayload.id, 'ENABLE_TOTP', 'user', String(user_id), {}, request);
					return jsonResponse({ success: true });
				} else {
					return jsonResponse({ error: '验证码错误' }, 400);
				}
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/auth/forgot-password
		if (url.pathname === '/api/auth/forgot-password' && method === 'POST') {
			try {
				const body = await request.json() as any;

				// Turnstile Check
				const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
				if (!(await checkTurnstile(body, ip))) {
					return jsonResponse({ error: '验证码验证失败' }, 403);
				}

				const { email } = body;
				if (!email) return jsonResponse({ error: '请输入邮箱地址' }, 400);

				const user = await env.cforum_db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
				if (!user) return jsonResponse({ success: true }); // Silent fail

				const token = generateToken();
				const expires = Date.now() + 3600000; // 1 hour

				await env.cforum_db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?')
					.bind(token, expires, user.id).run();

				const baseUrl = getBaseUrl();
				const resetLink = `${baseUrl}/reset?token=${token}`;

				const emailHtml = `
					<h1>密码重置请求</h1>
					<p>请点击下方链接重置您的密码：</p>
					<a href="${resetLink}">重置密码</a>
					<p>如果您未请求此操作，请忽略此邮件。</p>
					<p>此链接将在 1 小时后失效。</p>
				`;

				ctx.waitUntil(sendEmail(email, '密码重置请求', emailHtml, env).catch(console.error));
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /auth/reset-password
		if (url.pathname === '/api/auth/reset-password' && method === 'POST') {
			try {
				const body = await request.json() as any;

				// Turnstile Check
				const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
				if (!(await checkTurnstile(body, ip))) {
					return jsonResponse({ error: '验证码验证失败' }, 403);
				}

				const { token, new_password, confirm_password, totp_code } = body;
				if (!token || !new_password) return jsonResponse({ error: '缺少参数' }, 400);
				if (new_password !== confirm_password) return jsonResponse({ error: '两次输入的密码不一致' }, 400);

				if (new_password.length < 8 || new_password.length > 16) return jsonResponse({ error: '密码长度需 8-16 个字符' }, 400);

				// Verify token
				const user = await env.cforum_db.prepare('SELECT * FROM users WHERE reset_token = ?').bind(token).first<DBUser>();
				if (!user) return jsonResponse({ error: '重置链接无效' }, 400);
				if (!user.reset_token_expires || Date.now() > user.reset_token_expires) return jsonResponse({ error: '重置链接已过期' }, 400);

				// If user has 2FA, require it
				if (user.totp_enabled) {
					if (!totp_code) return jsonResponse({ error: 'TOTP_REQUIRED' }, 403);
					if (!user.totp_secret) return jsonResponse({ error: '2FA 未配置' }, 500);
					const totp = new OTPAuth.TOTP({
						algorithm: 'SHA1',
						digits: 6,
						period: 30,
						secret: OTPAuth.Secret.fromBase32(String(user.totp_secret))
					});
					if (totp.validate({ token: totp_code, window: 1 }) === null) {
						return jsonResponse({ error: '2FA 验证码错误' }, 401);
					}
				}

				const passwordHash = await hashPassword(new_password);
				// 记录旧密码到历史
				const oldHash = user.password;
				if (oldHash) {
					await env.cforum_db.prepare('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)').bind(user.id, oldHash).run();
				}
				await env.cforum_db.prepare('UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
					.bind(passwordHash, user.id).run();

				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/user/change-email
		if (url.pathname === '/api/user/change-email' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				const body = await request.json() as any;
				const { new_email, totp_code } = body;

				if (!new_email) return jsonResponse({ error: '缺少参数' }, 400);

				if (new_email.length > 50) return jsonResponse({ error: '邮箱过长（最多 50 个字符）' }, 400);

				const user_id = userPayload.id;

const user = await env.cforum_db.prepare('SELECT * FROM users WHERE id = ?').bind(user_id).first<DBUser>();
				if (!user) return jsonResponse({ error: '用户不存在' }, 404);

				// Verify 2FA if enabled
				if (user.totp_enabled) {
					if (!totp_code) return jsonResponse({ error: 'TOTP_REQUIRED' }, 403);
					if (!user.totp_secret) return jsonResponse({ error: '2FA 未配置' }, 500);
					const totp = new OTPAuth.TOTP({
						algorithm: 'SHA1',
						digits: 6,
						period: 30,
						secret: OTPAuth.Secret.fromBase32(String(user.totp_secret))
					});
					if (totp.validate({ token: totp_code, window: 1 }) === null) {
						return jsonResponse({ error: '2FA 验证码错误' }, 401);
					}
				}

				// Check if email already exists
				const exists = await env.cforum_db.prepare('SELECT id FROM users WHERE email = ?').bind(new_email).first();
				if (exists) return jsonResponse({ error: '该邮箱已被使用' }, 400);

				const token = generateToken();
				await env.cforum_db.prepare('UPDATE users SET pending_email = ?, email_change_token = ? WHERE id = ?')
					.bind(new_email, token, user.id).run();

				await security.logAudit(userPayload.id, 'CHANGE_EMAIL_INIT', 'user', String(user_id), { new_email }, request);

				const baseUrl = getBaseUrl();
				const verifyLink = `${baseUrl}/api/verify-email-change?token=${token}`;
				const emailHtml = `
					<h1>确认更换邮箱</h1>
					<p>请点击下方链接确认将您的邮箱更换为 ${new_email}：</p>
					<a href="${verifyLink}">确认更换</a>
				`;

				ctx.waitUntil(sendEmail(new_email, '确认更换邮箱', emailHtml, env).catch(console.error));
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /api/verify-email-change
		if (url.pathname === '/api/verify-email-change' && method === 'GET') {
			const token = url.searchParams.get('token');
			if (!token) return new Response('Missing token', { status: 400 });

			try {
const user = await env.cforum_db.prepare('SELECT * FROM users WHERE email_change_token = ?').bind(token).first<DBUser>();
				if (!user) return new Response('Invalid token', { status: 400 });

				await env.cforum_db.prepare('UPDATE users SET email = ?, pending_email = NULL, email_change_token = NULL WHERE id = ?')
					.bind(user.pending_email, user.id).run();

				return Response.redirect(`${getBaseUrl()}/?email_changed=true`, 302);
			} catch (e) {
				return new Response('Failed', { status: 500 });
			}
		}

		// POST /api/admin/users/:id/update (Admin direct update)
		if (url.pathname.match(/^\/api\/admin\/users\/\d+\/update$/) && method === 'POST') {
			const id = url.pathname.split('/')[4];
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const body = await request.json() as any;
				const { password, email, username, avatar_url } = body;

				if (password && (password.length < 8 || password.length > 16)) return jsonResponse({ error: '密码长度需 8-16 个字符' }, 400);

				if (password) {
					const hash = await hashPassword(password);
					await env.cforum_db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(hash, id).run();
				}
				if (email) {
					if (email.length > 50) return jsonResponse({ error: '邮箱过长（最多 50 个字符）' }, 400);
					await env.cforum_db.prepare('UPDATE users SET email = ? WHERE id = ?').bind(email, id).run();
				}
				if (avatar_url !== undefined) {
					// Allow clearing avatar with empty string or null -> Force Regenerate Default
					if (!avatar_url) {
						// Reset to Default
						const identicon = await generateIdenticon(String(id));
						await env.cforum_db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(identicon, id).run();
					} else {
						if (avatar_url.length > 500) return jsonResponse({ error: '头像链接过长（最多 500 个字符）' }, 400);
						if (!/^https?:\/\//i.test(avatar_url) && !avatar_url.startsWith('data:image/svg+xml')) return jsonResponse({ error: '头像链接格式无效' }, 400);
						await env.cforum_db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatar_url, id).run();
					}

					// Notify Avatar Change
					const notifyAvatar = await env.cforum_db.prepare("SELECT value FROM settings WHERE key = 'notify_on_avatar_change'").first<DBSetting>();
					if (notifyAvatar && notifyAvatar.value === '1') {
						const user = await env.cforum_db.prepare('SELECT email, username FROM users WHERE id = ?').bind(id).first<{email:string;username:string}>();
						if (user) {
							const emailHtml = `
								<h1>头像已更新</h1>
								<p>您的头像已被管理员更新。</p>
							`;
							ctx.waitUntil(sendEmail(user.email, '您的头像已更新', emailHtml, env).catch(console.error));
						}
					}
				}
				if (username) {
					if (username.length > 20) return jsonResponse({ error: '昵称过长（最多 20 个字符）' }, 400);
					if (isVisuallyEmpty(username)) return jsonResponse({ error: '昵称不能为空' }, 400);
					if (hasInvisibleCharacters(username)) return jsonResponse({ error: '昵称包含不可见字符' }, 400);
					if (hasControlCharacters(username)) return jsonResponse({ error: '昵称包含控制字符' }, 400);

					await env.cforum_db.prepare('UPDATE users SET username = ? WHERE id = ?').bind(username, id).run();

					// Notify user about username change
					const notifyUsername = await env.cforum_db.prepare("SELECT value FROM settings WHERE key = 'notify_on_username_change'").first<DBSetting>();
					if (notifyUsername && notifyUsername.value === '1') {
						const user = await env.cforum_db.prepare('SELECT email, username FROM users WHERE id = ?').bind(id).first<{email:string;username:string}>();
						if (user) {
							const emailHtml = `
								<h1>用户名已修改</h1>
								<p>您的用户名已被管理员修改为 <strong>${username}</strong>。</p>
								<p>如有疑问，请联系管理员。</p>
							`;
							ctx.waitUntil(sendEmail(user.email, '您的用户名已修改', emailHtml, env).catch(console.error));
						}
					}
				}

				await security.logAudit(userPayload.id, 'ADMIN_UPDATE_USER', 'user', id, { username, email, avatar_url, passwordChanged: !!password }, request);

				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /api/categories — filter admin-only categories
		if (url.pathname === '/api/categories' && method === 'GET') {
			try {
				let isAdmin = false;
				try {
					const admin = await authenticate(request);
					isAdmin = admin.role === 'admin';
				} catch { /* not logged in or not admin */ }

				const { results } = await env.cforum_db.prepare(
					isAdmin
						? 'SELECT * FROM categories ORDER BY created_at ASC'
						: "SELECT id, name, created_at FROM categories WHERE name != '公告' ORDER BY created_at ASC"
				).all<any>();
				const resp = jsonResponse(results);
				resp.headers.set('Cache-Control', isAdmin ? 'no-store, private' : 'public, max-age=86400, stale-while-revalidate=604800');
				return resp;
			} catch (e) {
				return handleError(e);
			}
		}

		// --- NOTIFICATION ROUTES ---

		// GET /api/notifications
		if (url.pathname === '/api/notifications' && method === 'GET') {
			try {
				const userPayload = await authenticate(request);
				const limit = parseInt(url.searchParams.get('limit') || '20');
				const { results } = await env.cforum_db.prepare(
					'SELECT id, type, title, message, actor_id, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
				).bind(userPayload.id, limit).all();
				return jsonResponse(results, 200, 'no-store, private');
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /api/notifications/unread-count
		if (url.pathname === '/api/notifications/unread-count' && method === 'GET') {
			try {
				const userPayload = await authenticate(request);
				const row = await env.cforum_db.prepare(
					'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
				).bind(userPayload.id).first<{count: number}>();
				return jsonResponse({ count: row?.count || 0 });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/notifications/read/:id
		if (url.pathname.match(/^\/api\/notifications\/read\/\d+$/) && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				const id = url.pathname.split('/')[4];
				await env.cforum_db.prepare(
					'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
				).bind(id, userPayload.id).run();
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/notifications/read-all
		if (url.pathname === '/api/notifications/read-all' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				await env.cforum_db.prepare(
					'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
				).bind(userPayload.id).run();
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// DELETE /api/notifications/:id
		if (url.pathname.match(/^\/api\/notifications\/\d+$/) && method === 'DELETE') {
			try {
				const userPayload = await authenticate(request);
				const id = url.pathname.split('/')[3];
				await env.cforum_db.prepare(
					'DELETE FROM notifications WHERE id = ? AND user_id = ?'
				).bind(id, userPayload.id).run();
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/admin/categories
		if (url.pathname === '/api/admin/categories' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const body = await request.json() as any;
				const { name } = body;
				if (!name) return jsonResponse({ error: '请输入分类名称' }, 400);

				// Check if name already exists
				const existing = await env.cforum_db.prepare('SELECT id FROM categories WHERE name = ?').bind(name).first();
				if (existing) return jsonResponse({ error: '该分类名已存在' }, 409);

				await env.cforum_db.prepare('INSERT INTO categories (name) VALUES (?)').bind(name).run();
				await security.logAudit(userPayload.id, 'CREATE_CATEGORY', 'category', name, {}, request);
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// PUT /api/admin/categories/:id
		if (url.pathname.match(/^\/api\/admin\/categories\/\d+$/) && method === 'PUT') {
			const id = url.pathname.split('/')[4];
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const body = await request.json() as any;
				const { name } = body;
				if (!name) return jsonResponse({ error: '请输入分类名称' }, 400);

				// Check category exists first, bail early if no-op
				const existing = await env.cforum_db.prepare('SELECT name FROM categories WHERE id = ?').bind(id).first<{name: string}>();
				if (!existing) return jsonResponse({ error: '分类不存在' }, 404);
				if (existing.name === name) return jsonResponse({ success: true }); // same name, no-op

				await env.cforum_db.prepare('UPDATE categories SET name = ? WHERE id = ?').bind(name, id).run();
				await security.logAudit(userPayload.id, 'UPDATE_CATEGORY', 'category', id, { name }, request);
				return jsonResponse({ success: true });
			} catch (e: any) {
				if (e?.message?.includes('UNIQUE constraint failed: categories.name')) {
					return jsonResponse({ error: '该分类名已存在' }, 409);
				}
				return handleError(e);
			}
		}

		// DELETE /api/admin/categories/:id
		if (url.pathname.match(/^\/api\/admin\/categories\/\d+$/) && method === 'DELETE') {
			const id = url.pathname.split('/')[4];
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				// Check if there are posts in this category
				const count = await env.cforum_db.prepare('SELECT COUNT(*) as count FROM posts WHERE category_id = ?').bind(id).first<number>('count');
				if ((count ?? 0) > 0) {
					return jsonResponse({ error: '该分类下有帖子，无法删除' }, 400);
				}

				await env.cforum_db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
				await security.logAudit(userPayload.id, 'DELETE_CATEGORY', 'category', id, {}, request);
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// --- ADMIN ROUTES ---

		// GET /api/admin/stats
		if (url.pathname === '/api/admin/stats' && method === 'GET') {
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const [userCount, postCount, commentCount] = await Promise.all([
					env.cforum_db.prepare('SELECT COUNT(*) as count FROM users').first<number>('count'),
					env.cforum_db.prepare('SELECT COUNT(*) as count FROM posts').first<number>('count'),
					env.cforum_db.prepare('SELECT COUNT(*) as count FROM comments').first<number>('count')
				]);

				return jsonResponse({
					users: userCount,
					posts: postCount,
					comments: commentCount
				}, 200, 'no-store, private');
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /api/admin/users — 管理后台用，不缓存
		if (url.pathname === '/api/admin/users' && method === 'GET') {
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const { results } = await env.cforum_db.prepare('SELECT id, email, username, role, verified, created_at, avatar_url FROM users ORDER BY created_at DESC').all();
				return jsonResponse(results, 200, 'no-store, private');
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/admin/users/:id/verify (Manual Verify)
		if (url.pathname.match(/^\/api\/admin\/users\/\d+\/verify$/) && method === 'POST') {
			const id = url.pathname.split('/')[4];
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const { success } = await env.cforum_db.prepare('UPDATE users SET verified = 1, verification_token = NULL WHERE id = ?').bind(id).run();
				await security.logAudit(userPayload.id, 'MANUAL_VERIFY_USER', 'user', id, {}, request);

				// Notification
				const setting = await env.cforum_db.prepare("SELECT value FROM settings WHERE key = 'notify_on_manual_verify'").first<DBSetting>();
				if (setting && setting.value === '1') {
					const user = await env.cforum_db.prepare('SELECT email, username FROM users WHERE id = ?').bind(id).first<{email:string;username:string}>();
					if (!user) throw new Error('User unexpectedly missing');
					// Send notification to the verified user
					ctx.waitUntil(createNotification(parseInt(id), 'manual_verified', '账户已验证', `您的账户（${user.username}）已通过管理员手动验证。`, userPayload.id));
				}

				return jsonResponse({ success });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/admin/users/:id/resend (Resend Verification Email)
		if (url.pathname.match(/^\/api\/admin\/users\/\d+\/resend$/) && method === 'POST') {
			const id = url.pathname.split('/')[4];
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const user = await env.cforum_db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<DBUser>();
				if (!user) return jsonResponse({ error: '用户不存在' }, 404);
				if (user.verified) return jsonResponse({ error: '该用户已验证' }, 400);

				// Generate new token if needed, or use existing
				let token = user.verification_token;
				if (!token) {
					token = generateToken();
					await env.cforum_db.prepare('UPDATE users SET verification_token = ? WHERE id = ?').bind(token, id).run();
				}

				const baseUrl = getBaseUrl();
				const verifyLink = `${baseUrl}/api/verify?token=${token}`;
				const emailHtml = `
					<h1>欢迎加入论坛，${user.username}！</h1>
					<p>请点击下方链接验证您的邮箱地址：</p>
					<a href="${verifyLink}">验证邮箱</a>
					<p>如果您未请求此操作，请忽略此邮件。</p>
				`;

				ctx.waitUntil(
					sendEmail(user.email, '请验证您的邮箱', emailHtml, env)
						.catch(err => console.error('[Background Email Error]', err))
				);

				await security.logAudit(userPayload.id, 'RESEND_VERIFY_EMAIL', 'user', id, {}, request);

				return jsonResponse({ success: true, message: '验证邮件已发送' });
			} catch (e) {
				return handleError(e);
			}
		}

		// DELETE /api/admin/users/:id
		if (url.pathname.match(/^\/api\/admin\/users\/\d+$/) && method === 'DELETE') {
			const id = url.pathname.split('/').pop();
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				// 检查用户是否存在（防止已自删用户还在列表中）
				const existingUser = await env.cforum_db.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
				if (!existingUser) return jsonResponse({ error: '用户不存在或已被删除' }, 404);

				// 0. Delete user avatar and post images
				const user = await env.cforum_db.prepare('SELECT avatar_url FROM users WHERE id = ?').bind(id).first<{avatar_url?: string}>();
				const posts = await env.cforum_db.prepare('SELECT content FROM posts WHERE author_id = ?').bind(id).all();

				const deletionPromises: Promise<any>[] = [];
				if (user && user.avatar_url) {
					deletionPromises.push(deleteImage(env as unknown as S3Env, user.avatar_url, id));
				}
				if (posts.results) {
					for (const post of posts.results) {
						const imageUrls = extractImageUrls(post.content as string);
						imageUrls.forEach(url => deletionPromises.push(deleteImage(env as unknown as S3Env, url, id)));
					}
				}
				if (deletionPromises.length > 0) {
					ctx.waitUntil(Promise.all(deletionPromises).catch(err => console.error('Failed to delete user images', err)));
				}

				// 1. Delete likes and comments ON the user's posts (to avoid orphans)
				await env.cforum_db.prepare('DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE author_id = ?)').bind(id).run();
				await env.cforum_db.prepare('DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE author_id = ?)').bind(id).run();

				// 2. Delete the user's own activity (likes and comments they made)
				await env.cforum_db.prepare('DELETE FROM likes WHERE user_id = ?').bind(id).run();
				await env.cforum_db.prepare('DELETE FROM comments WHERE author_id = ?').bind(id).run();

				// 3. Clean up all other FK references before deleting the user
				await env.cforum_db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
				await env.cforum_db.prepare('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?').bind(id, id).run();
				await env.cforum_db.prepare('DELETE FROM user_watermarks WHERE user_id = ?').bind(id).run();
				await env.cforum_db.prepare('DELETE FROM password_history WHERE user_id = ?').bind(id).run();
				await env.cforum_db.prepare('DELETE FROM temp_passwords WHERE user_id = ? OR created_by = ?').bind(id, id).run();
				await env.cforum_db.prepare('DELETE FROM invitation_codes WHERE created_by = ? OR used_by = ?').bind(id, id).run();
				await env.cforum_db.prepare('DELETE FROM encrypted_attachments WHERE user_id = ?').bind(id).run();

				// 4. Delete the user's posts
				await env.cforum_db.prepare('DELETE FROM posts WHERE author_id = ?').bind(id).run();

				// 5. Finally, delete the user
				const userToDelete = await env.cforum_db.prepare('SELECT email, username FROM users WHERE id = ?').bind(id).first();
				await env.cforum_db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();

				await security.logAudit(userPayload.id, 'ADMIN_DELETE_USER', 'user', String(id), {}, request);

				// Notify admins about account deletion
				const setting = await env.cforum_db.prepare("SELECT value FROM settings WHERE key = 'notify_on_user_delete'").first<DBSetting>();
				if (setting && setting.value === '1') {
					const email = userToDelete?.email || '';
					const username = userToDelete?.username || '';
					const admins = await env.cforum_db.prepare("SELECT id FROM users WHERE role = 'admin' AND id != ?").bind(userPayload.id).all<{id:number}>();
					for (const admin of admins.results) {
						ctx.waitUntil(createNotification(admin.id, 'account_deleted', '用户已删除', `用户 ${email || username}（ID: ${id}）已被管理员删除。`, userPayload.id));
					}
					// Also notify the acting admin as confirmation
					ctx.waitUntil(createNotification(userPayload.id, 'account_deleted', '用户已删除', `您已成功删除用户 ${email || username}（ID: ${id}）。`, userPayload.id));
				}

				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// DELETE /api/admin/posts/:id
		if (url.pathname.match(/^\/api\/admin\/posts\/\d+$/) && method === 'DELETE') {
			const id = url.pathname.split('/').pop();
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				// Delete images in post
				const post = await env.cforum_db.prepare('SELECT content, author_id FROM posts WHERE id = ?').bind(id).first();
				if (post) {
					const imageUrls = extractImageUrls(post.content as string);
					if (imageUrls.length > 0) {
						ctx.waitUntil(Promise.all(imageUrls.map(url => deleteImage(env as unknown as S3Env, url, post.author_id as number))).catch(err => console.error('Failed to delete post images', err)));
					}
				}

				await env.cforum_db.prepare('DELETE FROM likes WHERE post_id = ?').bind(id).run();
				await env.cforum_db.prepare('DELETE FROM comments WHERE post_id = ?').bind(id).run();
				await env.cforum_db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();

				await security.logAudit(userPayload.id, 'ADMIN_DELETE_POST', 'post', String(id), {}, request);
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// DELETE /api/admin/comments/:id
		if (url.pathname.match(/^\/api\/admin\/comments\/\d+$/) && method === 'DELETE') {
			const id = url.pathname.split('/').pop();
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				// Delete the comment AND its children (orphans prevention)
				await env.cforum_db.prepare('DELETE FROM comments WHERE parent_id = ?').bind(id).run();
				await env.cforum_db.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();

				await security.logAudit(userPayload.id, 'ADMIN_DELETE_COMMENT', 'comment', String(id), {}, request);
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/admin/posts/:id/pin
		if (url.pathname.match(/^\/api\/admin\/posts\/\d+\/pin$/) && method === 'POST') {
			const id = url.pathname.split('/')[4];
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const body = await request.json() as any;
				const { pinned } = body;
				await env.cforum_db.prepare('UPDATE posts SET is_pinned = ? WHERE id = ?').bind(pinned ? 1 : 0, id).run();

				await security.logAudit(userPayload.id, 'ADMIN_PIN_POST', 'post', id, { pinned }, request);

				// Notify post author
				const post = await env.cforum_db.prepare('SELECT author_id, title FROM posts WHERE id = ?').bind(id).first<{author_id: number; title: string}>();
				if (post && post.author_id !== userPayload.id) {
					ctx.waitUntil(createNotification(post.author_id, 'post_pinned', '帖子已置顶', `你的帖子「${post.title?.slice(0, 30) || '无标题'}」已被${pinned ? '置顶' : '取消置顶'}。`, userPayload.id));
				}

				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/admin/posts/:id/move
		if (url.pathname.match(/^\/api\/admin\/posts\/\d+\/move$/) && method === 'POST') {
			const id = url.pathname.split('/')[4];
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const body = await request.json() as any;
				const { category_id } = body;

				// Validate category exists if provided
				if (category_id) {
					const category = await env.cforum_db.prepare('SELECT id FROM categories WHERE id = ?').bind(category_id).first();
					if (!category) return jsonResponse({ error: '分类不存在' }, 404);
				}

				await env.cforum_db.prepare('UPDATE posts SET category_id = ? WHERE id = ?').bind(category_id || null, id).run();

				await security.logAudit(userPayload.id, 'ADMIN_MOVE_POST', 'post', id, { category_id }, request);
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /api/admin/cleanup/analyze
		if (url.pathname === '/api/admin/cleanup/analyze' && method === 'GET') {
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				// 1. List all S3 objects
				const allKeys = await listAllKeys(env as unknown as S3Env);

				// 2. Gather used URLs
				const usedKeys = new Set<string>();

				// Users avatars
				const users = await env.cforum_db.prepare('SELECT avatar_url FROM users WHERE avatar_url IS NOT NULL').all();
				for (const u of users.results) {
					const uUrl = u.avatar_url as string;
					const key = uUrl ? getKeyFromUrl(env as unknown as S3Env, uUrl) : null;
					if (key) usedKeys.add(key);
				}

				// Posts images
				const posts = await env.cforum_db.prepare('SELECT content FROM posts').all();
				for (const p of posts.results) {
					const urls = extractImageUrls(p.content as string);
					for (const uUrl of urls) {
						const key = uUrl ? getKeyFromUrl(env as unknown as S3Env, uUrl) : null;
						if (key) usedKeys.add(key);
					}
				}

				// 3. Find orphans
				const orphans = allKeys.filter(key => !usedKeys.has(key));

				return jsonResponse({
					total_files: allKeys.length,
					used_files: usedKeys.size,
					orphaned_files: orphans.length,
					orphans: orphans.slice(0, 100)
				}, 200, 'no-store, private');

			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/admin/cleanup/execute
		if (url.pathname === '/api/admin/cleanup/execute' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);

				const body = await request.json() as any;
				const { orphans } = body;

				if (!orphans || !Array.isArray(orphans)) return jsonResponse({ error: 'Invalid parameters' }, 400);

				const deletePromises = orphans.map(key => deleteImage(env as unknown as S3Env, key));

				ctx.waitUntil(Promise.all(deletePromises).catch(err => console.error('Cleanup failed', err)));

				return jsonResponse({ success: true, message: `Deletion of ${orphans.length} files started` });
			} catch (e) {
				return handleError(e);
			}
		}

		// --- END ADMIN ROUTES ---

		// TEST: Email Debug
		if (url.pathname === '/api/test-email' && method === 'POST') {
			try {
				const body = await request.json() as any;
				const { to } = body;
				if (!to) return jsonResponse({ error: '缺少收件人地址' }, 400);

				console.log('[DEBUG] Starting test email to:', to);
				await sendEmail(to, '测试邮件', '<h1>你好</h1><p>这是一封测试邮件。</p>', env);
				console.log('[DEBUG] Test email sent successfully');

				return jsonResponse({ success: true, message: '邮件已发送' });
			} catch (e) {
				console.error('[DEBUG] Test email failed:', e);
				return handleError(e);
			}
		}

		// AUTH: Register
		if (url.pathname === '/api/register' && method === 'POST') {
			try {
				const body = await request.json() as any;

				// Turnstile Check
				const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
				if (!(await checkTurnstile(body, ip))) {
					return jsonResponse({ error: '验证码验证失败' }, 403);
				}

				const { email, username, password, confirm_password, invitation_code } = body;
				if (!email || !username || !password) {
					return jsonResponse({ error: '请填写邮箱、昵称和密码' }, 400);
				}
				if (password !== confirm_password) {
					return jsonResponse({ error: '两次输入的密码不一致' }, 400);
				}

				// Check invite-only mode
				const inviteSetting = await env.cforum_db.prepare("SELECT value FROM settings WHERE key = 'invite_only'").first<DBSetting>();
				const inviteOnly = inviteSetting && inviteSetting.value === '1';
				if (inviteOnly) {
					if (!invitation_code) return jsonResponse({ error: '需要邀请码才能注册' }, 400);
					const code = await env.cforum_db.prepare('SELECT * FROM invitation_codes WHERE code = ? AND is_active = 1 AND used_by IS NULL AND expires_at > ?').bind(invitation_code, Date.now()).first();
					if (!code) return jsonResponse({ error: '邀请码无效或已过期' }, 400);
				}

				if (email.length > 50) return jsonResponse({ error: '邮箱过长（最多 50 个字符）' }, 400);

				if (username.length > 20) return jsonResponse({ error: '昵称过长（最多 20 个字符）' }, 400);
				if (isVisuallyEmpty(username)) return jsonResponse({ error: '昵称不能为空' }, 400);
				if (hasInvisibleCharacters(username)) return jsonResponse({ error: '昵称包含不可见字符' }, 400);
				if (hasControlCharacters(username)) return jsonResponse({ error: '昵称包含控制字符' }, 400);
				if (hasRestrictedKeywords(username)) return jsonResponse({ error: '昵称包含敏感词' }, 400);

				if (password.length < 8 || password.length > 16) return jsonResponse({ error: '密码长度需 8-16 个字符' }, 400);

				// Check Uniqueness (Combined Query for Performance)
				const existing = await env.cforum_db.prepare('SELECT email, username FROM users WHERE email = ? OR username = ?').bind(email, username).first();
				if (existing) {
					if (existing.email === email) return jsonResponse({ error: '该邮箱已被注册' }, 409);
					return jsonResponse({ error: '该昵称已被使用' }, 409);
				}

				const passwordHash = await hashPassword(password);

				const { success, meta } = await env.cforum_db.prepare(
					'INSERT INTO users (email, username, password, role, verified) VALUES (?, ?, ?, "user", 1)'
				).bind(email, username, passwordHash).run();

				if (success) {
					// Generate Default Avatar (Identicon)
					// Use ID if available, otherwise fallback to Username
					const userId = meta?.last_row_id;
					if (userId) {
						const identicon = await generateIdenticon(String(userId));
						await env.cforum_db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(identicon, userId).run();
						// Mark invitation code as used
						if (invitation_code) {
							await env.cforum_db.prepare('UPDATE invitation_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE code = ?').bind(userId, invitation_code).run();
						}
					} else {
						// Fallback if ID retrieval fails (rare in D1)
						const identicon = await generateIdenticon(username);
						// We don't have ID easily without query, but we can update by username or just skip
						await env.cforum_db.prepare('UPDATE users SET avatar_url = ? WHERE username = ?').bind(identicon, username).run();
					}
				}

				return jsonResponse({ success, message: '注册成功，请前往邮箱完成验证。' }, 201);
			} catch (e: any) {
				if (e.message && e.message.includes('UNIQUE constraint failed')) {
					return jsonResponse({ error: 'Email already exists' }, 409);
				}
				return handleError(e);
			}
		}

		// AUTH: Verify Email
		if (url.pathname === '/api/verify' && method === 'GET') {
			const token = url.searchParams.get('token');
			if (!token) {
				return new Response('缺少 token', { status: 400 });
			}

			try {
				const { success } = await env.cforum_db.prepare(
					'UPDATE users SET verified = 1, verification_token = NULL WHERE verification_token = ?'
				).bind(token).run();

				if (success) {
					// Redirect to home page with verified param
					return Response.redirect(`${getBaseUrl()}/?verified=true`, 302);
				} else {
					return new Response('token 无效或已过期', { status: 400 });
				}
			} catch (e) {
				return new Response('验证失败', { status: 500 });
			}
		}

		// GET /api/users — 管理后台用，不缓存
		if (url.pathname === '/api/users' && method === 'GET') {
			try {
				const { results } = await env.cforum_db.prepare(
					'SELECT id, email, username, created_at FROM users'
				).all();
				return jsonResponse(results, 200, 'no-store, private');
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /api/user/likes (Get all post IDs liked by user)
		if (url.pathname === '/api/user/likes' && method === 'GET') {
			try {
				const userPayload = await authenticate(request);
				const { results } = await env.cforum_db.prepare('SELECT post_id FROM likes WHERE user_id = ?').bind(userPayload.id).all();
				return jsonResponse(results.map((r: any) => r.post_id));
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /posts
		if (url.pathname === '/api/posts' && method === 'GET') {
			try {
				const limit = parseInt(url.searchParams.get('limit') || '20');
				const offset = parseInt(url.searchParams.get('offset') || '0');
				const categoryId = url.searchParams.get('category_id');
				const q = (url.searchParams.get('q') || url.searchParams.get('query') || '').trim();
				const sortByRaw = (url.searchParams.get('sort_by') || 'time').trim().toLowerCase();
				const sortDirRaw = (url.searchParams.get('sort_dir') || 'desc').trim().toLowerCase();
				const sortDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC';

				let query = `SELECT
                        posts.id, posts.title, posts.author_id, posts.category_id, posts.is_pinned, posts.view_count, posts.created_at,
                        users.username as author_name,
                        users.avatar_url as author_avatar,
                        users.role as author_role,
                        categories.name as category_name,
                        (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as like_count,
                        (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) as comment_count
                     FROM posts
                     JOIN users ON posts.author_id = users.id
                     LEFT JOIN categories ON posts.category_id = categories.id`;

                let countQuery = `SELECT COUNT(*) as total FROM posts`;

                const params: any[] = [];
                const countParams: any[] = [];
				const conditions: string[] = [];

                if (categoryId) {
                    if (categoryId === 'uncategorized') {
						conditions.push(`posts.category_id IS NULL`);
                    } else {
						conditions.push(`posts.category_id = ?`);
                        params.push(categoryId);
                        countParams.push(categoryId);
                    }
                }

				if (q) {
					conditions.push(`(posts.title LIKE ? OR posts.content LIKE ?)`);
					const like = `%${q}%`;
					params.push(like, like);
					countParams.push(like, like);
				}

				if (conditions.length) {
					query += ` WHERE ${conditions.join(' AND ')}`;
					countQuery += ` WHERE ${conditions.join(' AND ')}`;
				}

				const sortExpr =
					sortByRaw === 'likes'
						? `like_count ${sortDir}`
						: sortByRaw === 'comments'
							? `comment_count ${sortDir}`
							: sortByRaw === 'views'
								? `posts.view_count ${sortDir}`
								: `posts.created_at ${sortDir}`;

                query += ` ORDER BY is_pinned DESC, ${sortExpr}, posts.created_at DESC LIMIT ? OFFSET ?`;
                params.push(limit, offset);

				const [postsResult, countResult] = await Promise.all([
                    env.cforum_db.prepare(query).bind(...params).all(),
                    env.cforum_db.prepare(countQuery).bind(...countParams).first()
                ]);

				return jsonResponse({
                    posts: postsResult.results,
                    total: countResult ? countResult.total : 0
                });
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /api/posts/:id
		if (url.pathname.match(/^\/api\/posts\/\d+$/) && method === 'GET') {
			const postId = url.pathname.split('/')[3];
			try {
				// 条件缓存检查：先仅查 updated_at（轻量查询），未修改直接 304，不走后续 JOIN
				const userId = url.searchParams.get('user_id');
				if (!userId) {
					const row = await env.cforum_db.prepare('SELECT created_at FROM posts WHERE id = ?').bind(postId).first<{created_at: string}>();
					if (row) {
						const ifModifiedSince = request.headers.get('If-Modified-Since');
						if (ifModifiedSince) {
							const modSince = new Date(ifModifiedSince).getTime();
							const postTime = new Date(row.created_at).getTime();
							if (!isNaN(modSince) && !isNaN(postTime) && postTime <= modSince) {
								return new Response(null, {
									status: 304,
									headers: {
										'Cache-Control': 'no-cache',
										'Last-Modified': new Date(postTime).toUTCString(),
										'Access-Control-Allow-Origin': getCorsOrigin(),
									}
								});
							}
						}
					}
				}

				// 未命中缓存或带 user_id，查全量数据
				const post = await env.cforum_db.prepare(
					`SELECT
                        posts.*,
                        users.username as author_name,
                        users.avatar_url as author_avatar,
                        users.role as author_role,
                        categories.name as category_name,
                        (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) as like_count,
                        (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) as comment_count
                     FROM posts
                     JOIN users ON posts.author_id = users.id
                     LEFT JOIN categories ON posts.category_id = categories.id
                     WHERE posts.id = ?`
				).bind(postId).first();

				if (!post) return jsonResponse({ error: 'Post not found' }, 404);

				// 更新浏览量
				try {
					await env.cforum_db.prepare('UPDATE posts SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?').bind(postId).run();
					(post as any).view_count = Number((post as any).view_count || 0) + 1;
				} catch {}

				// Check like status if user_id provided
				if (userId) {
					const like = await env.cforum_db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').bind(postId, userId).first();
					(post as any).liked = !!like;
				}

				// 设置 Last-Modified + Cache-Control，浏览器缓存但每次用 If-Modified-Since 快速验证
			const resp = jsonResponse(post);
			const postUpdated = (post as any).created_at as string | undefined;
			if (postUpdated) {
				resp.headers.set('Last-Modified', new Date(postUpdated).toUTCString());
			}
			resp.headers.set('Cache-Control', 'private, no-cache');
			return resp;
			} catch (e) {
				return handleError(e);
			}
		}

		// PUT /api/posts/:id
		if (url.pathname.match(/^\/api\/posts\/\d+$/) && method === 'PUT') {
			const postId = url.pathname.split('/')[3];
			try {
				const userPayload = await authenticate(request);
				const body = await request.json() as any;
				const { title, content, category_id } = body; // user_id not needed from body

				if (!title || !content) {
					return jsonResponse({ error: 'Missing parameters' }, 400);
				}

				if (isVisuallyEmpty(title) || isVisuallyEmpty(content)) return jsonResponse({ error: 'Title or content cannot be empty' }, 400);

				if (hasInvisibleCharacters(title) || hasInvisibleCharacters(content)) return jsonResponse({ error: 'Title or content contains invalid invisible characters' }, 400);

				// Check ownership or admin
				const post = await env.cforum_db.prepare('SELECT author_id FROM posts WHERE id = ?').bind(postId).first();
				if (!post) return jsonResponse({ error: 'Post not found' }, 404);

				// Use userPayload for RBAC
				if (post.author_id !== userPayload.id && userPayload.role !== 'admin') {
					return jsonResponse({ error: 'Unauthorized' }, 403);
				}

				// Validate Lengths
				if (title.length > 60) return jsonResponse({ error: 'Title too long (Max 60 chars)' }, 400);
				if (content.length > 3000) return jsonResponse({ error: 'Content too long (Max 3000 chars)' }, 400);
				if (hasControlCharacters(title) || hasControlCharacters(content)) return jsonResponse({ error: 'Title or content contains invalid control characters' }, 400);

				// Validate Category if provided
				if (category_id) {
					const category = await env.cforum_db.prepare('SELECT id, name FROM categories WHERE id = ?').bind(category_id).first() as { id: number; name: string } | null;
					if (!category) return jsonResponse({ error: 'Category not found' }, 400);
					if (category.name === '公告' && userPayload.role !== 'admin') {
						return jsonResponse({ error: 'Only admins can post in this category' }, 403);
					}
				}

				await env.cforum_db.prepare(
					'UPDATE posts SET title = ?, content = ?, category_id = ? WHERE id = ?'
				).bind(title.trim(), content.trim(), category_id || null, postId).run();

				await security.logAudit(userPayload.id, 'UPDATE_POST', 'post', postId, { title_length: title.length }, request);

				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// DELETE /api/posts/:id (User delete own post)
		if (url.pathname.match(/^\/api\/posts\/\d+$/) && method === 'DELETE') {
			const id = url.pathname.split('/')[3];
			try {
				const userPayload = await authenticate(request);

				// Check ownership
				const post = await env.cforum_db.prepare('SELECT author_id, content FROM posts WHERE id = ?').bind(id).first();
				if (!post) return jsonResponse({ error: 'Post not found' }, 404);

				if (post.author_id !== userPayload.id) {
					return jsonResponse({ error: 'Unauthorized' }, 403);
				}

				// Delete images in post
				const imageUrls = extractImageUrls(post.content as string);
				if (imageUrls.length > 0) {
					ctx.waitUntil(Promise.all(imageUrls.map(url => deleteImage(env as unknown as S3Env, url, userPayload.id))).catch(err => console.error('Failed to delete post images', err)));
				}

				await env.cforum_db.prepare('DELETE FROM likes WHERE post_id = ?').bind(id).run();
				await env.cforum_db.prepare('DELETE FROM comments WHERE post_id = ?').bind(id).run();
				await env.cforum_db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();

				await security.logAudit(userPayload.id, 'DELETE_POST', 'post', id, {}, request);
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/posts/:id/comments
		if (url.pathname.match(/^\/api\/posts\/\d+\/comments$/) && method === 'POST') {
			const postId = url.pathname.split('/')[3];
			try {
				const userPayload = await authenticate(request);
				const body = await request.json() as any;
				const { content, parent_id, 'cf-turnstile-response': turnstileToken } = body;

				if (!content || !content.trim()) return jsonResponse({ error: '评论内容不能为空' }, 400);
				if (content.length > 3000) return jsonResponse({ error: '评论过长 (最多 3000 字符)' }, 400);

				// Verify Turnstile if enabled
				const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
				if (!(await checkTurnstile({ 'cf-turnstile-response': turnstileToken }, ip))) {
					return jsonResponse({ error: '验证码验证失败' }, 403);
				}

				const result = await env.cforum_db.prepare(
					'INSERT INTO comments (post_id, author_id, content, parent_id) VALUES (?, ?, ?, ?)'
				).bind(postId, userPayload.id, content.trim(), parent_id || null).run();

				// 通知帖子作者有人评论
				const post = await env.cforum_db.prepare('SELECT author_id, title FROM posts WHERE id = ?').bind(postId).first<{ author_id: number; title: string }>();
				if (post && post.author_id !== userPayload.id) {
					const setting = await env.cforum_db.prepare("SELECT value FROM settings WHERE key = 'notify_on_comment'").first<DBSetting>();
					if (!setting || setting.value !== '0') {
						await createNotification(post.author_id, 'new_comment', `回复了你的帖子「${post.title}」`, content.trim());
					}
				}

				return jsonResponse({ success: true, id: result.meta?.last_row_id });
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /api/posts/:id/comments
		if (url.pathname.match(/^\/api\/posts\/\d+\/comments$/) && method === 'GET') {
			const postId = url.pathname.split('/')[3];
			try {
				const { results } = await env.cforum_db.prepare(
					`SELECT comments.*, users.username, users.avatar_url, users.role
                     FROM comments
                     JOIN users ON comments.author_id = users.id
                     WHERE post_id = ?
                     ORDER BY created_at ASC`
				).bind(postId).all();
				const resp = jsonResponse(results);
				resp.headers.set('Cache-Control', 'public, max-age=30');
				return resp;
			} catch (e) {
				return handleError(e);
			}
		}

		// DELETE /api/comments/:id
		if (url.pathname.match(/^\/api\/comments\/\d+$/) && method === 'DELETE') {
			const id = url.pathname.split('/').pop();
			try {
				const userPayload = await authenticate(request);

				// Fetch comment to check ownership
				const comment = await env.cforum_db.prepare('SELECT author_id FROM comments WHERE id = ?').bind(id).first();

				if (!comment) return jsonResponse({ error: 'Comment not found' }, 404);

				// Allow deletion if user is author OR admin
				if (comment.author_id !== userPayload.id && userPayload.role !== 'admin') {
					return jsonResponse({ error: 'Unauthorized' }, 403);
				}

				// Delete the comment AND its children (orphans prevention)
				await env.cforum_db.prepare('DELETE FROM comments WHERE parent_id = ?').bind(id).run();
				await env.cforum_db.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();

				await security.logAudit(userPayload.id, 'DELETE_COMMENT', 'comment', String(id), {}, request);
				return jsonResponse({ success: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /api/posts/:id/like
		if (url.pathname.match(/^\/api\/posts\/\d+\/like$/) && method === 'POST') {
			const postId = url.pathname.split('/')[3];
			try {
				const userPayload = await authenticate(request);
				const userId = userPayload.id;

				// Toggle like — atomic INSERT OR IGNORE, no race condition.
				const inserted = await env.cforum_db.prepare(
					'INSERT INTO likes (post_id, user_id) VALUES (?, ?)'
				).bind(postId, userId).run();
				if (inserted.meta.changes === 0) {
					// Already liked → unlike
					await env.cforum_db.prepare(
						'DELETE FROM likes WHERE post_id = ? AND user_id = ?'
					).bind(postId, userId).run();
					return jsonResponse({ liked: false });
				}

				// Notify post author (skip self-like)
				const post = await env.cforum_db.prepare('SELECT author_id, title FROM posts WHERE id = ?').bind(postId).first<{author_id: number; title: string}>();
				if (post && post.author_id !== userId) {
					const liker = await env.cforum_db.prepare('SELECT username FROM users WHERE id = ?').bind(userId).first<{username: string}>();
					ctx.waitUntil(createNotification(post.author_id, 'post_liked', '点赞通知', `${liker?.username || '某用户'} 赞了你的帖子「${post.title?.slice(0, 30) || '无标题'}」`, userId));
				}

				return jsonResponse({ liked: true });
			} catch (e) {
				return handleError(e);
			}
		}

		// GET /api/posts/:id/like-status
		if (url.pathname.match(/^\/api\/posts\/\d+\/like-status$/) && method === 'GET') {
			const postId = url.pathname.split('/')[3];

			try {
				const userPayload = await authenticate(request);
				const existing = await env.cforum_db.prepare(
					'SELECT id FROM likes WHERE post_id = ? AND user_id = ?'
				).bind(postId, userPayload.id).first();
				return jsonResponse({ liked: !!existing });
			} catch (e) {
				return handleError(e);
			}
		}

		// POST /posts (Protected - in real app check token)
		if (url.pathname === '/api/posts' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				const body = await request.json() as any;

				// Turnstile Check
				const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
				if (!(await checkTurnstile(body, ip))) {
					return jsonResponse({ error: 'Turnstile verification failed' }, 403);
				}

				const { title, content: rawContent, category_id } = body;
				let content = rawContent;

				if (!title || !content) {
					return jsonResponse({ error: 'Missing title or content' }, 400);
				}

				// --- Input Sanitization & Validation (Sync with Frontend) ---
				if (isVisuallyEmpty(title) || isVisuallyEmpty(content)) return jsonResponse({ error: 'Title or content cannot be empty' }, 400);

				if (hasInvisibleCharacters(title) || hasInvisibleCharacters(content)) return jsonResponse({ error: 'Title or content contains invalid invisible characters' }, 400);

				// Validate Lengths
				if (title.length > 60) return jsonResponse({ error: 'Title too long (Max 60 chars)' }, 400);
				if (content.length > 3000) return jsonResponse({ error: 'Content too long (Max 3000 chars)' }, 400);

				if (hasControlCharacters(title) || hasControlCharacters(content)) return jsonResponse({ error: 'Title or content contains invalid control characters' }, 400);

				// 内容直接存储，前端 DOMPurify 负责安全过滤

				// Validate Title (simple trim, no HTML escaping needed)
				const safeTitle = title.trim();

				// Validate Category
				if (!category_id) return jsonResponse({ error: '请选择分类' }, 400);
				const category = await env.cforum_db.prepare('SELECT id, name FROM categories WHERE id = ?').bind(category_id).first() as { id: number; name: string } | null;
				if (!category) return jsonResponse({ error: 'Category not found' }, 400);
				if (category.name === '公告' && userPayload.role !== 'admin') {
					return jsonResponse({ error: 'Only admins can post in this category' }, 403);
				}

				const { success } = await env.cforum_db.prepare(
					'INSERT INTO posts (author_id, title, content, category_id) VALUES (?, ?, ?, ?)'
				).bind(userPayload.id, safeTitle.trim(), content.trim(), category_id || null).run();

				await security.logAudit(userPayload.id, 'CREATE_POST', 'post', 'new', { title_length: safeTitle.length }, request);

				return jsonResponse({ success }, 201);
			} catch (e) {
				return handleError(e);
			}
		}

		// ===== 二次开发: 邀请码管理 =====

		// POST /api/admin/invitations/generate
		if (url.pathname === '/api/admin/invitations/generate' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);
				const body = await request.json() as any;
				const count = Math.min(Math.max(parseInt(body.count) || 1, 1), 100);
				const codes: string[] = [];
				const batch = [];
				const expiresAt = Date.now() + (parseInt(body.expires_hours || '72') * 3600000);
				for (let i = 0; i < count; i++) {
					const code = crypto.randomUUID().slice(0, 8).toUpperCase();
					codes.push(code);
					batch.push(env.cforum_db.prepare('INSERT INTO invitation_codes (code, created_by, expires_at) VALUES (?, ?, ?)').bind(code, userPayload.id, expiresAt));
				}
				if (batch.length) await env.cforum_db.batch(batch);
				return jsonResponse({ success: true, codes, expires_at: expiresAt });
			} catch (e) { return handleError(e); }
		}

		// GET /api/admin/invitations
		if (url.pathname === '/api/admin/invitations' && method === 'GET') {
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);
				const { results } = await env.cforum_db.prepare(
					`SELECT ic.*, creator.username as creator_name, user.username as used_by_name
					 FROM invitation_codes ic
					 LEFT JOIN users creator ON ic.created_by = creator.id
					 LEFT JOIN users user ON ic.used_by = user.id
					 ORDER BY ic.created_at DESC LIMIT 200`
				).all();
				return jsonResponse(results, 200, 'no-store, private');
			} catch (e) { return handleError(e); }
		}

		// POST /api/admin/invitations/:id/deactivate
		if (url.pathname.match(/^\/api\/admin\/invitations\/\d+\/deactivate$/) && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);
				const id = url.pathname.split('/')[4];
				await env.cforum_db.prepare('UPDATE invitation_codes SET is_active = 0 WHERE id = ?').bind(id).run();
				return jsonResponse({ success: true });
			} catch (e) { return handleError(e); }
		}

		// ===== 二次开发: 人工密码重置 =====

		// POST /api/admin/users/:id/reset-password
		if (url.pathname.match(/^\/api\/admin\/users\/\d+\/reset-password$/) && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				if (userPayload.role !== 'admin') return jsonResponse({ error: 'Unauthorized' }, 403);
				const id = parseInt(url.pathname.split('/')[4]);
				const user = await env.cforum_db.prepare('SELECT id, username FROM users WHERE id = ?').bind(id).first();
				if (!user) return jsonResponse({ error: 'User not found' }, 404);

				const tempPassword = Array.from({length: 12}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 56)]).join('');
				const tempHash = await hashPassword(tempPassword);
				const expiresAt = Date.now() + 86400000; // 24h

				// Store old password hash in history
				const oldUser = await env.cforum_db.prepare('SELECT password FROM users WHERE id = ?').bind(id).first<{password: string}>();
				if (oldUser) {
					await env.cforum_db.prepare('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)').bind(id, oldUser.password).run();
				}

				// Set temp password
				await env.cforum_db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(tempHash, id).run();
				await env.cforum_db.prepare('INSERT INTO temp_passwords (user_id, temp_password, temp_password_hash, expires_at, created_by) VALUES (?, ?, ?, ?, ?)').bind(id, tempPassword, tempHash, expiresAt, userPayload.id).run();
				// 清理该用户的过期临时密码
				await env.cforum_db.prepare('DELETE FROM temp_passwords WHERE user_id = ? AND (is_used = 1 OR expires_at < ?)').bind(id, Date.now()).run();
				await security.logAudit(userPayload.id, 'RESET_PASSWORD', 'user', String(id), {}, request);

				return jsonResponse({ success: true, temp_password: tempPassword, expires_at: expiresAt, username: user.username });
			} catch (e) { return handleError(e); }
		}

		// ===== 二次开发: LSB 水印 =====

		// GET /api/user/watermark
		if (url.pathname === '/api/user/watermark' && method === 'GET') {
			try {
				const userPayload = await authenticate(request);
				const existing = await env.cforum_db.prepare('SELECT watermark_data FROM user_watermarks WHERE user_id = ?').bind(userPayload.id).first<{watermark_data: string}>();
				if (existing) return jsonResponse({ watermark: existing.watermark_data });
				// Generate watermark data: UID + timestamp hash
				const wmData = `${userPayload.id}:${Date.now().toString(36)}`;
				await env.cforum_db.prepare('INSERT OR REPLACE INTO user_watermarks (user_id, watermark_data) VALUES (?, ?)').bind(userPayload.id, wmData).run();
				return jsonResponse({ watermark: wmData });
			} catch (e) { return handleError(e); }
		}

		// ===== 二次开发: 加密网盘附件（仅存链接）=====

		// POST /api/attachments (保存网盘链接)
		if (url.pathname === '/api/attachments' && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				const setting = await env.cforum_db.prepare("SELECT value FROM settings WHERE key = 'encrypted_attachments_enabled'").first<DBSetting>();
				if (!setting || setting.value !== '1') return jsonResponse({ error: '加密附件功能未开启' }, 403);

				const body = await request.json() as any;
				const { link_url, file_name, extract_code, password } = body;
				if (!link_url || !file_name) return jsonResponse({ error: '链接和文件名必填' }, 400);
				const postId = body.postId || body.post_id;
				if (!postId) return jsonResponse({ error: '缺少帖子ID' }, 400);

				const passwordHash = password ? await hashPassword(password) : '';
				await env.cforum_db.prepare(
					'INSERT INTO encrypted_attachments (post_id, user_id, link_url, file_name, extract_code, password_hash, is_encrypted) VALUES (?, ?, ?, ?, ?, ?, ?)'
				).bind(parseInt(postId), userPayload.id, link_url, file_name, extract_code || '', passwordHash, password ? 1 : 0).run();

				return jsonResponse({ success: true });
			} catch (e) { return handleError(e); }
		}

		// POST /api/attachments/:id/verify (验证密码获取链接)
		if (url.pathname.match(/^\/api\/attachments\/\d+\/verify$/) && method === 'POST') {
			try {
				const userPayload = await authenticate(request);
				const id = url.pathname.split('/')[3];
				const body = await request.json() as any;
				const { password } = body;

				const att = await env.cforum_db.prepare('SELECT * FROM encrypted_attachments WHERE id = ?').bind(id).first() as any;
				if (!att) return jsonResponse({ error: '附件不存在' }, 404);

				if (att.password_hash) {
					if (!password) return jsonResponse({ error: '需要密码' }, 400);
					const passHash = await hashPassword(password);
					if (att.password_hash !== passHash) return jsonResponse({ error: '密码错误' }, 403);
				}

				return jsonResponse({ link_url: att.link_url });
			} catch (e) { return handleError(e); }
		}

		// GET /api/posts/:id/attachments
		if (url.pathname.match(/^\/api\/posts\/\d+\/attachments$/) && method === 'GET') {
			try {
				const postId = url.pathname.split('/')[3];
				const { results } = await env.cforum_db.prepare(
					'SELECT id, file_name, extract_code, is_encrypted, password_hash != \'\' AS has_password, CASE WHEN password_hash = \'\' THEN link_url ELSE NULL END AS link_url, created_at, user_id FROM encrypted_attachments WHERE post_id = ? ORDER BY created_at DESC'
				).bind(postId).all();
				return jsonResponse(results);
			} catch (e) { return handleError(e); }
		}

		if (method === 'GET' && !url.pathname.startsWith('/api')) {
			const pathname = url.pathname;
			const postMatch = pathname.match(/^\/posts\/(\d+)$/);
			if (postMatch) {
				const redirectUrl = new URL(request.url);
				redirectUrl.pathname = '/post';
				redirectUrl.search = `?id=${postMatch[1]}`;
				return Response.redirect(redirectUrl.toString(), 302);
			}
			const postAltMatch = pathname.match(/^\/post\/(\d+)$/);
			if (postAltMatch) {
				const redirectUrl = new URL(request.url);
				redirectUrl.pathname = '/post';
				redirectUrl.search = `?id=${postAltMatch[1]}`;
				return Response.redirect(redirectUrl.toString(), 302);
			}

			if (!(env as any).ASSETS?.fetch) return new Response('Not Found', { status: 404 });
			const mapped =
				pathname === '/login' ? '/login.html' :
				pathname === '/register' ? '/register.html' :
				pathname === '/forgot' ? '/forgot.html' :
				pathname === '/reset' ? '/reset.html' :
				pathname === '/settings' ? '/settings.html' :
				pathname === '/admin' ? '/admin.html' :
				pathname === '/post' ? '/post.html' :
				pathname;

			const assetUrl = new URL(request.url);
			assetUrl.pathname = mapped;
			const assetRes = await (env as any).ASSETS.fetch(new Request(assetUrl, request));
			if (assetRes.status !== 404) return assetRes;
			if (mapped !== pathname) {
				const directRes = await (env as any).ASSETS.fetch(request);
				if (directRes.status !== 404) return directRes;
			}
			return new Response('Not Found', { status: 404 });
		}

		return new Response('Not Found', { status: 404 });
	},

	async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
		const result = await runScheduledCleanup(env.cforum_db);
		console.log('[Scheduled Cleanup]', JSON.stringify(result));
	}
};
