import * as React from 'react';
import { Film } from 'lucide-react';
import { captureAndUpload, getCachedThumbnail } from '@/lib/video-thumbnail';

type ThumbnailState =
	| { status: 'cached' | 'uploaded'; url: string }
	| { status: 'capturing' }
	| { status: 'error' };

export function VideoThumbnail({
	videoUrl,
	postId,
	className,
}: {
	videoUrl: string;
	postId: number;
	className?: string;
}) {
	const [state, setState] = React.useState<ThumbnailState>(() => {
		const cached = getCachedThumbnail(videoUrl);
		if (cached) return { status: 'cached', url: cached };
		return { status: 'capturing' };
	});

	React.useEffect(() => {
		if (state.status !== 'capturing') return;
		let cancelled = false;

		(async () => {
			try {
				// captureAndUpload 内部处理跨域代理、截帧、上传和防重复
				const url = await captureAndUpload(videoUrl, postId);
				if (cancelled) return;
				if (!cancelled) setState({ status: 'uploaded', url });
			} catch {
				if (!cancelled) setState({ status: 'error' });
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [videoUrl, postId, state.status]);

	const url = state.status === 'cached' || state.status === 'uploaded' ? state.url : null;
	const [imgFailed, setImgFailed] = React.useState(false);

	if (url && !imgFailed) {
		return (
			<img
				src={url}
				alt=""
				className={className || 'hidden sm:block h-20 w-28 shrink-0 rounded-md object-cover object-center'}
				loading="lazy"
				onError={() => {
					setImgFailed(true);
					// 如果是缓存命中的 URL 失效了，清除缓存避免下次复用
					if (state.status === 'cached') {
						try { localStorage.removeItem('vt:' + videoUrl); } catch { /* ignore */ }
					}
				}}
			/>
		);
	}

	// 图片加载失败 & 截帧也出错 → 显示 error fallback
	if (imgFailed || state.status === 'error') {
		return (
			<div
				className={
					className ||
					'hidden sm:flex h-20 w-28 shrink-0 items-center justify-center rounded-md bg-muted/30'
				}
			>
				<Film className="h-5 w-5 text-muted-foreground/30" />
			</div>
		);
	}

	// capturing 状态
	return (
		<div
			className={
				className ||
				'hidden sm:flex h-20 w-28 shrink-0 items-center justify-center rounded-md bg-muted/50'
			}
		>
			<Film className="h-5 w-5 text-muted-foreground/50" />
		</div>
	);
}
