import DOMPurify from 'isomorphic-dompurify';

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
];

const ALLOWED_ATTR = ['href', 'target', 'rel'];

/**
 * Sanitize untrusted rich text HTML.
 *
 * - Strips scripts, event handlers, and unknown tags/attributes.
 * - Blocks `javascript:` and `data:` URLs.
 * - Forces `rel="noopener noreferrer"` and `target="_blank"` on links.
 *
 * Safe to call on both the server (write path) and the client (render path).
 */
export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return '';

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['style', 'srcset', 'formaction'],
  });

  // Harden links: force safe rel/target and drop unsafe protocols.
  return clean.replace(/<a\b([^>]*)>/gi, (_match, attrs: string) => {
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

/** Plain text of a rich-text HTML string (tags stripped, content kept). */
export function richTextToPlainText(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [],
    KEEP_CONTENT: true,
    RETURN_DOM_FRAGMENT: true,
  });
  return (fragment.textContent ?? '').trim();
}

/** True when the HTML has visible text or an embedded video. */
export function hasRichTextContent(html: string): boolean {
  return richTextToPlainText(html).length > 0 || html.includes('data-video-embed');
}
