import * as React from 'react';

import QRCode from 'qrcode';

import { PageShell } from '@/components/page-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { apiFetch, API_BASE, getSecurityHeaders } from '@/lib/api';
import { getUser, logout, setUser, type User } from '@/lib/auth';
import { validateText } from '@/lib/validators';

export function SettingsPage() {
	const [user, setUserState] = React.useState<User | null>(() => getUser());
	const [saving, setSaving] = React.useState(false);
	const [uploading, setUploading] = React.useState(false);
	const [totpLoading, setTotpLoading] = React.useState(false);
	const [deleting, setDeleting] = React.useState(false);
	const [error, setError] = React.useState('');

	const [username, setUsername] = React.useState(user?.username || '');
	const [avatarUrl, setAvatarUrl] = React.useState(user?.avatar_url || '');

	const [totpSecret, setTotpSecret] = React.useState('');
	const [totpUri, setTotpUri] = React.useState('');
	const [totpCode, setTotpCode] = React.useState('');
	const qrCanvasRef = React.useRef<HTMLCanvasElement | null>(null);

	const [deletePassword, setDeletePassword] = React.useState('');
	const [deleteTotp, setDeleteTotp] = React.useState('');

	React.useEffect(() => {
		if (!user) {
			window.location.href = '/login';
		}
	}, [user]);

	React.useEffect(() => {
		if (!totpUri || !qrCanvasRef.current) return;
		QRCode.toCanvas(qrCanvasRef.current, totpUri).catch(() => {});
	}, [totpUri]);

	async function saveProfile() {
		if (!user) return;
		setError('');
		const err = username ? validateText(username, '用户名') : null;
		if (err) return setError(err);
		if (username.length > 20) return setError('用户名过长 (最多 20 字符)');
		if (avatarUrl && avatarUrl.length > 500) return setError('头像 URL 过长 (最多 500 字符)');

		setSaving(true);
		try {
			const data = await apiFetch<{ user: User }>('/user/profile', {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({ username, avatar_url: avatarUrl }),
			});
			setUser(data.user);
			setUserState(data.user);
			alert('资料已更新');
		} catch (e: any) {
			setError(String(e?.message || e));
		} finally {
			setSaving(false);
		}
	}

	async function uploadAvatar(file: File) {
		if (!user) return;
		setError('');
		if (file.size > 2 * 1024 * 1024) return setError('文件过大 (最大 2MB)');

		const formData = new FormData();
		formData.append('file', file);
		formData.append('type', 'avatar');

		setUploading(true);
		try {
			const res = await fetch(`${API_BASE}/upload`, {
				method: 'POST',
				headers: getSecurityHeaders('POST', null),
				body: formData,
			});
			const data = (await res.json()) as any;
			if (!res.ok) throw new Error(data?.error || '上传失败');
			setAvatarUrl(data.url);
		} catch (e: any) {
			setError(String(e?.message || e));
		} finally {
			setUploading(false);
		}
	}

	async function startTotpSetup() {
		setError('');
		setTotpLoading(true);
		try {
			const data = await apiFetch<{ secret: string; uri: string }>('/user/totp/setup', {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({}),
			});
			setTotpSecret(data.secret);
			setTotpUri(data.uri);
		} catch (e: any) {
			setError(String(e?.message || e));
		} finally {
			setTotpLoading(false);
		}
	}

	async function verifyTotp() {
		setError('');
		setTotpLoading(true);
		try {
			await apiFetch('/user/totp/verify', {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({ token: totpCode }),
			});
			if (user) {
				const updated = { ...user, totp_enabled: true };
				setUser(updated);
				setUserState(updated);
			}
			setTotpSecret('');
			setTotpUri('');
			setTotpCode('');
			alert('2FA 已启用');
		} catch (e: any) {
			setError(String(e?.message || e));
		} finally {
			setTotpLoading(false);
		}
	}

	async function deleteAccount() {
		if (!user) return;
		setError('');
		if (!confirm('确定要删除您的账号吗？此操作无法撤销。')) return;
		setDeleting(true);
		try {
			await apiFetch('/user/delete', {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({ password: deletePassword, totp_code: deleteTotp }),
			});
			logout();
			window.location.href = '/';
		} catch (e: any) {
			setError(String(e?.message || e));
		} finally {
			setDeleting(false);
		}
	}

	return (
		<PageShell>
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">设置</h1>
						<p className="text-sm text-muted-foreground">管理个人资料和 2FA 安全设置。</p>
					</div>
					<Button
						variant="outline"
						onClick={() => {
							logout();
							window.location.href = '/';
						}}
					>
						退出登录
					</Button>
				</div>

				{error ? <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}

				<Card>
					<CardHeader>
						<CardTitle>个人资料</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="profile-username">用户名</Label>
								<Input id="profile-username" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={20} />
							</div>
							<div className="space-y-2">
								<Label htmlFor="profile-avatar">头像 URL</Label>
								<Input id="profile-avatar" value={avatarUrl || ''} onChange={(e) => setAvatarUrl(e.target.value)} />
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="avatar-file">上传头像 (最大 2MB)</Label>
							<Input
								id="avatar-file"
								type="file"
								accept="image/*"
								disabled={uploading}
								onChange={(e) => {
									const f = e.target.files?.[0];
									if (f) uploadAvatar(f);
									e.target.value = '';
								}}
							/>
						</div>

						<Button onClick={saveProfile} disabled={saving}>
							{saving ? '保存中...' : '保存资料'}
						</Button>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>双重验证 (2FA)</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{user?.totp_enabled ? (
							<div className="rounded-md border bg-muted/30 p-3 text-sm">2FA 已启用</div>
						) : (
							<>
								<div className="text-sm text-muted-foreground">启用 2FA 以保护您的账户。</div>
								<Button onClick={startTotpSetup} disabled={totpLoading || !!totpSecret}>
									{totpLoading ? '处理中...' : '开始启用'}
								</Button>
								{totpSecret ? (
									<div className="space-y-3 rounded-md border p-4">
										<div className="text-sm font-medium">1. 扫描二维码</div>
										<canvas ref={qrCanvasRef} />
										<div className="text-sm text-muted-foreground">或手动输入密钥：{totpSecret}</div>
										<Separator />
										<div className="text-sm font-medium">2. 输入验证码</div>
										<div className="flex flex-wrap items-center gap-2">
											<Input
												value={totpCode}
												onChange={(e) => setTotpCode(e.target.value)}
												placeholder="000000"
												maxLength={6}
												autoComplete="one-time-code"
												className="w-32"
											/>
											<Button onClick={verifyTotp} disabled={totpLoading}>
												{totpLoading ? '验证中...' : '验证并启用'}
											</Button>
										</div>
									</div>
								) : null}
							</>
						)}
					</CardContent>
				</Card>

				<Card className="border-destructive/40">
					<CardHeader>
						<CardTitle className="text-destructive">危险区域</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="text-sm text-muted-foreground">删除账号后无法恢复。</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="delete-password">密码</Label>
								<Input
									id="delete-password"
									type="password"
									autoComplete="current-password"
									value={deletePassword}
									onChange={(e) => setDeletePassword(e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="delete-totp">双重验证码 (若开启)</Label>
								<Input
									id="delete-totp"
									type="text"
									inputMode="numeric"
									maxLength={6}
									autoComplete="one-time-code"
									value={deleteTotp}
									onChange={(e) => setDeleteTotp(e.target.value)}
								/>
							</div>
						</div>
						<Button variant="destructive" onClick={deleteAccount} disabled={deleting}>
							{deleting ? '处理中...' : '删除账号'}
						</Button>
					</CardContent>
				</Card>
			</div>
		</PageShell>
	);
}
