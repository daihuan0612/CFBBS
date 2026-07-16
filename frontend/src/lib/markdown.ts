import { API_BASE } from '@/lib/api';
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { highlightElement } from '@speed-highlight/core';

/**
 * 替换 workers.dev 域名为自定义域名（解决国内无法访问问题）
 */
function resolveR2Url(url: string, r2PublicUrl?: string): string {
	if (!r2PublicUrl) return url;
	// 匹配任何 *.workers.dev/r2/ 路径
	return url.replace(/https?:\/\/[^\/]+\.workers\.dev\/r2\//g, r2PublicUrl.replace(/\/+$/, '') + '/');
}

function escapeHtml(text: string) {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function normalizeLang(lang: string) {
	const raw = (lang || '').trim().toLowerCase();
	const first = raw.split(/\s+/)[0] || '';
	if (!first) return 'plain';
	if (first === 'javascript' || first === 'js') return 'js';
	if (first === 'typescript' || first === 'ts') return 'ts';
	if (first === 'python' || first === 'py') return 'py';
	if (first === 'rust' || first === 'rs') return 'rs';
	if (first === 'golang' || first === 'go') return 'go';
	if (first === 'shell' || first === 'sh' || first === 'bash') return 'bash';
	if (first === 'md' || first === 'markdown') return 'md';
	if (first === 'yml') return 'yaml';
	return first;
}

let currentR2PublicUrl = '';

// 首行缩进检测：\u200B（零宽空格）+ \u3000（全角空格）
// \u200B 防止 marked 吞掉文档开头的空白
const INDENT_RE = /^\u200B?\u3000+/;

const renderer = new marked.Renderer();
renderer.code = (({ text, lang }: { text: string; lang?: string }) => {
	const normalized = normalizeLang(lang || '');
	return `<div class="shj-lang-${normalized}">${escapeHtml(text)}</div>`;
}) as any;
renderer.codespan = (({ text }: { text: string }) => {
	return `<code class="shj-inline">${escapeHtml(text)}</code>`;
}) as any;
renderer.link = (({ href, title, text }: { href: string; title?: string | null; text: string }) => {
	const hrefAttr = escapeHtml(href || '');
	const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
	return `<a href="${hrefAttr}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
}) as any;
renderer.image = (({ href, title, text }: { href: string; title?: string | null; text: string }) => {
	let resolved = href || '';
	if (resolved && !/^https?:\/\//i.test(resolved) && !resolved.startsWith('/') && !resolved.startsWith('data:')) {
		resolved = `/r2/${resolved.replace(/^\/+/, '')}`;
	}
	// 替换 workers.dev 域名为自定义域名
	resolved = resolveR2Url(resolved, currentR2PublicUrl);
	const src = escapeHtml(resolved);
	const alt = escapeHtml(text || '');
	const caption = escapeHtml(title || text || '');
	const captionAttr = caption ? ` data-caption="${caption}"` : '';
	if (!src) return '';
	return `<a href="${src}" data-fancybox="gallery"${captionAttr} style="display:block;text-align:center"><img src="${src}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer" style="display:inline-block;margin:1em auto" /></a>`;
}) as any;

renderer.paragraph = (({ text }: { text: string }) => {
	if (INDENT_RE.test(text)) {
		const content = text.replace(INDENT_RE, '');
		return `<p class="md-indent-paragraph">${marked.parseInline(content)}</p>`;
	}
	return `<p>${marked.parseInline(text)}</p>`;
}) as any;

marked.use({ renderer, breaks: true, gfm: true });

export function renderMarkdownToHtml(markdown: string, r2PublicUrl?: string) {
	currentR2PublicUrl = r2PublicUrl || '';
	const windowLike = window as unknown as Window;
	const DOMPurify = createDOMPurify(windowLike);
	// 编辑器按钮插入 \u3000\u3000（全角空格）→ 段落渲染器检测行首 \u3000，加 class="md-indent-paragraph"
	// → CSS .md-indent-paragraph { text-indent: 2em } 实现缩进
	// \u200B（零宽空格）防止 marked 吞掉文档开头或行首的 \u3000
	let processed = markdown.replace(/^\u3000+/gm, '\u200B$&');
	// 转换 !MEDIA(id) 语法为占位元素
	processed = processed.replace(/!MEDIA\(([a-zA-Z0-9_-]+)\)/g, '<span data-media-id="$1" class="media-inline"></span>');
	let html = marked.parse(processed) as string;
	html = DOMPurify.sanitize(html, {
		ADD_TAGS: ['video', 'source', 'iframe'],
		ADD_ATTR: ['allowfullscreen', 'frameborder', 'allow', 'referrerpolicy', 'target', 'rel', 'autoplay', 'muted', 'playsinline', 'preload', 'data-fancybox', 'data-caption', 'data-media-id'],
		ADD_CLASSES: ['md-indent-paragraph', 'media-inline']
	});
	// 给视频和 iframe 加内联样式居中
	html = html.replace(/(<video\b)/gi, '$1 style="display:block;margin:1em auto;max-width:100%;max-height:70vh;border-radius:0.5rem"');
	html = html.replace(/(<iframe\b)/gi, '$1 style="display:block;margin:1em auto;max-width:100%;border-radius:0.5rem"');
	return html;
}

export { resolveR2Url };

/**
 * 获取缓存的媒体信息
 */
export function getCachedMedia(id: string) {
	return mediaCache.get(id);
}

/**
 * 批量获取媒体文件信息（内存缓存 + localStorage 持久化）
 */
const mediaCache = new Map<string, { url: string; media_type: string; mime: string; width?: number | null; height?: number | null; thumbnail?: string | null }>();
const MEDIA_CACHE_PREFIX = 'media_';
const MEDIA_CACHE_TTL = 604800_000; // 7 天

function getLocalMediaCache(id: string) {
	try {
		const raw = localStorage.getItem(`${MEDIA_CACHE_PREFIX}${id}`);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (Date.now() - parsed.cached_at > MEDIA_CACHE_TTL) {
			localStorage.removeItem(`${MEDIA_CACHE_PREFIX}${id}`);
			return null;
		}
		return parsed.data;
	} catch {
		return null;
	}
}

function setLocalMediaCache(id: string, data: any) {
	try {
		localStorage.setItem(`${MEDIA_CACHE_PREFIX}${id}`, JSON.stringify({ data, cached_at: Date.now() }));
	} catch {
		// localStorage 满时静默失败
	}
}

export async function batchGetMedia(ids: string[]): Promise<void> {
	const uncached = ids.filter(id => {
		if (mediaCache.has(id)) return false;
		const local = getLocalMediaCache(id);
		if (local) {
			// 视频缩略图未生成时不使用缓存，确保能拉取最新状态
			if (local.media_type === 'video' && !local.thumbnail) {
				localStorage.removeItem(`${MEDIA_CACHE_PREFIX}${id}`);
				return true;
			}
			mediaCache.set(id, local);
			return false;
		}
		return true;
	});
	if (uncached.length === 0) return;

	// 逐个查询（私密论坛用户少，单次查询即可）
	for (const id of uncached) {
		try {
			const res = await fetch(`${API_BASE}/media/get?id=${encodeURIComponent(id)}`);
			if (!res.ok) continue;
			const data = await res.json();
			if (data.success) {
				mediaCache.set(id, data);
				// 视频缩略图未生成时不持久化缓存，下次重新拉取
				if (data.media_type === 'video' && !data.thumbnail) {
					// 仅内存缓存，不写 localStorage
				} else {
					setLocalMediaCache(id, data);
				}
			}
		} catch {
			// 单个失败不影响其他
		}
	}
}

/**
 * 解析 !MEDIA(id) 占位元素，根据媒体类型渲染 DOM
 * - image → <a data-fancybox><img></a>
 * - video → <video controls poster>
 * - audio → <audio controls>
 * - file  → 下载链接
 */
export async function resolveMediaUrls(root: HTMLElement | null) {
	if (!root) return;
	const placeholders = root.querySelectorAll<HTMLSpanElement>('[data-media-id]');
	if (!placeholders.length) return;

	const ids = Array.from(placeholders).map(el => el.dataset.mediaId || '').filter(Boolean);
	await batchGetMedia(ids);

	placeholders.forEach((el) => {
		const mediaId = el.dataset.mediaId;
		if (!mediaId) return;
		const media = mediaCache.get(mediaId);
		if (!media) return;

		el.classList.remove('media-inline');
		el.removeAttribute('data-media-id');

		switch (media.media_type) {
			case 'image': {
				el.outerHTML = `<a href="${media.url}" data-fancybox="gallery" style="display:block;text-align:center"><img src="${media.url}" alt="" loading="lazy" referrerpolicy="no-referrer" style="display:inline-block;max-width:100%;margin:1em auto" /></a>`;
				break;
			}
			case 'video': {
				const poster = media.thumbnail ? ` poster="${media.thumbnail}"` : '';
				el.outerHTML = `<video controls preload="metadata"${poster} style="display:block;margin:1em auto;max-width:100%;max-height:70vh;border-radius:0.5rem"><source src="${media.url}"></video>`;
				break;
			}
			case 'audio': {
				el.outerHTML = `<audio controls style="display:block;margin:1em auto"><source src="${media.url}"></audio>`;
				break;
			}
			default: {
				// file / unknown → download link
				const rawName = media.url.split('/').pop() || mediaId;
				// 去掉图床加的时间戳前缀（如 1784086706996_逍遥小散仙1-28.rar → 逍遥小散仙1-28.rar）
				const filename = rawName.replace(/^\d+_/, '');
				el.outerHTML = `<a href="${media.url}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;margin:0.5em 0;text-decoration:none;color:var(--link-color,#2563eb);font-size:14px">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
					${filename}
				</a>`;
			}
		}
	});

	// 重新挂载 fancybox（新插入的图片）
	attachFancybox(root);
}

/**
 * 初始化视频封面：静音播放 0.1 秒加载第一帧画面，然后暂停。
 * 用户点击播放时恢复声音正常播放。
 */
export function initVideoPosters(root: HTMLElement | null) {
	if (!root) return;
	const videos = root.querySelectorAll<HTMLVideoElement>('video');
	videos.forEach((video) => {
		if (video.dataset.posterLoaded) return;
		video.dataset.posterLoaded = 'true';

		// 确保满足浏览器自动播放策略
		video.muted = true;
		video.playsInline = true;
		video.preload = 'auto';

		const playPromise = video.play();
		if (playPromise !== undefined) {
			playPromise
				.then(() => {
					// 播放 100ms 后暂停，让浏览器渲染出第一帧作为封面
					setTimeout(() => {
						video.pause();
						video.currentTime = 0;
						// 恢复声音，用户点击播放时即有声音
						video.muted = false;
					}, 100);
				})
				.catch(() => {
					// 自动播放被阻止（如 iOS），保持 controls 让用户手动播放
					video.muted = false;
				});
		} else {
			video.muted = false;
		}
	});
}

export function highlightCodeBlocks(root: ParentNode | null) {
	if (!root) return;
	const nodes = Array.from((root as any).querySelectorAll?.('[class*="shj-lang-"]') || []) as Element[];
	if (!nodes.length) return;
	void Promise.all(nodes.map((el) => highlightElement(el, undefined, undefined, { hideLineNumbers: true })));
}

export function attachFancybox(root: HTMLElement | null) {
	if (!root) return () => {};
	if (!root.querySelector('a[data-fancybox]')) return () => {};
	let cancelled = false;
	void import('@fancyapps/ui').then(({ Fancybox }) => {
		if (cancelled) return;
		Fancybox.bind(root, 'a[data-fancybox]', { groupAll: false });
	});
	return () => {
		cancelled = true;
		void import('@fancyapps/ui').then(({ Fancybox }) => {
			Fancybox.unbind(root, 'a[data-fancybox]');
		});
	};
}
