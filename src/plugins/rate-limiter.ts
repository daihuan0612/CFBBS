/**
 * 插件: 前置速率限制中间件
 * 独立拦截所有 API 请求，不修改原有路由逻辑。
 * 在 Worker fetch 入口顶部调用，被限流直接返回 429。
 */
interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
}
const RULES: Record<string, RateLimitRule> = {
  '/api/login':    { windowMs: 60000, maxRequests: 5 },
  '/api/register': { windowMs: 60000, maxRequests: 3 },
  '/api/upload':   { windowMs: 60000, maxRequests: 10 },
};
const DEFAULT_RULE: RateLimitRule = { windowMs: 60000, maxRequests: 60 };

export async function checkRateLimit(
  db: D1Database,
  ip: string,
  pathname: string,
  method: string,
): Promise<Response | null> {
  if (method === 'GET') return null;
  const rule = RULES[pathname] || DEFAULT_RULE;
  const now = Date.now();
  const windowStart = now - rule.windowMs;
  try {
    const row = await db.prepare(
      'SELECT count FROM rate_limits WHERE ip = ? AND endpoint = ? AND window_start > ?'
    ).bind(ip, pathname, windowStart).first<{ count: number }>();
    if (row && row.count >= rule.maxRequests) {
      return new Response(JSON.stringify({ error: '请求过于频繁，请稍后再试' }), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(rule.windowMs / 1000)) },
      });
    }
    if (row) {
      await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE ip = ? AND endpoint = ? AND window_start > ?')
        .bind(ip, pathname, windowStart).run();
    } else {
      await db.prepare('INSERT INTO rate_limits (ip, endpoint, count, window_start) VALUES (?, ?, 1, ?)')
        .bind(ip, pathname, now).run();
    }
  } catch { /* 限流失效时放行 */ }
  return null;
}

export const RATE_LIMITS_DDL = `CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  window_start INTEGER NOT NULL
);`;