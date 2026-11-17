const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML content and double/single-quoted attributes. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Only absolute http(s) URLs (no `javascript:`, no relative URLs) are kept. */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : undefined;
}

/** https URL or inline raster/SVG data URI, for logos. */
export function safeImageSrc(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v)) return v;
  return safeHttpUrl(v);
}

export function safeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim()
    : fallback;
}
