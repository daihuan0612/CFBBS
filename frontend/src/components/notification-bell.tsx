import * as React from 'react';
import { Bell, BellRing, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { apiFetch, getSecurityHeaders } from '@/lib/api';
import { getToken } from '@/lib/auth';

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  actor_id: number | null;
  is_read: number;
  created_at: string;
}

export function NotificationBell() {
	const [open, setOpen] = React.useState(false);
	const [unreadCount, setUnreadCount] = React.useState(0);
	const [notifications, setNotifications] = React.useState<Notification[]>([]);
	const dropdownRef = React.useRef<HTMLDivElement>(null);

	const fetchUnread = React.useCallback(async () => {
		try {
			const data = await apiFetch<{ count: number }>('/notifications/unread-count', { headers: getSecurityHeaders('GET') });
			setUnreadCount(data.count);
		} catch { /* ignore */ }
	}, []);

	const fetchNotifications = React.useCallback(async () => {
		try {
			const data = await apiFetch<Notification[]>('/notifications', { headers: getSecurityHeaders('GET') });
			setNotifications(data);
		} catch { /* ignore */ }
	}, []);

	// 页面加载时拉一次未读数
	React.useEffect(() => {
		if (!getToken()) return;
		fetchUnread();
	}, [fetchUnread]);

	const handleToggle = () => {
		if (!open) {
			fetchNotifications();
			fetchUnread();
		}
		setOpen(!open);
	};

	const markRead = async (id: number) => {
		try {
			await apiFetch(`/notifications/read/${id}`, { method: 'POST', headers: getSecurityHeaders('POST'), body: '{}' });
			setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
			setUnreadCount(prev => Math.max(0, prev - 1));
		} catch { /* ignore */ }
	};

	const markAllRead = async () => {
		try {
			await apiFetch('/notifications/read-all', { method: 'POST', headers: getSecurityHeaders('POST'), body: '{}' });
			setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
			setUnreadCount(0);
		} catch { /* ignore */ }
	};

	const deleteNotification = async (id: number, e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await apiFetch(`/notifications/${id}`, { method: 'DELETE', headers: getSecurityHeaders('DELETE') });
			setNotifications(prev => {
				const removed = prev.find(n => n.id === id);
				if (removed && !removed.is_read) {
					setUnreadCount(c => Math.max(0, c - 1));
				}
				return prev.filter(n => n.id !== id);
			});
		} catch { /* ignore */ }
	};

	React.useEffect(() => {
		if (!open) return;
		function handleClick(e: MouseEvent) {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [open]);

	const token = getToken();
	if (!token) return null;

	return (
		<div className="relative" ref={dropdownRef}>
			<Button type="button" variant="ghost" size="sm" onClick={handleToggle} className="relative">
				{unreadCount > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
				{unreadCount > 0 && (
					<span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[14px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
						{unreadCount > 99 ? '99+' : unreadCount}
					</span>
				)}
				<span className="sr-only">通知</span>
			</Button>

			{open && (
				<div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border bg-background shadow-lg">
					<div className="flex items-center justify-between border-b px-3 py-2">
						<span className="text-sm font-medium">通知</span>
						<div className="flex items-center gap-2">
							{unreadCount > 0 && (
								<button className="text-xs text-muted-foreground hover:text-foreground" onClick={markAllRead}>
									全部已读
								</button>
							)}
							{notifications.length > 0 && (
								<button
									className="text-xs text-muted-foreground hover:text-destructive"
									onClick={async () => {
										try {
											await Promise.all(
												notifications.map(n =>
													apiFetch(`/notifications/${n.id}`, { method: 'DELETE', headers: getSecurityHeaders('DELETE') })
												)
											);
											setNotifications([]);
											setUnreadCount(0);
										} catch { /* ignore */ }
									}}
								>
									全部删除
								</button>
							)}
						</div>
					</div>
					<div className="max-h-72 overflow-y-auto">
						{notifications.length === 0 ? (
							<div className="px-3 py-6 text-center text-sm text-muted-foreground">暂无通知</div>
						) : (
							notifications.map((n) => (
								<div
									key={n.id}
									className={`flex cursor-pointer items-start gap-2 border-b px-3 py-2.5 text-sm transition-colors hover:bg-muted/30 ${!n.is_read ? 'bg-muted/10' : ''}`}
									onClick={() => { if (!n.is_read) markRead(n.id); }}
								>
									<div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${!n.is_read ? 'bg-destructive' : 'bg-transparent'}`} />
									<div className="min-w-0 flex-1">
										<div className="font-medium">{n.title}</div>
										<div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.message}</div>
										<div className="mt-1 text-[10px] text-muted-foreground/60">
											{formatTime(n.created_at)}
										</div>
									</div>
									<button
										className="mt-0.5 shrink-0 text-muted-foreground/50 hover:text-destructive"
										onClick={(e) => deleteNotification(n.id, e)}
										title="删除"
									>
										<X className="h-3.5 w-3.5" />
									</button>
								</div>
							))
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function formatTime(dateStr: string) {
	const date = new Date(dateStr);
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	if (diff < 60000) return '刚刚';
	if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
	return date.toLocaleDateString('zh-CN');
}
