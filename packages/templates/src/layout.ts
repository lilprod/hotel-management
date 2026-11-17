import mjml2html from 'mjml';
import type { Branding } from './branding.js';
import { escapeHtml, safeHttpUrl } from './escape.js';

export interface LayoutInput {
  branding: Branding;
  /** Already HTML-escaped fragments (rendered through the escaping engine). */
  titleHtml: string;
  paragraphsHtml: string[];
  cta?: { label: string; url: string } | undefined;
  lang: string;
}

/** Branded e-mail layout: logo, colors, call to action and legal footer (MJML -> HTML). */
export async function renderEmailLayout(input: LayoutInput): Promise<string> {
  const { branding: b } = input;
  const cta = input.cta && safeHttpUrl(input.cta.url);
  const logo = b.logoUrl
    ? `<mj-image src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.displayName)}" width="140px" align="left" padding="0" />`
    : `<mj-text font-size="20px" font-weight="700" color="#ffffff" padding="0">${escapeHtml(b.displayName)}</mj-text>`;
  const footer = b.footerLegal
    .map(
      (l) =>
        `<mj-text align="center" font-size="11px" color="#777777" padding="2px 0">${escapeHtml(l)}</mj-text>`,
    )
    .join('');
  const source = `<mjml lang="${escapeHtml(input.lang)}">
  <mj-head>
    <mj-attributes><mj-all font-family="Helvetica, Arial, sans-serif" /></mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f4">
    <mj-section background-color="${b.primaryColor}" padding="16px 24px">
      <mj-column>${logo}</mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="24px">
      <mj-column>
        <mj-text font-size="20px" font-weight="700" color="${b.primaryColor}">${input.titleHtml}</mj-text>
        ${input.paragraphsHtml.map((p) => `<mj-text font-size="15px" line-height="22px" color="#333333">${p}</mj-text>`).join('\n')}
        ${cta ? `<mj-button background-color="${b.accentColor}" color="#ffffff" href="${escapeHtml(cta)}" border-radius="4px" align="left">${escapeHtml(input.cta?.label)}</mj-button>` : ''}
      </mj-column>
    </mj-section>
    <mj-section padding="12px 24px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#555555">${escapeHtml(b.displayName)}</mj-text>
        ${footer}
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
  const { html } = await mjml2html(source, { validationLevel: 'soft' });
  return html;
}
