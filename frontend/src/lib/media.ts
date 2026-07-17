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
 * 分块大小：16MB（Telegram 渠道）
 * 与 ImgBed 网站前端一致
 */
const CHUNK_SIZE = 16 * 1024 * 1024;
const CHUNK_CONCURRENCY = 3;
const CHUNK_RETRIES = 3;

/**
 * 构建 ImgBed 上传基础 URL
 */
function imgbedUploadUrl(imgbedDomain: string, imgbedAuthCode: string): string {
	return `${imgbedDomain}/upload?authCode=${encodeURIComponent(imgbedAuthCode)}&uploadFolder=tucao&autoRetry=false`;
}

/**
 * XHR 单次请求封装（FormData）
 */
function xhrPost(url: string, formData: FormData, onProgress?: (pct: number) => void): Promise<string> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable && onProgress) {
				onProgress(Math.round((e.loaded / e.total) * 100));
			}
		};
		xhr.onload = () => {
			if (xhr.status < 200 || xhr.status >= 300) {
				reject(new Error(`HTTP ${xhr.status}`));
				return;
			}
			resolve(xhr.responseText);
		};
		xhr.onerror = () => reject(new Error('网络错误'));
		xhr.onabort = () => reject(new Error('已取消'));
		xhr.open('POST', url);
		xhr.send(formData);
	});
}

/**
 * 解析 ImgBed 上传响应，提取 src 路径
 */
function parseImgBedResponse(responseText: string, context: string): string {
	const data = JSON.parse(responseText);
	const srcPath = data[0]?.src;
	if (!srcPath) {
		throw new Error(`ImgBed 返回格式异常 (${context}): ` + responseText.slice(0, 200));
	}
	return srcPath;
}

/**
 * 简单上传（小文件，单次 POST）
 */
function simpleUploadToImgBed(
	file: File,
	imgbedDomain: string,
	imgbedAuthCode: string,
	onProgress?: (percent: number) => void
): Promise<string> {
	const url = imgbedUploadUrl(imgbedDomain, imgbedAuthCode);
	const fd = new FormData();
	fd.append('file', file);
	return xhrPost(url, fd, onProgress).then((resp) => {
		const srcPath = parseImgBedResponse(resp, 'simple');
		return `${imgbedDomain}${srcPath}`;
	});
}

/**
 * 分块上传（大文件，三步流程）
 * 与 ImgBed 网站前端逻辑一致
 */
async function chunkedUploadToImgBed(
	file: File,
	imgbedDomain: string,
	imgbedAuthCode: string,
	totalChunks: number,
	onProgress?: (percent: number) => void
): Promise<string> {
	const baseUrl = imgbedUploadUrl(imgbedDomain, imgbedAuthCode);
	const pad = (n: number) => String(n).padStart(6, '0');

	// ---- Step 1: 初始化分块会话 ----
	const initFd = new FormData();
	initFd.append('originalFileName', file.name);
	initFd.append('originalFileType', file.type);
	initFd.append('totalChunks', String(totalChunks));

	const initResp = await xhrPost(`${baseUrl}&initChunked=true`, initFd);
	const initData = JSON.parse(initResp);
	const uploadId: string = initData.uploadId;
	if (!uploadId) throw new Error('ImgBed 初始化分块失败: ' + initResp.slice(0, 200));

	// ---- Step 2: 并发上传分块 ----
	const chunkProgress: number[] = new Array(totalChunks).fill(0);
	let hasError = false;
	let errorMsg = '';
	let currentIdx = 0;

	const uploadOneChunk = async (): Promise<void> => {
		while (currentIdx < totalChunks && !hasError) {
			const idx = currentIdx++;
			const start = idx * CHUNK_SIZE;
			const end = Math.min(start + CHUNK_SIZE, file.size);
			const blob = file.slice(start, end);

			const fd = new FormData();
			fd.append('file', blob, `${file.name}.part${pad(idx)}`);
			fd.append('chunkIndex', String(idx));
			fd.append('totalChunks', String(totalChunks));
			fd.append('uploadId', uploadId);
			fd.append('originalFileName', file.name);
			fd.append('originalFileType', file.type);

			let success = false;
			for (let retry = 0; retry < CHUNK_RETRIES; retry++) {
				try {
					await xhrPost(`${baseUrl}&chunked=true`, fd, (pct) => {
						chunkProgress[idx] = pct;
						const overall = Math.round(
							chunkProgress.reduce((a, b) => a + b, 0) / totalChunks
						);
						onProgress?.(overall);
					});
					chunkProgress[idx] = 100;
					success = true;
					break;
				} catch (e: any) {
					if (retry >= CHUNK_RETRIES - 1) {
						hasError = true;
						errorMsg = `分块 ${idx + 1}/${totalChunks} 上传失败`;
						throw new Error(errorMsg);
					}
					await new Promise((r) => setTimeout(r, 2000 * (retry + 1)));
				}
			}
			if (success) {
				const overall = Math.round(
					chunkProgress.reduce((a, b) => a + b, 0) / totalChunks
				);
				onProgress?.(overall);
			}
		}
	};

	const workers: Promise<void>[] = [];
	for (let i = 0; i < CHUNK_CONCURRENCY; i++) {
		workers.push(uploadOneChunk());
	}
	await Promise.all(workers);

	if (hasError) throw new Error(errorMsg);

	// ---- Step 3: 合并分块 ----
	onProgress?.(95);
	const mergeFd = new FormData();
	mergeFd.append('uploadId', uploadId);
	mergeFd.append('totalChunks', String(totalChunks));
	mergeFd.append('originalFileName', file.name);
	mergeFd.append('originalFileType', file.type);

	const mergeResp = await xhrPost(`${baseUrl}&chunked=true&merge=true`, mergeFd);
	onProgress?.(100);

	const srcPath = parseImgBedResponse(mergeResp, 'merge');
	return `${imgbedDomain}${srcPath}`;
}

/**
 * 分块上传阈值：85MB
 * Cloudflare Workers 请求体限制 100MB，留余量
 * 小于此值直接一次传（更快），超过才走分块
 */
const CHUNK_THRESHOLD = 85 * 1024 * 1024;

/**
 * 使用 XHR 上传文件到 ImgBed，支持进度回调
 * 大文件(>85MB)自动走分块上传
 */
function uploadToImgBed(
	file: File,
	imgbedDomain: string,
	imgbedAuthCode: string,
	onProgress?: (percent: number) => void
): Promise<string> {
	if (file.size <= CHUNK_THRESHOLD) {
		return simpleUploadToImgBed(file, imgbedDomain, imgbedAuthCode, onProgress);
	}
	return chunkedUploadToImgBed(file, imgbedDomain, imgbedAuthCode, Math.ceil(file.size / CHUNK_SIZE), onProgress);
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