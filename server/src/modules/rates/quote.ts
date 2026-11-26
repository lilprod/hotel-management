/**
 * Pure stay price calculator (OP-04). No I/O: every input is passed in, amounts are integers
 * (minor units, XOF by default), nights are DATEs (arrival included, departure excluded).
 *
 * Rate selection per night, among the rates of (rate plan, room type) whose day-of-week mask
 * contains the night and whose season (if any) contains the night:
 *   1. highest season priority (a rate without season has the lowest priority);
 *   2. most specific day mask (fewest days: a weekend rate beats an all-week rate);
 *   3. lowest id (deterministic).
 * Taxes: PERCENT (inclusive or exclusive), FIXED_PER_PERSON_NIGHT, FIXED_PER_NIGHT.
 */

export type TaxKind = 'PERCENT' | 'FIXED_PER_PERSON_NIGHT' | 'FIXED_PER_NIGHT';

export interface QuoteRate {
  id: string;
  seasonId: string | null;
  /** Bit i = day i of the week, 0 = Sunday … 6 = Saturday (127 = every day). */
  dowMask: number;
  price: number;
  extraAdult: number;
  extraChild: number;
  minStay: number;
  /** Maximum stay when this rate applies on the arrival night (null = none). */
  maxStay?: number | null;
  /** No arrival on a night this rate applies to. */
  closedToArrival?: boolean;
  /** No departure on a day this rate applies to. */
  closedToDeparture?: boolean;
}

export interface QuoteSeason {
  id: string;
  /** YYYY-MM-DD, inclusive. */
  fromDate: string;
  /** YYYY-MM-DD, inclusive. */
  toDate: string;
  priority: number;
}

export interface QuoteTax {
  id: string;
  code: string;
  name: string;
  type: TaxKind;
  /** PERCENT: percentage as a decimal string ("18", "7.5"); fixed taxes: integer minor units. */
  value: string;
  inclusive: boolean;
}

export interface QuoteRoomType {
  baseOccupancy: number;
  maxAdults: number;
  maxChildren: number;
}

export interface QuoteInput {
  arrival: string;
  departure: string;
  adults: number;
  children: number;
}

export interface QuoteData {
  currency: string;
  roomType: QuoteRoomType;
  rates: readonly QuoteRate[];
  seasons: readonly QuoteSeason[];
  taxes: readonly QuoteTax[];
}

export interface NightLine {
  date: string;
  rateId: string;
  seasonId: string | null;
  base: number;
  extraAdults: number;
  extraAdultAmount: number;
  extraChildren: number;
  extraChildAmount: number;
  total: number;
}

export interface TaxLine {
  taxId: string;
  code: string;
  name: string;
  type: TaxKind;
  inclusive: boolean;
  /** Tax amount (included in the gross price when inclusive, added to it otherwise). */
  amount: number;
}

export interface Quote {
  currency: string;
  nights: number;
  nightly: NightLine[];
  roomTotal: number;
  extrasTotal: number;
  /** Room + extras as priced (before exclusive taxes). */
  grossSubtotal: number;
  /** Base excluding inclusive taxes. */
  netSubtotal: number;
  taxes: TaxLine[];
  inclusiveTaxTotal: number;
  exclusiveTaxTotal: number;
  /** What the guest pays: gross subtotal + exclusive taxes. */
  total: number;
  minStay: number;
  maxStay: number | null;
}

export class QuoteError extends Error {
  constructor(
    readonly code:
      | 'INVALID_DATES'
      | 'INVALID_OCCUPANCY'
      | 'NO_RATE'
      | 'MIN_STAY'
      | 'MAX_STAY'
      | 'CLOSED_TO_ARRIVAL'
      | 'CLOSED_TO_DEPARTURE'
      | 'INVALID_DATA',
    message: string,
    readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'QuoteError';
  }
}

const DAY_MS = 86_400_000;

function parseDay(s: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new QuoteError('INVALID_DATES', `Invalid date ${s}`);
  const t = Date.parse(`${s}T00:00:00.000Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s)
    throw new QuoteError('INVALID_DATES', `Invalid date ${s}`);
  return t;
}

const popcount = (n: number): number => {
  let c = 0;
  for (let v = n; v > 0; v >>= 1) c += v & 1;
  return c;
};

/** Nights of a stay as YYYY-MM-DD with their day of week (0 = Sunday). */
export function stayNights(arrival: string, departure: string): { date: string; dow: number }[] {
  const from = parseDay(arrival);
  const to = parseDay(departure);
  if (to <= from) throw new QuoteError('INVALID_DATES', 'Departure must be after arrival');
  const out: { date: string; dow: number }[] = [];
  for (let t = from; t < to; t += DAY_MS) {
    const d = new Date(t);
    out.push({ date: d.toISOString().slice(0, 10), dow: d.getUTCDay() });
  }
  return out;
}

/** round(a * b / c) for non-negative integers, half up, exact (BigInt). */
function mulDivRound(a: bigint, b: bigint, c: bigint): number {
  return Number((2n * a * b + c) / (2n * c));
}

/** Decimal string ("7.5") → [scaled integer, scale] with 4 decimals max. */
function parseRate(value: string): bigint {
  const m = /^(\d{1,5})(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!m) throw new QuoteError('INVALID_DATA', `Invalid tax value ${value}`);
  return BigInt(m[1]! + (m[2] ?? '').padEnd(4, '0'));
}
const SCALE = 10_000n;

function assertInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new QuoteError('INVALID_DATA', `${what} must be a non-negative integer`);
}

export function pickRate(
  rates: readonly QuoteRate[],
  seasons: ReadonlyMap<string, QuoteSeason>,
  date: string,
  dow: number,
): QuoteRate | undefined {
  let best: { rate: QuoteRate; prio: number; spec: number } | undefined;
  for (const rate of rates) {
    if (!(rate.dowMask & (1 << dow))) continue;
    let prio = -1;
    if (rate.seasonId) {
      const s = seasons.get(rate.seasonId);
      if (!s || date < s.fromDate || date > s.toDate) continue;
      prio = s.priority;
    }
    const spec = popcount(rate.dowMask);
    if (
      !best ||
      prio > best.prio ||
      (prio === best.prio && (spec < best.spec || (spec === best.spec && rate.id < best.rate.id)))
    )
      best = { rate, prio, spec };
  }
  return best?.rate;
}

export function priceStay(data: QuoteData, input: QuoteInput): Quote {
  const { adults, children } = input;
  assertInt(adults, 'adults');
  assertInt(children, 'children');
  const rt = data.roomType;
  if (adults < 1) throw new QuoteError('INVALID_OCCUPANCY', 'At least one adult is required');
  if (adults > rt.maxAdults || children > rt.maxChildren)
    throw new QuoteError('INVALID_OCCUPANCY', 'Occupancy exceeds the room type capacity', {
      maxAdults: rt.maxAdults,
      maxChildren: rt.maxChildren,
    });

  const nights = stayNights(input.arrival, input.departure);
  const seasons = new Map(data.seasons.map((s) => [s.id, s]));
  const extraAdults = Math.max(0, adults - rt.baseOccupancy);

  const nightly: NightLine[] = [];
  let firstRate: QuoteRate | undefined;
  for (const n of nights) {
    const rate = pickRate(data.rates, seasons, n.date, n.dow);
    if (!rate)
      throw new QuoteError('NO_RATE', `No rate for the night of ${n.date}`, { date: n.date });
    for (const v of [rate.price, rate.extraAdult, rate.extraChild]) assertInt(v, 'rate amount');
    firstRate ??= rate;
    const extraAdultAmount = extraAdults * rate.extraAdult;
    const extraChildAmount = children * rate.extraChild;
    nightly.push({
      date: n.date,
      rateId: rate.id,
      seasonId: rate.seasonId,
      base: rate.price,
      extraAdults,
      extraAdultAmount,
      extraChildren: children,
      extraChildAmount,
      total: rate.price + extraAdultAmount + extraChildAmount,
    });
  }

  // Stay restrictions are driven by the rate applied on the arrival night (min / max stay,
  // closed to arrival) and by the rate that would apply on the departure day (closed to
  // departure; no rate that day = no restriction).
  const minStay = firstRate?.minStay ?? 1;
  if (nights.length < minStay)
    throw new QuoteError('MIN_STAY', `Minimum stay is ${minStay} night(s)`, {
      minStay,
      nights: nights.length,
    });
  const maxStay = firstRate?.maxStay ?? null;
  if (maxStay !== null && nights.length > maxStay)
    throw new QuoteError('MAX_STAY', `Maximum stay is ${maxStay} night(s)`, {
      maxStay,
      nights: nights.length,
    });
  if (firstRate?.closedToArrival)
    throw new QuoteError('CLOSED_TO_ARRIVAL', `No arrival on ${input.arrival}`, {
      date: input.arrival,
    });
  const depDow = new Date(parseDay(input.departure)).getUTCDay();
  if (pickRate(data.rates, seasons, input.departure, depDow)?.closedToDeparture)
    throw new QuoteError('CLOSED_TO_DEPARTURE', `No departure on ${input.departure}`, {
      date: input.departure,
    });

  const roomTotal = nightly.reduce((s, n) => s + n.base, 0);
  const extrasTotal = nightly.reduce((s, n) => s + n.extraAdultAmount + n.extraChildAmount, 0);
  const gross = roomTotal + extrasTotal;
  const persons = BigInt(adults + children);
  const nightCount = BigInt(nights.length);

  const taxLines: TaxLine[] = [];
  const line = (t: QuoteTax, amount: number): void => {
    taxLines.push({
      taxId: t.id,
      code: t.code,
      name: t.name,
      type: t.type,
      inclusive: t.inclusive,
      amount,
    });
  };

  // 1. Fixed taxes (amounts are exact, whatever the inclusive flag).
  for (const t of data.taxes.filter((x) => x.type !== 'PERCENT')) {
    if (!/^\d+(\.0+)?$/.test(t.value))
      throw new QuoteError('INVALID_DATA', `Fixed tax ${t.code} must be an integer amount`);
    const unit = BigInt(t.value.split('.')[0]!);
    line(
      t,
      Number(unit * (t.type === 'FIXED_PER_PERSON_NIGHT' ? persons * nightCount : nightCount)),
    );
  }
  const fixedIncl = taxLines.filter((l) => l.inclusive).reduce((s, l) => s + l.amount, 0);

  // 2. Inclusive percentages are extracted from the gross price (net = gross / (1 + Σ rates)).
  const inclPct = data.taxes.filter((x) => x.type === 'PERCENT' && x.inclusive);
  const inclRates = inclPct.map((t) => parseRate(t.value));
  const inclSum = inclRates.reduce((s, r) => s + r, 0n);
  const pctBase = BigInt(gross - fixedIncl);
  let inclusivePctTotal = 0;
  inclPct.forEach((t, i) => {
    const amount = mulDivRound(pctBase, inclRates[i]!, 100n * SCALE + inclSum);
    inclusivePctTotal += amount;
    line(t, amount);
  });
  const net = gross - fixedIncl - inclusivePctTotal;

  // 3. Exclusive percentages apply on the net base and are added to the price.
  for (const t of data.taxes.filter((x) => x.type === 'PERCENT' && !x.inclusive))
    line(t, mulDivRound(BigInt(net), parseRate(t.value), 100n * SCALE));

  const inclusiveTaxTotal = taxLines.filter((l) => l.inclusive).reduce((s, l) => s + l.amount, 0);
  const exclusiveTaxTotal = taxLines.filter((l) => !l.inclusive).reduce((s, l) => s + l.amount, 0);
  return {
    currency: data.currency,
    nights: nights.length,
    nightly,
    roomTotal,
    extrasTotal,
    grossSubtotal: gross,
    netSubtotal: net,
    taxes: taxLines,
    inclusiveTaxTotal,
    exclusiveTaxTotal,
    total: gross + exclusiveTaxTotal,
    minStay,
    maxStay,
  };
}
