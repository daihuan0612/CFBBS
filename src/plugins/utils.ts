/**
 * 插件: 统一 API 工具库
 * 封装 URL 参数提取、自定义错误类、日期格式化。
 * 新功能全部使用此工具库，旧页面维持原有逻辑。
 */

export function extractUrlParams(pathname: string, pattern: string): Record<string, string> | null {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) params[patternParts[i].slice(1)] = pathParts[i];
    else if (patternParts[i] !== pathParts[i]) return null;
  }
  return params;
}

export class ApiError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message); this.name = 'ApiError';
  }
  static badRequest(msg: string) { return new ApiError(400, msg, 'BAD_REQUEST'); }
  static unauthorized(msg = '未登录') { return new ApiError(401, msg, 'UNAUTHORIZED'); }
  static forbidden(msg = '无权限') { return new ApiError(403, msg, 'FORBIDDEN'); }
  static notFound(msg = '资源不存在') { return new ApiError(404, msg, 'NOT_FOUND'); }
  static tooMany(msg = '请求过于频繁，请稍后再试') { return new ApiError(429, msg, 'TOO_MANY_REQUESTS'); }
  static internal(msg = '服务器内部错误') { return new ApiError(500, msg, 'INTERNAL_ERROR'); }
}

export function formatDateSafe(dateStr: string | number | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? String(dateStr) : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export function timeAgo(dateStr: string | number): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
}