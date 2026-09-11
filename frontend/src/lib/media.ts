import { API_BASE, getSecurityHeaders } from './api';

export type MediaUploadResult = {
	success: boolean;
	id: string;
	url: string;
	mediaType: string;
	mime: string;
	size: number;
	status: string;
};

/**
 * Upload through the forum Worker. The ImgBed credential remains server-side.
 * Worker-side MIME, size, and ownership validation is authoritative.
 */
export async function uploadMedia(
	file: File,
	onProgress?: (percent: number) => void
): Promise<MediaUploadResult> {
	onProgress?.(0);
	const formData = new FormData();
	formData.append('file', file);

	// fetch 目前不会暴露请求体上传进度；这里使用 XMLHttpRequest 仅为监听 upload
	// 事件。文件到达 Worker 后，进度停在 95%，直到 Worker 转发图床并返回结果。
	return new Promise<MediaUploadResult>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${API_BASE}/media/upload`);
		for (const [name, value] of Object.entries(getSecurityHeaders('POST', null))) {
			xhr.setRequestHeader(name, value);
		}
		xhr.responseType = 'text';

		xhr.upload.onprogress = (event) => {
			if (!event.lengthComputable) return;
			// 预留最后 5% 显示 Worker → 图床的服务端转发与登记阶段。
			onProgress?.(Math.min(95, Math.max(1, Math.round((event.loaded / event.total) * 95))));
		};
		xhr.upload.onload = () => onProgress?.(95);
		xhr.onerror = () => reject(new Error('网络错误，媒体上传失败'));
		xhr.onabort = () => reject(new Error('媒体上传已取消'));
		xhr.onload = () => {
			let data: any = null;
			try {
				data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
			} catch {
				// Cloudflare 出错时可能返回 HTML；保留通用错误提示。
			}
			if (xhr.status < 200 || xhr.status >= 300) {
				reject(new Error(data?.error || `媒体上传失败 (${xhr.status || '网络错误'})`));
				return;
			}
			onProgress?.(100);
			resolve(data as MediaUploadResult);
		};
		xhr.send(formData);
	});
}

export async function generateVideoThumbnail(mediaId: string, videoUrl: string, postId?: number): Promise<void> {
	try {
		const { captureVideoFrame, uploadThumbnail, getCaptureUrl } = await import('@/lib/video-thumbnail');
		const captureUrl = getCaptureUrl(videoUrl);
		const blob = await captureVideoFrame(captureUrl);
		const thumbUrl = await uploadThumbnail(blob, mediaId);
		await fetch(`${API_BASE}/media/thumbnail`, {
			method: 'POST',
			headers: getSecurityHeaders('POST'),
			body: JSON.stringify({ media_id: mediaId, thumbnail_url: thumbUrl, post_id: postId }),
		});
	} catch (e) {
		console.error('生成视频缩略图失败:', e);
	}
}

export function extractMediaIds(content: string): string[] {
	const ids: string[] = [];
	const re = /!MEDIA\(([a-zA-Z0-9_-]+)\)/g;
	let match;
	while ((match = re.exec(content)) !== null) {
		if (!ids.includes(match[1])) ids.push(match[1]);
	}
	return ids;
}

export async function attachMediaToPost(postId: number | string, content: string): Promise<void> {
	const mediaIds = extractMediaIds(content);
	if (!mediaIds.length) return;
	const res = await fetch(`${API_BASE}/media/attach`, {
		method: 'POST',
		headers: getSecurityHeaders('POST'),
		body: JSON.stringify({ post_id: String(postId), media_ids: mediaIds }),
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data?.error || '媒体关联失败');
	}
}
