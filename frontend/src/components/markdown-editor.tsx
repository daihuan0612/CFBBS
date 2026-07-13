import React, { useRef, useState, useEffect, useCallback } from 'react';
import { EditorView, keymap, placeholder, highlightSpecialChars } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { API_BASE, getSecurityHeaders } from '@/lib/api';
import { renderMarkdownToHtml } from '@/lib/markdown';
import 'remixicon/fonts/remixicon.css';

interface MarkdownEditorProps {
	content: string;
	setContent: (content: string) => void;
	placeholder?: string;
	r2PublicUrl?: string;
}

/**
 * CodeMirror 6 + Markdown Toolbar editor for CFBBS.
 */
export function MarkdownEditor({ content, setContent, placeholder: ph, r2PublicUrl }: MarkdownEditorProps) {
	const editorRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const [isDark, setIsDark] = React.useState(false);
	const [uploadLoading, setUploadLoading] = React.useState(false);

	// Dialog states
	const [videoDialogOpen, setVideoDialogOpen] = React.useState(false);
	const [videoUrl, setVideoUrl] = React.useState('');
	const [imageDialogOpen, setImageDialogOpen] = React.useState(false);
	const [imageUrl, setImageUrl] = React.useState('');
	const [cloudDialogOpen, setCloudDialogOpen] = React.useState(false);
	const [cloudUrl, setCloudUrl] = React.useState('');
	const [cloudName, setCloudName] = React.useState('');
	const [cloudPwd, setCloudPwd] = React.useState('');

	// Preview
	const themeComp = useRef(new Compartment());
	const previewRef = useRef<HTMLDivElement>(null);

	// Detect dark mode
	useEffect(() => {
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		setIsDark(mq.matches);
		const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
		mq.addEventListener('change', handler);
		return () => mq.removeEventListener('change', handler);
	}, []);

	// Get current selection (text + range)
	const getSelection = useCallback(() => {
		const view = viewRef.current;
		if (!view) return null;
		const sel = view.state.selection.main;
		const text = view.state.sliceDoc(sel.from, sel.to - sel.from);
		return { from: sel.from, to: sel.to, text };
	}, []);

	// Replace selection or insert at cursor
	const replaceSelection = useCallback((insertText: string, selectFrom?: number, selectTo?: number) => {
		const view = viewRef.current;
		if (!view) return;
		const sel = view.state.selection.main;
		const from = sel.from;
		const to = sel.to;
		view.dispatch({
			changes: { from, to, insert: insertText },
			selection: selectFrom !== undefined && selectTo !== undefined
				? { anchor: selectFrom, head: selectTo }
				: { anchor: from + insertText.length }
		});
		view.focus();
		setContent(view.state.doc.toString());
	}, [setContent]);

	// Wrap selection with prefix/suffix
	const wrapSelection = useCallback((prefix: string, suffix: string, fallback: string) => {
		const sel = getSelection();
		if (!sel) return;
		const inner = sel.text || fallback;
		const insertText = `${prefix}${inner}${suffix}`;
		const from = sel.from + prefix.length;
		const to = from + inner.length;
		replaceSelection(insertText, from, to);
	}, [getSelection, replaceSelection]);

	// Format each selected line
	const formatLines = useCallback((formatter: (line: string, index: number) => string, fallbackLine: string) => {
		const view = viewRef.current;
		if (!view) return;
		const sel = view.state.selection.main;
		const doc = view.state.doc;
		const startLine = doc.lineAt(sel.from);
		const endLine = doc.lineAt(sel.to);
		const lines: string[] = [];
		for (let i = startLine.number; i <= endLine.number; i++) {
			const line = doc.line(i);
			lines.push(formatter(line.text, i - startLine.number));
		}
		const insertText = lines.join('\n');
		view.dispatch({
			changes: {
				from: startLine.from,
				to: endLine.to,
				insert: insertText
			},
			selection: { anchor: startLine.from + insertText.length }
		});
		view.focus();
		setContent(view.state.doc.toString());
	}, [setContent]);

	// --- Toolbar actions ---

	const insertBold = useCallback(() => {
		const view = viewRef.current;
		if (!view) return;
		const sel = view.state.selection.main;
		const text = view.state.sliceDoc(sel.from, sel.to - sel.from) || '粗体文字';
		view.dispatch({
			changes: { from: sel.from, to: sel.to, insert: `**${text}**` },
			selection: { anchor: sel.from + 2, head: sel.from + 2 + text.length }
		});
		view.focus();
		setContent(view.state.doc.toString());
	}, [setContent]);
	const insertItalic = useCallback(() => wrapSelection('*', '*', '斜体'), [wrapSelection]);
	const insertLink = useCallback(() => {
		const sel = getSelection();
		if (!sel) return;
		const text = sel.text || '链接文字';
		const url = '链接URL';
		const insertText = `[${text}](${url})`;
		const linkStart = sel.from + text.length + 3;
		replaceSelection(insertText, linkStart, linkStart + url.length);
	}, [getSelection, replaceSelection]);
	const insertQuote = useCallback(() => {
		formatLines((line) => line.startsWith('> ') ? line : `> ${line}`, '> 引用');
	}, [formatLines]);
	const insertList = useCallback(() => {
		formatLines((line, i) => {
			if (line.match(/^\s*[-*]\s/)) return line;
			return `- ${line}`;
		}, '- 列表项');
	}, [formatLines]);
	const insertOrderedList = useCallback(() => {
		formatLines((line, i) => {
			if (line.match(/^\s*\d+\.\s/)) return line;
			return `${i + 1}. ${line}`;
		}, '1. 列表项');
	}, [formatLines]);
	const insertCode = useCallback(() => wrapSelection('`', '`', '代码'), [wrapSelection]);
	const insertCodeBlock = useCallback(() => {
		const sel = getSelection();
		if (!sel) return;
		const text = sel.text || '代码';
		replaceSelection(`\`\`\`\n${text}\n\`\`\``);
	}, [getSelection, replaceSelection]);
	const insertHR = useCallback(() => replaceSelection('\n---\n'), [replaceSelection]);
	const insertCenter = useCallback(() => wrapSelection('<center>', '</center>', '居中'), [wrapSelection]);
	const insertIndent = useCallback(() => wrapSelection('\t', '', ''), [wrapSelection]);

	// Paragraph indent (全角空格)
	const insertParagraphIndent = useCallback(() => {
		const view = viewRef.current;
		if (!view) return;
		const sel = view.state.selection.main;
		const doc = view.state.doc;
		const startLine = doc.lineAt(sel.from);
		const endLine = doc.lineAt(sel.to);
		const changes: { from: number; to: number; insert: string }[] = [];
		for (let i = startLine.number; i <= endLine.number; i++) {
			const line = doc.line(i);
			const trimmed = line.text.trim();
			if (!trimmed) continue;
			if (trimmed.startsWith('\u3000\u3000')) continue;
			changes.push({ from: line.from, to: line.from, insert: '\u3000\u3000' });
		}
		if (changes.length === 0) return;
		view.dispatch({ changes });
		view.focus();
		setContent(view.state.doc.toString());
	}, [setContent]);

	// Novel format (章节标题加粗 + 首行缩进)
	const insertNovelFormat = useCallback(() => {
		const view = viewRef.current;
		if (!view) return;
		const doc = view.state.doc;
		const changes: { from: number; to: number; insert: string }[] = [];
		for (let i = 1; i <= doc.lines; i++) {
			const line = doc.line(i);
			const trimmed = line.text.trim();
			if (!trimmed) {
				if (line.text.length > 0) changes.push({ from: line.from, to: line.to, insert: '' });
				continue;
			}
			if (/^(第[一二三四五六七八九十百千万\d]+[章节回部]|Chapter\s*\d+|#[#\s]|引子|楔子|序|尾声|后记)/.test(trimmed)) {
				// Chapter title: bold + keep
				const newText = `**${trimmed}**`;
				if (line.text !== newText) changes.push({ from: line.from, to: line.to, insert: newText });
			} else {
				// Normal paragraph: first-line indent (if not already)
				if (!trimmed.startsWith('\u3000\u3000') && !trimmed.startsWith('>') && !trimmed.startsWith('-') && !trimmed.startsWith('*')) {
					changes.push({ from: line.from, to: line.from, insert: '\u3000\u3000' });
				}
			}
		}
		if (changes.length === 0) return;
		view.dispatch({ changes });
		view.focus();
		setContent(view.state.doc.toString());
	}, [setContent]);

	// Initialize CodeMirror
	useEffect(() => {
		if (!editorRef.current) return;

		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				setContent(update.state.doc.toString());
			}
		});

		// Custom key bindings for Ctrl+B, Ctrl+I, Ctrl+K
		const customKeymap = keymap.of([
			{ key: 'Mod-b', run: () => { insertBold(); return true; } },
			{ key: 'Mod-i', run: () => { insertItalic(); return true; } },
			{ key: 'Mod-k', run: () => { insertLink(); return true; } },
		]);

		const state = EditorState.create({
			doc: content,
			extensions: [
				highlightSpecialChars(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				history(),
				markdown({ base: markdownLanguage }),
				syntaxHighlighting(defaultHighlightStyle),
				placeholder(ph || '写下你的内容...'),
				themeComp.current.of(isDark ? oneDark : []),
				updateListener,
				EditorView.lineWrapping,
				customKeymap,
			]
		});

		const view = new EditorView({
			state,
			parent: editorRef.current,
		});

		viewRef.current = view;

		return () => {
			view.destroy();
			viewRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Update theme when dark mode changes
	useEffect(() => {
		if (viewRef.current) {
			viewRef.current.dispatch({
				effects: themeComp.current.reconfigure(isDark ? oneDark : [])
			});
		}
	}, [isDark]);

	// Sync content from external changes (e.g., when switching posts)
	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const current = view.state.doc.toString();
		if (current !== content) {
			view.dispatch({
				changes: { from: 0, to: current.length, insert: content }
			});
		}
	}, [content]);

	// --- Dialog handlers ---

	const handleInsertVideo = useCallback(() => {
		if (!videoUrl.trim()) return;
		const url = videoUrl.trim();
		let embedHtml = '';

		// Bilibili
		if (url.includes('bilibili.com') || url.includes('b23.tv')) {
			const bvMatch = url.match(/BV[a-zA-Z0-9]+/);
			const avMatch = url.match(/\/av(\d+)/);
			const params = new URLSearchParams();
			if (bvMatch) params.set('bvid', bvMatch[0]);
			if (avMatch) params.set('aid', avMatch[1]);
			if (bvMatch || avMatch) {
				params.set('page', '1');
				const src = `//player.bilibili.com/player.html?${params.toString()}&high_quality=1&danmaku=0`;
				embedHtml = `<iframe src="${src}" allowfullscreen></iframe>`;
			}
		}
		// YouTube
		else if (url.includes('youtube.com') || url.includes('youtu.be')) {
			let videoId = '';
			try {
				const u = new URL(url);
				if (u.hostname === 'youtu.be') videoId = u.pathname.slice(1);
				else if (u.pathname === '/watch') videoId = u.searchParams.get('v') || '';
			} catch { /* ignore */ }
			if (videoId) embedHtml = `<iframe src="https://www.youtube.com/embed/${videoId}" allowfullscreen></iframe>`;
		}
		// Direct video URL
		else if (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url)) {
			embedHtml = `<video controls preload="metadata"><source src="${url}"></video>`;
		}

		if (!embedHtml) {
			embedHtml = `<video controls preload="metadata"><source src="${url}"></video>`;
		}

		replaceSelection(`\n${embedHtml}\n`);
		setVideoDialogOpen(false);
		setVideoUrl('');
	}, [videoUrl, replaceSelection]);

	const handleInsertImage = useCallback(() => {
		if (!imageUrl.trim()) return;
		replaceSelection(`\n![图片](${imageUrl.trim()})\n`);
		setImageDialogOpen(false);
		setImageUrl('');
	}, [imageUrl, replaceSelection]);

	const handleInsertCloud = useCallback(() => {
		if (!cloudUrl.trim()) return;
		const attrs = [`class="rin-download-card"`, `data-url="${cloudUrl.trim()}"`];
		if (cloudName.trim()) attrs.push(`data-filename="${cloudName.trim()}"`);
		if (cloudPwd.trim()) attrs.push(`data-password="${btoa(cloudPwd.trim())}"`);
		const html = `<div ${attrs.join(' ')}></div>`;
		replaceSelection(`\n${html}\n`);
		setCloudDialogOpen(false);
		setCloudUrl('');
		setCloudName('');
		setCloudPwd('');
	}, [cloudUrl, cloudName, cloudPwd, replaceSelection]);

	// Image upload handler
	const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setUploadLoading(true);
		try {
			if (file.size > 2 * 1024 * 1024) {
				throw new Error('文件过大 (最大 2MB)');
			}
			const formData = new FormData();
			formData.append('file', file);
			formData.append('type', 'post');
			const res = await fetch(`${API_BASE}/upload`, {
				method: 'POST',
				headers: getSecurityHeaders('POST', null as any),
				body: formData,
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data?.error || '上传失败');
			replaceSelection(`\n![](${data.url})\n`);
		} catch (err: any) {
			console.error('Upload failed:', err);
		} finally {
			setUploadLoading(false);
			e.target.value = '';
		}
	}, [replaceSelection]);

	return (
		<div className="space-y-3">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/20 p-1.5">
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="加粗 Ctrl+B"
					onClick={insertBold}><i className="ri-bold text-sm leading-none" /></Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="斜体 Ctrl+I"
					onClick={insertItalic}><i className="ri-italic text-sm leading-none" /></Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="链接 Ctrl+K"
					onClick={insertLink}><i className="ri-link text-sm leading-none" /></Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="引用"
					onClick={insertQuote}><i className="ri-double-quotes-l text-sm leading-none" /></Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="无序列表"
					onClick={insertList}><i className="ri-list-unordered text-sm leading-none" /></Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="有序列表"
					onClick={insertOrderedList}><i className="ri-list-ordered text-sm leading-none" /></Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="行内代码"
					onClick={insertCode}><i className="ri-code-s-slash-line text-sm leading-none" /></Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="代码块"
					onClick={insertCodeBlock}><i className="ri-code-box-line text-sm leading-none" /></Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="分割线"
					onClick={insertHR}><i className="ri-separator text-sm leading-none" /></Button>
				<span className="mx-1 h-5 w-px bg-border" />
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="居中"
					onClick={insertCenter}><i className="ri-align-center text-sm leading-none" /></Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="首行缩进（全角空格）"
					onClick={insertParagraphIndent}>
					<i className="ri-indent-decrease text-sm leading-none" />
				</Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="小说格式化（章标题+首行缩进）"
					onClick={insertNovelFormat}>
					<i className="ri-book-2-line text-sm leading-none" />
				</Button>
				<span className="mx-1 h-5 w-px bg-border" />
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="插入视频"
					onClick={() => setVideoDialogOpen(true)}><i className="ri-video-line text-sm leading-none" /></Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="插入图片链接"
					onClick={() => setImageDialogOpen(true)}><i className="ri-image-line text-sm leading-none" /></Button>
				<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="插入网盘链接"
					onClick={() => setCloudDialogOpen(true)}><i className="ri-cloud-line text-sm leading-none" /></Button>
				<label className="relative cursor-pointer">
					<Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" title="上传图片"
						disabled={uploadLoading} asChild>
						<span><i className="ri-image-add-line text-sm leading-none" /></span>
					</Button>
					<input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer"
						onChange={handleImageUpload} disabled={uploadLoading} />
				</label>
			</div>

			{/* Editor area */}
			<div className="relative">
				<div
					ref={editorRef}
					className="min-h-[300px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				/>
				<style>{`
					.cm-editor { height: 100%; min-height: 300px; }
					.cm-editor .cm-scroller { font-family: inherit; font-size: 14px; line-height: 1.6; }
					.cm-editor.cm-focused { outline: none; }
					.cm-editor .cm-content { padding: 8px 0; }
					.cm-editor .cm-line { padding: 0 4px; }
					.cm-editor .cm-specialChar { color: #94a3b8; opacity: 0.5; }
				`}</style>
			</div>

			{/* Preview */}
			<div className="w-full max-w-full rounded-md border bg-muted/20 p-3">
				<div className="mb-2 text-xs font-medium text-muted-foreground">预览</div>
				<div
					ref={previewRef}
					className="prose max-w-full break-words [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1"
					dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(
						viewRef.current?.state.doc.toString() || content, r2PublicUrl
					) }}
				/>
			</div>

			{/* Shortcut hints */}
			<div className="text-xs text-muted-foreground">
				Ctrl+B 加粗，Ctrl+I 斜体，Ctrl+K 链接
			</div>

			{/* Video Dialog */}
			<Dialog open={videoDialogOpen} onOpenChange={setVideoDialogOpen}>
				<DialogContent>
					<DialogHeader><DialogTitle>插入视频</DialogTitle></DialogHeader>
					<div className="space-y-3">
						<Label>视频链接（支持 B站、YouTube、MP4/WebM 直链）</Label>
						<Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://..." />
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setVideoDialogOpen(false)}>取消</Button>
						<Button onClick={handleInsertVideo}>插入</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Image URL Dialog */}
			<Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
				<DialogContent>
					<DialogHeader><DialogTitle>插入图片链接</DialogTitle></DialogHeader>
					<div className="space-y-3">
						<Label>图片 URL</Label>
						<Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setImageDialogOpen(false)}>取消</Button>
						<Button onClick={handleInsertImage}>插入</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Cloud/Download Card Dialog */}
			<Dialog open={cloudDialogOpen} onOpenChange={setCloudDialogOpen}>
				<DialogContent>
					<DialogHeader><DialogTitle>插入网盘链接</DialogTitle></DialogHeader>
					<div className="space-y-3">
						<div className="space-y-1">
							<Label>文件链接 *</Label>
							<Input value={cloudUrl} onChange={(e) => setCloudUrl(e.target.value)} placeholder="https://..." />
						</div>
						<div className="space-y-1">
							<Label>自定义文件名（可选）</Label>
							<Input value={cloudName} onChange={(e) => setCloudName(e.target.value)} placeholder="文件名.扩展名" />
						</div>
						<div className="space-y-1">
							<Label>提取密码（可选）</Label>
							<Input value={cloudPwd} onChange={(e) => setCloudPwd(e.target.value)} placeholder="密码" />
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setCloudDialogOpen(false)}>取消</Button>
						<Button onClick={handleInsertCloud}>插入</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}