import * as React from 'react';
import { Bold, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Eye, EyeOff, Italic, Heart, MessageCircle, MoreVertical, Pin, Quote, RefreshCw, Search, Shield, Trash2, User, X, AlignCenter, Indent, Video, Cloud } from 'lucide-react';

import { TurnstileWidget } from '@/components/turnstile';
import { PageShell } from '@/components/page-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useConfig } from '@/hooks/use-config';
import { apiFetch, API_BASE, formatDate, getSecurityHeaders, type Category, type Post } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { attachFancybox, highlightCodeBlocks, renderMarkdownToHtml } from '@/lib/markdown';
import { validateText } from '@/lib/validators';

export function IndexPage() {
	const { config } = useConfig();
	const token = getToken();
	const user = React.useMemo(() => getUser(), [token]);
	const [banner, setBanner] = React.useState<string>('');
	const [categories, setCategories] = React.useState<Category[]>([]);
	const [selectedCategory, setSelectedCategory] = React.useState<string>('');
	const [searchInput, setSearchInput] = React.useState<string>('');
	const [searchQuery, setSearchQuery] = React.useState<string>('');
	const [posts, setPosts] = React.useState<Post[]>([]);
	const [totalPosts, setTotalPosts] = React.useState<number>(0);
	const [pageOffset, setPageOffset] = React.useState<number>(0);
	const [loading, setLoading] = React.useState<boolean>(true);
	const [error, setError] = React.useState<string>('');
	const pageLimit = 10;
	const [jumpTo, setJumpTo] = React.useState<string>('');

	const [newTitle, setNewTitle] = React.useState('');
	const [newContent, setNewContent] = React.useState('');
	const [newCategoryId, setNewCategoryId] = React.useState<string>('');
	const [previewOpen, setPreviewOpen] = React.useState(true);
	const [createOpen, setCreateOpen] = React.useState(false);
	const [createLoading, setCreateLoading] = React.useState(false);
	const [createError, setCreateError] = React.useState('');
	const [uploadLoading, setUploadLoading] = React.useState(false);
	const [uploadError, setUploadError] = React.useState('');

	// 编辑器增强: 视频/网盘对话框
	const [videoDialogOpen, setVideoDialogOpen] = React.useState(false);
	const [videoUrl, setVideoUrl] = React.useState('');
	const [cloudDialogOpen, setCloudDialogOpen] = React.useState(false);
	const [cloudUrl, setCloudUrl] = React.useState('');
	const [cloudName, setCloudName] = React.useState('');

	// insert text at current cursor position in the textarea (or append)
	function insertIntoContent(insertText: string) {
		if (newContentRef.current) {
			const el = newContentRef.current;
			const start = el.selectionStart;
			const end = el.selectionEnd;
			const before = newContent.slice(0, start);
			const after = newContent.slice(end);
			const updated = before + insertText + after;
			setNewContent(updated);
			// reposition cursor immediately after inserted text
			setTimeout(() => {
				el.selectionStart = el.selectionEnd = start + insertText.length;
				el.focus();
			}, 0);
		} else {
			setNewContent(newContent + insertText);
		}
	}

	function applyEdit(transform: (text: string, start: number, end: number) => { text: string; selectionStart: number; selectionEnd: number }) {
		const el = newContentRef.current;
		const start = el ? el.selectionStart : newContent.length;
		const end = el ? el.selectionEnd : newContent.length;
		const result = transform(newContent, start, end);
		setNewContent(result.text);
		setTimeout(() => {
			const target = newContentRef.current;
			if (!target) return;
			target.selectionStart = result.selectionStart;
			target.selectionEnd = result.selectionEnd;
			target.focus();
		}, 0);
	}

	function wrapSelection(prefix: string, suffix: string, placeholder: string) {
		applyEdit((text, start, end) => {
			const selected = text.slice(start, end) || placeholder;
			const next = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
			const selectionStart = start + prefix.length;
			const selectionEnd = selectionStart + selected.length;
			return { text: next, selectionStart, selectionEnd };
		});
	}

	function wrapBlock(fence: string) {
		applyEdit((text, start, end) => {
			const selected = text.slice(start, end);
			const block = `${fence}\n${selected}\n${fence}`;
			const next = text.slice(0, start) + block + text.slice(end);
			const selectionStart = start + fence.length + 1;
			const selectionEnd = selectionStart + selected.length;
			return { text: next, selectionStart, selectionEnd };
		});
	}

	function transformLines(transform: (line: string, index: number, lines: string[]) => string) {
		applyEdit((text, start, end) => {
			const lineStart = text.lastIndexOf('\n', start - 1) + 1;
			const lineEnd = text.indexOf('\n', end);
			const endIndex = lineEnd === -1 ? text.length : lineEnd;
			const segment = text.slice(lineStart, endIndex);
			const lines = segment.split('\n');
			const nextSegment = lines.map(transform).join('\n');
			const next = text.slice(0, lineStart) + nextSegment + text.slice(endIndex);
			return { text: next, selectionStart: lineStart, selectionEnd: lineStart + nextSegment.length };
		});
	}

	function setHeading(level: number) {
		transformLines((line) => {
			const cleaned = line.replace(/^\s{0,3}#{1,6}\s+/, '');
			if (level === 0) return cleaned;
			return `${'#'.repeat(level)} ${cleaned}`;
		});
	}

	function toggleLinePrefix(prefix: string, matcher: RegExp) {
		transformLines((line) => {
			if (matcher.test(line)) return line.replace(matcher, '');
			return `${prefix}${line}`;
		});
	}

	function toggleBlockquote() {
		transformLines((line) => (line.startsWith('> ') ? line.slice(2) : `> ${line}`));
	}

	function toggleList(ordered: boolean) {
		transformLines((line, index, lines) => {
			if (ordered) {
				if (/^\d+\.\s+/.test(line)) return line.replace(/^\d+\.\s+/, '');
				return `${index + 1}. ${line}`;
			}
			if (/^[-*+]\s+/.test(line)) return line.replace(/^[-*+]\s+/, '');
			return `- ${line}`;
		});
	}

	function indentLines() {
		transformLines((line) => `  ${line}`);
	}

	function outdentLines() {
		transformLines((line) => line.replace(/^(\t| {1,2})/, ''));
	}

	function insertLink(isImage: boolean) {
		applyEdit((text, start, end) => {
			const selected = text.slice(start, end) || (isImage ? 'alt' : 'text');
			const link = isImage ? `![${selected}](url)` : `[${selected}](url)`;
			const next = text.slice(0, start) + link + text.slice(end);
			const urlStart = start + (isImage ? 2 : 1) + selected.length + 2;
			const urlEnd = urlStart + 3;
			return { text: next, selectionStart: urlStart, selectionEnd: urlEnd };
		});
	}

	function insertTable() {
		applyEdit((text, start, end) => {
			const table = `| Header | Header |\n| --- | --- |\n| Cell | Cell |`;
			const next = text.slice(0, start) + table + text.slice(end);
			const selectionStart = start + 2;
			const selectionEnd = selectionStart + 6;
			return { text: next, selectionStart, selectionEnd };
		});
	}

	// 编辑器增强: 居中
	function insertCenter() {
		wrapSelection('<center>\n', '\n</center>', 'text');
	}

	// 编辑器增强: 缩进
	function insertIndent() {
		applyEdit((text, start, end) => {
			const selected = text.slice(start, end) || '缩进内容';
			const indented = selected.split('\n').map(l => l ? '  ' + l : l).join('\n');
			const next = text.slice(0, start) + indented + text.slice(end);
			return { text: next, selectionStart: start, selectionEnd: start + indented.length };
		});
	}

	// 编辑器增强: 加粗
	function insertBold() { wrapSelection('**', '**', '加粗文字'); }
	// 编辑器增强: 斜体
	function insertItalic() { wrapSelection('*', '*', '斜体文字'); }
	// 编辑器增强: 引用
	function insertQuote() {
		transformLines((line) => `> ${line}`);
	}

	// 编辑器增强: 首行缩进（中文全角空格）
	function formatParagraphIndent() {
		transformLines((line) => {
			if (!line.trim()) return line;
			if (line.startsWith('\u3000\u3000')) return line.replace(/^\u3000\u3000/, '');
			return `\u3000\u3000${line}`;
		});
	}

	// 编辑器增强: 小说格式化（识别章标题 + 批量缩进）
	function formatNovel() {
		applyEdit((text, start, end) => {
			const selected = text.slice(start, end) || text;
			const lines = selected.split('\n');
			const formatted = lines.map(line => {
				// 识别章/节标题: 第X章、Chapter X、# 开头、回车后紧跟的短标题
				const trimmed = line.trim();
				if (/^(第[一二三四五六七八九十百千万\d]+[章节回部]|Chapter\s*\d+|#[#\s]|引子|楔子|序|尾声|后记)/.test(trimmed)) {
					return `\n**${trimmed}**\n`;
				}
				// 空行保留
				if (!trimmed) return '';
				// 正文自动缩进
				return `\u3000\u3000${trimmed}`;
			}).join('\n');
			const next = text.slice(0, start) + formatted + text.slice(end);
			return { text: next, selectionStart: start, selectionEnd: start + formatted.length };
		});
	}

	// 编辑器增强: 视频（自动识别链接类型）
	function insertVideoMarkdown(url: string) {
		const trimmed = url.trim();
		// YouTube
		const ytMatch = trimmed.match(/(?:youtube\.com\/(?:watch|embed)\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
		if (ytMatch) {
			const embed = `\n<div class="video-wrapper" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%;"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}" style="position:absolute;top:0;left:0;width:100%;height:100%;" frameborder="0" allowfullscreen></iframe></div>\n`;
			return insertIntoContent(embed);
		}
		// Bilibili
		const bvMatch = trimmed.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/);
		if (bvMatch) {
			const embed = `\n<div class="video-wrapper" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%;"><iframe src="https://player.bilibili.com/player.html?bvid=${bvMatch[1]}" style="position:absolute;top:0;left:0;width:100%;height:100%;" frameborder="0" allowfullscreen></iframe></div>\n`;
			return insertIntoContent(embed);
		}
		// 默认：用 <video> 标签（支持 mp4/webm/mov 及任何返回视频内容的代理链接）
		const ext = trimmed.split('?')[0].split('.').pop()?.toLowerCase();
		const mime = ext === 'webm' ? 'video/webm' : ext === 'ogg' ? 'video/ogg' : 'video/mp4';
		const embed = `\n<video controls width="100%"><source src="${trimmed}" type="${mime}"></video>\n`;
		insertIntoContent(embed);
	}

	// 编辑器增强: 网盘链接
	function insertCloudLink(url: string, name: string) {
		const markdown = `\n[📁 ${name}](${url})\n`;
		insertIntoContent(markdown);
	}

	function handleEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		const isMod = e.ctrlKey || e.metaKey;
		if (!isMod) return;
		const key = e.key.toLowerCase();
		const shift = e.shiftKey;
		if (!shift && key === 'b') {
			e.preventDefault();
			wrapSelection('**', '**', 'text');
			return;
		}
		if (!shift && key === 'i') {
			e.preventDefault();
			wrapSelection('*', '*', 'text');
			return;
		}
		if (!shift && key === 'u') {
			e.preventDefault();
			wrapSelection('<u>', '</u>', 'text');
			return;
		}
		if (!shift && key === 'k') {
			e.preventDefault();
			insertLink(false);
			return;
		}
		if (!shift && key === 't') {
			e.preventDefault();
			insertTable();
			return;
		}
		if (shift && key === 'i') {
			e.preventDefault();
			insertLink(true);
			return;
		}
		if (!shift && key === '0') {
			e.preventDefault();
			setHeading(0);
			return;
		}
		if (!shift && key === '1') {
			e.preventDefault();
			setHeading(1);
			return;
		}
		if (!shift && key === '2') {
			e.preventDefault();
			setHeading(2);
			return;
		}
		if (!shift && key === '3') {
			e.preventDefault();
			setHeading(3);
			return;
		}
		if (shift && key === 'k') {
			e.preventDefault();
			wrapBlock('```');
			return;
		}
		if (shift && key === 'm') {
			e.preventDefault();
			wrapBlock('$$');
			return;
		}
		if (shift && key === 'q') {
			e.preventDefault();
			toggleBlockquote();
			return;
		}
		if (shift && key === '[') {
			e.preventDefault();
			toggleList(true);
			return;
		}
		if (shift && key === ']') {
			e.preventDefault();
			toggleList(false);
			return;
		}
		if (!shift && key === '[') {
			e.preventDefault();
			outdentLines();
			return;
		}
		if (!shift && key === ']') {
			e.preventDefault();
			indentLines();
			return;
		}
		if (shift && (e.code === 'Backquote' || key === '`')) {
			e.preventDefault();
			wrapSelection('`', '`', 'code');
			return;
		}
		if (e.altKey && shift && e.code === 'Digit5') {
			e.preventDefault();
			wrapSelection('~~', '~~', 'text');
			return;
		}
	}
	const [turnstileToken, setTurnstileToken] = React.useState('');
	const [turnstileResetKey, setTurnstileResetKey] = React.useState(0);
	const previewRef = React.useRef<HTMLDivElement | null>(null);
	const newContentRef = React.useRef<HTMLTextAreaElement | null>(null);
	const [adminMenuPostId, setAdminMenuPostId] = React.useState<number | null>(null);
	const [adminActionPostId, setAdminActionPostId] = React.useState<number | null>(null);
	const [sortOption, setSortOption] = React.useState('time_desc');
	const listTopRef = React.useRef<HTMLDivElement | null>(null);
	const lastOffsetRef = React.useRef<number | null>(null);

	const enabled = !!config?.turnstile_enabled;
	const siteKey = config?.turnstile_site_key || '';
	const turnstileActive = enabled && !!siteKey;

	const fetchCategories = React.useCallback(async () => {
		try {
			const list = await apiFetch<Category[]>('/categories', { headers: getSecurityHeaders('GET') });
			setCategories(list);
		} catch {
			setCategories([]);
		}
	}, []);

	const fetchPosts = React.useCallback(
		async (offset: number) => {
			setLoading(true);
			setError('');
			try {
				const sortBy =
					sortOption === 'likes_desc'
						? 'likes'
						: sortOption === 'comments_desc'
							? 'comments'
							: sortOption === 'views_desc'
								? 'views'
								: 'time';
				const sortDir = sortOption === 'time_asc' ? 'asc' : 'desc';
				const categoryParam = selectedCategory ? `&category_id=${encodeURIComponent(selectedCategory)}` : '';
				const searchParam = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : '';
				const sortParam = `&sort_by=${encodeURIComponent(sortBy)}&sort_dir=${encodeURIComponent(sortDir)}`;
				const res = await fetch(`${API_BASE}/posts?limit=${pageLimit}&offset=${offset}${categoryParam}${searchParam}${sortParam}`);
				if (!res.ok) {
					let msg = `加载帖子失败 (${res.status})`;
					try {
						const body = await res.text();
						if (body) msg += `: ${body}`;
					} catch {}
					throw new Error(msg);
				}
				const data = (await res.json()) as any;
				const list: Post[] = Array.isArray(data) ? data : (data.posts as Post[]);
				const total = Array.isArray(data) ? list.length : Number(data.total || 0);

				const processed = list.map((p) => ({
					...p,
					like_count: p.like_count || 0,
					comment_count: p.comment_count || 0
				}));

				setPosts(processed);
				setTotalPosts(total);
				setPageOffset(offset);
			} catch (e: any) {
				setError(String(e?.message || e));
			} finally {
				setLoading(false);
			}
		},
		[selectedCategory, searchQuery, sortOption]
	);

	React.useEffect(() => {
		fetchCategories();
	}, [fetchCategories]);

	React.useEffect(() => {
		fetchPosts(0);
	}, [fetchPosts]);

	React.useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get('verified') === 'true') {
			setBanner('用户名验证成功，现在可以登录。');
			params.delete('verified');
			window.history.replaceState({}, document.title, `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`);
		} else if (params.get('loginName_changed') === 'true') {
			setBanner('登录用户名更换成功。');
			params.delete('loginName_changed');
			window.history.replaceState({}, document.title, `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`);
		}
	}, []);

	React.useEffect(() => {
		if (!previewOpen) return;
		const el = previewRef.current;
		if (!el) return;
		highlightCodeBlocks(el);
		const cleanup = attachFancybox(el);
		return cleanup;
	}, [previewOpen, newContent]);

	React.useEffect(() => {
		if (adminMenuPostId == null) return;
		function close() {
			setAdminMenuPostId(null);
		}
		document.addEventListener('mousedown', close);
		document.addEventListener('touchstart', close);
		return () => {
			document.removeEventListener('mousedown', close);
			document.removeEventListener('touchstart', close);
		};
	}, [adminMenuPostId]);

	React.useEffect(() => {
		if (lastOffsetRef.current !== null && lastOffsetRef.current !== pageOffset && !loading) {
			listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
		lastOffsetRef.current = pageOffset;
	}, [pageOffset, loading]);

	async function adminTogglePin(post: Post) {
		if (!user || user.role !== 'admin') return;
		setAdminActionPostId(post.id);
		try {
			const next = !post.is_pinned;
			await apiFetch(`/admin/posts/${post.id}/pin`, {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({ pinned: next })
			});
			setAdminMenuPostId(null);
			await fetchPosts(pageOffset);
		} catch {
			return;
		} finally {
			setAdminActionPostId(null);
		}
	}

	async function adminDeletePost(post: Post) {
		if (!user || user.role !== 'admin') return;
		if (!confirm('确定要删除这个帖子吗？此操作无法撤销。')) return;
		setAdminActionPostId(post.id);
		try {
			await apiFetch(`/admin/posts/${post.id}`, {
				method: 'DELETE',
				headers: getSecurityHeaders('DELETE')
			});
			setAdminMenuPostId(null);
			await fetchPosts(pageOffset);
		} catch {
			return;
		} finally {
			setAdminActionPostId(null);
		}
	}

	async function adminMovePost(post: Post, categoryId: number | null) {
		if (!user || user.role !== 'admin') return;
		setAdminActionPostId(post.id);
		try {
			await apiFetch(`/admin/posts/${post.id}/move`, {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({ category_id: categoryId })
			});
			setAdminMenuPostId(null);
			await fetchPosts(pageOffset);
		} catch {
			return;
		} finally {
			setAdminActionPostId(null);
		}
	}

	async function createPost(e: React.FormEvent) {
		e.preventDefault();
		if (!user) {
			window.location.href = '/login';
			return;
		}

		setCreateError('');
		const titleErr = validateText(newTitle, '标题');
		if (titleErr) return setCreateError(titleErr);
		const contentErr = validateText(newContent, '内容');
		if (contentErr) return setCreateError(contentErr);
		if (newTitle.length > 30) return setCreateError('标题过长 (最多 30 字符)');
		if (newContent.length > 3000) return setCreateError('内容过长 (最多 3000 字符)');
		if (turnstileActive && !turnstileToken) return setCreateError('请完成验证码验证');

		setCreateLoading(true);
		try {
			await apiFetch<{ success: boolean }>('/posts', {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({
					title: newTitle,
					content: newContent,
					category_id: newCategoryId ? Number(newCategoryId) : null,
					'cf-turnstile-response': turnstileToken
				})
			});
			setNewTitle('');
			setNewContent('');
			setNewCategoryId('');
			setTurnstileToken('');
			setTurnstileResetKey((v) => v + 1);
			setCreateOpen(false);
			await fetchPosts(0);
		} catch (e: any) {
			setCreateError(String(e?.message || e));
			setTurnstileToken('');
			setTurnstileResetKey((v) => v + 1);
		} finally {
			setCreateLoading(false);
		}
	}

	const currentPage = Math.floor(pageOffset / pageLimit) + 1;
	const totalPages = Math.max(1, Math.ceil(totalPosts / pageLimit));
	const pages: Array<number | 'ellipsis'> = [];
	if (totalPages <= 7) {
		for (let p = 1; p <= totalPages; p++) pages.push(p);
	} else {
		const start = Math.max(2, currentPage - 2);
		const end = Math.min(totalPages - 1, currentPage + 2);
		pages.push(1);
		if (start > 2) pages.push('ellipsis');
		for (let p = start; p <= end; p++) pages.push(p);
		if (end < totalPages - 1) pages.push('ellipsis');
		pages.push(totalPages);
	}

	function getCoverImageUrl(markdown: string) {
		const mdMatch = markdown.match(/!\[[^\]]*\]\(([^)\s]+)\)/i);
		const htmlMatch = markdown.match(/<img[^>]+src=["']([^"']+)["']/i);
		let url = mdMatch?.[1] || htmlMatch?.[1] || '';
		if (!url) return '';
		if (!/^https?:\/\//i.test(url) && !url.startsWith('/') && !url.startsWith('data:')) {
			url = `/r2/${url.replace(/^\/+/, '')}`;
		}
		return url;
	}

	return (
		<PageShell>
			<div className="space-y-6">
				{banner ? <div className="rounded-md border bg-muted/40 p-3 text-sm">{banner}</div> : null}
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
							<h1 className="text-2xl font-semibold tracking-tight">侃侃看</h1>
						<p className="text-sm text-muted-foreground">邀请制的纯私密小圈子。</p>
					</div>
					<div className="flex items-center gap-2">
						<label className="text-sm text-muted-foreground" htmlFor="category-filter">
							分类
						</label>
						<select
							id="category-filter"
							className="h-9 rounded-md border bg-background px-3 text-sm"
							value={selectedCategory}
							onChange={(e) => {
								setSelectedCategory(e.target.value);
								setPageOffset(0);
							}}
						>
							<option value="">全部</option>
							<option value="uncategorized">未分类</option>
							{categories.map((c) => (
								<option key={c.id} value={String(c.id)}>
									{c.name}
								</option>
							))}
						</select>
						<label className="text-sm text-muted-foreground" htmlFor="sort-filter">
							排序
						</label>
						<select
							id="sort-filter"
							className="h-9 rounded-md border bg-background px-3 text-sm"
							value={sortOption}
							onChange={(e) => {
								setSortOption(e.target.value);
								setPageOffset(0);
							}}
						>
							<option value="time_desc">最新发布</option>
							<option value="time_asc">最早发布</option>
							<option value="likes_desc">最多点赞</option>
							<option value="comments_desc">最多评论</option>
							<option value="views_desc">最多观看</option>
						</select>
						<form
							className="flex items-center gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								setPageOffset(0);
								setSearchQuery(searchInput.trim());
							}}
						>
							<Input
								value={searchInput}
								onChange={(e) => setSearchInput(e.target.value)}
								placeholder="搜索标题/内容"
								className="h-9 w-48"
							/>
							<Button variant="outline" size="sm" type="submit" disabled={loading}>
								<Search className="h-4 w-4" />
								<span className="sr-only">搜索</span>
							</Button>
							{searchInput || searchQuery ? (
								<Button
									variant="outline"
									size="sm"
									type="button"
									onClick={() => {
										setSearchInput('');
										setSearchQuery('');
										setPageOffset(0);
									}}
									disabled={loading}
								>
									<X className="h-4 w-4" />
									<span className="sr-only">清除</span>
								</Button>
							) : null}
						</form>
						<Button variant="outline" size="sm" onClick={() => fetchPosts(0)} disabled={loading}>
							<RefreshCw className="h-4 w-4" />
							<span className="sr-only">刷新</span>
						</Button>
					</div>
				</div>

				{user ? (
					config?.feature_posts !== false ? (
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center justify-between gap-2">
								<span>发布新帖</span>
								<Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen((v) => !v)}>
									{createOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
									<span className="sr-only">{createOpen ? '收起' : '展开'}</span>
								</Button>
							</CardTitle>
						</CardHeader>
						<CardContent>
							{!createOpen ? (
								<div className="text-sm text-muted-foreground">点击右侧按钮展开编辑器。</div>
							) : (
								<form className="space-y-4" onSubmit={createPost}>
								{createError ? <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{createError}</div> : null}
								<div className="space-y-4">
									<div className="space-y-2">
										<Label htmlFor="new-title">标题</Label>
										<Input id="new-title" maxLength={30} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required />
									</div>
									<div className="space-y-2">
										<Label htmlFor="new-category">分类</Label>
										<select
											id="new-category"
											className="h-9 w-full rounded-md border bg-background px-3 text-sm"
											value={newCategoryId}
											onChange={(e) => setNewCategoryId(e.target.value)}
										>
											<option value="">-- 请选择分类 --</option>
											{categories.map((c) => (
												<option key={c.id} value={String(c.id)}>
													{c.name}
												</option>
											))}
										</select>
									</div>
								</div>
								<div className="space-y-2">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<Label htmlFor="new-content">内容 (支持 Markdown)</Label>
									<div className="flex flex-wrap items-center gap-1">
										<span className="text-xs text-muted-foreground mr-1">快捷键：Ctrl+B/I/K</span>
										{/* 加粗 */}
										<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="加粗 Ctrl+B" onClick={insertBold}>
											<Bold className="h-3.5 w-3.5" />
										</Button>
										{/* 斜体 */}
										<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="斜体 Ctrl+I" onClick={insertItalic}>
											<Italic className="h-3.5 w-3.5" />
										</Button>
										{/* 引用 */}
										<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="引用" onClick={insertQuote}>
											<Quote className="h-3.5 w-3.5" />
										</Button>
										{/* 居中 */}
										<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="居中" onClick={insertCenter}>
											<AlignCenter className="h-3.5 w-3.5" />
										</Button>
										{/* 缩进 */}
										<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="增加缩进" onClick={insertIndent}>
											<Indent className="h-3.5 w-3.5" />
										</Button>
										{/* 首行缩进 */}
										<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="首行缩进（全角空格）" onClick={formatParagraphIndent}>
											<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12H9"/><path d="M21 6H3"/><path d="M21 18H3"/><polyline points="7 8 3 12 7 16"/></svg>
										</Button>
										{/* 小说格式化 */}
										<Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" title="小说格式化（章标题+首行缩进）" onClick={formatNovel}>
											<span className="text-[10px] font-medium">Aa</span>
										</Button>
										{/* 视频 */}
										<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="插入视频" onClick={() => setVideoDialogOpen(true)}>
											<Video className="h-3.5 w-3.5" />
										</Button>
										{/* 编辑器增强: 网盘 */}
										<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="插入网盘链接" onClick={() => setCloudDialogOpen(true)}>
											<Cloud className="h-3.5 w-3.5" />
										</Button>
										<Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen((v) => !v)}>
											{previewOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
											<span className="sr-only">{previewOpen ? '关闭预览' : '打开预览'}</span>
										</Button>
									</div>
								</div>
								<div className={previewOpen ? 'grid gap-3 lg:grid-cols-2' : 'space-y-2'}>
									<div className="space-y-2">
										<Textarea
											id="new-content"
											ref={newContentRef}
											value={newContent}
											onChange={(e) => setNewContent(e.target.value)}
											onKeyDown={handleEditorKeyDown}
											rows={10}
											className="min-h-[220px]"
											required
										/>
										<div className="text-xs text-muted-foreground">Ctrl+T 表格，Ctrl+Shift+M 公式，Ctrl+Shift+Q 引用，Alt+Shift+5 删除线</div>
									</div>
									{previewOpen ? (
										<div className="rounded-md border bg-muted/20 p-3">
											<div className="mb-2 text-xs font-medium text-muted-foreground">预览</div>
											<div
												ref={previewRef}
												className="prose max-w-none break-words [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1"
												dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(newContent || '') }}
											/>
										</div>
									) : null}
								</div>
							</div>
								{/* 图片上传（增强版: 非图片拦截 + Luban压缩 + WebP转码） */}
		<div className="space-y-2">
			<label className="block text-sm font-medium text-muted-foreground">上传图片</label>
			<input
				type="file"
				accept="image/*"
				className="block w-full text-sm"
				onChange={async (e) => {
					const file = e.target.files && e.target.files[0];
					if (!file) return;
					setUploadError('');

					// 非图片文件拦截
					if (!file.type.startsWith('image/')) {
						setUploadError('仅支持图片文件');
						return;
					}

					// Luban 本地压缩 + WebP 转换
					let processedFile = file;
					try {
						const imageCompression = (await import('browser-image-compression')).default;
						processedFile = await imageCompression(file, {
							maxSizeMB: 1,
							maxWidthOrHeight: 1920,
							useWebWorker: true,
							fileType: 'image/webp',
							initialQuality: 0.85
						});
					} catch {
						// fallback: 如果压缩失败直接用原文件
					}

					setUploadLoading(true);
					try {
						const formData = new FormData();
						// 使用压缩后的文件，重命名为 .webp
						const webpFile = new File([processedFile], processedFile.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' });
						formData.append('file', webpFile);
						formData.append('type', 'post');
						const res = await fetch(`${API_BASE}/upload`, {
							method: 'POST',
							headers: getSecurityHeaders('POST', null),
							body: formData
						});
						const data = await res.json();
						if (!res.ok) throw new Error(data?.error || '上传失败');
                        // insert markdown link at cursor and ensure preview is visible
                        insertIntoContent(`

![](${data.url})

`);
                        setPreviewOpen(true);
					} catch (err: any) {
						setUploadError(String(err?.message || err));
					} finally {
						setUploadLoading(false);
					}
				}}
			/>
			{uploadError ? <div className="text-sm text-destructive">{uploadError}</div> : null}
			{uploadLoading ? <div className="text-sm text-muted-foreground">上传中…</div> : null}
		</div>
		<TurnstileWidget enabled={turnstileActive} siteKey={siteKey} onToken={setTurnstileToken} resetKey={turnstileResetKey} />

								<Button type="submit" disabled={createLoading}>
									{createLoading ? '发布中...' : '发布'}
								</Button>
							</form>
							)}
						</CardContent>
					</Card>
				) : null) : (
					<Card>
						<CardContent className="py-6 text-sm text-muted-foreground">
							<a className="text-foreground underline" href="/login">
								登录
							</a>{' '}
							后可发布、点赞和评论。
						</CardContent>
					</Card>
				)}

				{/* 编辑器增强: 视频插入弹窗 */}
				<Dialog open={videoDialogOpen} onOpenChange={setVideoDialogOpen}>
					<DialogContent className="sm:max-w-md">
						<DialogHeader><DialogTitle>插入视频</DialogTitle></DialogHeader>
						<div className="space-y-4 py-2">
							<div className="space-y-2">
								<Label htmlFor="video-url">视频链接（自动识别 mp4/代理/YouTube/B站）</Label>
								<Input id="video-url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://example.com/video.mp4" />
							</div>
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => { setVideoDialogOpen(false); setVideoUrl(''); }}>取消</Button>
							<Button onClick={() => { if (videoUrl) { insertVideoMarkdown(videoUrl); setVideoUrl(''); setVideoDialogOpen(false); } }} disabled={!videoUrl}>插入</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				{/* 编辑器增强: 网盘链接插入弹窗 */}
				<Dialog open={cloudDialogOpen} onOpenChange={setCloudDialogOpen}>
					<DialogContent className="sm:max-w-md">
						<DialogHeader><DialogTitle>插入网盘链接</DialogTitle></DialogHeader>
						<div className="space-y-4 py-2">
							<div className="space-y-2">
								<Label htmlFor="cloud-url">网盘分享链接</Label>
								<Input id="cloud-url" value={cloudUrl} onChange={(e) => setCloudUrl(e.target.value)} placeholder="https://pan.baidu.com/s/xxx" />
							</div>
							<div className="space-y-2">
								<Label htmlFor="cloud-name">显示名称</Label>
								<Input id="cloud-name" value={cloudName} onChange={(e) => setCloudName(e.target.value)} placeholder="下载资源" />
							</div>
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => { setCloudDialogOpen(false); setCloudUrl(''); setCloudName(''); }}>取消</Button>
							<Button onClick={() => { if (cloudUrl && cloudName) { insertCloudLink(cloudUrl, cloudName); setCloudUrl(''); setCloudName(''); setCloudDialogOpen(false); } }} disabled={!cloudUrl || !cloudName}>插入</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				{error ? <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}

				<div className="space-y-4">
					<div ref={listTopRef} />
					{loading ? (
						<Card>
							<CardContent className="py-6 text-sm text-muted-foreground">加载中...</CardContent>
						</Card>
					) : posts.length === 0 ? (
						<Card>
							<CardContent className="py-6 text-sm text-muted-foreground">暂无帖子</CardContent>
						</Card>
					) : (
						posts.map((p) => {
							const coverUrl = getCoverImageUrl(p.content || '');
							const isAdmin = user?.role === 'admin';
							const menuOpen = adminMenuPostId === p.id;
							const actionLoading = adminActionPostId === p.id;
							return (
								<Card key={p.id}>
									<CardContent className="py-5">
										<div className="flex gap-4">
											{coverUrl ? (
												<img
													src={coverUrl}
													alt=""
													className="h-20 w-28 shrink-0 object-contain"
													loading="lazy"
													referrerPolicy="no-referrer"
												/>
											) : null}
											<div className="min-w-0 flex-1 space-y-1">
												<div className="flex items-start justify-between gap-2">
													<div className="flex min-w-0 items-center gap-2">
														{p.is_pinned ? (
															<span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
																<Pin className="h-3.5 w-3.5" />
																置顶
															</span>
														) : null}
														<a className="truncate text-lg font-semibold hover:underline" href={`/post.html?id=${p.id}`}>
															{p.title}
														</a>
													</div>
													{isAdmin ? (
														<div className="relative">
															<Button
																type="button"
																variant="ghost"
																size="sm"
																disabled={actionLoading}
																onMouseDown={(e) => e.stopPropagation()}
																onTouchStart={(e) => e.stopPropagation()}
																onClick={(e) => {
																	e.preventDefault();
																	e.stopPropagation();
																	setAdminMenuPostId((cur) => (cur === p.id ? null : p.id));
																}}
																aria-haspopup="menu"
																aria-expanded={menuOpen}
															>
																<MoreVertical className="h-4 w-4" />
																<span className="sr-only">更多</span>
															</Button>
															{menuOpen ? (
																<div
																	className="absolute right-0 top-full z-50 mt-1 w-40 rounded-md border bg-background p-1 shadow-md"
																	onMouseDown={(e) => e.stopPropagation()}
																	onTouchStart={(e) => e.stopPropagation()}
																	onClick={(e) => e.stopPropagation()}
																>
																	<button
																		type="button"
																		disabled={actionLoading}
																		className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
																		onClick={() => void adminTogglePin(p)}
																	>
																		<Pin className="h-4 w-4" />
																		{p.is_pinned ? '取消置顶' : '置顶'}
																	</button>
																	<button
																		type="button"
																		disabled={actionLoading}
																		className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
																		onClick={() => void adminDeletePost(p)}
																	>
																		<Trash2 className="h-4 w-4" />
																		删除
																	</button>
																	<div className="my-1 h-px bg-border" />
																	<div className="px-2 py-1 text-xs font-medium text-muted-foreground">移动到分类</div>
																	<button
																		type="button"
																		disabled={actionLoading}
																		className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
																		onClick={() => void adminMovePost(p, null)}
																	>
																		未分类
																	</button>
																	{categories.map((c) => (
																		<button
																			key={c.id}
																			type="button"
																			disabled={actionLoading}
																			className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
																			onClick={() => void adminMovePost(p, c.id)}
																		>
																			{c.name}
																		</button>
																	))}
																</div>
															) : null}
														</div>
													) : null}
												</div>
												<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
													<span className="inline-flex items-center gap-2">
														{p.author_avatar ? (
															<img
																src={p.author_avatar}
																alt=""
																className="h-6 w-6 rounded-full object-cover"
																loading="lazy"
																referrerPolicy="no-referrer"
															/>
														) : (
															<span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
																<User className="h-4 w-4" />
															</span>
														)}
														<span className="truncate text-foreground">{p.author_name}</span>
														{p.author_role === 'admin' ? (
															<span className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
																<Shield className="h-3 w-3" />
																<span className="sr-only">管理员</span>
															</span>
														) : null}
													</span>
													{p.category_name ? (
														<>
															<span>·</span>
															<span className="truncate">{p.category_name}</span>
														</>
													) : null}
													<span>·</span>
													<span className="whitespace-nowrap">{formatDate(p.created_at)}</span>
												</div>
												<div className="flex items-center gap-4 text-xs text-muted-foreground">
													<span className="inline-flex items-center gap-1">
														<Heart className="h-4 w-4 text-rose-600" />
														{p.like_count || 0}
													</span>
													<span className="inline-flex items-center gap-1">
														<MessageCircle className="h-4 w-4 text-sky-600" />
														{p.comment_count || 0}
													</span>
													<span className="inline-flex items-center gap-1">
														<Eye className="h-4 w-4 text-emerald-600" />
														{p.view_count || 0}
													</span>
												</div>
											</div>
										</div>
									</CardContent>
								</Card>
							);
						})
					)}
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage <= 1 || loading}
							onClick={() => fetchPosts(Math.max(0, pageOffset - pageLimit))}
						>
							<ChevronLeft className="h-4 w-4" />
							<span className="sr-only">上一页</span>
						</Button>
						<div className="flex items-center gap-1">
							{pages.map((p, idx) =>
								p === 'ellipsis' ? (
									<span key={`e-${idx}`} className="px-2 text-sm text-muted-foreground">
										…
									</span>
								) : (
									<Button
										key={p}
										variant={p === currentPage ? 'secondary' : 'outline'}
										size="sm"
										disabled={loading}
										onClick={() => fetchPosts((p - 1) * pageLimit)}
									>
										{p}
									</Button>
								)
							)}
						</div>
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage >= totalPages || loading}
							onClick={() => fetchPosts(pageOffset + pageLimit)}
						>
							<ChevronRight className="h-4 w-4" />
							<span className="sr-only">下一页</span>
						</Button>
					</div>
					<form
						className="flex items-center gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							const parsed = Number.parseInt(jumpTo, 10);
							if (!Number.isFinite(parsed)) return;
							const next = Math.min(Math.max(parsed, 1), totalPages);
							setJumpTo(String(next));
							fetchPosts((next - 1) * pageLimit);
						}}
					>
						<div className="text-sm text-muted-foreground">
							第 {currentPage} / {totalPages} 页
						</div>
						<Input
							value={jumpTo}
							onChange={(e) => setJumpTo(e.target.value)}
							inputMode="numeric"
							placeholder="跳页"
							className="h-9 w-20"
						/>
						<Button variant="outline" size="sm" type="submit" disabled={loading}>
							跳转
						</Button>
					</form>
				</div>
			</div>
		</PageShell>
	);
}
