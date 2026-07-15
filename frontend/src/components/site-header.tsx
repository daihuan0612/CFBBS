import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { NotificationBell } from '@/components/notification-bell';
import { getUser, logout, type User } from '@/lib/auth';
import { getTheme, toggleTheme, type Theme } from '@/lib/theme';
import { Home, LogIn, LogOut, Moon, Settings, Shield, Sun, User as UserIcon, UserPlus } from 'lucide-react';

export function SiteHeader({
	currentUser,
	onLogout
}: {
	currentUser: User | null;
	onLogout?: () => void;
}) {
	const [user, setUser] = React.useState<User | null>(() => currentUser ?? getUser());
	const [theme, setTheme] = React.useState<Theme>(() => getTheme());
	const [menuOpen, setMenuOpen] = React.useState(false);
	const menuRef = React.useRef<HTMLDivElement>(null);

	// 点击外部关闭菜单
	React.useEffect(() => {
		if (!menuOpen) return;
		function handleClick(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
		}
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [menuOpen]);

	// 页面从缓存恢复时同步最新的用户数据
	React.useEffect(() => {
		const sync = () => setUser(currentUser ?? getUser());
		window.addEventListener('pageshow', sync);
		return () => window.removeEventListener('pageshow', sync);
	}, [currentUser]);

	React.useEffect(() => {
		function onThemeChange(e: Event) {
			const next = (e as CustomEvent).detail;
			if (next === 'light' || next === 'dark') setTheme(next);
		}
		window.addEventListener('theme-change', onThemeChange as any);
		setTheme(getTheme());
		return () => window.removeEventListener('theme-change', onThemeChange as any);
	}, []);
	return (
		<header className="w-full border-b bg-background">
			<div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
				<a
					href="/"
					className="inline-flex items-center justify-center rounded-md border border-transparent p-2 text-foreground hover:bg-muted/40"
				>
					<Home className="h-5 w-5" />
					<span className="sr-only">主页</span>
				</a>
				<div className="flex items-center gap-1 sm:gap-2">
					<Button type="button" variant="ghost" size="sm" onClick={toggleTheme}>
						{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
						<span className="sr-only">切换主题</span>
					</Button>
					{user ? (
						<>
							<NotificationBell />
							{/* 桌面端：显示用户名、管理后台、设置、退出 */}
							<span className="hidden sm:inline-flex items-center gap-1 text-sm text-muted-foreground">
								{user.avatar_url ? (
									<img src={user.avatar_url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
								) : (
									<span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground"><UserIcon className="h-4 w-4" /></span>
								)}
								<span>欢迎，<span className="text-foreground">{user.username}</span></span>
								{user.role === 'admin' ? (
									<span className="inline-flex shrink-0 items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300"><Shield className="h-3 w-3" /></span>
								) : null}
							</span>
							<div className="hidden sm:flex items-center gap-1">
								{user.role === 'admin' ? (
									<Button asChild variant="ghost" size="sm"><a href="/admin"><Shield className="h-4 w-4" /></a></Button>
								) : null}
								<Button asChild variant="ghost" size="sm"><a href="/settings"><Settings className="h-4 w-4" /></a></Button>
								<Separator orientation="vertical" className="h-6" />
								<Button variant="destructive" size="sm" onClick={() => { logout(); onLogout?.(); window.location.href = '/'; }}>
									<LogOut className="h-4 w-4" />
								</Button>
							</div>
							{/* 移动端：头像下拉菜单 */}
							<div className="relative sm:hidden" ref={menuRef}>
								<Button variant="ghost" size="sm" className="p-1" onClick={() => setMenuOpen(!menuOpen)}>
									{user.avatar_url ? (
										<img src={user.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
									) : (
										<span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground"><UserIcon className="h-4 w-4" /></span>
									)}
								</Button>
								{menuOpen ? (
									<div className="absolute right-0 top-full mt-1 w-40 rounded-md border bg-popover p-1 shadow-md z-50">
										{user.role === 'admin' ? (
											<a href="/admin" className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-muted" onClick={() => setMenuOpen(false)}>
												<Shield className="h-4 w-4" /> 管理后台
											</a>
										) : null}
										<a href="/settings" className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-muted" onClick={() => setMenuOpen(false)}>
											<Settings className="h-4 w-4" /> 设置
										</a>
										<div className="my-1 h-px bg-border" />
										<button className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-destructive hover:bg-destructive/10" onClick={() => { logout(); onLogout?.(); window.location.href = '/'; }}>
											<LogOut className="h-4 w-4" /> 退出登录
										</button>
									</div>
								) : null}
							</div>
						</>
					) : (
						<>
							<Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
								<a href="/login">
									<LogIn className="h-4 w-4" />
									<span className="sr-only">登录</span>
								</a>
							</Button>
							{/* 移动端登录 */}
							<Button asChild variant="ghost" size="sm" className="inline-flex sm:hidden">
								<a href="/login">
									<LogIn className="h-4 w-4" />
									<span className="sr-only">登录</span>
								</a>
							</Button>
							<Button asChild size="sm" className="hidden sm:inline-flex">
								<a href="/register">
									<UserPlus className="h-4 w-4" />
									<span className="sr-only">注册</span>
								</a>
							</Button>
						</>
					)}
				</div>
			</div>
		</header>
	);
}
