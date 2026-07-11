import * as React from 'react';

import { SiteHeader } from '@/components/site-header';
import { getUser, getToken, type User } from '@/lib/auth';
import { useConfig } from '@/hooks/use-config';
import { apiFetch, getSecurityHeaders } from '@/lib/api';

export function PageShell({
	children
}: {
	children: React.ReactNode;
}) {
	const [user, setUser] = React.useState<User | null>(() => getUser());
	const { config } = useConfig();
	const [generatedSecret, setGeneratedSecret] = React.useState<string>('');
	const canvasRef = React.useRef<HTMLCanvasElement>(null);

	// if jwt not configured, generate a base64-secret for display
	React.useEffect(() => {
		if (config && config.jwt_secret_configured === false && !generatedSecret) {
			const arr = new Uint8Array(32);
			crypto.getRandomValues(arr);
			const secret = btoa(String.fromCharCode(...arr));
			setGeneratedSecret(secret);
		}
	}, [config, generatedSecret]);

	// LSB 隐形盲水印: 前端 Canvas 底层渲染，零感知、零布局占用
	React.useEffect(() => {
		const token = getToken();
		if (!token || !canvasRef.current || config?.watermark_enabled === false) return;
		const canvas = canvasRef.current;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// 从后端获取水印数据（UID + 时间戳）
		apiFetch<{ watermark: string }>('/user/watermark', { headers: getSecurityHeaders('GET') })
			.then((data) => {
				canvas.width = 1;
				canvas.height = 1;
				// 在 1x1 Canvas 上写入不可见像素（LSB 理念）
				// 实际只在内存中存储水印数据，不占任何视觉空间
				const imgData = ctx.createImageData(1, 1);
				const text = data.watermark || 'anon';
				// 将水印 hash 编码到像素的 alpha 通道最低位
				const hash = text.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
				imgData.data[0] = 0;   // R
				imgData.data[1] = 0;   // G
				imgData.data[2] = 0;   // B
				imgData.data[3] = Math.abs(hash % 2) * 1; // Alpha: 0 或 1（肉眼不可见）
				ctx.putImageData(imgData, 0, 0);
			})
			.catch(() => {});
	}, [config?.watermark_enabled]);

	return (
		<div className="min-h-dvh">
			<SiteHeader currentUser={user} onLogout={() => setUser(null)} />
			{/* warning banner if jwt secret missing */}
			{config && config.jwt_secret_configured === false && (
				<div className="bg-yellow-200 text-yellow-800 px-4 py-2 text-sm">
					JWT secret not configured on server! Set a random value (≥32 chars) in Cloudflare Worker secrets named
					<strong> JWT_SECRET</strong>. Suggested value:
					<code className="ml-2 break-all">{generatedSecret}</code>
				</div>
			)}
			<main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
			{/* LSB 水印 Canvas - 零布局占用 */}
			<canvas ref={canvasRef} style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }} />
		</div>
	);
}
