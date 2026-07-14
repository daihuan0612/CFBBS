import * as React from 'react';
import { Film } from 'lucide-react';
import { captureVideoFrame, getCachedThumbnail, setCachedThumbnail, uploadThumbnail } from '@/lib/video-thumbnail';

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
				const blob = await captureVideoFrame(videoUrl);
				if (cancelled) return;
				const url = await uploadThumbnail(blob, postId);
				if (cancelled) return;
				setCachedThumbnail(videoUrl, url);
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

	if (url) {
		return (
			<img
				src={url}
				alt=""
				className={className || 'hidden sm:block h-20 w-28 shrink-0 rounded-md object-cover object-top'}
				loading="lazy"
			/>
		);
	}

	if (state.status === 'capturing') {
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

	// error fallback
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