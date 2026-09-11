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
	const res = await fetch(`${API_BASE}/media/upload`, {
		method: 'POST',
		headers: getSecurityHeaders('POST', null),
		body: formData,
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data?.error || '媒体上传失败');
	onProgress?.(100);
	return data as MediaUploadResult;
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
