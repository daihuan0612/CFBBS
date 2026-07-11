/**
 * 插件: Markdown 渲染预处理
 *
 * 后端对帖子内容做了 HTML 实体编码，导致 Markdown 中的 HTML 标签被双倍转义。
 * 此组件：解码 HTML 实体后再交给 Markdown 解析器。
 * 仅对新增页面启用，历史帖子沿用原生逻辑。
 */

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

export function preprocessForMarkdown(raw: string): string {
  if (!raw) return '';
  let text = decodeHtmlEntities(raw);
  text = text.replace(/\r\n/g, '\n');
  return text;
}

export function renderMarkdownFromDb(dbContent: string): string {
  const hasEncoded = dbContent.includes('&amp;') || dbContent.includes('&lt;');
  const hasRawTags = /<[a-zA-Z\/]/.test(dbContent);
  return hasEncoded && !hasRawTags ? decodeHtmlEntities(dbContent) : dbContent;
}