import * as React from 'react';

import { TurnstileWidget } from '@/components/turnstile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfig } from '@/hooks/use-config';
import { getSecurityHeaders, API_BASE } from '@/lib/api';
import { setToken, setUser } from '@/lib/auth';

export function LoginPage() {
	const { config } = useConfig();
	const [tab, setTab] = React.useState<'login' | 'register'>('login');

	// 登录表单
	const [loginName, setLoginName] = React.useState('');
	const [password, setPassword] = React.useState('');
	const [totpCode, setTotpCode] = React.useState('');
	const [turnstileToken, setTurnstileToken] = React.useState('');
	const [turnstileResetKey, setTurnstileResetKey] = React.useState(0);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState('');

	// 注册表单
	const [regUsername, setRegUsername] = React.useState('');
	const [regLoginName, setRegLoginName] = React.useState('');
	const [regPassword, setRegPassword] = React.useState('');
	const [invitationCode, setInvitationCode] = React.useState('');
	const [regTurnstileToken, setRegTurnstileToken] = React.useState('');
	const [regTurnstileResetKey, setRegTurnstileResetKey] = React.useState(0);
	const [regLoading, setRegLoading] = React.useState(false);
	const [regError, setRegError] = React.useState('');
	const [regSuccess, setRegSuccess] = React.useState('');

	const enabled = !!config?.turnstile_enabled;
	const siteKey = config?.turnstile_site_key || '';
	const turnstileActive = enabled && !!siteKey;
	const inviteOnly = config?.invite_only !== false;

	async function handleLogin(e: React.FormEvent) {
		e.preventDefault();
		setError('');
		if (turnstileActive && !turnstileToken) {
			setError('请完成验证码验证');
			return;
		}
		setLoading(true);
		try {
			const res = await fetch(`${API_BASE}/login`, {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify({
					email: loginName,
					password,
					totp_code: totpCode,
					'cf-turnstile-response': turnstileToken
				})
			});
			const data = (await res.json()) as any;
			if (!res.ok) {
				setTurnstileToken('');
				setTurnstileResetKey((v) => v + 1);
				if (data?.error === 'TOTP_REQUIRED') {
					setError('请输入 2FA 验证码');
					return;
				}
				throw new Error(data?.error || '登录失败');
			}

			setUser(data.user);
			setToken(data.token);
			window.location.href = '/';
		} catch (err: any) {
			setError(String(err?.message || err));
		} finally {
			setLoading(false);
		}
	}

	async function handleRegister(e: React.FormEvent) {
		e.preventDefault();
		setRegError('');
		setRegSuccess('');
		if (turnstileActive && !regTurnstileToken) {
			setRegError('请完成验证码验证');
			return;
		}

		setRegLoading(true);
		try {
			const body: any = { email: regLoginName, username: regUsername, password: regPassword, 'cf-turnstile-response': regTurnstileToken };
			if (inviteOnly) body.invitation_code = invitationCode;

			const res = await fetch(`${API_BASE}/register`, {
				method: 'POST',
				headers: getSecurityHeaders('POST'),
				body: JSON.stringify(body)
			});
			const data = (await res.json()) as any;
			if (!res.ok) {
				setRegTurnstileToken('');
				setRegTurnstileResetKey((v) => v + 1);
				throw new Error(data?.error || '注册失败');
			}
			setRegSuccess('注册成功！切换到登录页登录。');
			setTab('login');
			setRegUsername('');
			setRegLoginName('');
			setRegPassword('');
			setInvitationCode('');
			setRegTurnstileToken('');
			setRegTurnstileResetKey((v) => v + 1);
		} catch (err: any) {
			setRegError(String(err?.message || err));
		} finally {
			setRegLoading(false);
		}
	}

	return (
		<div className="min-h-dvh bg-muted/20 flex items-center justify-center">
			<Card className="w-full max-w-md mx-4">
				<CardHeader>
					<div className="flex border-b mb-4">
						<button
							className={`flex-1 pb-2 text-center text-sm font-medium transition-colors ${tab === 'login' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}
							onClick={() => setTab('login')}
						>
							登录
						</button>
						<button
							className={`flex-1 pb-2 text-center text-sm font-medium transition-colors ${tab === 'register' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground'}`}
							onClick={() => setTab('register')}
						>
							注册
						</button>
					</div>
					<CardTitle>{tab === 'login' ? '登录' : '注册'}</CardTitle>
				</CardHeader>
				<CardContent>
					{tab === 'login' ? (
						<form className="space-y-4" onSubmit={handleLogin}>
							{error ? <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}

							<div className="space-y-2">
								<Label htmlFor="login-name">用户名</Label>
								<Input
									id="login-name"
									name="loginName"
									type="text"
									autoComplete="username"
									value={loginName}
									onChange={(e) => setLoginName(e.target.value)}
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="login-password">密码</Label>
								<Input
									id="login-password"
									name="password"
									type="password"
									autoComplete="current-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="login-totp">双重验证码 (若开启)</Label>
								<Input
									id="login-totp"
									name="totp_code"
									type="text"
									inputMode="numeric"
									pattern="\d*"
									maxLength={6}
									placeholder="选填"
									autoComplete="one-time-code"
									value={totpCode}
									onChange={(e) => setTotpCode(e.target.value)}
								/>
							</div>

							<TurnstileWidget enabled={turnstileActive} siteKey={siteKey} onToken={setTurnstileToken} resetKey={turnstileResetKey} />

							<Button className="w-full" type="submit" disabled={loading}>
								{loading ? '处理中...' : '登录'}
							</Button>

							<div className="text-right text-sm">
								<a className="text-muted-foreground hover:underline" href="/forgot">
									忘记密码？
								</a>
							</div>
							<div className="text-xs text-muted-foreground text-center border-t pt-3 mt-2">
								管理员已为你重置密码？请使用临时密码登录后立即修改。
							</div>
						</form>
					) : (
						<form className="space-y-4" onSubmit={handleRegister}>
							{regError ? <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{regError}</div> : null}
							{regSuccess ? <div className="rounded-md border bg-muted/40 p-3 text-sm">{regSuccess}</div> : null}

							<div className="space-y-2">
								<Label htmlFor="register-username">显示名称 (最多 20 字符)</Label>
								<Input
									id="register-username"
									name="username"
									type="text"
									maxLength={20}
									value={regUsername}
									onChange={(e) => setRegUsername(e.target.value)}
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="register-login">登录用户名</Label>
								<Input
									id="register-login"
									name="loginName"
									type="text"
									autoComplete="username"
									value={regLoginName}
									onChange={(e) => setRegLoginName(e.target.value)}
									required
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="register-password">密码 (8-16 字符)</Label>
								<Input
									id="register-password"
									name="password"
									type="password"
									autoComplete="new-password"
									value={regPassword}
									onChange={(e) => setRegPassword(e.target.value)}
									required
								/>
							</div>

							{inviteOnly ? (
								<div className="space-y-2">
									<Label htmlFor="register-invite">邀请码</Label>
									<Input
										id="register-invite"
										name="invitation_code"
										type="text"
										placeholder="请输入邀请码"
										value={invitationCode}
										onChange={(e) => setInvitationCode(e.target.value)}
										required
									/>
								</div>
							) : null}

							<TurnstileWidget enabled={turnstileActive} siteKey={siteKey} onToken={setRegTurnstileToken} resetKey={regTurnstileResetKey} />

							<Button className="w-full" type="submit" disabled={regLoading}>
								{regLoading ? '处理中...' : '注册'}
							</Button>
						</form>
					)}
				</CardContent>
			</Card>
		</div>
	);
}