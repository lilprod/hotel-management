import { formatMoney, money, type Money } from '@hm/shared';
import { normalizeBranding, type Branding } from './branding.js';
import { escapeHtml, safeHttpUrl } from './escape.js';
import { baseLocale, DEFAULT_LOCALE, type Locale } from './locale.js';

/** Printable documents (HTML -> PDF through Gotenberg). Every value is HTML-escaped. */
export const DOCUMENT_TYPES = [
  'invoice',
  'receipt',
  'ticket',
  'police_form',
  'police_register',
  'night_audit_report',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type MoneyValue = { amount: number; currency: string };

export interface DocParty {
  name: string;
  /** Registered company name (raison sociale), when different from the trading name. */
  legalName?: string;
  /** Legal form (SARL, SA…). */
  legalForm?: string;
  /** Tax regime (régime fiscal). */
  taxRegime?: string;
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
  /** Night of a room-night line (ISO day), appended to the description in the document locale. */
  nightDate?: string;
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
  stay?: {
    reservation: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    /** Nights actually invoiced; when lower than `nights` the period is labelled "x of y". */
    invoicedNights?: number;
  };
  lines: InvoiceLine[];
  /** Per-rate HT / TVA breakdown. */
  taxBreakdown: TaxBreakdownRow[];
  /** Tourist tax (taxe de séjour), shown as its own line outside the VAT base. */
  touristTax?: MoneyValue;
  totalNet: MoneyValue;
  totalTax: MoneyValue;
  totalGross: MoneyValue;
  paymentMethod?: string;
  /** Payments by method (code or label + amount), printed as "Espèces : 126 000 FCFA". */
  payments?: { method: string; label?: string; amount: MoneyValue }[];
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
    idIssuedOn?: string;
  };
  stay: {
    checkIn: string;
    checkOut: string;
    room?: string;
    reservation?: string;
    provenance?: string;
    destination?: string;
    purpose?: string;
  };
  companions?: { lastName: string; firstName: string; birthDate?: string }[];
}

/** Travellers register of a period (OP-25): one table row per police record. */
export interface PoliceRegisterData {
  hotel: DocParty;
  period: { from: string; to: string };
  /** Sensitive fields (document number, birth date, address) are masked in `rows`. */
  masked?: boolean;
  rows: {
    name: string;
    birth?: string;
    nationality?: string;
    profession?: string;
    address?: string;
    idDoc?: string;
    arrival: string;
    departure: string;
    room?: string;
    provenance?: string;
    destination?: string;
  }[];
}

/** Manager report of a closed business day (night audit, OP-24 / OP-100 KPIs). */
export interface NightAuditReportData {
  hotel: DocParty;
  businessDate: string;
  /** ISO instant the day was closed. */
  closedAt: string;
  closedBy?: string;
  kpis: {
    /** Occupancy in percent, as text ("66.7"). */
    occupancy: string;
    roomsSold: number;
    roomsAvailable: number;
    adr: MoneyValue;
    revpar: MoneyValue;
    roomRevenue: MoneyValue;
    totalRevenue: MoneyValue;
    arrivals: number;
    departures: number;
    inHouse: number;
    noShows: number;
  };
  /** Net revenue (HT) per department code; `label` is the department name when known. */
  revenueByDepartment: { code: string; label?: string; amount: MoneyValue }[];
  payments: { method: string; label?: string; amount: MoneyValue }[];
  /** Taxes collected: `kind` VAT (percentage) or TOURIST (fixed, taxe de séjour). */
  taxes: { code: string; name: string; kind: 'VAT' | 'TOURIST'; amount: MoneyValue }[];
  /** Pre-check warnings accepted at closing (check code + count). */
  warnings?: { code: string; count: number }[];
}

export type DocumentData = {
  invoice: InvoiceData;
  receipt: ReceiptData;
  ticket: TicketData;
  police_form: PoliceFormData;
  police_register: PoliceRegisterData;
  night_audit_report: NightAuditReportData;
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
    nightOf: 'nuit du',
    invoicedNights: 'nuits facturées',
    of: 'sur',
    taxRegime: 'Régime fiscal',
    methods: {
      CASH: 'Espèces',
      CARD: 'Carte bancaire',
      BANK_TRANSFER: 'Virement bancaire',
      MIXX: 'Mixx by Yas',
      MOOV_MONEY: 'Moov Money',
      CITY_LEDGER: 'Compte débiteur',
      LOYALTY_POINTS: 'Points de fidélité',
    } as Record<string, string>,
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
    nightOf: 'night of',
    invoicedNights: 'nights invoiced',
    of: 'of',
    taxRegime: 'Tax regime',
    methods: {
      CASH: 'Cash',
      CARD: 'Bank card',
      BANK_TRANSFER: 'Bank transfer',
      MIXX: 'Mixx by Yas',
      MOOV_MONEY: 'Moov Money',
      CITY_LEDGER: 'City ledger',
      LOYALTY_POINTS: 'Loyalty points',
    } as Record<string, string>,
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
} satisfies Record<Locale, Record<string, string | Record<string, string>>>;

const e = escapeHtml;

/** Day `YYYY-MM-DD` (or ISO timestamp) in the reader's convention: fr dd/mm/yyyy, en ISO. */
export function formatDocDate(value: string, lang: Locale): string {
  const mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!mt) return value;
  return lang === 'fr' ? `${mt[3]}/${mt[2]}/${mt[1]}` : `${mt[1]}-${mt[2]}-${mt[3]}`;
}

/**
 * Line designation in the document locale: the structured night is appended ("nuit du 22/11/2026"),
 * and ISO days left inside free text are formatted too.
 */
export function lineDescription(l: Pick<InvoiceLine, 'description' | 'nightDate'>, lang: Locale): string {
  const text = l.description.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => formatDocDate(d, lang));
  return l.nightDate ? `${text} — ${L[lang].nightOf} ${formatDocDate(l.nightDate, lang)}` : text;
}

const methodLabel = (code: string, fallback: string | undefined, lang: Locale): string =>
  (L[lang].methods as Record<string, string>)[code] ?? fallback ?? code;

/** "18" -> "18 %" (the unit is added here only, never by callers); "18 %" stays as is. */
const pct = (rate: string): string => `${rate.replace(/\s*%\s*$/, '').trim()} %`;
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
    p.legalName && p.legalName !== p.name && e([p.legalName, p.legalForm].filter(Boolean).join(' ')),
    p.address && e(p.address),
    p.phone && e(p.phone),
    p.email && e(p.email),
    ids.nif && `${t.nif} : ${e(ids.nif)}`,
    ids.rccm && `${t.rccm} : ${e(ids.rccm)}`,
    p.taxRegime && `${t.taxRegime} : ${e(p.taxRegime)}`,
    ...Object.entries(ids)
      .filter(([k, v]) => v && k !== 'nif' && k !== 'rccm')
      .map(([k, v]) => `${e(k.toUpperCase())} : ${e(v)}`),
  ].filter(Boolean);
  return `<div class="box"><div class="muted">${e(label)}</div>${lines.join('<br/>')}</div>`;
}

/** Document header: the logo if any, else the name of the issuer (the hotel), never the platform. */
function logo(b: Branding, issuer: string): string {
  return b.logoUrl
    ? `<img src="${e(b.logoUrl)}" alt="${e(issuer)}" style="max-height:60px;max-width:180px"/>`
    : `<h1>${e(issuer)}</h1>`;
}

/** Legal footer of an issuer: company name, form, NIF, RCCM, tax regime, address, then branding mentions. */
function footerHtml(s: DocParty, b: Branding, t: (typeof L)['fr'], br = ' - '): string {
  const ids = s.legalIds ?? {};
  const own = [
    [s.legalName ?? s.name, s.legalName ? s.legalForm : undefined].filter(Boolean).join(' '),
    ids.nif && `${t.nif} ${ids.nif}`,
    ids.rccm && `${t.rccm} ${ids.rccm}`,
    s.taxRegime && `${t.taxRegime} : ${s.taxRegime}`,
    s.address,
  ];
  const known = [ids.nif, ids.rccm, s.address].filter((v): v is string => !!v);
  const extra = b.footerLegal.filter((l) => !known.some((k) => l.includes(k)));
  return [...own, ...extra]
    .filter(Boolean)
    .map((x) => e(x))
    .join(br);
}

function paymentsHtml(d: InvoiceData, t: (typeof L)['fr'], lang: Locale): string {
  if (d.payments?.length)
    return `<p>${t.payment} :<br/>${d.payments
      .map((p) => `${e(methodLabel(p.method, p.label, lang))} : ${m(p.amount)}`)
      .join('<br/>')}</p>`;
  return d.paymentMethod ? `<p>${t.payment} : ${e(d.paymentMethod)}</p>` : '';
}

function invoiceHtml(d: InvoiceData, b: Branding, lang: Locale): string {
  const t = L[lang];
  const rows = d.lines
    .map(
      (l) =>
        `<tr><td>${e(lineDescription(l, lang))}</td><td class="r">${e(l.quantity)}</td><td class="r">${m(l.unitPrice)}</td><td class="r">${e(pct(l.taxRate))}</td><td class="r">${m(l.net)}</td></tr>`,
    )
    .join('');
  const tax = d.taxBreakdown
    .map(
      (r) =>
        `<tr><td>${t.rate} ${e(pct(r.rate))}</td><td class="r">${m(r.base)}</td><td class="r">${m(r.tax)}</td></tr>`,
    )
    .join('');
  const title = d.creditNoteOf ? t.creditNote : t.invoice;
  const body = `<div style="padding:15mm">
<table><tr><td style="border:0">${logo(b, d.seller.name)}</td><td style="border:0" class="r"><h1>${title}</h1>${t.number} ${e(d.number)}<br/>${t.date} : ${e(formatDocDate(d.issuedOn, lang))}${d.dueOn ? `<br/>${t.due} : ${e(formatDocDate(d.dueOn, lang))}` : ''}${d.creditNoteOf ? `<br/>${t.creditOf} ${e(d.creditNoteOf)}` : ''}</td></tr></table>
<table style="margin:12px 0"><tr><td style="border:0;width:50%">${party(t.seller, d.seller, t)}</td><td style="border:0">${party(t.buyer, d.buyer, t)}</td></tr></table>
${d.stay ? `<p>${t.stay} ${e(d.stay.reservation)} : ${t.from} ${e(formatDocDate(d.stay.checkIn, lang))} ${t.to} ${e(formatDocDate(d.stay.checkOut, lang))} (${
    d.stay.invoicedNights !== undefined && d.stay.invoicedNights < d.stay.nights
      ? `${t.invoicedNights} : ${e(d.stay.invoicedNights)} ${t.of} ${e(d.stay.nights)}`
      : `${e(d.stay.nights)} ${t.nights}`
  })</p>` : ''}
<table><thead><tr><th>${t.description}</th><th class="r">${t.qty}</th><th class="r">${t.unit}</th><th class="r">${t.rate}</th><th class="r">${t.net}</th></tr></thead><tbody>${rows}</tbody></table>
<table style="margin-top:12px"><tr><td style="border:0;width:55%;vertical-align:top">
<table><thead><tr><th>${t.rate}</th><th class="r">${t.base}</th><th class="r">${t.tax}</th></tr></thead><tbody>${tax}</tbody></table></td>
<td style="border:0"><table class="totals">
<tr><td>${t.ht}</td><td class="r">${m(d.totalNet)}</td></tr>
<tr><td>${t.tva}</td><td class="r">${m(d.totalTax)}</td></tr>
${d.touristTax ? `<tr><td>${t.touristTax}</td><td class="r">${m(d.touristTax)}</td></tr>` : ''}
<tr class="grand"><td>${t.ttc}</td><td class="r">${m(d.totalGross)}</td></tr></table></td></tr></table>
${paymentsHtml(d, t, lang)}
${(d.notes ?? []).map((n) => `<p class="muted">${e(n)}</p>`).join('')}
<p class="muted" style="margin-top:20px;text-align:center;font-size:9px">${footerHtml(d.seller, b, t)}</p></div>`;
  return shell(`${title} ${d.number}`, BASE_CSS(b, 'A4'), body, lang);
}

function receiptHtml(d: ReceiptData, b: Branding, lang: Locale): string {
  const t = L[lang];
  const body = `<div style="padding:20mm">${logo(b, d.seller.name)}<h1 style="margin-top:12px">${t.receipt}</h1><p>${t.number} ${e(d.number)} - ${e(formatDocDate(d.issuedAt, lang))}</p>
${party(t.seller, d.seller, t)}
<table style="margin-top:14px"><tr><td>${t.payer}</td><td>${e(d.payer)}</td></tr>
<tr><td>${t.amount}</td><td><strong>${m(d.amount)}</strong></td></tr>
<tr><td>${t.method}</td><td>${e(methodLabel(d.method, d.method, lang))}</td></tr>
${d.reference ? `<tr><td>${t.ref}</td><td>${e(d.reference)}</td></tr>` : ''}
${d.invoiceNumber ? `<tr><td>${t.invoiceRef}</td><td>${e(d.invoiceNumber)}</td></tr>` : ''}</table>
<p class="muted" style="margin-top:24px">${footerHtml(d.seller, b, t, '<br/>')}</p></div>`;
  return shell(`${t.receipt} ${d.number}`, BASE_CSS(b, 'A4'), body, lang);
}

function ticketHtml(d: TicketData, b: Branding, lang: Locale): string {
  const t = L[lang];
  const css = `${BASE_CSS(b, '80mm auto')} body{width:72mm;padding:4mm;font-size:10px} td{border:0;padding:2px 0}`;
  const ids = d.seller.legalIds ?? {};
  const body = `<div style="text-align:center"><strong>${e(d.seller.name)}</strong><br/>${d.seller.address ? `${e(d.seller.address)}<br/>` : ''}${ids.nif ? `${t.nif} ${e(ids.nif)}<br/>` : ''}${ids.rccm ? `${t.rccm} ${e(ids.rccm)}<br/>` : ''}${d.seller.taxRegime ? `${t.taxRegime} : ${e(d.seller.taxRegime)}<br/>` : ''}${t.number} ${e(d.number)} - ${e(formatDocDate(d.issuedAt, lang))}</div><hr/>
<table>${d.lines.map((l) => `<tr><td>${e(l.quantity)} x ${e(l.description)}</td><td class="r">${m(l.total)}</td></tr>`).join('')}</table><hr/>
<table><tr><td><strong>${t.total}</strong></td><td class="r"><strong>${m(d.total)}</strong></td></tr>${d.paymentMethod ? `<tr><td>${t.method}</td><td class="r">${e(methodLabel(d.paymentMethod, d.paymentMethod, lang))}</td></tr>` : ''}</table>
<p style="text-align:center">${t.thanks}</p>`;
  return shell(`Ticket ${d.number}`, css, body, lang);
}

const POLICE_EXTRA = {
  fr: {
    issuedOn: 'Délivrée le',
    provenance: 'Provenance',
    destination: 'Destination',
    purpose: 'Motif du séjour',
    register: 'REGISTRE DES VOYAGEURS',
    period: 'Période',
    name: 'Nom et prénoms',
    birth: 'Naissance',
    masked: 'Données sensibles masquées',
  },
  en: {
    issuedOn: 'Issued on',
    provenance: 'Coming from',
    destination: 'Going to',
    purpose: 'Purpose of stay',
    register: 'GUEST REGISTER',
    period: 'Period',
    name: 'Name',
    birth: 'Birth',
    masked: 'Sensitive data masked',
  },
} satisfies Record<Locale, Record<string, string>>;

function policeRegisterHtml(d: PoliceRegisterData, b: Branding, lang: Locale): string {
  const t = L[lang];
  const x = POLICE_EXTRA[lang];
  const head = [x.name, x.birth, t.nat, t.job, t.addr, t.idDoc, t.arrival, t.departure, t.room, x.provenance, x.destination];
  const rows = d.rows
    .map(
      (r) =>
        `<tr>${[r.name, r.birth, r.nationality, r.profession, r.address, r.idDoc, r.arrival, r.departure, r.room, r.provenance, r.destination]
          .map((v) => `<td>${e(v ?? '')}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const body = `<div style="padding:10mm">${logo(b, d.hotel.name)}<h1 style="margin-top:8px">${x.register}</h1><p>${e(d.hotel.name)}${d.hotel.address ? ` - ${e(d.hotel.address)}` : ''}<br/>${x.period} : ${e(d.period.from)} → ${e(d.period.to)}${d.masked ? ` <span class="muted">(${x.masked})</span>` : ''}</p>
<table style="font-size:9px"><tr>${head.map((h) => `<th>${e(h)}</th>`).join('')}</tr>${rows}</table></div>`;
  return shell(x.register, BASE_CSS(b, 'A4 landscape'), body, lang);
}

function policeHtml(d: PoliceFormData, b: Branding, lang: Locale): string {
  const t = L[lang];
  const x = POLICE_EXTRA[lang];
  const g = d.guest;
  const field = (label: string, v?: string): string =>
    `<tr><td style="width:35%" class="muted">${label}</td><td>${e(v ?? '')}</td></tr>`;
  const body = `<div style="padding:15mm">${logo(b, d.hotel.name)}<h1 style="margin-top:10px">${t.police}</h1><p>${e(d.hotel.name)}${d.hotel.address ? ` - ${e(d.hotel.address)}` : ''}</p>
<table>${field(t.last, g.lastName)}${field(t.first, g.firstName)}${field(t.birth, g.birthDate)}${field(t.place, g.birthPlace)}${field(t.nat, g.nationality)}${field(t.job, g.profession)}${field(t.addr, g.address)}${field(t.idDoc, g.idType)}${field(t.idNo, g.idNumber)}${field(t.issued, g.idIssuedBy)}</table>
${g.idIssuedOn ? `<table style="margin-top:12px">${field(x.issuedOn, g.idIssuedOn)}</table>` : ''}
<table style="margin-top:12px">${field(t.arrival, d.stay.checkIn)}${field(t.departure, d.stay.checkOut)}${field(t.room, d.stay.room)}${field(t.ref, d.stay.reservation)}${field(x.provenance, d.stay.provenance)}${field(x.destination, d.stay.destination)}${field(x.purpose, d.stay.purpose)}</table>
${d.companions?.length ? `<h3>${t.companions}</h3><table>${d.companions.map((c) => `<tr><td>${e(c.lastName)} ${e(c.firstName)}</td><td>${e(c.birthDate ?? '')}</td></tr>`).join('')}</table>` : ''}
<p style="margin-top:40px">${t.sign} : ______________________</p></div>`;
  return shell(`${t.police}`, BASE_CSS(b, 'A4'), body, lang);
}

export const DOCUMENT_PAPER: Record<DocumentType, 'A4' | 'ticket80'> = {
  invoice: 'A4',
  receipt: 'A4',
  ticket: 'ticket80',
  police_form: 'A4',
  police_register: 'A4',
  night_audit_report: 'A4',
};

const NA = {
  fr: {
    title: 'RAPPORT DE CLÔTURE JOURNALIÈRE',
    day: 'Date d’exploitation',
    closedAt: 'Clôturée le',
    by: 'par',
    kpis: 'Indicateurs',
    occupancy: 'Taux d’occupation (TO)',
    roomsSold: 'Chambres vendues',
    adr: 'Prix moyen (ADR)',
    revpar: 'RevPAR',
    roomRevenue: 'CA hébergement',
    totalRevenue: 'CA total (HT)',
    movements: 'Mouvements',
    arrivals: 'Arrivées',
    departures: 'Départs',
    inHouse: 'En séjour',
    noShows: 'No-shows',
    byDept: 'Chiffre d’affaires par département (HT)',
    dept: 'Département',
    amount: 'Montant',
    payments: 'Encaissements par moyen de paiement',
    method: 'Moyen',
    taxes: 'Taxes collectées',
    tax: 'Taxe',
    vat: 'TVA',
    tourist: 'Taxe de séjour',
    total: 'Total',
    none: 'Aucun',
    warnings: 'Points d’attention à la clôture',
    depts: { ROOM: 'Hébergement', NO_SHOW: 'Pénalités de no-show', EXTRA: 'Extras', DISCOUNT: 'Remises', OTHER: 'Autres' } as Record<string, string>,
    checks: {
      PENDING_DEPARTURES: 'Départs du jour non enregistrés',
      OPEN_CASH_SESSIONS: 'Sessions de caisse ouvertes',
      NEGATIVE_BALANCES: 'Folios au solde créditeur',
      UNASSIGNED_IN_HOUSE: 'Séjours sans chambre affectée',
    } as Record<string, string>,
  },
  en: {
    title: 'DAILY CLOSING REPORT',
    day: 'Business date',
    closedAt: 'Closed on',
    by: 'by',
    kpis: 'Key figures',
    occupancy: 'Occupancy',
    roomsSold: 'Rooms sold',
    adr: 'ADR',
    revpar: 'RevPAR',
    roomRevenue: 'Room revenue',
    totalRevenue: 'Total revenue (net)',
    movements: 'Movements',
    arrivals: 'Arrivals',
    departures: 'Departures',
    inHouse: 'In house',
    noShows: 'No-shows',
    byDept: 'Revenue by department (net)',
    dept: 'Department',
    amount: 'Amount',
    payments: 'Payments by method',
    method: 'Method',
    taxes: 'Taxes collected',
    tax: 'Tax',
    vat: 'VAT',
    tourist: 'Tourist tax',
    total: 'Total',
    none: 'None',
    warnings: 'Warnings at closing',
    depts: { ROOM: 'Rooms', NO_SHOW: 'No-show penalties', EXTRA: 'Extras', DISCOUNT: 'Discounts', OTHER: 'Other' } as Record<string, string>,
    checks: {
      PENDING_DEPARTURES: 'Departures not checked out',
      OPEN_CASH_SESSIONS: 'Open cash sessions',
      NEGATIVE_BALANCES: 'Folios with a credit balance',
      UNASSIGNED_IN_HOUSE: 'In-house stays without a room',
    } as Record<string, string>,
  },
} as const;

function formatInstant(iso: string, lang: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatDocDate(d.toISOString().slice(0, 10), lang)} ${d.toISOString().slice(11, 16)} UTC`;
}

function nightAuditHtml(d: NightAuditReportData, b: Branding, lang: Locale): string {
  const t = NA[lang];
  const k = d.kpis;
  const row = (label: string, value: string) => `<tr><td>${e(label)}</td><td class="r">${value}</td></tr>`;
  const table = (head: string, rows: string[], total?: MoneyValue) =>
    `<table><thead><tr><th>${head}</th><th class="r">${t.amount}</th></tr></thead><tbody>${
      rows.length ? rows.join('') : `<tr><td colspan="2" class="muted">${t.none}</td></tr>`
    }${total ? `<tr class="grand"><td>${t.total}</td><td class="r">${m(total)}</td></tr>` : ''}</tbody></table>`;
  const sum = (xs: { amount: MoneyValue }[]): MoneyValue | undefined =>
    xs.length ? { amount: xs.reduce((s, x) => s + x.amount.amount, 0), currency: xs[0]!.amount.currency } : undefined;
  const body = `<div style="padding:15mm">
<table><tr><td style="border:0">${logo(b, d.hotel.name)}</td><td style="border:0" class="r"><h1>${t.title}</h1>${t.day} : <strong>${e(formatDocDate(d.businessDate, lang))}</strong><br/>${t.closedAt} ${e(formatInstant(d.closedAt, lang))}${d.closedBy ? ` ${t.by} ${e(d.closedBy)}` : ''}</td></tr></table>
<table style="margin-top:12px"><tr><td style="border:0;width:50%;vertical-align:top">
<h3>${t.kpis}</h3><table class="totals">
${row(t.occupancy, `${e(k.occupancy)} %`)}
${row(t.roomsSold, `${e(k.roomsSold)} / ${e(k.roomsAvailable)}`)}
${row(t.adr, m(k.adr))}
${row(t.revpar, m(k.revpar))}
${row(t.roomRevenue, m(k.roomRevenue))}
${row(t.totalRevenue, m(k.totalRevenue))}</table></td>
<td style="border:0;vertical-align:top"><h3>${t.movements}</h3><table class="totals">
${row(t.arrivals, e(k.arrivals))}
${row(t.departures, e(k.departures))}
${row(t.inHouse, e(k.inHouse))}
${row(t.noShows, e(k.noShows))}</table></td></tr></table>
<h3>${t.byDept}</h3>
${table(t.dept, d.revenueByDepartment.map((r) => `<tr><td>${e(r.label ?? t.depts[r.code] ?? r.code)}</td><td class="r">${m(r.amount)}</td></tr>`), sum(d.revenueByDepartment))}
<h3>${t.payments}</h3>
${table(t.method, d.payments.map((p) => `<tr><td>${e(methodLabel(p.method, p.label, lang))}</td><td class="r">${m(p.amount)}</td></tr>`), sum(d.payments))}
<h3>${t.taxes}</h3>
${table(t.tax, d.taxes.map((x) => `<tr><td>${e(x.name)} (${x.kind === 'VAT' ? t.vat : t.tourist})</td><td class="r">${m(x.amount)}</td></tr>`), sum(d.taxes))}
${d.warnings?.length ? `<h3>${t.warnings}</h3><ul>${d.warnings.map((w) => `<li>${e(t.checks[w.code] ?? w.code)} : ${e(w.count)}</li>`).join('')}</ul>` : ''}
<p class="muted" style="margin-top:20px;text-align:center;font-size:9px">${footerHtml(d.hotel, b, L[lang])}</p></div>`;
  return shell(`${t.title} ${d.businessDate}`, BASE_CSS(b, 'A4'), body, lang);
}

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
    case 'police_register':
      return policeRegisterHtml(data as PoliceRegisterData, b, lang);
    case 'night_audit_report':
      return nightAuditHtml(data as NightAuditReportData, b, lang);
    default:
      throw new Error(`Unknown document type ${String(type)}`);
  }
}

export { safeHttpUrl };
