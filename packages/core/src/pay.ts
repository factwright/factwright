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

const MONEY = String.raw`(\$)?\s*(\d+(?:\.\d+)?)\s*([kKmM](?![a-z]))?`;
const RANGES = new RegExp(`${MONEY}\\s*(?:–|—|-|to)\\s*${MONEY}`, 'g');
const AMOUNTS = new RegExp(MONEY, 'g');
const HOURLY = /\b(hour|hourly|hr)\b|\/\s*h(ou)?r\b/i;
const HOURS_PER_YEAR = 2080;
const MIN_ANNUAL = 15_000;
const MAX_ANNUAL = 5_000_000;

/**
 * Reads an annual pay range from posting text such as "$190,000 - $250,000", "$150-200k" or
 * "$70-$85 an hour". Text in parentheses is ignored, because it usually describes another level
 * ("Senior: $142k-$172k (Staff: $180k-$220k)"). Returns null when there's no believable figure.
 */
export function parsePay(text: string | null | undefined): PayRange | null {
  if (!text) return null;
  const cleaned = text
    .replace(/401\s*\(?k\)?/gi, '')
    .replace(/,/g, '')
    .replace(/\([^)]*\)/g, ' ');

  const amounts = findAmounts(cleaned);
  const usesThousands = amounts.some((amount) => amount.unit === 'k');
  const hourly = HOURLY.test(cleaned);
  const annual = amounts
    .map((amount) => toAnnual(amount, usesThousands, hourly))
    .filter((value) => value >= MIN_ANNUAL && value <= MAX_ANNUAL);

  return annual.length > 0 ? { min: Math.min(...annual), max: Math.max(...annual) } : null;
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
