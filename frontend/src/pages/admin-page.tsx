import * as React from 'react';
import { RefreshCw, Shield, User as UserIcon, Key, Copy, Check, Trash2, AlertTriangle } from 'lucide-react';

import { PageShell } from '@/components/page-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { apiFetch, getSecurityHeaders, type Category } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

export function AdminPage() {
	const token = getToken();
	const user = React.useMemo(() => getUser(), [token]);
	const isAdmin = user?.role === 'admin';
	const [error, setError] = React.useState('');
	const [savingSettings, setSavingSettings] = React.useState(false);
	const [categorySaving, setCategorySaving] = React.useState(false);
	const [userSaving, setUserSaving] = React.useState(false);
	const [inviteSaving, setInviteSaving] = React.useState(false);
	const [refreshing, setRefreshing] = React.useState(false);
	const [purging, setPurging] = React.useState(false);

	const [stats, setStats] = React.useState<{ users: number; posts: number; comments: number } | null>(null);
	const [users, setUsers] = React.useState<
		Array<{ id: number; email: string; username: string; role: string; verified: number; created_at: string; avatar_url?: string | null }>
	>([]);
	const [categories, setCategories] = React.useState<Category[]>([]);
	const [systemSettings, setSystemSettings] = React.useState({
		turnstile_enabled: false,
		notify_on_user_delete: false,
		notify_on_username_change: false,
		notify_on_avatar_change: false,
		notify_on_manual_verify: false,
		invite_only: true,
		encrypted_attachments_enabled: false,
		feature_likes: true,
		feature_bookmarks: true,
		feature_comments: true,
		feature_posts: true,
		watermark_enabled: true
	});

	const [newCategoryName, setNewCategoryName] = React.useState('');
	const [editingCategoryId, setEditingCategoryId] = React.useState<number | null>(null);
	const [editingCategoryName, setEditingCategoryName] = React.useState('');

	const [editOpen, setEditOpen] = React.useState(false);
	const [editUserId, setEditUserId] = React.useState<number | null>(null);
	const [editEmail, setEditEmail] = React.useState('');
	const [editUsername, setEditUsername] = React.useState('');
	const [editAvatarUrl, setEditAvatarUrl] = React.useState('');
	const [editPassword, setEditPassword] = React.useState('');

	// 邀请码管理
	const [invitations, setInvitations] = React.useState<any[]>([]);
	const [inviteCount, setInviteCount] = React.useState(5);
	const [inviteHours, setInviteHours] = React.useState(72);
	const [generatedCodes, setGeneratedCodes] = React.useState<string[]>([]);
	const [copiedIndex, setCopiedIndex] = React.useState(-1);

	// 密码重置
	const [resetResult, setResetResult] = React.useState<{ username: string; temp_password: string; expires_at: number } | null>(null);
	const [resetDialogOpen, setResetDialogOpen] = React.useState(false);
	const [resetUserId, setResetUserId] = React.useState<number | null>(null);
	const [resetLoading, setResetLoading] = React.useState(false);

	// 缓存清除
	const [cacheResult, setCacheResult] = React.useState('');

	React.useEffect(() => {
		if (!token) window.location.href = '/login';
	}, [token]);

	React.useEffect(() => {
		if (token && !isAdmin) setError('无权限访问管理后台');
	}, [token, isAdmin]);

	const refresh = React.useCallback(async () => {
		if (!isAdmin) return;
		setRefreshing(true);
		setError('');
		try {
			const [s, u, c, settings] = await Promise.all([
				apiFetch<{ users: number; posts: number; comments: number }>('/admin/stats', { headers: getSecurityHeaders('GET') }),
				apiFetch<any[]>('/admin/users', { headers: getSecurityHeaders('GET') }),
				apiFetch<Category[]>('/categories', { headers: getSecurityHeaders('GET') }),
				apiFetch<any>('/admin/settings', { headers: getSecurityHeaders('GET') })
			]);
			setStats(s);
			setUsers(u as any);
			setCategories(c);
			setSystemSettings((prev) => ({
				...prev,
				turnstile_enabled: !!settings.turnstile_enabled,
				notify_on_user_delete: !!settings.notify_on_user_delete,
				notify_on_username_change: !!settings.notify_on_username_change,
				notify_on_avatar_change: !!settings.notify_on_avatar_change,
				notify_on_manual_verify: !!settings.notify_on_manual_verify,
				invite_only: settings.invite_only !== false,
				encrypted_attachments_enabled: !!settings.encrypted_attachments_enabled,
				feature_likes: settings.feature_likes !== false,
				feature_bookmarks: settings.feature_bookmarks !== false,
				feature_comments: settings.feature_comments !== false,
				feature_posts: settings.feature_posts !== false,
				watermark_enabled: settings.watermark_enabled !== false
			}));
		} catch (e: any) {
			setError(String(e?.message || e));
		} finally {
			setRefreshing(false);
		}
	}, [isAdmin]);

	React.useEffect(() => { refresh(); }, [refresh]);

	// 加载邀请码列表
	const loadInvitations = React.useCallback(async () => {
		try {
			const list = await apiFetch<any[]>('/admin/invitations', { headers: getSecurityHeaders('GET') });
			setInvitations(list);
		} catch { /* ignore */ }
	}, []);

	React.useEffect(() => { loadInvitations(); }, [loadInvitations]);

	async function saveSettings() {
		if (!isAdmin) return;
		setSavingSettings(true);
		setError('');
		try {
			await apiFetch('/admin/settings', {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify(systemSettings)
			});
			alert('设置已保存');
		} catch (e: any) {
			setError(String(e?.message || e));
		} finally {
			setSavingSettings(false);
		}
	}

	async function createCategory() {
		if (!isAdmin || !newCategoryName) return;
		setCategorySaving(true);
		setError('');
		try {
			await apiFetch('/admin/categories', {
				method: 'POST', headers: getSecurityHeaders('POST'), body: JSON.stringify({ name: newCategoryName })
			});
			setNewCategoryName('');
			await refresh();
		} catch (e: any) { setError(String(e?.message || e)); } finally { setCategorySaving(false); }
	}

	async function updateCategory(id: number) {
		if (!isAdmin || !editingCategoryName) return;
		setCategorySaving(true);
		setError('');
		try {
			await apiFetch(`/admin/categories/${id}`, {
				method: 'PUT', headers: getSecurityHeaders('PUT'), body: JSON.stringify({ name: editingCategoryName })
			});
			setEditingCategoryId(null);
			setEditingCategoryName('');
			await refresh();
		} catch (e: any) { setError(String(e?.message || e)); } finally { setCategorySaving(false); }
	}

	async function deleteCategory(id: number) {
		if (!confirm('确定删除此分类？')) return;
		setCategorySaving(true);
		try {
			await apiFetch(`/admin/categories/${id}`, { method: 'DELETE', headers: getSecurityHeaders('DELETE') });
			await refresh();
		} catch (e: any) { setError(String(e?.message || e)); } finally { setCategorySaving(false); }
	}

	function openEdit(u: any) {
		setEditUserId(u.id);
		setEditEmail(u.email || '');
		setEditUsername(u.username || '');
		setEditAvatarUrl(u.avatar_url || '');
		setEditPassword('');
		setEditOpen(true);
	}

	async function saveEdit() {
		if (!editUserId) return;
		setUserSaving(true);
		setError('');
		try {
			await apiFetch(`/admin/users/${editUserId}/update`, {
				method: 'POST', headers: getSecurityHeaders('POST'),
				body: JSON.stringify({ email: editEmail || undefined, username: editUsername || undefined, avatar_url: editAvatarUrl, password: editPassword || undefined })
			});
			setEditOpen(false);
			await refresh();
		} catch (e: any) { setError(String(e?.message || e)); } finally { setUserSaving(false); }
	}

	async function deleteUser(id: number) {
		if (!confirm('确定删除此用户？')) return;
		setUserSaving(true);
		try {
			await apiFetch(`/admin/users/${id}`, { method: 'DELETE', headers: getSecurityHeaders('DELETE') });
			await refresh();
		} catch (e: any) { setError(String(e?.message || e)); } finally { setUserSaving(false); }
	}

	async function manualVerify(id: number) {
		if (!confirm('确认手动验证此用户？')) return;
		setUserSaving(true);
		try {
			await apiFetch(`/admin/users/${id}/verify`, { method: 'POST', headers: getSecurityHeaders('POST'), body: JSON.stringify({}) });
			await refresh();
		} catch (e: any) { setError(String(e?.message || e)); } finally { setUserSaving(false); }
	}

	// 生成邀请码
	async function generateInvites() {
		setInviteSaving(true);
		setError('');
		setGeneratedCodes([]);
		try {
			const data = await apiFetch<{ codes: string[]; expires_at: number }>('/admin/invitations/generate', {
				method: 'POST', headers: getSecurityHeaders('POST'),
				body: JSON.stringify({ count: inviteCount, expires_hours: inviteHours })
			});
			setGeneratedCodes(data.codes);
			await loadInvitations();
		} catch (e: any) { setError(String(e?.message || e)); } finally { setInviteSaving(false); }
	}

	// 停用邀请码
	async function deactivateInvite(id: number) {
		try {
			await apiFetch(`/admin/invitations/${id}/deactivate`, { method: 'POST', headers: getSecurityHeaders('POST'), body: '{}' });
			await loadInvitations();
		} catch (e: any) { setError(String(e?.message || e)); }
	}

	function renderInvitations() {
		if (invitations.length === 0) {
			return <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">暂无邀请码</td></tr>;
		}
		return invitations.map((inv: any) => (
			<tr key={inv.id} className="border-t">
				<td className="px-3 py-2 font-mono text-xs">{inv.code}</td>
				<td className="px-3 py-2">{inv.creator_name || '-'}</td>
				<td className="px-3 py-2">{inv.used_by ? <span className="text-emerald-600">已使用</span> : inv.is_active ? <span className="text-sky-600">有效</span> : <span className="text-muted-foreground">已停用</span>}</td>
				<td className="px-3 py-2">{inv.used_by_name || '-'}</td>
				<td className="px-3 py-2 text-xs">{new Date(inv.expires_at).toLocaleString('zh-CN')}</td>
				<td className="px-3 py-2">{!inv.used_by && inv.is_active ? (
					<Button variant="destructive" size="sm" onClick={() => deactivateInvite(inv.id)}>停用</Button>
				) : null}</td>
			</tr>
		));
	}

	// 重置密码
	function openResetDialog(userId: number) {
		setResetUserId(userId);
		setResetResult(null);
		setResetDialogOpen(true);
	}

	async function doResetPassword() {
		if (!resetUserId) return;
		setResetLoading(true);
		setError('');
		try {
			const data = await apiFetch<{ temp_password: string; expires_at: number; username: string }>(`/admin/users/${resetUserId}/reset-password`, {
				method: 'POST', headers: getSecurityHeaders('POST'), body: JSON.stringify({})
			});
			setResetResult(data);
		} catch (e: any) { setError(String(e?.message || e)); } finally { setResetLoading(false); }
	}

	// 清除缓存
	async function purgeCache() {
		if (!confirm('⚠️ 确定要清除全站缓存吗？这将使所有用户重新加载最新数据。')) return;
		setPurging(true);
		try {
			await apiFetch('/admin/cache/purge', { method: 'POST', headers: getSecurityHeaders('POST'), body: JSON.stringify({}) });
			setCacheResult('✅ 缓存清除指令已发出！');
			setTimeout(() => setCacheResult(''), 3000);
		} catch (e: any) { setError(String(e?.message || e)); } finally { setPurging(false); }
	}

	return (
		<PageShell>
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">管理后台</h1>
						<p className="text-sm text-muted-foreground">站点设置、分类与用户管理</p>
					</div>
					<div className="flex items-center gap-2">
						<Button variant="destructive" size="sm" onClick={purgeCache} disabled={purging}>
							<AlertTriangle className="h-4 w-4" />
							清除缓存
						</Button>
						<Button variant="outline" onClick={refresh} disabled={refreshing}>
							<RefreshCw className="h-4 w-4" />
						</Button>
					</div>
				</div>
				{cacheResult ? <div className="rounded-md border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{cacheResult}</div> : null}

				{user?.role !== 'admin' ? (
					<Card><CardContent className="py-6 text-sm text-muted-foreground">无权限访问</CardContent></Card>
				) : (
					<>
						{error ? <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}

						{/* 统计 */}
						<Card>
							<CardHeader><CardTitle>统计</CardTitle></CardHeader>
							<CardContent className="grid gap-4 sm:grid-cols-3">
								<div className="rounded-md border p-4">
									<div className="text-sm text-muted-foreground">用户</div>
									<div className="text-2xl font-semibold">{stats?.users ?? '-'}</div>
								</div>
								<div className="rounded-md border p-4">
									<div className="text-sm text-muted-foreground">帖子</div>
									<div className="text-2xl font-semibold">{stats?.posts ?? '-'}</div>
								</div>
								<div className="rounded-md border p-4">
									<div className="text-sm text-muted-foreground">评论</div>
									<div className="text-2xl font-semibold">{stats?.comments ?? '-'}</div>
								</div>
							</CardContent>
						</Card>

						{/* 全局配置 - 功能说明 */}
						<Card>
							<CardHeader>
								<CardTitle>全局配置</CardTitle>
								<p className="text-sm text-muted-foreground">【功能说明】在这里统一控制论坛各项功能的开启和关闭。关闭后前端对应的按钮和入口会隐藏，但不会删除任何代码。</p>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.turnstile_enabled}
											onChange={(e) => setSystemSettings((s) => ({ ...s, turnstile_enabled: e.target.checked }))} />
										启用 Cloudflare Turnstile
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.invite_only}
											onChange={(e) => setSystemSettings((s) => ({ ...s, invite_only: e.target.checked }))} />
										邀请码注册（关闭后公开注册）
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.encrypted_attachments_enabled}
											onChange={(e) => setSystemSettings((s) => ({ ...s, encrypted_attachments_enabled: e.target.checked }))} />
										加密附件功能
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.watermark_enabled}
											onChange={(e) => setSystemSettings((s) => ({ ...s, watermark_enabled: e.target.checked }))} />
										图片水印保护
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.feature_likes}
											onChange={(e) => setSystemSettings((s) => ({ ...s, feature_likes: e.target.checked }))} />
										点赞功能
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.feature_comments}
											onChange={(e) => setSystemSettings((s) => ({ ...s, feature_comments: e.target.checked }))} />
										评论功能
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.feature_posts}
											onChange={(e) => setSystemSettings((s) => ({ ...s, feature_posts: e.target.checked }))} />
										发帖功能
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.feature_bookmarks}
											onChange={(e) => setSystemSettings((s) => ({ ...s, feature_bookmarks: e.target.checked }))} />
										收藏功能
									</label>
								</div>
								<Separator />
								<div className="grid gap-3 sm:grid-cols-2">
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.notify_on_user_delete}
											onChange={(e) => setSystemSettings((s) => ({ ...s, notify_on_user_delete: e.target.checked }))} />
										删除账号时通知用户
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.notify_on_username_change}
											onChange={(e) => setSystemSettings((s) => ({ ...s, notify_on_username_change: e.target.checked }))} />
										修改用户名时通知用户
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.notify_on_avatar_change}
											onChange={(e) => setSystemSettings((s) => ({ ...s, notify_on_avatar_change: e.target.checked }))} />
										修改头像时通知用户
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input type="checkbox" className="h-4 w-4" checked={systemSettings.notify_on_manual_verify}
											onChange={(e) => setSystemSettings((s) => ({ ...s, notify_on_manual_verify: e.target.checked }))} />
										手动验证通过时通知用户
									</label>
								</div>
								<Button onClick={saveSettings} disabled={savingSettings}>{savingSettings ? '保存中...' : '保存设置'}</Button>
							</CardContent>
						</Card>

						{/* 邀请码管理 - 功能说明 */}
						<Card>
							<CardHeader>
								<CardTitle>邀请码管理</CardTitle>
								<p className="text-sm text-muted-foreground">【功能说明】在这里生成和管理注册邀请码。邀请码有效期内可被新用户用于注册。关闭"邀请码注册"开关后，任何人都可以自由注册。</p>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="flex flex-wrap items-end gap-3">
									<div className="space-y-2">
										<Label>生成数量</Label>
										<Input type="number" min={1} max={100} value={inviteCount} onChange={(e) => setInviteCount(parseInt(e.target.value) || 1)} className="w-24" />
									</div>
									<div className="space-y-2">
										<Label>有效时长（小时）</Label>
										<Input type="number" min={1} value={inviteHours} onChange={(e) => setInviteHours(parseInt(e.target.value) || 72)} className="w-24" />
									</div>
									<Button onClick={generateInvites} disabled={inviteSaving}>
										<Key className="h-4 w-4" />
										生成邀请码
									</Button>
								</div>
								{generatedCodes.length > 0 ? (
									<div className="rounded-md border bg-muted/20 p-3">
										<div className="mb-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">✅ 新生成的邀请码：</div>
										<div className="flex flex-wrap gap-2">
											{generatedCodes.map((code, i) => (
												<div key={i} className="inline-flex items-center gap-2 rounded bg-background px-3 py-1.5 text-sm font-mono border">
													<span>{code}</span>
													<button className="text-muted-foreground hover:text-foreground" onClick={() => { navigator.clipboard.writeText(code); setCopiedIndex(i); setTimeout(() => setCopiedIndex(-1), 2000); }}>
														{copiedIndex === i ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
													</button>
												</div>
											))}
										</div>
									</div>
								) : null}
								<Separator />
								<div className="text-sm font-medium">邀请码列表</div>
								<div className="overflow-x-auto rounded-md border max-h-60 overflow-y-auto">
									<table className="w-full text-sm">
										<thead className="bg-muted/30 text-left">
											<tr><th className="px-3 py-2">邀请码</th><th className="px-3 py-2">创建者</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">使用人</th><th className="px-3 py-2">过期时间</th><th className="px-3 py-2">操作</th></tr>
										</thead>
										<tbody>
											{renderInvitations()}
										</tbody>
									</table>
								</div>
							</CardContent>
						</Card>

						{/* 分类管理 */}
						<Card>
							<CardHeader><CardTitle>分类管理</CardTitle></CardHeader>
							<CardContent className="space-y-4">
								<div className="flex flex-wrap items-end gap-2">
									<div className="space-y-2">
										<Label htmlFor="cat-name">分类名称</Label>
										<Input id="cat-name" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
									</div>
									<Button onClick={createCategory} disabled={categorySaving}>添加</Button>
								</div>
								<div className="space-y-2">
									{categories.map((c) => (
										<div key={c.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
											{editingCategoryId === c.id ? (
												<Input value={editingCategoryName} onChange={(e) => setEditingCategoryName(e.target.value)} className="h-9 max-w-xs" />
											) : <span>{c.name}</span>}
											<div className="flex items-center gap-2">
												{editingCategoryId === c.id ? (
													<><Button variant="outline" size="sm" onClick={() => updateCategory(c.id)}>保存</Button><Button variant="outline" size="sm" onClick={() => { setEditingCategoryId(null); setEditingCategoryName(''); }}>取消</Button></>
												) : (
													<Button variant="outline" size="sm" onClick={() => { setEditingCategoryId(c.id); setEditingCategoryName(c.name); }}>编辑</Button>
												)}
												<Button variant="destructive" size="sm" onClick={() => deleteCategory(c.id)}>删除</Button>
											</div>
										</div>
									))}
									{categories.length === 0 ? <div className="text-sm text-muted-foreground">暂无分类</div> : null}
								</div>
							</CardContent>
						</Card>

						{/* 用户管理 */}
						<Card>
							<CardHeader>
								<CardTitle>用户管理</CardTitle>
								<p className="text-sm text-muted-foreground">【功能说明】管理所有用户账号。点击【重置密码】可为用户生成一个24小时有效的临时密码，系统会展示明文密码供你转发给用户。</p>
							</CardHeader>
							<CardContent className="space-y-3">
								<div className="overflow-x-auto rounded-md border">
									<table className="w-full text-sm">
										<thead className="bg-muted/30 text-left">
											<tr>
												<th className="px-3 py-2">ID</th>
												<th className="px-3 py-2">昵称</th>
												<th className="px-3 py-2">登录用户名</th>
												<th className="px-3 py-2">角色</th>
												<th className="px-3 py-2">已验证</th>
												<th className="px-3 py-2">操作</th>
											</tr>
										</thead>
										<tbody>
											{users.map((u) => (
												<tr key={u.id} className="border-t">
													<td className="px-3 py-2">{u.id}</td>
													<td className="px-3 py-2">
														<span className="inline-flex items-center gap-2">
															{u.avatar_url ? <img src={u.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
																: <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground"><UserIcon className="h-4 w-4" /></span>}
															<span>{u.username}</span>
															{u.role === 'admin' ? <span className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300"><Shield className="h-3 w-3" /><span className="sr-only">管理员</span></span> : null}
														</span>
													</td>
													<td className="px-3 py-2">{u.email}</td>
													<td className="px-3 py-2">{u.role}</td>
													<td className="px-3 py-2">{u.verified ? '是' : '否'}</td>
													<td className="px-3 py-2">
														<div className="flex flex-wrap gap-2">
															<Button variant="outline" size="sm" className="border-sky-500 text-sky-700 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/40" onClick={() => openEdit(u)}>编辑</Button>
															{!u.verified ? (<>
																<Button variant="outline" size="sm" className="border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40" onClick={() => manualVerify(u.id)}>验证</Button>
															</>) : null}
															{/* 重置密码按钮 */}
															<Button variant="outline" size="sm" className="border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40" onClick={() => openResetDialog(u.id)}>
																<Key className="h-3.5 w-3.5" />
																重置密码
															</Button>
															{user?.id !== u.id ? <Button variant="destructive" size="sm" onClick={() => deleteUser(u.id)}>删除</Button> : null}
														</div>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</CardContent>
						</Card>

						{/* 编辑用户对话框 */}
						<Dialog open={editOpen} onOpenChange={setEditOpen}>
							<DialogContent>
								<DialogHeader><DialogTitle>编辑用户</DialogTitle><DialogDescription>修改昵称/用户名/头像/密码</DialogDescription></DialogHeader>
												<div className="grid gap-4 py-4">
													<div className="grid gap-2"><Label htmlFor="edit-username">昵称</Label><Input id="edit-username" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} maxLength={20} /></div>
													<div className="grid gap-2"><Label htmlFor="edit-email">登录用户名</Label><Input id="edit-email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} /></div>
									<div className="grid gap-2"><Label htmlFor="edit-avatar">头像 URL</Label><Input id="edit-avatar" value={editAvatarUrl} onChange={(e) => setEditAvatarUrl(e.target.value)} /></div>
									<div className="grid gap-2"><Label htmlFor="edit-password">新密码 (留空不变)</Label><Input id="edit-password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} /></div>
								</div>
								<DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button><Button onClick={saveEdit} disabled={userSaving}>{userSaving ? '保存中...' : '保存'}</Button></DialogFooter>
							</DialogContent>
						</Dialog>

						{/* 重置密码对话框 */}
						<Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>重置密码</DialogTitle>
									<DialogDescription>⚠️ 生成24小时有效的临时密码，用户需在此时间内登录并修改密码。</DialogDescription>
								</DialogHeader>
								{resetResult ? (
									<div className="space-y-4">
										<div className="rounded-md border border-destructive/50 bg-destructive/5 p-4">
											<div className="mb-2 text-sm font-bold text-destructive">⚠️ 临时密码（请立即复制并转发给用户，关闭后无法再次查看）</div>
											<div className="rounded bg-background p-3 text-center">
												<span className="text-xl font-mono font-bold tracking-wider">{resetResult.temp_password}</span>
											</div>
											<div className="mt-2 text-xs text-muted-foreground">用户：{resetResult.username} | 过期时间：{new Date(resetResult.expires_at).toLocaleString('zh-CN')}</div>
										</div>
										<Button variant="outline" className="w-full" onClick={() => { navigator.clipboard.writeText(resetResult.temp_password); }}>
											<Copy className="h-4 w-4" /> 复制临时密码
										</Button>
									</div>
								) : (
									<div className="space-y-4">
										<div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
											<AlertTriangle className="h-4 w-4 inline mr-1" />
											确定要重置该用户的密码吗？此操作将：
											<ul className="mt-1 list-disc pl-5">
												<li>使当前密码立即失效</li>
												<li>生成12位随机临时密码（24小时有效）</li>
												<li>旧密码将被记录到密码历史中</li>
											</ul>
										</div>
										<DialogFooter>
											<Button variant="outline" onClick={() => setResetDialogOpen(false)}>取消</Button>
											<Button variant="destructive" onClick={doResetPassword} disabled={resetLoading}>{resetLoading ? '处理中...' : '确认重置'}</Button>
										</DialogFooter>
									</div>
								)}
							</DialogContent>
						</Dialog>
					</>
				)}
			</div>
		</PageShell>
	);
}