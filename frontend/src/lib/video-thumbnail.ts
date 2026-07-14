import { API_BASE, getSecurityHeaders } from './api';

// 跳到 0.3s 避开开头黑帧
const SEEK_TIME = 0.3;
// localStorage 缓存前缀
const CACHE_PREFIX = 'vt:';

/**
 * 从 localStorage 获取缓存的缩略图 URL
 */
export function getCachedThumbnail(videoUrl: string): string | null {
	try {
		return localStorage.getItem(CACHE_PREFIX + videoUrl);
	} catch {
		return null;
	}
}

/**
 * 缓存缩略图 URL 到 localStorage
 */
export function setCachedThumbnail(videoUrl: string, thumbUrl: string): void {
	try {
		localStorage.setItem(CACHE_PREFIX + videoUrl, thumbUrl);
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
 * 捕获视频帧：创建隐藏 video → seek 到 0.3s → canvas 截帧
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
		const cleanup = () => {
			if (cleanedUp) return;
			cleanedUp = true;
			video.pause();
			video.removeAttribute('src');
			video.load();
			if (video.parentNode) video.parentNode.removeChild(video);
		};

		video.addEventListener('loadedmetadata', () => {
			video.currentTime = SEEK_TIME;
		});

		video.addEventListener('seeked', () => {
			if (cleanedUp) return;
			try {
				const canvas = document.createElement('canvas');
				// 缩略图不需要原图那么大，按比例缩小提高性能
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
				canvas.toBlob(
					(blob) => {
						cleanup();
						if (blob) resolve(blob);
						else reject(new Error('截帧失败'));
					},
					'image/webp',
					0.8
				);
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
 * 上传截取的帧到 R2
 */
export async function uploadThumbnail(blob: Blob, postId: number): Promise<string> {
	const formData = new FormData();
	const file = new File([blob], `thumb-${postId}.webp`, { type: 'image/webp' });
	formData.append('file', file);
	formData.append('type', 'post');
	formData.append('post_id', String(postId));

	const res = await fetch(`${API_BASE}/upload`, {
		method: 'POST',
		headers: getSecurityHeaders('POST', null),
		body: formData,
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data?.error || '上传失败');
	return data.url;
}