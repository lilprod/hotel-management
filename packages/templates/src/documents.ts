import { formatMoney, money, type Money } from '@hm/shared';
import { normalizeBranding, type Branding } from './branding.js';
import { escapeHtml, safeHttpUrl } from './escape.js';
import { baseLocale, DEFAULT_LOCALE, type Locale } from './locale.js';

/** Printable documents (HTML -> PDF through Gotenberg). Every value is HTML-escaped. */
export const DOCUMENT_TYPES = ['invoice', 'receipt', 'ticket', 'police_form'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type MoneyValue = { amount: number; currency: string };

export interface DocParty {
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  /** Legal identifiers, labelled as given (e.g. NIF, RCCM). Country rules are not hard-coded. */
  legalIds?: { nif?: string; rccm?: string; [other: string]: string | undefined };
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: MoneyValue;
  /** Net amount (HT) of the line. */
  net: MoneyValue;
  /** Tax rate in percent, as text ("18", "0"); drives the per-rate breakdown. */
  taxRate: string;
}

export interface TaxBreakdownRow {
  rate: string;
  base: MoneyValue;
  tax: MoneyValue;
}

export interface InvoiceData {
  number: string;
  issuedOn: string;
  dueOn?: string;
  seller: DocParty;
  buyer: DocParty;
  stay?: { reservation: string; checkIn: string; checkOut: string; nights: number };
  lines: InvoiceLine[];
  /** Per-rate HT / TVA breakdown. */
  taxBreakdown: TaxBreakdownRow[];
  /** Tourist tax (taxe de séjour), shown as its own line outside the VAT base. */
  touristTax?: MoneyValue;
  totalNet: MoneyValue;
  totalTax: MoneyValue;
  totalGross: MoneyValue;
  paymentMethod?: string;
  notes?: string[];
  creditNoteOf?: string;
}

export interface ReceiptData {
  number: string;
  issuedAt: string;
  seller: DocParty;
  payer: string;
  amount: MoneyValue;
  method: string;
  reference?: string;
  invoiceNumber?: string;
}

export interface TicketData {
  number: string;
  issuedAt: string;
  seller: DocParty;
  lines: { description: string; quantity: number; total: MoneyValue }[];
  total: MoneyValue;
  paymentMethod?: string;
}

export interface PoliceFormData {
  hotel: DocParty;
  guest: {
    lastName: string;
    firstName: string;
    birthDate?: string;
    birthPlace?: string;
    nationality?: string;
    profession?: string;
    address?: string;
    idType?: string;
    idNumber?: string;
    idIssuedBy?: string;
  };
  stay: { checkIn: string; checkOut: string; room?: string; reservation?: string };
  companions?: { lastName: string; firstName: string; birthDate?: string }[];
}

export type DocumentData = {
  invoice: InvoiceData;
  receipt: ReceiptData;
  ticket: TicketData;
  police_form: PoliceFormData;
};

const L = {
  fr: {
    invoice: 'FACTURE',
    creditNote: 'AVOIR',
    receipt: 'REÇU DE PAIEMENT',
    police: 'FICHE DE POLICE',
    number: 'N°',
    date: 'Date',
    due: 'Échéance',
    seller: 'Émetteur',
    buyer: 'Client',
    description: 'Désignation',
    qty: 'Qté',
    unit: 'P.U. HT',
    net: 'Total HT',
    rate: 'TVA',
    base: 'Base HT',
    tax: 'Montant TVA',
    ht: 'Total HT',
    tva: 'Total TVA',
    ttc: 'Total TTC',
    touristTax: 'Taxe de séjour',
    payment: 'Mode de paiement',
    nif: 'NIF',
    rccm: 'RCCM',
    stay: 'Séjour',
    from: 'du',
    to: 'au',
    nights: 'nuit(s)',
    payer: 'Reçu de',
    amount: 'Montant',
    method: 'Mode de paiement',
    ref: 'Référence',
    invoiceRef: 'Facture',
    thanks: 'Merci de votre visite',
    total: 'TOTAL',
    last: 'Nom',
    first: 'Prénom',
    birth: 'Né(e) le',
    place: 'à',
    nat: 'Nationalité',
    job: 'Profession',
    addr: 'Adresse',
    idDoc: 'Pièce d’identité',
    idNo: 'N°',
    issued: 'Délivrée par',
    arrival: 'Arrivée',
    departure: 'Départ',
    room: 'Chambre',
    companions: 'Accompagnants',
    sign: 'Signature du client',
    creditOf: 'Avoir sur la facture',
    page: 'Page',
  },
  en: {
    invoice: 'INVOICE',
    creditNote: 'CREDIT NOTE',
    receipt: 'PAYMENT RECEIPT',
    police: 'GUEST REGISTRATION FORM',
    number: 'No.',
    date: 'Date',
    due: 'Due date',
    seller: 'Issuer',
    buyer: 'Customer',
    description: 'Description',
    qty: 'Qty',
    unit: 'Unit excl. tax',
    net: 'Total excl. tax',
    rate: 'VAT',
    base: 'Net base',
    tax: 'VAT amount',
    ht: 'Total excl. tax',
    tva: 'Total VAT',
    ttc: 'Total incl. tax',
    touristTax: 'Tourist tax',
    payment: 'Payment method',
    nif: 'Tax ID (NIF)',
    rccm: 'Trade register (RCCM)',
    stay: 'Stay',
    from: 'from',
    to: 'to',
    nights: 'night(s)',
    payer: 'Received from',
    amount: 'Amount',
    method: 'Payment method',
    ref: 'Reference',
    invoiceRef: 'Invoice',
    thanks: 'Thank you for your visit',
    total: 'TOTAL',
    last: 'Last name',
    first: 'First name',
    birth: 'Born on',
    place: 'in',
    nat: 'Nationality',
    job: 'Occupation',
    addr: 'Address',
    idDoc: 'ID document',
    idNo: 'No.',
    issued: 'Issued by',
    arrival: 'Arrival',
    departure: 'Departure',
    room: 'Room',
    companions: 'Companions',
    sign: 'Guest signature',
    creditOf: 'Credit note for invoice',
    page: 'Page',
  },
} satisfies Record<Locale, Record<string, string>>;

const e = escapeHtml;
const m = (v: MoneyValue): string => formatMoney(money(v.amount, v.currency) as Money);

const BASE_CSS = (b: Branding, page: string): string => `
@page { size: ${page}; margin: 0 }
*{box-sizing:border-box} body{font-family:Helvetica,Arial,sans-serif;color:#222;margin:0;font-size:11px}
h1{margin:0;color:${b.primaryColor}} table{width:100%;border-collapse:collapse}
th{background:${b.primaryColor};color:#fff;text-align:left;padding:5px 6px;font-size:10px}
td{padding:5px 6px;border-bottom:1px solid #ddd;vertical-align:top} .r{text-align:right} .muted{color:#666}
.totals td{border:0;padding:3px 6px} .grand td{font-weight:700;font-size:13px;border-top:2px solid ${b.primaryColor}}
.box{border:1px solid #ccc;padding:8px;border-radius:3px}`;

function shell(title: string, css: string, body: string, lang: Locale): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${e(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

function party(label: string, p: DocParty, t: (typeof L)['fr']): string {
  const ids = p.legalIds ?? {};
  const lines = [
    `<strong>${e(p.name)}</strong>`,
    p.address && e(p.address),
    p.phone && e(p.phone),
    p.email && e(p.email),
    ids.nif && `${t.nif} : ${e(ids.nif)}`,
    ids.rccm && `${t.rccm} : ${e(ids.rccm)}`,
    ...Object.entries(ids)
      .filter(([k, v]) => v && k !== 'nif' && k !== 'rccm')
      .map(([k, v]) => `${e(k.toUpperCase())} : ${e(v)}`),
  ].filter(Boolean);
  return `<div class="box"><div class="muted">${e(label)}</div>${lines.join('<br/>')}</div>`;
}

function logo(b: Branding): string {
  return b.logoUrl
    ? `<img src="${e(b.logoUrl)}" alt="${e(b.displayName)}" style="max-height:60px;max-width:180px"/>`
    : `<h1>${e(b.displayName)}</h1>`;
}

function invoiceHtml(d: InvoiceData, b: Branding, lang: Locale): string {
  const t = L[lang];
  const rows = d.lines
    .map(
      (l) =>
        `<tr><td>${e(l.description)}</td><td class="r">${e(l.quantity)}</td><td class="r">${m(l.unitPrice)}</td><td class="r">${e(l.taxRate)} %</td><td class="r">${m(l.net)}</td></tr>`,
    )
    .join('');
  const tax = d.taxBreakdown
    .map(
      (r) =>
        `<tr><td>${t.rate} ${e(r.rate)} %</td><td class="r">${m(r.base)}</td><td class="r">${m(r.tax)}</td></tr>`,
    )
    .join('');
  const title = d.creditNoteOf ? t.creditNote : t.invoice;
  const body = `<div style="padding:15mm">
<table><tr><td style="border:0">${logo(b)}</td><td style="border:0" class="r"><h1>${title}</h1>${t.number} ${e(d.number)}<br/>${t.date} : ${e(d.issuedOn)}${d.dueOn ? `<br/>${t.due} : ${e(d.dueOn)}` : ''}${d.creditNoteOf ? `<br/>${t.creditOf} ${e(d.creditNoteOf)}` : ''}</td></tr></table>
<table style="margin:12px 0"><tr><td style="border:0;width:50%">${party(t.seller, d.seller, t)}</td><td style="border:0">${party(t.buyer, d.buyer, t)}</td></tr></table>
${d.stay ? `<p>${t.stay} ${e(d.stay.reservation)} : ${t.from} ${e(d.stay.checkIn)} ${t.to} ${e(d.stay.checkOut)} (${e(d.stay.nights)} ${t.nights})</p>` : ''}
<table><thead><tr><th>${t.description}</th><th class="r">${t.qty}</th><th class="r">${t.unit}</th><th class="r">${t.rate}</th><th class="r">${t.net}</th></tr></thead><tbody>${rows}</tbody></table>
<table style="margin-top:12px"><tr><td style="border:0;width:55%;vertical-align:top">
<table><thead><tr><th>${t.rate}</th><th class="r">${t.base}</th><th class="r">${t.tax}</th></tr></thead><tbody>${tax}</tbody></table></td>
<td style="border:0"><table class="totals">
<tr><td>${t.ht}</td><td class="r">${m(d.totalNet)}</td></tr>
<tr><td>${t.tva}</td><td class="r">${m(d.totalTax)}</td></tr>
${d.touristTax ? `<tr><td>${t.touristTax}</td><td class="r">${m(d.touristTax)}</td></tr>` : ''}
<tr class="grand"><td>${t.ttc}</td><td class="r">${m(d.totalGross)}</td></tr></table></td></tr></table>
${d.paymentMethod ? `<p>${t.payment} : ${e(d.paymentMethod)}</p>` : ''}
${(d.notes ?? []).map((n) => `<p class="muted">${e(n)}</p>`).join('')}
<p class="muted" style="margin-top:20px;text-align:center;font-size:9px">${[
    b.displayName,
    d.seller.legalIds?.nif && `${t.nif} ${d.seller.legalIds.nif}`,
    d.seller.legalIds?.rccm && `${t.rccm} ${d.seller.legalIds.rccm}`,
    ...b.footerLegal,
  ]
    .filter(Boolean)
    .map((x) => e(x))
    .join(' - ')}</p></div>`;
  return shell(`${title} ${d.number}`, BASE_CSS(b, 'A4'), body, lang);
}

function receiptHtml(d: ReceiptData, b: Branding, lang: Locale): string {
  const t = L[lang];
  const body = `<div style="padding:20mm">${logo(b)}<h1 style="margin-top:12px">${t.receipt}</h1><p>${t.number} ${e(d.number)} - ${e(d.issuedAt)}</p>
${party(t.seller, d.seller, t)}
<table style="margin-top:14px"><tr><td>${t.payer}</td><td>${e(d.payer)}</td></tr>
<tr><td>${t.amount}</td><td><strong>${m(d.amount)}</strong></td></tr>
<tr><td>${t.method}</td><td>${e(d.method)}</td></tr>
${d.reference ? `<tr><td>${t.ref}</td><td>${e(d.reference)}</td></tr>` : ''}
${d.invoiceNumber ? `<tr><td>${t.invoiceRef}</td><td>${e(d.invoiceNumber)}</td></tr>` : ''}</table>
<p class="muted" style="margin-top:24px">${b.footerLegal.map((x) => e(x)).join('<br/>')}</p></div>`;
  return shell(`${t.receipt} ${d.number}`, BASE_CSS(b, 'A4'), body, lang);
}

function ticketHtml(d: TicketData, b: Branding, lang: Locale): string {
  const t = L[lang];
  const css = `${BASE_CSS(b, '80mm auto')} body{width:72mm;padding:4mm;font-size:10px} td{border:0;padding:2px 0}`;
  const ids = d.seller.legalIds ?? {};
  const body = `<div style="text-align:center"><strong>${e(d.seller.name)}</strong><br/>${d.seller.address ? `${e(d.seller.address)}<br/>` : ''}${ids.nif ? `${t.nif} ${e(ids.nif)}<br/>` : ''}${ids.rccm ? `${t.rccm} ${e(ids.rccm)}<br/>` : ''}${t.number} ${e(d.number)} - ${e(d.issuedAt)}</div><hr/>
<table>${d.lines.map((l) => `<tr><td>${e(l.quantity)} x ${e(l.description)}</td><td class="r">${m(l.total)}</td></tr>`).join('')}</table><hr/>
<table><tr><td><strong>${t.total}</strong></td><td class="r"><strong>${m(d.total)}</strong></td></tr>${d.paymentMethod ? `<tr><td>${t.method}</td><td class="r">${e(d.paymentMethod)}</td></tr>` : ''}</table>
<p style="text-align:center">${t.thanks}</p>`;
  return shell(`Ticket ${d.number}`, css, body, lang);
}

function policeHtml(d: PoliceFormData, b: Branding, lang: Locale): string {
  const t = L[lang];
  const g = d.guest;
  const field = (label: string, v?: string): string =>
    `<tr><td style="width:35%" class="muted">${label}</td><td>${e(v ?? '')}</td></tr>`;
  const body = `<div style="padding:15mm">${logo(b)}<h1 style="margin-top:10px">${t.police}</h1><p>${e(d.hotel.name)}${d.hotel.address ? ` - ${e(d.hotel.address)}` : ''}</p>
<table>${field(t.last, g.lastName)}${field(t.first, g.firstName)}${field(t.birth, g.birthDate)}${field(t.place, g.birthPlace)}${field(t.nat, g.nationality)}${field(t.job, g.profession)}${field(t.addr, g.address)}${field(t.idDoc, g.idType)}${field(t.idNo, g.idNumber)}${field(t.issued, g.idIssuedBy)}</table>
<table style="margin-top:12px">${field(t.arrival, d.stay.checkIn)}${field(t.departure, d.stay.checkOut)}${field(t.room, d.stay.room)}${field(t.ref, d.stay.reservation)}</table>
${d.companions?.length ? `<h3>${t.companions}</h3><table>${d.companions.map((c) => `<tr><td>${e(c.lastName)} ${e(c.firstName)}</td><td>${e(c.birthDate ?? '')}</td></tr>`).join('')}</table>` : ''}
<p style="margin-top:40px">${t.sign} : ______________________</p></div>`;
  return shell(`${t.police}`, BASE_CSS(b, 'A4'), body, lang);
}

export const DOCUMENT_PAPER: Record<DocumentType, 'A4' | 'ticket80'> = {
  invoice: 'A4',
  receipt: 'A4',
  ticket: 'ticket80',
  police_form: 'A4',
};

/** Pure HTML rendering of a printable document. The PDF step (Gotenberg) lives in the server. */
export function renderDocumentHtml<T extends DocumentType>(
  type: T,
  data: DocumentData[T],
  branding?: Partial<Branding>,
  locale?: string,
): string {
  const b = normalizeBranding(branding);
  const lang = baseLocale(locale) ?? DEFAULT_LOCALE;
  switch (type) {
    case 'invoice':
      return invoiceHtml(data as InvoiceData, b, lang);
    case 'receipt':
      return receiptHtml(data as ReceiptData, b, lang);
    case 'ticket':
      return ticketHtml(data as TicketData, b, lang);
    case 'police_form':
      return policeHtml(data as PoliceFormData, b, lang);
    default:
      throw new Error(`Unknown document type ${String(type)}`);
  }
}

export { safeHttpUrl };
