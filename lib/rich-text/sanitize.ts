import DOMPurify from 'isomorphic-dompurify';
import { isAllowedEmbedSrc } from './video-embed';

/**
 * Strict allowlist for rich text content.
 * Deny-by-default: anything not listed here is stripped.
 */
const ALLOWED_TAGS = [
  'p',
  'a',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'h2',
  'h3',
  'h4',
  'div',
  'iframe',
  'span',
  'blockquote',
  'hr',
  'br',
];

const ALLOWED_ATTR = [
  'href',
  'target',
  'rel',
  'src',
  'title',
  'class',
  'allowfullscreen',
  'frameborder',
  'data-video-embed',
];

/**
 * Sanitize untrusted rich text HTML.
 *
 * - Strips scripts, event handlers, and unknown tags/attributes.
 * - Blocks `javascript:` and `data:` URLs.
 * - Forces `rel="noopener noreferrer"` and `target="_blank"` on links.
 * - Only keeps video embed iframes that match canonical allowlisted video providers.
 *
 * Safe to call on both the server (write path) and the client (render path).
 */
export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return '';

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true,
    FORBID_TAGS: ['script', 'style', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['style', 'srcset', 'formaction'],
  });

  // 1. Sanitize iframes: keep only allowlisted video sources, drop every other iframe.
  const filteredIframes = clean.replace(/<iframe\b([^>]*)>([\s\S]*?)<\/iframe>|<iframe\b([^>]*)>/gi, (_match, attrs1, _inner, attrs2) => {
    const attrs = attrs1 || attrs2 || '';
    const srcMatch = /\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const src = srcMatch
      ? (srcMatch[2] ?? srcMatch[3] ?? srcMatch[4] ?? '').trim()
      : '';

    if (!isAllowedEmbedSrc(src)) {
      return '';
    }

    return `<iframe src="${src}" allowfullscreen="true" frameborder="0"></iframe>`;
  });

  // 2. Harden links: force safe rel/target and drop unsafe protocols.
  return filteredIframes.replace(/<a\b([^>]*)>/gi, (_match, attrs: string) => {
    const hrefMatch = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const href = hrefMatch
      ? (hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4] ?? '').trim()
      : '';

    const lower = href.toLowerCase().replace(/\s+/g, '');
    const isUnsafe =
      lower.startsWith('javascript:') ||
      lower.startsWith('data:') ||
      lower.startsWith('vbscript:');

    if (!href || isUnsafe) {
      // Drop the href entirely; keep the anchor text.
      return '<a>';
    }

    return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
  });
}

/**
 * Extract clean, human-readable plain text from rich text HTML.
 * Strips dangerous blocks (script, style, iframe) along with their contents,
 * strips all remaining HTML tags, and unescapes basic HTML entities.
 */
export function richTextToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  const withoutDangerousBlocks = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');

  return withoutDangerousBlocks
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Check if the given rich text HTML contains meaningful visible text or media content.
 */
export function hasRichTextContent(html: string | null | undefined): boolean {
  if (!html) return false;
  if (richTextToPlainText(html).length > 0) return true;
  return /data-video-embed|<iframe\b|<img\b/i.test(html);
}

