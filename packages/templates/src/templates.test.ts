import { formatMoney, money } from '@hm/shared';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES,
  DOCUMENT_PAPER,
  lineDescription,
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
    expect(codes).toHaveLength(23);
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

  it('hotel documents show the hotel, its legal mentions, formatted amounts and FR dates', () => {
    const html = renderDocumentHtml(
      'invoice',
      {
        ...invoice,
        issuedOn: '2026-11-25',
        seller: {
          name: 'Hôtel 2 Février',
          legalName: 'Société 2 Février SARL',
          legalForm: 'SARL',
          taxRegime: 'Réel normal',
          address: 'Lomé',
          legalIds: { nif: 'NIF-1', rccm: 'RCCM-1' },
        },
        stay: { reservation: 'RES-1', checkIn: '2026-11-22', checkOut: '2026-11-27', nights: 5 },
        payments: [{ method: 'CASH', amount: xof(126000) }],
        paymentMethod: undefined as never,
      },
      {},
      'fr',
    );
    expect(html).not.toContain('Hotel Management');
    expect(html).not.toMatch(/% %/);
    expect(html).toContain('<h1>Hôtel 2 Février</h1>');
    expect(html).toContain('25/11/2026');
    expect(html).toContain('du 22/11/2026 au 27/11/2026 (5 nuit(s))');
    expect(html).toContain('Régime fiscal : Réel normal');
    expect(html).toContain('Espèces : ' + formatMoney(money(126000, 'XOF')));
    expect(html).not.toContain('126000');
    const en = renderDocumentHtml('invoice', { ...invoice, payments: [{ method: 'MIXX', amount: xof(1) }] }, {}, 'en');
    expect(en).toContain('Mixx by Yas');
    // Pre-formatted rates are not doubled
    const dbl = renderDocumentHtml('invoice', { ...invoice, lines: [{ ...invoice.lines[0]!, taxRate: '18 %' }] }, {});
    expect(dbl).not.toMatch(/% %/);
  });

  it('labels an interim invoice with the invoiced nights only', () => {
    const html = renderDocumentHtml(
      'invoice',
      { ...invoice, stay: { reservation: 'R', checkIn: '2026-11-22', checkOut: '2026-11-27', nights: 5, invoicedNights: 4 } },
      {},
      'fr',
    );
    expect(html).toContain('nuits facturées : 4 sur 5');
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

describe('guest and billing notices wired by the modules', () => {
  const hotel = { name: 'Hôtel du Lac', phone: '+228 90 00 00 00' };
  const guest = { firstName: 'Kossi', lastName: 'Mensah' };
  const samples: Record<string, Record<string, unknown>> = {
    waitlist_offer: {
      guest,
      hotel,
      reservation: { checkIn: '2026-12-01', checkOut: '2026-12-04', roomType: 'Double' },
      offer: { expiresAt: '2026-11-26T10:00:00.000Z' },
    },
    reservation_cancelled: {
      guest,
      hotel,
      reservation: {
        number: 'R-42',
        checkIn: '2026-12-01',
        checkOut: '2026-12-04',
        roomType: 'Double',
      },
      penalty: { applies: true, amount: { amount: 45000, currency: 'XOF' } },
    },
    guest_email_verification: {
      guest,
      hotel,
      verification: { url: 'https://hotel.example/verify-email?token=abc', expiresInHours: 48 },
    },
    night_audit_completed: {
      hotel,
      audit: {
        businessDate: '2026-11-12',
        occupancy: '66.7',
        roomsSold: 4,
        roomRevenue: { amount: 120000, currency: 'XOF' },
        totalRevenue: { amount: 135500, currency: 'XOF' },
        url: '',
      },
    },
    night_audit_blocked: {
      hotel,
      audit: { businessDate: '2026-11-12', reasons: 'PENDING_ARRIVALS', url: '' },
    },
    payment_declaration_rejected: {
      owner: { name: 'Ama Kodjo' },
      hotel: { name: 'Hôtel du Lac' },
      billing: { url: 'https://hotel.example/settings/subscription' },
      declaration: { amount: { amount: 50000, currency: 'XOF' }, reason: 'Référence introuvable' },
    },
  };

  it.each(Object.keys(samples))(
    '%s renders in FR and EN, e-mail and SMS, with branding',
    async (code) => {
      for (const locale of ['fr', 'en'] as const)
        for (const channel of ['EMAIL', 'SMS'] as const) {
          const r = await renderMessage({
            code,
            channel,
            locale,
            data: samples[code]!,
            branding: { displayName: 'Hôtel du Lac', primaryColor: '#112233' },
          });
          expect(r.source).toBe('default');
          expect(r.locale).toBe(locale);
          expect(r.text).not.toMatch(/\{\{|undefined|NaN/);
          expect(r.text).toContain('Hôtel du Lac');
          if (channel === 'EMAIL') {
            expect(r.subject).toBeTruthy();
            expect(r.html).toContain('#112233');
          }
        }
    },
  );

  it('reservation_cancelled states the penalty, or its absence', async () => {
    const withFee = await renderMessage({
      code: 'reservation_cancelled',
      channel: 'EMAIL',
      locale: 'fr',
      data: samples['reservation_cancelled']!,
    });
    expect(withFee.text).toContain(formatMoney(money(45000, 'XOF')));
    const free = await renderMessage({
      code: 'reservation_cancelled',
      channel: 'SMS',
      locale: 'en',
      data: { ...samples['reservation_cancelled']!, penalty: { applies: false } },
    });
    expect(free.text).toContain('No fee');
  });

  it('the verification and rejection templates are mandatory, the offer is optional', () => {
    const by = new Map(DEFAULT_TEMPLATES.map((t) => [t.code, t]));
    expect(by.get('guest_email_verification')?.mandatory).toBe(true);
    expect(by.get('payment_declaration_rejected')?.mandatory).toBe(true);
    expect(by.get('waitlist_offer')?.mandatory).toBe(false);
  });
});

describe('night audit report and localized night designations', () => {
  const seller = { name: 'Hôtel du Lac', legalIds: { nif: '100' } };
  const xof = (amount: number) => ({ amount, currency: 'XOF' });

  it('formats the structured night and ISO days inside designations per locale', () => {
    expect(lineDescription({ description: 'Hébergement Double — ch. 12', nightDate: '2026-11-22' }, 'fr')).toBe(
      'Hébergement Double — ch. 12 — nuit du 22/11/2026',
    );
    expect(lineDescription({ description: 'Hébergement Double', nightDate: '2026-11-22' }, 'en')).toBe(
      'Hébergement Double — night of 2026-11-22',
    );
    expect(lineDescription({ description: 'Avoir AV-1 : séjour du 2026-11-20' }, 'fr')).toBe('Avoir AV-1 : séjour du 20/11/2026');
  });

  it('renders the manager day report in FR and EN with KPIs, departments, payments and taxes', () => {
    const data = {
      hotel: seller,
      businessDate: '2026-11-12',
      closedAt: '2026-11-13T03:02:00.000Z',
      closedBy: 'Ama <Kodjo>',
      kpis: {
        occupancy: '66.7',
        roomsSold: 4,
        roomsAvailable: 6,
        adr: xof(30000),
        revpar: xof(20000),
        roomRevenue: xof(120000),
        totalRevenue: xof(135500),
        arrivals: 2,
        departures: 1,
        inHouse: 4,
        noShows: 1,
      },
      revenueByDepartment: [
        { code: 'ROOM', amount: xof(120000) },
        { code: 'RES', label: 'Restaurant', amount: xof(15500) },
      ],
      payments: [{ method: 'MIXX', amount: xof(50000) }],
      taxes: [
        { code: 'TVA18', name: 'TVA 18 %', kind: 'VAT' as const, amount: xof(21600) },
        { code: 'TS', name: 'Taxe de séjour', kind: 'TOURIST' as const, amount: xof(4000) },
      ],
      warnings: [{ code: 'OPEN_CASH_SESSIONS', count: 1 }],
    };
    const fr = renderDocumentHtml('night_audit_report', data);
    expect(fr).toContain('RAPPORT DE CLÔTURE JOURNALIÈRE');
    expect(fr).toContain('12/11/2026');
    expect(fr).toContain('66.7 %');
    expect(fr).toContain('Hébergement');
    expect(fr).toContain('Restaurant');
    expect(fr).toContain('Mixx by Yas');
    expect(fr).toContain('Taxe de séjour (Taxe de séjour)');
    expect(fr).toContain('Sessions de caisse ouvertes : 1');
    expect(fr).toContain('Ama &lt;Kodjo&gt;');
    const en = renderDocumentHtml('night_audit_report', data, {}, 'en');
    expect(en).toContain('DAILY CLOSING REPORT');
    expect(en).toContain('Rooms');
    expect(en).toContain('Open cash sessions : 1');
    expect(DOCUMENT_PAPER.night_audit_report).toBe('A4');
  });
});
