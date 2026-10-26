/** An annual pay range in US dollars. */
export interface PayRange {
  min: number;
  max: number;
}

interface Amount {
  hasDollarSign: boolean;
  value: number;
  unit: '' | 'k' | 'm';
}

/**
 * An amount: a dollar sign, the number, and k or m. Each space is taken only where what follows it
 * fits, and a number is read from its first digit, so text from a page, such as a long run of
 * spaces or digits, takes as long as it is long, never longer.
 */
const MONEY = String.raw`(?:(\$)\s*)?(?<!\d)(?<!\d\.)(\d+(?:\.\d+)?)(?:\s*([kKmM])(?![a-z]))?`;
// "to" as iCIMS writes it too: "$144000.00 To $237500.00 / year".
const RANGES = new RegExp(`${MONEY}\\s*(?:–|—|-|[tT][oO])\\s*${MONEY}`, 'g');
const AMOUNTS = new RegExp(MONEY, 'g');
const HOURLY = /\b(hour|hourly|hr)\b|\/\s*h(ou)?r\b/i;
const HOURS_PER_YEAR = 2080;
const MIN_ANNUAL = 15_000;
const MAX_ANNUAL = 5_000_000;
/** The longest option a choice's pay band is read from: one that runs longer names no band. */
const MAX_BAND = 300;

/**
 * Text with each part in parentheses taken out, from a "(" to the next ")", in one pass: a page's
 * long run of "(" with no ")" takes as long as it is long. A "(" with no ")" after it stays.
 */
function withoutParentheses(text: string): string {
  let kept = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('(', at);
    const close = open < 0 ? -1 : text.indexOf(')', open);
    if (close < 0) return kept + text.slice(at);
    kept += `${text.slice(at, open)} `;
    at = close + 1;
  }
}

/**
 * Reads an annual pay range from posting text such as "$190,000 - $250,000", "$150-200k" or
 * "$70-$85 an hour". Text in parentheses is ignored, because it usually describes another level
 * ("Senior: $142k-$172k (Staff: $180k-$220k)"). Returns null when there's no believable figure.
 */
export function parsePay(text: string | null | undefined): PayRange | null {
  if (!text) return null;
  const cleaned = withoutParentheses(text.replace(/401\s*\(?k\)?/gi, '').replace(/,/g, ''));

  const amounts = findAmounts(cleaned);
  const usesThousands = amounts.some((amount) => amount.unit === 'k');
  const hourly = HOURLY.test(cleaned);
  const annual = amounts
    .map((amount) => toAnnual(amount, usesThousands, hourly))
    .filter((value) => value >= MIN_ANNUAL && value <= MAX_ANNUAL);

  return annual.length > 0 ? { min: Math.min(...annual), max: Math.max(...annual) } : null;
}

/** Words that make an amount the top of a band, as "Under $50,000" or "$50k or less" do. */
const UP_TO =
  /\b(under|below|less than|lower than|up to|no more than|not more than|or less|or lower|or below)\b|^\s*</i;

/** Words that make an amount the bottom of a band, as "$200,000 or more" or "Over $200k" do. */
const AND_UP =
  /\b(over|above|more than|greater than|at least|or more|or higher|or above|or greater|and (above|up|over|higher|more|greater))\b|\d(?:\s*[kKmM])?\s*\+|^\s*>/i;

/**
 * The pay a choice's option names, as a band of a year's pay: "$100,000 - $149,999", "Under
 * $50k", "$200,000 or more", "$150k+", or "$50-$60 an hour". An amount alone is a band of its
 * own. Null for an option that names no pay, as "Prefer not to say".
 */
export function payBand(option: string): PayRange | null {
  if (option.length > MAX_BAND) return null;
  const cleaned = withoutParentheses(option.replace(/,/g, ''));
  // The first two amounts that look like money, as in "$40,000 up to $60,000", and never a
  // tier's number before them, as in "Tier 2 - $100k-$150k". Else a range with one end that
  // looks like money, as "100-150k".
  const money = [...cleaned.matchAll(AMOUNTS)]
    .map((match) => toAmount(match[1], match[2], match[3]))
    .filter(looksLikeMoney);
  const amounts = money.length >= 2 ? money.slice(0, 2) : findAmounts(cleaned);
  const usesThousands = amounts.some((amount) => amount.unit === 'k');
  const hourly = HOURLY.test(cleaned);
  // Unlike a posting's pay, a band can start at nothing, as "$0 - $49,999" does.
  const values = amounts
    .map((amount) => toAnnual(amount, usesThousands, hourly))
    .filter((value) => value <= MAX_ANNUAL);
  if (values.length === 0) return null;
  const [low, high] = [Math.min(...values), Math.max(...values)];
  if (values.length > 1) return { min: low, max: high };
  if (UP_TO.test(cleaned)) return { min: 0, max: low };
  if (AND_UP.test(cleaned)) return { min: low, max: Number.POSITIVE_INFINITY };
  return { min: low, max: low };
}

/** The first range that looks like money or, failing that, the first single amount that does. */
function findAmounts(text: string): Amount[] {
  for (const match of text.matchAll(RANGES)) {
    const range = [toAmount(match[1], match[2], match[3]), toAmount(match[4], match[5], match[6])];
    if (range.some(looksLikeMoney)) return range;
  }
  for (const match of text.matchAll(AMOUNTS)) {
    const amount = toAmount(match[1], match[2], match[3]);
    if (looksLikeMoney(amount)) return [amount];
  }
  return [];
}

function toAmount(
  dollarSign: string | undefined,
  digits: string | undefined,
  unit: string | undefined,
): Amount {
  const lowerUnit = unit?.toLowerCase();
  return {
    hasDollarSign: dollarSign === '$',
    value: Number(digits),
    unit: lowerUnit === 'k' || lowerUnit === 'm' ? lowerUnit : '',
  };
}

function looksLikeMoney(amount: Amount): boolean {
  return amount.hasDollarSign || amount.unit !== '' || amount.value >= 20_000;
}

function toAnnual(amount: Amount, usesThousands: boolean, hourly: boolean): number {
  const multiplier = amount.unit === 'k' ? 1_000 : amount.unit === 'm' ? 1_000_000 : 1;
  let value = amount.value * multiplier;
  // "$150-200k": the k applies to both ends of the range.
  if (amount.unit === '' && usesThousands && value < 1_000) value *= 1_000;
  // "$70-$85 an hour": a full-time year is 2,080 hours.
  if (hourly && value < 500) value *= HOURS_PER_YEAR;
  return Math.round(value);
}
