import * as React from 'react';
import { AlignCenter, ArrowLeft, Bold, Cloud, Eye, EyeOff, Heart, Image, Indent, Italic, Lock, ExternalLink, MoreVertical, Pin, Pencil, Quote, Reply, Shield, Trash2, User, Video, X } from 'lucide-react';

import { TurnstileWidget } from '@/components/turnstile';
import { PageShell } from '@/components/page-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useConfig } from '@/hooks/use-config';
import { apiFetch, API_BASE, formatDate, getSecurityHeaders, type Category, type Comment, type Post } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { attachFancybox, highlightCodeBlocks, initVideoPosters, renderMarkdownToHtml } from '@/lib/markdown';
import { validateText } from '@/lib/validators';

export function PostPage() {
	const token = getToken();
	const user = React.useMemo(() => getUser(), [token]);
	const { config } = useConfig();
	const enabled = !!config?.turnstile_enabled;
	const siteKey = config?.turnstile_site_key || '';
	const turnstileActive = enabled && !!siteKey;

	const [post, setPost] = React.useState<Post | null>(null);
	const [comments, setComments] = React.useState<Comment[]>([]);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState('');

	const [newComment, setNewComment] = React.useState('');
	const [replyTo, setReplyTo] = React.useState<Comment | null>(null);
	const [commentLoading, setCommentLoading] = React.useState(false);
	const [commentError, setCommentError] = React.useState('');
	const [turnstileToken, setTurnstileToken] = React.useState('');
	const [turnstileResetKey, setTurnstileResetKey] = React.useState(0);

	const [isEditing, setIsEditing] = React.useState(false);
	const [editTitle, setEditTitle] = React.useState('');
	const [editContent, setEditContent] = React.useState('');
	const [editLoading, setEditLoading] = React.useState(false);
	const [editError, setEditError] = React.useState('');
	const [uploadLoading, setUploadLoading] = React.useState(false);
	const [uploadError, setUploadError] = React.useState('');
	const editContentRef = React.useRef<HTMLTextAreaElement | null>(null);

	// 加密附件（仅存网盘链接）
	const [attachments, setAttachments] = React.useState<any[]>([]);
	const [attachDialogOpen, setAttachDialogOpen] = React.useState(false);
	const [attachLinkUrl, setAttachLinkUrl] = React.useState('');
	const [attachFileName, setAttachFileName] = React.useState('');
	const [attachExtractCode, setAttachExtractCode] = React.useState('');
	const [attachPassword, setAttachPassword] = React.useState('');
	const [attachVerifyError, setAttachVerifyError] = React.useState('');
	const [verifiedLinks, setVerifiedLinks] = React.useState<Record<number, string>>({});
	const attEnabled = config?.encrypted_attachments_enabled === true;

	const [videoDialogOpen, setVideoDialogOpen] = React.useState(false);
	const [videoUrl, setVideoUrl] = React.useState('');
	const [cloudDialogOpen, setCloudDialogOpen] = React.useState(false);
	const [cloudLinkUrl, setCloudLinkUrl] = React.useState('');
	const [cloudLinkName, setCloudLinkName] = React.useState('');
	const [imageDialogOpen, setImageDialogOpen] = React.useState(false);
	const [imageUrl, setImageUrl] = React.useState('');

	function insertIntoEditContent(insertText: string) {
		if (editContentRef.current) {
			const el = editContentRef.current;
			const start = el.selectionStart;
			const end = el.selectionEnd;
			const before = editContent.slice(0, start);
			const after = editContent.slice(end);
			const updated = before + insertText + after;
			setEditContent(updated);
			setTimeout(() => {
				el.selectionStart = el.selectionEnd = start + insertText.length;
				el.focus();
			}, 0);
		} else {
			setEditContent(editContent + insertText);
		}
	}

	function applyEdit(transform: (text: string, start: number, end: number) => { text: string; selectionStart: number; selectionEnd: number }) {
		const el = editContentRef.current;
		const start = el ? el.selectionStart : editContent.length;
		const end = el ? el.selectionEnd : editContent.length;
		const result = transform(editContent, start, end);
		setEditContent(result.text);
		setTimeout(() => {
			const target = editContentRef.current;
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

	function insertEditBold() { wrapSelection('**', '**', '加粗文字'); }
	function insertEditItalic() { wrapSelection('*', '*', '斜体文字'); }
	function insertEditQuote() {
		transformLines((line) => `> ${line}`);
	}
	function insertEditCenter() {
		wrapSelection('<center>\n', '\n</center>', 'text');
	}
	function insertEditIndent() {
		applyEdit((text, start, end) => {
			const selected = text.slice(start, end) || '缩进内容';
			const indented = selected.split('\n').map(l => l ? '  ' + l : l).join('\n');
			const next = text.slice(0, start) + indented + text.slice(end);
			return { text: next, selectionStart: start, selectionEnd: start + indented.length };
		});
	}
	function formatEditParagraphIndent() {
		transformLines((line) => {
			if (!line.trim()) return line;
			if (line.startsWith('\u3000\u3000')) return line.replace(/^\u3000\u3000/, '');
			return `\u3000\u3000${line}`;
		});
	}
	function formatEditNovel() {
		applyEdit((text, start, end) => {
			const selected = text.slice(start, end) || text;
			const lines = selected.split('\n');
			const formatted = lines.map(line => {
				const trimmed = line.trim();
				if (/^(第[一二三四五六七八九十百千万\d]+[章节回部]|Chapter\s*\d+|#[#\s]|引子|楔子|序|尾声|后记)/.test(trimmed)) {
					return `\n**${trimmed}**\n`;
				}
				if (!trimmed) return '';
				return `\u3000\u3000${trimmed}`;
			}).join('\n');
			const next = text.slice(0, start) + formatted + text.slice(end);
			return { text: next, selectionStart: start, selectionEnd: start + formatted.length };
		});
	}
	function insertEditVideo() {
		if (!videoUrl.trim()) return;
		const url = videoUrl.trim();
		const isYouTube = url.includes('youtube.com/watch?v=') || url.includes('youtu.be/');
		const isBilibili = url.includes('bilibili.com/video/');
		if (isYouTube) {
			const match = url.match(/(?:v=|\/)([\w\-]{11})/);
			if (match) insertIntoEditContent(`\n<div class="youtube-embed"><iframe src="https://www.youtube.com/embed/${match[1]}" frameborder="0" allowfullscreen></iframe></div>\n`);
		} else if (isBilibili) {
			const match = url.match(/video\/(BV[\w]+)/);
			if (match) insertIntoEditContent(`\n<div class="bilibili-embed"><iframe src="https://player.bilibili.com/player.html?bvid=${match[1]}" frameborder="0" allowfullscreen></iframe></div>\n`);
		} else {
			insertIntoEditContent(`\n<div align="center">\n<video controls playsinline muted width="100%"><source src="${url}" type="video/mp4"></video>\n</div>\n`);
		}
		setVideoUrl('');
		setVideoDialogOpen(false);
	}
	function insertEditImageMarkdown() {
		const trimmed = imageUrl.trim();
		if (!trimmed) return;
		insertIntoEditContent(`\n![图片](${trimmed})\n`);
		setImageUrl('');
		setImageDialogOpen(false);
	}
	function insertEditCloudLink() {
		if (!cloudLinkUrl.trim()) return;
		insertIntoEditContent(`\n[${cloudLinkName.trim() || '网盘链接'}](${cloudLinkUrl.trim()})\n`);
		setCloudLinkUrl('');
		setCloudLinkName('');
		setCloudDialogOpen(false);
	}
	function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
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

	const contentRef = React.useRef<HTMLDivElement | null>(null);
	const [editPreviewOpen, setEditPreviewOpen] = React.useState(true);
	const editPreviewRef = React.useRef<HTMLDivElement | null>(null);
	const [adminMenuOpen, setAdminMenuOpen] = React.useState(false);
	const adminMenuRef = React.useRef<HTMLDivElement | null>(null);
	const [allCategories, setAllCategories] = React.useState<Category[]>([]);

	function getPostIdFromPath() {
		const params = new URLSearchParams(window.location.search);
		const q = params.get('id') || params.get('post_id');
		if (q && /^\d+$/.test(q)) return q;
		const m = window.location.pathname.match(/^\/posts\/(\d+)$/);
		if (m) return m[1];
		const m2 = window.location.pathname.match(/^\/post\/(\d+)$/);
		return m2 ? m2[1] : null;
	}

	const postId = getPostIdFromPath();

	const userId = user?.id ?? null;

	const refresh = React.useCallback(async () => {
		if (!postId) {
			setError('帖子不存在');
			setLoading(false);
			return;
		}
		setLoading(true);
		setError('');
		try {
			const userParam = userId ? `?user_id=${userId}` : '';
			const p = await apiFetch<Post>(`/posts/${postId}${userParam}`);
			const cs = await apiFetch<Comment[]>(`/posts/${postId}/comments`);
			setPost(p);
			setComments(cs);
			setEditTitle(p.title);
			setEditContent(p.content);
		} catch (e: any) {
			setError(String(e?.message || e));
		} finally {
			setLoading(false);
		}
	}, [postId, userId]);

	React.useEffect(() => {
		refresh();
	}, [refresh]);

	// 加载加密附件列表
	React.useEffect(() => {
		if (postId && attEnabled) {
			apiFetch<any[]>('/posts/' + postId + '/attachments', { headers: getSecurityHeaders('GET') })
				.then(setAttachments)
				.catch(() => {});
		}
	}, [postId, attEnabled]);

	// 保存网盘链接
	async function saveAttachmentLink() {
		if (!attachLinkUrl || !attachFileName) return;
		try {
			await apiFetch('/attachments', {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({
					postId,
					link_url: attachLinkUrl,
					file_name: attachFileName,
					extract_code: attachExtractCode,
					password: attachPassword
				})
			});
			setAttachDialogOpen(false);
			setAttachLinkUrl('');
			setAttachFileName('');
			setAttachExtractCode('');
			setAttachPassword('');
			const list = await apiFetch<any[]>('/posts/' + postId + '/attachments', { headers: getSecurityHeaders('GET') });
			setAttachments(list);
		} catch (e: any) {
			// 静默失败
		}
	}

	// 验证密码解锁链接
	async function verifyAttachmentLink(attId: number, password: string) {
		setAttachVerifyError('');
		try {
			const data = await apiFetch<{ link_url: string }>('/attachments/' + attId + '/verify', {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({ password })
			});
			setVerifiedLinks(v => ({ ...v, [attId]: data.link_url }));
		} catch (e: any) {
			setAttachVerifyError(String(e?.message || e));
		}
	}

	React.useEffect(() => {
		void apiFetch<Category[]>('/categories')
			.then((list) => setAllCategories(Array.isArray(list) ? list : []))
			.catch(() => setAllCategories([]));
	}, []);

	React.useEffect(() => {
		if (isEditing) return;
		const el = contentRef.current;
		if (!el) return;
		highlightCodeBlocks(el);
		initVideoPosters(el);
		const cleanup = attachFancybox(el);
		return cleanup;
	}, [post, comments.length, isEditing]);

	React.useEffect(() => {
		if (!isEditing) return;
		if (!editPreviewOpen) return;
		const el = editPreviewRef.current;
		if (!el) return;
		highlightCodeBlocks(el);
		initVideoPosters(el);
		const cleanup = attachFancybox(el);
		return cleanup;
	}, [isEditing, editPreviewOpen, editContent]);

	React.useEffect(() => {
		if (!adminMenuOpen) return;
		function onPointerDown(e: MouseEvent | TouchEvent) {
			const target = e.target as Node | null;
			if (!target) return;
			const menu = adminMenuRef.current;
			if (menu && !menu.contains(target)) setAdminMenuOpen(false);
		}
		document.addEventListener('mousedown', onPointerDown);
		document.addEventListener('touchstart', onPointerDown);
		return () => {
			document.removeEventListener('mousedown', onPointerDown);
			document.removeEventListener('touchstart', onPointerDown);
		};
	}, [adminMenuOpen]);

	function organizeComments(list: Comment[]) {
		const roots: Array<Comment & { replies?: Comment[] }> = [];
		const map = new Map<number, Comment & { replies?: Comment[] }>();
		list.forEach((c) => map.set(c.id, { ...c, replies: [] }));
		map.forEach((c) => {
			if (c.parent_id && map.has(c.parent_id)) map.get(c.parent_id)!.replies!.push(c);
			else roots.push(c);
		});
		return roots;
	}

	async function toggleLike() {
		if (!post) return;
		if (!user) {
			window.location.href = '/login';
			return;
		}
		try {
			const data = await apiFetch<{ liked: boolean }>(`/posts/${post.id}/like`, {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({})
			});
			setPost((prev) =>
				prev
					? {
							...prev,
							liked: data.liked,
							like_count: (prev.like_count || 0) + (data.liked ? 1 : -1)
						}
					: prev
			);
		} catch {
			return;
		}
	}

	async function submitComment(e: React.FormEvent) {
		e.preventDefault();
		if (!postId) return;
		if (!user) {
			window.location.href = '/login';
			return;
		}
		setCommentError('');
		const err = validateText(newComment, '评论');
		if (err) return setCommentError(err);
		if (newComment.length > 3000) return setCommentError('评论过长 (最多 3000 字符)');
		if (turnstileActive && !turnstileToken) return setCommentError('请完成验证码验证');

		setCommentLoading(true);
		try {
			await apiFetch(`/posts/${postId}/comments`, {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({
					content: newComment,
					parent_id: replyTo ? replyTo.id : null,
					'cf-turnstile-response': turnstileToken
				})
			});
			setNewComment('');
			setReplyTo(null);
			setTurnstileToken('');
			setTurnstileResetKey((v) => v + 1);
			await refresh();
		} catch (e: any) {
			setCommentError(String(e?.message || e));
			setTurnstileToken('');
			setTurnstileResetKey((v) => v + 1);
		} finally {
			setCommentLoading(false);
		}
	}

	async function deleteComment(id: number) {
		if (!confirm('确定要删除此评论吗？此操作无法撤销。')) return;
		try {
			await apiFetch(`/comments/${id}`, {
				method: 'DELETE',
				headers: getSecurityHeaders('DELETE')
			});
			await refresh();
		} catch (e: any) {
			alert(String(e?.message || e));
		}
	}

	async function deletePost() {
		if (!post) return;
		if (!confirm('确定要删除这个帖子吗？此操作无法撤销。')) return;
		try {
			const isAdmin = user?.role === 'admin';
			const path = isAdmin ? `/admin/posts/${post.id}` : `/posts/${post.id}`;
			await apiFetch(path, {
				method: 'DELETE',
				headers: getSecurityHeaders('DELETE')
			});
			window.location.href = '/';
		} catch (e: any) {
			alert(String(e?.message || e));
		}
	}

	async function togglePin() {
		if (!post) return;
		if (!user || user.role !== 'admin') return;
		try {
			const next = !post.is_pinned;
			await apiFetch(`/admin/posts/${post.id}/pin`, {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({ pinned: next })
			});
			setPost((prev) => (prev ? { ...prev, is_pinned: next ? 1 : 0 } : prev));
		} catch {
			return;
		} finally {
			setAdminMenuOpen(false);
		}
	}

	async function adminMovePostCategory(categoryId: number | null) {
		if (!post) return;
		if (!user || user.role !== 'admin') return;
		try {
			await apiFetch(`/admin/posts/${post.id}/move`, {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({ category_id: categoryId })
			});
			setAdminMenuOpen(false);
			await refresh();
		} catch {
			return;
		}
	}

	async function saveEdit() {
		if (!post) return;
		setEditError('');
		const titleErr = validateText(editTitle, '标题');
		if (titleErr) return setEditError(titleErr);
		const contentErr = validateText(editContent, '内容');
		if (contentErr) return setEditError(contentErr);
		if (editTitle.length > 30) return setEditError('标题过长 (最多 30 字符)');
		if (editContent.length > 3000) return setEditError('内容过长 (最多 3000 字符)');

		setEditLoading(true);
		try {
			await apiFetch(`/posts/${post.id}`, {
				method: 'PUT',
				headers: getSecurityHeaders('PUT'),
				body: JSON.stringify({ title: editTitle, content: editContent, category_id: post.category_id })
			});
			setIsEditing(false);
			await refresh();
		} catch (e: any) {
			setEditError(String(e?.message || e));
		} finally {
			setEditLoading(false);
		}
	}

	return (
		<PageShell>
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<Button asChild variant="ghost" size="sm">
						<a href="/">
							<ArrowLeft className="h-4 w-4" />
							<span className="sr-only">返回首页</span>
						</a>
					</Button>
				</div>

				{error ? <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}

				{loading ? (
					<Card>
						<CardContent className="py-6 text-sm text-muted-foreground">加载中...</CardContent>
					</Card>
				) : !post ? (
					<Card>
						<CardContent className="py-6 text-sm text-muted-foreground">帖子不存在</CardContent>
					</Card>
				) : (
					<>
						<Card>
							<CardHeader>
								<CardTitle className="flex flex-col gap-2">
									<span>{post.title}</span>
									<span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-normal text-muted-foreground">
										<span className="inline-flex items-center gap-2">
											{post.author_avatar ? (
												<img
													src={post.author_avatar}
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
											<span className="text-foreground">{post.author_name}</span>
											{post.author_role === 'admin' ? (
												<span className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
													<Shield className="h-3 w-3" />
													<span className="sr-only">管理员</span>
												</span>
											) : null}
										</span>
										<span>·</span>
										<span className="whitespace-nowrap">{formatDate(post.created_at)}</span>
									</span>
								</CardTitle>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="flex flex-wrap items-center gap-2">
									{config?.feature_likes !== false ? (
									<div>
									<Button variant={post.liked ? 'secondary' : 'outline'} size="sm" onClick={toggleLike} disabled={!user}>
										<Heart className="h-4 w-4 text-rose-600" fill={post.liked ? 'currentColor' : 'none'} />
										<span className="tabular-nums">{post.like_count || 0}</span>
										<span className="sr-only">{post.liked ? '取消点赞' : '点赞'}</span>
									</Button>
									</div>
								) : null}
									<span className="inline-flex items-center gap-1 rounded-md border bg-muted/20 px-2 py-1 text-xs text-muted-foreground">
										<Eye className="h-4 w-4 text-emerald-600" />
										<span className="tabular-nums">{post.view_count || 0}</span>
										<span className="sr-only">观看数</span>
									</span>

									{user && (user.role === 'admin' || user.id === post.author_id) ? (
										<>
											<Button variant="outline" size="sm" onClick={() => setIsEditing((v) => !v)}>
												{isEditing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
												<span className="sr-only">{isEditing ? '取消编辑' : '编辑'}</span>
											</Button>
										</>
									) : null}

									{user && (user.role === 'admin' || user.id === post.author_id) ? (
										<div className="relative" ref={adminMenuRef}>
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={() => setAdminMenuOpen((v) => !v)}
												aria-haspopup="menu"
												aria-expanded={adminMenuOpen}
											>
												<MoreVertical className="h-4 w-4" />
												<span className="sr-only">更多</span>
											</Button>
											{adminMenuOpen ? (
												<div className="absolute right-0 top-full z-50 mt-2 w-44 rounded-md border bg-background p-1 shadow-md">
													{user.role === 'admin' ? (
														<button
															type="button"
															className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
															onClick={togglePin}
														>
															<Pin className="h-4 w-4" />
															{post.is_pinned ? '取消置顶' : '置顶'}
														</button>
													) : null}
													<button
														type="button"
														className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
														onClick={() => {
															setAdminMenuOpen(false);
															void deletePost();
														}}
													>
														<Trash2 className="h-4 w-4" />
														删除
													</button>
													{user.role === 'admin' ? (
														<>
															<div className="my-1 h-px bg-border" />
															<div className="px-2 py-1 text-xs font-medium text-muted-foreground">移动到分类</div>
															<button
																type="button"
																className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
																onClick={() => void adminMovePostCategory(null)}
															>
																未分类
															</button>
															{allCategories.map((c) => (
																<button
																	key={c.id}
																	type="button"
																	className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
																	onClick={() => void adminMovePostCategory(c.id)}
																>
																	{c.name}
																</button>
															))}
														</>
													) : null}
												</div>
											) : null}
										</div>
									) : null}
								</div>

								{isEditing ? (
									<div className="space-y-3">
										{editError ? <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{editError}</div> : null}
										<div className="space-y-2">
											<Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={60} />
										</div>
										<div className="space-y-2">
											<div className="flex flex-wrap items-center justify-between gap-2">
												<Label>内容 (支持 Markdown)</Label>
												<div className="flex flex-wrap items-center gap-1">
													<span className="text-xs text-muted-foreground mr-1">快捷键：Ctrl+B/I/K</span>
													<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="加粗 Ctrl+B" onClick={insertEditBold}>
														<Bold className="h-3.5 w-3.5" />
													</Button>
													<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="斜体 Ctrl+I" onClick={insertEditItalic}>
														<Italic className="h-3.5 w-3.5" />
													</Button>
													<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="引用" onClick={insertEditQuote}>
														<Quote className="h-3.5 w-3.5" />
													</Button>
													<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="居中" onClick={insertEditCenter}>
														<AlignCenter className="h-3.5 w-3.5" />
													</Button>
													<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="增加缩进" onClick={insertEditIndent}>
														<Indent className="h-3.5 w-3.5" />
													</Button>
													<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="首行缩进（全角空格）" onClick={formatEditParagraphIndent}>
														<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12H9"/><path d="M21 6H3"/><path d="M21 18H3"/><polyline points="7 8 3 12 7 16"/></svg>
													</Button>
													<Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" title="小说格式化（章标题+首行缩进）" onClick={formatEditNovel}>
														<span className="text-[10px] font-medium">Aa</span>
													</Button>
													<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="插入视频" onClick={() => setVideoDialogOpen(true)}>
														<Video className="h-3.5 w-3.5" />
													</Button>
													<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="插入图片链接" onClick={() => setImageDialogOpen(true)}>
														<Image className="h-3.5 w-3.5" />
													</Button>
													<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="插入网盘链接" onClick={() => setCloudDialogOpen(true)}>
														<Cloud className="h-3.5 w-3.5" />
													</Button>
													<Button type="button" variant="outline" size="sm" onClick={() => setEditPreviewOpen((v) => !v)}>
														{editPreviewOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
														<span className="sr-only">{editPreviewOpen ? '关闭预览' : '打开预览'}</span>
													</Button>
												</div>
											</div>
											<div className="text-xs text-muted-foreground">Ctrl+T 表格，Ctrl+Shift+M 公式，Ctrl+Shift+Q 引用，Alt+Shift+5 删除线</div>
											<Textarea ref={editContentRef} value={editContent} onChange={(e) => setEditContent(e.target.value)} onKeyDown={handleEditKeyDown} rows={10} />
										</div>
                        {/* upload image when editing */}
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-muted-foreground">上传图片</label>
                            <input
                                type="file"
                                accept="image/*"
                                className="block w-full text-sm"
                                onChange={async (e) => {
                                    const file = e.target.files && e.target.files[0];
                                    if (!file) return;
                                    setEditError('');
                                    if (file.size > 2 * 1024 * 1024) {
                                        setEditError('文件过大 (最大 2MB)');
                                        return;
                                    }
                                    setUploadLoading(true);
                                    try {
                                        const formData = new FormData();
                                        formData.append('file', file);
                                        formData.append('type', 'post');
                                        const res = await fetch(`${API_BASE}/upload`, {
                                            method: 'POST',
                                            headers: getSecurityHeaders('POST', null),
                                            body: formData,
                                        });
                                        const data = await res.json();
                                        if (!res.ok) throw new Error(data?.error || '上传失败');
                                        // insert link at cursor and show preview
                                        insertIntoEditContent(`

![](${data.url})

`);
                                        setEditPreviewOpen(true);
                                    } catch (err: any) {
                                        setEditError(String(err?.message || err));
                                    } finally {
                                        setUploadLoading(false);
                                    }
                                }}
                            />
                            {uploadError ? <div className="text-sm text-destructive">{uploadError}</div> : null}
                            {uploadLoading ? <div className="text-sm text-muted-foreground">上传中…</div> : null}
                        </div>
										{editPreviewOpen ? (
<div className="w-full rounded-md border bg-muted/20 p-3">
												<div className="mb-2 text-xs font-medium text-muted-foreground">预览</div>
												<div
													ref={editPreviewRef}
													className="prose max-w-none break-words [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1"
													dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(editContent || '', config?.r2_public_url) }}
												/>
											</div>
										) : null}
										<Button onClick={saveEdit} disabled={editLoading}>
											{editLoading ? '保存中...' : '保存'}
										</Button>
									</div>
								) : (
									<div
										className="w-full prose !max-w-none break-words [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1"
										ref={contentRef}
										dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(post.content || '', config?.r2_public_url) }}
									/>
								)}
							</CardContent>
						</Card>

						<Dialog open={attachDialogOpen} onOpenChange={setAttachDialogOpen}>
							<DialogContent className="sm:max-w-md">
								<DialogHeader><DialogTitle>录入网盘链接</DialogTitle></DialogHeader>
								<div className="space-y-4 py-2">
									<div className="space-y-2">
										<Label>网盘链接 <span className="text-xs text-muted-foreground">（必填）</span></Label>
										<Input value={attachLinkUrl} onChange={(e) => setAttachLinkUrl(e.target.value)} placeholder="https://pan.baidu.com/s/..." />
									</div>
									<div className="space-y-2">
										<Label>文件名称 <span className="text-xs text-muted-foreground">（必填）</span></Label>
										<Input value={attachFileName} onChange={(e) => setAttachFileName(e.target.value)} placeholder="如: 项目资料.zip" />
									</div>
									<div className="space-y-2">
										<Label>提取码 <span className="text-xs text-muted-foreground">（可选）</span></Label>
										<Input value={attachExtractCode} onChange={(e) => setAttachExtractCode(e.target.value)} placeholder="如: abc123" />
									</div>
									<div className="space-y-2">
										<Label>访问密码 <span className="text-xs text-muted-foreground">（可选，用户查看链接时需要输入）</span></Label>
										<Input type="password" value={attachPassword} onChange={(e) => setAttachPassword(e.target.value)} placeholder="留空则公开" />
									</div>
								</div>
								<DialogFooter>
									<Button variant="outline" onClick={() => setAttachDialogOpen(false)}>取消</Button>
									<Button onClick={saveAttachmentLink} disabled={!attachLinkUrl || !attachFileName}>保存</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>

						<Dialog open={videoDialogOpen} onOpenChange={setVideoDialogOpen}>
							<DialogContent className="sm:max-w-md">
								<DialogHeader><DialogTitle>插入视频</DialogTitle></DialogHeader>
								<div className="space-y-4 py-2">
									<div className="space-y-2">
										<Label htmlFor="edit-video-url">视频链接</Label>
										<Input id="edit-video-url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://... 或 YouTube/B站链接" />
									</div>
								</div>
								<DialogFooter>
									<Button variant="outline" onClick={() => setVideoDialogOpen(false)}>取消</Button>
									<Button onClick={insertEditVideo} disabled={!videoUrl.trim()}>插入</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>

						<Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
							<DialogContent className="sm:max-w-md">
								<DialogHeader><DialogTitle>插入图片链接</DialogTitle></DialogHeader>
								<div className="space-y-4 py-2">
									<div className="space-y-2">
										<Label htmlFor="edit-image-url">图片链接</Label>
										<Input id="edit-image-url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://example.com/image.jpg" />
									</div>
								</div>
								<DialogFooter>
									<Button variant="outline" onClick={() => setImageDialogOpen(false)}>取消</Button>
									<Button onClick={insertEditImageMarkdown} disabled={!imageUrl.trim()}>插入</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>

						<Dialog open={cloudDialogOpen} onOpenChange={setCloudDialogOpen}>
							<DialogContent className="sm:max-w-md">
								<DialogHeader><DialogTitle>插入网盘链接</DialogTitle></DialogHeader>
								<div className="space-y-4 py-2">
									<div className="space-y-2">
										<Label htmlFor="edit-cloud-url">链接地址</Label>
										<Input id="edit-cloud-url" value={cloudLinkUrl} onChange={(e) => setCloudLinkUrl(e.target.value)} placeholder="https://..." />
									</div>
									<div className="space-y-2">
										<Label htmlFor="edit-cloud-name">显示名称</Label>
										<Input id="edit-cloud-name" value={cloudLinkName} onChange={(e) => setCloudLinkName(e.target.value)} placeholder="网盘链接" />
									</div>
								</div>
								<DialogFooter>
									<Button variant="outline" onClick={() => setCloudDialogOpen(false)}>取消</Button>
									<Button onClick={insertEditCloudLink} disabled={!cloudLinkUrl.trim()}>插入</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>

						{attEnabled && attachments.length > 0 ? (
						<Card>
							<CardHeader><CardTitle>📁 网盘附件</CardTitle></CardHeader>
							<CardContent className="space-y-3">
								{attachments.map((att: any) => (
									<div key={att.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
										<div className="flex items-center gap-3">
											<Lock className="h-5 w-5 shrink-0 text-muted-foreground" />
											<div className="min-w-0">
												<div className="truncate text-sm font-medium">{att.file_name}</div>
												<div className="text-xs text-muted-foreground">
													{att.has_password ? '🔒 需密码访问' : '🔓 公开'}
													{att.extract_code ? ` · 提取码: ${att.extract_code}` : ''}
												</div>
											</div>
										</div>
										{verifiedLinks[att.id] ? (
											<a href={verifiedLinks[att.id]} target="_blank" rel="noopener noreferrer">
												<Button size="sm" variant="outline" className="w-full sm:w-auto"><ExternalLink className="h-4 w-4" /> 打开链接</Button>
											</a>
										) : att.has_password ? (
											<div className="flex w-full items-center gap-2 sm:w-auto">
												<Input type="password" placeholder="密码" className="h-9 flex-1 text-xs sm:w-28" id={'pwd-' + att.id} />
												<Button size="sm" variant="outline" className="shrink-0" onClick={() => {
													const input = document.getElementById('pwd-' + att.id) as HTMLInputElement;
													if (input?.value) verifyAttachmentLink(att.id, input.value);
												}}><Lock className="h-4 w-4" /> 解锁</Button>
												{attachVerifyError ? <span className="text-xs text-destructive">{attachVerifyError}</span> : null}
											</div>
										) : (
											<a href={att.link_url} target="_blank" rel="noopener noreferrer">
												<Button size="sm" variant="outline" className="w-full sm:w-auto"><ExternalLink className="h-4 w-4" /> 打开链接</Button>
											</a>
										)}
									</div>
								))}
							</CardContent>
						</Card>
						) : null}

						{/* 加密附件录入按钮（工具栏附属） */}
						{attEnabled && user ? (
						<div className="flex justify-end">
							<Button variant="outline" size="sm" onClick={() => setAttachDialogOpen(true)}>
								<Lock className="h-4 w-4" /> 添加网盘链接
							</Button>
						</div>
						) : null}

						{config?.feature_comments !== false ? (
						<div>
						<Card>
							<CardHeader>
								<CardTitle>评论</CardTitle>
							</CardHeader>
							<CardContent className="space-y-4">
								{comments.length === 0 ? (
									<div className="text-sm text-muted-foreground">暂无评论</div>
								) : (
									<div className="space-y-3">
										{organizeComments(comments).map((c) => (
											<div key={c.id} className="rounded-md border p-3">
												<div className="flex items-center justify-between gap-2">
													<div className="text-sm">
														<span className="inline-flex items-center gap-2">
															{c.avatar_url ? (
																<img
																	src={c.avatar_url}
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
															<span className="font-medium text-foreground">{c.username}</span>
															{c.role === 'admin' ? (
																<span className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
																	<Shield className="h-3 w-3" />
																	<span className="sr-only">管理员</span>
																</span>
															) : null}
															<span className="text-muted-foreground">{formatDate(c.created_at)}</span>
														</span>
													</div>
													<div className="flex items-center gap-2">
														<Button variant="ghost" size="sm" onClick={() => setReplyTo(c)}>
															<Reply className="h-4 w-4" />
															<span className="sr-only">回复</span>
														</Button>
														{user && (user.role === 'admin' || user.id === c.author_id) ? (
															<Button variant="ghost" size="sm" onClick={() => deleteComment(c.id)}>
																<Trash2 className="h-4 w-4" />
																<span className="sr-only">删除</span>
															</Button>
														) : null}
													</div>
												</div>
												<div className="mt-2 whitespace-pre-wrap text-sm">{c.content}</div>
												{c.replies && c.replies.length ? (
													<div className="mt-3 space-y-2 border-l pl-3">
														{c.replies.map((r) => (
															<div key={r.id} className="rounded-md bg-muted/30 p-2">
																<div className="flex items-center justify-between gap-2">
																	<div className="text-xs">
																		<span className="inline-flex items-center gap-2">
																			{r.avatar_url ? (
																				<img
																					src={r.avatar_url}
																					alt=""
																					className="h-5 w-5 rounded-full object-cover"
																					loading="lazy"
																					referrerPolicy="no-referrer"
																				/>
																			) : (
																				<span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
																					<User className="h-3.5 w-3.5" />
																				</span>
																			)}
																			<span className="font-medium text-foreground">{r.username}</span>
																			{r.role === 'admin' ? (
																				<span className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-1 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300">
																					<Shield className="h-3 w-3" />
																					<span className="sr-only">管理员</span>
																				</span>
																			) : null}
																			<span className="text-muted-foreground">{formatDate(r.created_at)}</span>
																		</span>
																	</div>
																	{user && (user.role === 'admin' || user.id === r.author_id) ? (
																		<Button variant="ghost" size="sm" onClick={() => deleteComment(r.id)}>
																			<Trash2 className="h-4 w-4" />
																			<span className="sr-only">删除</span>
																		</Button>
																	) : null}
																</div>
																<div className="mt-1 whitespace-pre-wrap text-sm">{r.content}</div>
															</div>
														))}
													</div>
												) : null}
											</div>
										))}
									</div>
								)}

								{replyTo ? (
									<div className="flex items-center justify-between rounded-md border bg-muted/30 p-2 text-sm">
										<span>
											回复 <span className="font-medium">{replyTo.username}</span>
										</span>
										<Button variant="ghost" size="sm" onClick={() => setReplyTo(null)}>
											取消
										</Button>
									</div>
								) : null}

								<form className="space-y-3" onSubmit={submitComment}>
									{commentError ? <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{commentError}</div> : null}
									<Textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} rows={4} placeholder="写下你的评论..." />
						<TurnstileWidget enabled={turnstileActive} siteKey={siteKey} onToken={setTurnstileToken} resetKey={turnstileResetKey} />
									<div className="flex items-center gap-2">
										<Button type="submit" disabled={commentLoading}>
											{commentLoading ? '发布中...' : '发布评论'}
										</Button>
										{!user ? (
											<Button type="button" variant="outline" onClick={() => (window.location.href = '/login')}>
												登录后评论
											</Button>
										) : null}
									</div>
								</form>
							</CardContent>
						</Card>
						</div>
						) : null}
					</>
				)}
			</div>
		</PageShell>
	);
}
