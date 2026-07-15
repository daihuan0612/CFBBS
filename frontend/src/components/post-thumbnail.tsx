import { VideoThumbnail } from '@/components/video-thumbnail';

export function PostThumbnail({
	src,
	videoUrl,
	postId,
}: {
	src?: string | null;
	videoUrl?: string | null;
	postId: number;
}) {
	if (src) {
		return (
			<img
				src={src}
				alt=""
				className="block sm:hidden h-[88px] w-[88px] shrink-0 rounded-lg object-cover object-center"
				loading="lazy"
				referrerPolicy="no-referrer"
			/>
		);
	}

	if (videoUrl) {
		return (
			<VideoThumbnail
				videoUrl={videoUrl}
				postId={postId}
				className="block sm:hidden h-[88px] w-[88px] shrink-0 rounded-lg object-cover object-center"
			/>
		);
	}

	return null;
}
