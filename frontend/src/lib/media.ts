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
 * 根据文件扩展名推断 MIME 类型（浏览器不报 MIME 时兜底）
 */
function inferMimeFromExt(filename: string): string {
	const ext = filename.split('.').pop()?.toLowerCase() || '';
	const map: Record<string, string> = {
		zip: 'application/zip',
		rar: 'application/x-rar-compressed',
		'7z': 'application/x-7z-compressed',
		tar: 'application/x-tar',
		gz: 'application/gzip',
		tgz: 'application/gzip',
		mp4: 'video/mp4',
		webm: 'video/webm',
		mov: 'video/quicktime',
		avi: 'video/x-msvideo',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		gif: 'image/gif',
		webp: 'image/webp',
		bmp: 'image/bmp',
	};
	return map[ext] || 'application/octet-stream';
}

/**
 * 上传文件到 ImgBed，再登记到论坛 media_files 表
 * @returns media record including media_id
 */
export async function uploadMedia(
	file: File,
	imgbedDomain: string,
	imgbedAuthCode: string,
	onProgress?: (percent: number) => void
): Promise<MediaUploadResult> {
	// Step 1: Upload directly to ImgBed (XHR 支持进度回调)
	const fullUrl = await uploadToImgBed(file, imgbedDomain, imgbedAuthCode, onProgress);

	// 浏览器可能不报 MIME（如压缩包），根据扩展名推断
	const mime = file.type || inferMimeFromExt(file.name);

	// Step 2: Register with forum Worker
	const registerRes = await fetch(`${API_BASE}/media/upload`, {
		method: 'POST',
		headers: getSecurityHeaders('POST'),
		body: JSON.stringify({
			url: fullUrl,
			mime,
			size: file.size,
		}),
	});

	const registerData = await registerRes.json();
	if (!registerRes.ok) {
		throw new Error(registerData?.error || '媒体登记失败');
	}

	return registerData as MediaUploadResult;
}

/**
 * 使用 XHR 上传文件到 ImgBed，支持进度回调
 */
function uploadToImgBed(
	file: File,
	imgbedDomain: string,
	imgbedAuthCode: string,
	onProgress?: (percent: number) => void
): Promise<string> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		const formData = new FormData();
		formData.append('file', file);

		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable && onProgress) {
				onProgress(Math.round((e.loaded / e.total) * 100));
			}
		};

		xhr.onload = () => {
			if (xhr.status < 200 || xhr.status >= 300) {
				reject(new Error(`ImgBed 上传失败 (${xhr.status})`));
				return;
			}
			try {
				const uploadData = JSON.parse(xhr.responseText);
				const srcPath = uploadData[0]?.src;
				if (!srcPath) {
					reject(new Error('ImgBed 返回格式异常: ' + xhr.responseText.slice(0, 200)));
					return;
				}
				resolve(`${imgbedDomain}${srcPath}`);
			} catch {
				reject(new Error('ImgBed 返回格式异常: ' + xhr.responseText.slice(0, 200)));
			}
		};

		xhr.onerror = () => reject(new Error('网络错误，上传失败'));
		xhr.onabort = () => reject(new Error('上传已取消'));

		const uploadUrl = `${imgbedDomain}/upload?authCode=${encodeURIComponent(imgbedAuthCode)}&uploadFolder=tucao&autoRetry=false`;
		xhr.open('POST', uploadUrl);
		xhr.send(formData);
	});
}

/**
 * 上传视频后异步生成缩略图
 * 1. captureVideoFrame 截帧
 * 2. uploadThumbnail 上传到 R2
 * 3. 更新 media_files.thumbnail
 */
export async function generateVideoThumbnail(mediaId: string, videoUrl: string, postId?: number): Promise<void> {
	try {
		const { captureVideoFrame, uploadThumbnail, getCaptureUrl } = await import('@/lib/video-thumbnail');
		const captureUrl = getCaptureUrl(videoUrl);
		const blob = await captureVideoFrame(captureUrl);
		const thumbUrl = await uploadThumbnail(blob, mediaId);
		// 更新 media_files.thumbnail
		await fetch(`${API_BASE}/media/thumbnail`, {
			method: 'POST',
			headers: getSecurityHeaders('POST'),
			body: JSON.stringify({ media_id: mediaId, thumbnail_url: thumbUrl }),
		});
	} catch (e) {
		console.error('生成视频缩略图失败:', e);
		// 静默失败，不影响发帖体验
	}
}

/**
 * 从文本内容中提取 !MEDIA(...) 的媒体 ID 列表
 */
export function extractMediaIds(content: string): string[] {
	const ids: string[] = [];
	const re = /!MEDIA\(([a-zA-Z0-9_-]+)\)/g;
	let match;
	while ((match = re.exec(content)) !== null) {
		if (!ids.includes(match[1])) ids.push(match[1]);
	}
	return ids;
}

/**
 * 将内容中的媒体文件关联到帖子
 */
export async function attachMediaToPost(postId: number | string, content: string): Promise<void> {
	const mediaIds = extractMediaIds(content);
	if (!mediaIds.length) return;
	await fetch(`${API_BASE}/media/attach`, {
		method: 'POST',
		headers: getSecurityHeaders('POST'),
		body: JSON.stringify({ post_id: String(postId), media_ids: mediaIds }),
	});
}