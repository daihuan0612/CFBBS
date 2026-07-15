const _cache = new Map<string, { data: any; expiry: number }>();

export function getSharedCache(key: string): any | null {
    const entry = _cache.get(key);
    if (entry && entry.expiry > Date.now()) return entry.data;
    _cache.delete(key);
    return null;
}

export function setSharedCache(key: string, data: any, ttlMs: number): void {
    _cache.set(key, { data, expiry: Date.now() + ttlMs });
}

export function clearSharedCache(key: string): void {
    _cache.delete(key);
}
