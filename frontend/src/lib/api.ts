import { getToken, logout } from '@/lib/auth';

export type ForumConfig = {
	turnstile_enabled: boolean;
	turnstile_site_key: string;
	user_count?: number;
	jwt_secret_configured?: boolean;
	r2_public_url?: string;
	imgbed_domain?: string;
	imgbed_auth_code?: string;
	// 二次开发新增
	invite_only?: boolean;
	encrypted_attachments_enabled?: boolean;
	feature_likes?: boolean;
	feature_bookmarks?: boolean;
	feature_comments?: boolean;
	feature_posts?: boolean;
	watermark_enabled?: boolean;
};

export type Category = {
	id: number;
	name: string;
	created_at: string;
};

export type Post = {
	id: number;
	author_id: number;
	title: string;
	content: string;
	category_id: number | null;
	category_name?: string | null;
	is_pinned?: number;
	view_count?: number;
	created_at: string;
	author_name?: string;
	author_avatar?: string | null;
	author_role?: 'admin' | 'user';
	like_count?: number;
	comment_count?: number;
	liked?: boolean;
	thumbnail?: string | null;
};

export type Comment = {
	id: number;
	post_id: number;
	parent_id: number | null;
	author_id: number;
	username: string;
	avatar_url?: string | null;
	role?: 'admin' | 'user';
	content: string;
	created_at: string;
};

// __WORKER_URL__ is replaced at build time by CI with the real Worker URL
// In local dev (empty string), falls back to relative /api paths
const WORKER_URL = '__WORKER_URL__';
export const API_BASE = WORKER_URL.startsWith('http') ? `${WORKER_URL}/api` : '/api';

export function getSecurityHeaders(method: string, contentType: string | null = 'application/json') {
	const headers: Record<string, string> = {};
	const token = getToken();
	if (token) headers.Authorization = `Bearer ${token}`;
	if (['POST', 'PUT', 'DELETE'].includes(method.toUpperCase())) {
		headers['X-Timestamp'] = Math.floor(Date.now() / 1000).toString();
		headers['X-Nonce'] = crypto.randomUUID();
	}
	if (contentType) headers['Content-Type'] = contentType;
	return headers;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, init);
	if (res.status === 401) {
		logout();
		throw new Error('登录已过期，请重新登录');
	}
	const text = await res.text();
	if (!res.ok) {
		// Try to parse as JSON error, fall back to status text if it's HTML
		let message = `请求失败 (${res.status})`;
		if (text) {
			try {
				const parsed = JSON.parse(text);
				message = parsed?.error || message;
			} catch {
				// not JSON — likely Cloudflare HTML error page, worker down, etc.
				if (text.includes('<!DOCTYPE') || text.includes('<html')) {
					message = '服务器暂时不可用，请稍后重试';
				}
			}
		}
		throw new Error(message);
	}
	if (!text) return null as unknown as T;
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error('服务器返回了无效的数据，请稍后重试');
	}
}

export function formatDate(dateString: string | null | undefined) {
	if (!dateString) return '';
	const date = new Date(dateString.endsWith('Z') ? dateString : `${dateString}Z`);
	return date.toLocaleString('zh-CN', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}
