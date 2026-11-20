import { formatMoney, money } from '@hm/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  assertTemplate,
  inspectTemplate,
  renderDocumentHtml,
  renderMessage,
  templateCatalog,
  type InvoiceData,
} from './index.js';

const data = {
  hotel: { name: 'Hôtel <b>Lac</b>', phone: '+228 90' },
  guest: { firstName: 'Kossi' },
  reservation: {
    number: 'R1',
    checkIn: '2026-12-01',
    checkOut: '2026-12-04',
    nights: 3,
    roomType: 'Double',
    total: { amount: 135000, currency: 'XOF' },
  },
  portal: { url: 'https://hotel.example/p' },
};

describe('default templates', () => {
  it('ships every expected code in FR and EN with whitelisted variables only', () => {
    const codes = DEFAULT_TEMPLATES.map((t) => t.code);
    expect(codes).toHaveLength(17);
    for (const t of DEFAULT_TEMPLATES)
      for (const l of ['fr', 'en'] as const) {
        const c = t.content[l];
        for (const s of [c.subject, c.title, c.sms, ...c.paragraphs])
          expect(inspectTemplate(s, t.variables)).toEqual([]);
      }
  });

  it('exposes a closed catalog with samples', () => {
    const cat = templateCatalog();
    expect(cat['booking_confirmation']?.variables['hotel.name']).toBeTruthy();
    expect(cat['password_reset']?.channels).not.toContain('WHATSAPP');
  });
});

describe('renderMessage', () => {
  it('renders the default in French with escaping and formatted money', async () => {
    const r = await renderMessage({
      code: 'booking_confirmation',
      channel: 'EMAIL',
      locale: 'fr',
      data,
    });
    expect(r.source).toBe('default');
    expect(r.html).toContain('&lt;b&gt;Lac&lt;/b&gt;');
    expect(r.html).not.toContain('<b>Lac</b>');
    expect(r.text).toContain('135');
    expect(r.html).toContain('https://hotel.example/p');
    expect(r.subject).toContain('R1');
  });

  it('falls back to French for an unsupported locale and honours English', async () => {
    const es = await renderMessage({
      code: 'booking_confirmation',
      channel: 'SMS',
      locale: 'es',
      data,
    });
    expect(es.locale).toBe('fr');
    const en = await renderMessage({
      code: 'booking_confirmation',
      channel: 'SMS',
      locale: 'en-GB',
      data,
    });
    expect(en.locale).toBe('en');
    expect(en.text).toContain('confirmed');
  });

  it('prefers the tenant override, and walks the locale chain', async () => {
    const r = await renderMessage({
      code: 'booking_confirmation',
      channel: 'SMS',
      locale: 'en',
      data,
      findOverride: (l) =>
        l === 'fr' ? { body: 'Custom {{guest.firstName}} {{reservation.total}}' } : undefined,
    });
    expect(r.source).toBe('override');
    expect(r.locale).toBe('fr');
    expect(r.text).toBe(`Custom Kossi ${formatMoney(money(135000, 'XOF'))}`);
  });

  it('drops variables outside the whitelist and unsafe URLs; rejects bad templates', async () => {
    const r = await renderMessage({
      code: 'booking_confirmation',
      channel: 'EMAIL',
      data: { ...data, secret: 'x', portal: { url: 'javascript:alert(1)' } },
    });
    expect(r.html).not.toContain('javascript:');
    await expect(
      renderMessage({
        code: 'booking_confirmation',
        channel: 'SMS',
        data,
        findOverride: () => ({ body: '{{{guest.firstName}}}' }),
      }),
    ).rejects.toThrow();
    expect(() => assertTemplate('{{secret}}', ['guest.firstName'])).toThrow();
    await expect(renderMessage({ code: 'nope', channel: 'SMS', data })).rejects.toThrow('Unknown');
  });

  it('applies branding colors, logo and legal footer', async () => {
    const r = await renderMessage({
      code: 'welcome',
      channel: 'EMAIL',
      data,
      branding: {
        displayName: 'Lac',
        primaryColor: '#112233',
        logoUrl: 'https://x.test/l.png',
        footerLegal: ['NIF 123'],
      },
    });
    expect(r.html).toContain('#112233');
    expect(r.html).toContain('https://x.test/l.png');
    expect(r.html).toContain('NIF 123');
  });
});

describe('documents', () => {
  const xof = (amount: number) => ({ amount, currency: 'XOF' });
  const invoice: InvoiceData = {
    number: 'FAC-1',
    issuedOn: '2026-12-04',
    seller: {
      name: 'Hôtel <Lac>',
      legalIds: { nif: '1001234567', rccm: 'TG-LFW-01-2020-B13-00001' },
    },
    buyer: { name: 'Kossi' },
    lines: [
      {
        description: 'Chambre',
        quantity: 3,
        unitPrice: xof(40000),
        net: xof(120000),
        taxRate: '18',
      },
      {
        description: 'Petit-déjeuner',
        quantity: 1,
        unitPrice: xof(5000),
        net: xof(5000),
        taxRate: '0',
      },
    ],
    taxBreakdown: [
      { rate: '18', base: xof(120000), tax: xof(21600) },
      { rate: '0', base: xof(5000), tax: xof(0) },
    ],
    touristTax: xof(3000),
    totalNet: xof(125000),
    totalTax: xof(21600),
    totalGross: xof(149600),
    paymentMethod: 'Mobile Money',
  };

  it('invoice carries mandatory mentions, per-rate VAT, tourist tax and totals', () => {
    const html = renderDocumentHtml('invoice', invoice, { displayName: 'Lac' }, 'fr');
    for (const s of [
      'NIF',
      '1001234567',
      'RCCM',
      'TG-LFW-01-2020-B13-00001',
      'Total HT',
      'Total TVA',
      'Total TTC',
      'Taxe de séjour',
      'Mobile Money',
      formatMoney(money(149600, 'XOF')),
      formatMoney(money(21600, 'XOF')),
    ])
      expect(html).toContain(s);
    expect(html).toContain('TVA 18 %');
    expect(html).toContain('TVA 0 %');
    expect(html).toContain('Hôtel &lt;Lac&gt;');
    expect(html).toContain('size: A4');
  });

  it('renders receipt, 80 mm ticket and police form', () => {
    const seller = { name: 'Lac' };
    expect(
      renderDocumentHtml(
        'receipt',
        {
          number: 'R1',
          issuedAt: '2026-12-04',
          seller,
          payer: 'Kossi',
          amount: xof(1000),
          method: 'Cash',
        },
        {},
        'en',
      ),
    ).toContain('PAYMENT RECEIPT');
    const t = renderDocumentHtml('ticket', {
      number: 'T1',
      issuedAt: 'x',
      seller,
      lines: [{ description: 'Bière', quantity: 2, total: xof(2000) }],
      total: xof(2000),
    });
    expect(t).toContain('80mm');
    const p = renderDocumentHtml('police_form', {
      hotel: seller,
      guest: { lastName: 'M<', firstName: 'K' },
      stay: { checkIn: 'a', checkOut: 'b' },
    });
    expect(p).toContain('FICHE DE POLICE');
    expect(p).toContain('M&lt;');
  });
});
