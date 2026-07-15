export function PostThumbnail({ src, alt }: { src?: string | null; alt?: string }) {
	if (!src) return null;
	return (
		<img
			src={src}
			alt={alt || ''}
			className="block sm:hidden h-[88px] w-[88px] shrink-0 rounded-lg object-cover object-center"
			loading="lazy"
			referrerPolicy="no-referrer"
		/>
	);
}
