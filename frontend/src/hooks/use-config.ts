import * as React from 'react';

import type { ForumConfig } from '@/lib/api';
import { API_BASE } from '@/lib/api';
import { getSharedCache, setSharedCache } from '@/hooks/use-shared-cache';

const CONFIG_CACHE_KEY = 'config';
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5分钟

export function useConfig() {
	const [config, setConfig] = React.useState<ForumConfig | null>(null);
	const [error, setError] = React.useState<string>('');

	React.useEffect(() => {
		let cancelled = false;

		const cached = getSharedCache(CONFIG_CACHE_KEY);
		if (cached) {
			setConfig(cached);
			return;
		}

		(async () => {
			try {
				const res = await fetch(`${API_BASE}/config`);
				if (!res.ok) throw new Error('无法加载站点配置');
				const data = (await res.json()) as ForumConfig;
				setSharedCache(CONFIG_CACHE_KEY, data, CONFIG_CACHE_TTL);
				if (!cancelled) setConfig(data);
			} catch (e: any) {
				if (!cancelled) setError(String(e?.message || e));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return { config, error };
}

