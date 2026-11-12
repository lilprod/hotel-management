import type { PdfRenderer, PdfRenderOptions } from './types.js';

const PAPER_IN: Record<NonNullable<PdfRenderOptions['paper']>, [number, number]> = {
  A4: [8.27, 11.69],
  A5: [5.83, 8.27],
  Letter: [8.5, 11],
};

/** HTML → PDF through Gotenberg (Chromium route). */
export class GotenbergPdfRenderer implements PdfRenderer {
  readonly name = 'gotenberg';

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 30_000,
  ) {}

  async renderHtml(html: string, opts: PdfRenderOptions = {}): Promise<Buffer> {
    const [w, h] = PAPER_IN[opts.paper ?? 'A4'];
    const margin = String((opts.marginsMm ?? 10) / 25.4);
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    form.append('paperWidth', String(w));
    form.append('paperHeight', String(h));
    form.append('landscape', String(opts.landscape ?? false));
    for (const side of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight'])
      form.append(side, margin);
    form.append('printBackground', 'true');

    const res = await this.fetchImpl(
      `${this.baseUrl.replace(/\/$/, '')}/forms/chromium/convert/html`,
      {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!res.ok) throw new Error(`Gotenberg responded ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
