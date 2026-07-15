/**
 * 插件: 定时清理任务
 * 独立后台定时清理过期 nonce、临时密码、限流记录和 sessions。
 * 在 Worker scheduled 事件中调用。
 */

export async function runScheduledCleanup(db: D1Database): Promise<{
	cleanedNonces: number;
	cleanedTempPasswords: number;
	cleanedRateLimits: number;
	cleanedSessions: number;
	cleanedAuditLogs: number;
}> {
	const now = Date.now();
	const result = { cleanedNonces: 0, cleanedTempPasswords: 0, cleanedRateLimits: 0, cleanedSessions: 0, cleanedAuditLogs: 0 };
	try {
		const r1 = await db.prepare('DELETE FROM nonces WHERE expires_at < ?').bind(now).run();
		result.cleanedNonces = r1.meta.changes || 0;
	} catch { /* 表可能不存在 */ }
	try {
		const r2 = await db.prepare('DELETE FROM temp_passwords WHERE expires_at < ? OR is_used = 1').bind(now).run();
		result.cleanedTempPasswords = r2.meta.changes || 0;
	} catch { /* 表可能不存在 */ }
	try {
		const r3 = await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - 120000).run();
		result.cleanedRateLimits = r3.meta.changes || 0;
	} catch { /* 表可能不存在 */ }
	try {
		const r4 = await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
		result.cleanedSessions = r4.meta.changes || 0;
	} catch { /* 表可能不存在 */ }
	try {
		const r5 = await db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', '-90 days')").run();
		result.cleanedAuditLogs = r5.meta.changes || 0;
	} catch { /* 表可能不存在 */ }
	return result;
}
