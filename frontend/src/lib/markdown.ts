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
	return `<a href="${src}" data-fancybox="gallery"${captionAttr}><img src="${src}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer" /></a>`;
}) as any;
marked.use({ renderer, breaks: true, gfm: true });

export function renderMarkdownToHtml(markdown: string, r2PublicUrl?: string) {
	currentR2PublicUrl = r2PublicUrl || '';
	const windowLike = window as unknown as Window;
	const DOMPurify = createDOMPurify(windowLike);
	// marked 会把 U+3000（全角空格，Zs类）等第一段开头空白吃掉
	// 换成 U+00A0（不换行空格，No类）既不被 CommonMark 当空白，CSS 也不折叠
	const processed = markdown.replace(/\u3000/g, '\u00A0');
	let html = marked.parse(processed) as string;
	return DOMPurify.sanitize(html, {
		ADD_TAGS: ['video', 'source', 'iframe'],
		ADD_ATTR: ['allowfullscreen', 'frameborder', 'allow', 'referrerpolicy', 'target', 'rel', 'autoplay', 'muted', 'playsinline', 'preload']
	});
}

export { resolveR2Url };

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
