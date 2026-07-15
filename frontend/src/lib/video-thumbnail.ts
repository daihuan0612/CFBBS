import { API_BASE, getSecurityHeaders } from './api';

// 跳到视频 10% 位置（最远 0.8s），避开开头黑帧又控制流量
const MAX_SEEK = 0.8;
const SEEK_RATIO = 0.1;
// localStorage 缓存前缀
const CACHE_PREFIX = 'vt:';
// 截帧超时（视频加载 + seek 15s 足够）
const CAPTURE_TIMEOUT = 15000;
// 正在截帧中的视频 URL，避免同 URL 重复截帧
const inFlightCaptures = new Map<string, Promise<string>>();

const THUMBNAIL_TTL = 7 * 24 * 60 * 60 * 1000; // 7天

interface CachedEntry {
	url: string;
	cached_at: number;
}

/**
 * 从 localStorage 获取缓存的缩略图 URL（含 TTL 检查）
 */
export function getCachedThumbnail(videoUrl: string): string | null {
	try {
		const raw = localStorage.getItem(CACHE_PREFIX + videoUrl);
		if (!raw) return null;
		const entry: CachedEntry = JSON.parse(raw);
		if (entry.cached_at + THUMBNAIL_TTL > Date.now()) {
			return entry.url;
		}
		// 过期删除
		localStorage.removeItem(CACHE_PREFIX + videoUrl);
		return null;
	} catch {
		return null;
	}
}

/**
 * 缓存缩略图 URL 到 localStorage（带 TTL）
 */
export function setCachedThumbnail(videoUrl: string, thumbUrl: string): void {
	try {
		const entry: CachedEntry = { url: thumbUrl, cached_at: Date.now() };
		localStorage.setItem(CACHE_PREFIX + videoUrl, JSON.stringify(entry));
	} catch {
		// localStorage 满了就忽略
	}
}

/**
 * 从内容中提取第一个视频地址（仅限自托管 mp4/webm/mov）
 */
export function getFirstVideoUrl(markdown: string): string | null {
	// 匹配 <video><source src="...">
	const sourceMatch = markdown.match(/<video[^>]*>[\s\S]*?<source\s[^>]*src=["']([^"']+)["']/i);
	if (sourceMatch) return sourceMatch[1];

	// 匹配 <video src="...">
	const videoSrcMatch = markdown.match(/<video[^>]*\ssrc=["']([^"']+)["']/i);
	if (videoSrcMatch) return videoSrcMatch[1];

	return null;
}

/**
 * 判断视频 URL 是否需要通过代理截帧（跨域视频需要 CORS）
 */
export function needsProxy(videoUrl: string): boolean {
	if (videoUrl.startsWith('/') || videoUrl.startsWith('data:')) return false;
	try {
		const url = new URL(videoUrl, window.location.origin);
		return url.origin !== window.location.origin;
	} catch {
		return false;
	}
}

/**
 * 获取视频代理 URL（仅跨域视频才走代理）
 */
export function getCaptureUrl(videoUrl: string): string {
	if (!needsProxy(videoUrl)) return videoUrl;
	return `${API_BASE}/video-proxy?url=${encodeURIComponent(videoUrl)}`;
}

/**
 * 捕获视频帧：创建隐藏 video → seek 到靠前位置 → canvas 截帧
 */
export async function captureVideoFrame(videoUrl: string): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const video = document.createElement('video');
		video.muted = true;
		video.playsInline = true;
		video.preload = 'metadata';
		video.crossOrigin = 'anonymous';
		video.src = videoUrl;
		video.style.position = 'absolute';
		video.style.width = '1px';
		video.style.height = '1px';
		video.style.opacity = '0';
		video.style.pointerEvents = 'none';
		// 挂到 DOM 上，某些浏览器需要才能 seek
		document.body.appendChild(video);

		let cleanedUp = false;
		let timeout: ReturnType<typeof setTimeout> | null = null;

		const cleanup = () => {
			if (cleanedUp) return;
			cleanedUp = true;
			if (timeout !== null) clearTimeout(timeout);
			video.pause();
			video.removeAttribute('src');
			video.load();
			if (video.parentNode) video.parentNode.removeChild(video);
		};

		// 超时保护：防止视频加载卡死导致 DOM 残留
		timeout = setTimeout(() => {
			cleanup();
			reject(new Error('截帧超时'));
		}, CAPTURE_TIMEOUT);

		video.addEventListener('loadedmetadata', () => {
			// 固定 0.3s 对竖屏视频不友好，但 seek 越远 Range 越大
			// 折中：10% 位置，但不超过 0.8s
			video.currentTime = Math.min(video.duration * SEEK_RATIO, MAX_SEEK);
		});

		video.addEventListener('seeked', async () => {
			if (cleanedUp) return;
			// 等待视频帧真正解码完成，避免 drawImage 拿到空帧
			if (video.readyState < 2) {
				try {
					await new Promise<void>((resolve) => {
						video.addEventListener('loadeddata', () => resolve(), { once: true });
					});
				} catch {
					// ignore
				}
			}
			if (cleanedUp) return;
			try {
				const canvas = document.createElement('canvas');
				const maxW = 320;
				const scale = Math.min(1, maxW / video.videoWidth);
				canvas.width = Math.round(video.videoWidth * scale);
				canvas.height = Math.round(video.videoHeight * scale);
				const ctx = canvas.getContext('2d');
				if (!ctx) {
					cleanup();
					reject(new Error('canvas context 获取失败'));
					return;
				}
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
				// 先尝试 WebP（体积小），不支持则回退到 JPEG
				const tryFormats = ['image/webp', 'image/jpeg'] as const;
				let captured = false;
				for (const fmt of tryFormats) {
					if (captured || cleanedUp) break;
					try {
						const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, fmt, 0.8));
						if (blob) {
							resolve(blob);
							captured = true;
						}
					} catch {
						// 格式不支持继续尝试下一个
					}
				}
				if (!captured) {
					reject(new Error('截帧失败（浏览器不支持 WebP/JPEG 输出）'));
				}
				cleanup();
			} catch (e) {
				cleanup();
				reject(e);
			}
		});

		video.addEventListener('error', () => {
			cleanup();
			reject(new Error('视频加载失败'));
		});

		video.load();
	});
}

/**
 * 截帧并上传，带防重复（同一 videoUrl 同时只截一次）
 */
export async function captureAndUpload(videoUrl: string, postId: number): Promise<string> {
	const existing = inFlightCaptures.get(videoUrl);
	if (existing) return existing;

	const promise = (async () => {
		try {
			const captureUrl = getCaptureUrl(videoUrl);
			const blob = await captureVideoFrame(captureUrl);
			const url = await uploadThumbnail(blob, postId);

			// 存入数据库，供所有访客复用（幂等：已有则返回现存的）
			let finalUrl = url;
			try {
				const res = await fetch(`${API_BASE}/posts/thumbnail`, {
					method: 'POST',
					headers: getSecurityHeaders('POST', null),
					body: JSON.stringify({ post_id: postId, thumbnail_url: url }),
				});
				const data = await res.json();
				if (res.ok && data.thumbnail_url) {
					finalUrl = data.thumbnail_url;
				}
			} catch { /* 网络错误不影响展示 */ }

			setCachedThumbnail(videoUrl, finalUrl);
			return finalUrl;
		} finally {
			inFlightCaptures.delete(videoUrl);
		}
	})();

	inFlightCaptures.set(videoUrl, promise);
	return promise;
}

/**
 * 上传截取的帧到 R2
 */
export async function uploadThumbnail(blob: Blob, id: string | number): Promise<string> {
	const formData = new FormData();
	const ext = blob.type === 'image/jpeg' ? 'jpg' : 'webp';
	const file = new File([blob], `thumb-${id}.${ext}`, { type: blob.type });
	formData.append('file', file);
	formData.append('type', 'post');
	formData.append('post_id', String(id));

	const res = await fetch(`${API_BASE}/upload`, {
		method: 'POST',
		headers: getSecurityHeaders('POST', null),
		body: formData,
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data?.error || '上传失败');
	return data.url;
}
