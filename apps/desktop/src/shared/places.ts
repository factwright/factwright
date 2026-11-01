/** The US's states and DC, and Canada's provinces and territories, by their two letters, and the UK. */
const REGION_CODES = new Set(
  `AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY
   NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AB BC MB NB NL NS NT NU ON PE QC SK YT UK`.split(
    /\s+/,
  ),
);

/** The same by name, in lowercase, as they're told apart. */
const REGION_NAMES = new Set([
  'alabama',
  'alaska',
  'arizona',
  'arkansas',
  'california',
  'colorado',
  'connecticut',
  'delaware',
  'florida',
  'georgia',
  'hawaii',
  'idaho',
  'illinois',
  'indiana',
  'iowa',
  'kansas',
  'kentucky',
  'louisiana',
  'maine',
  'maryland',
  'massachusetts',
  'michigan',
  'minnesota',
  'mississippi',
  'missouri',
  'montana',
  'nebraska',
  'nevada',
  'new hampshire',
  'new jersey',
  'new mexico',
  'new york',
  'north carolina',
  'north dakota',
  'ohio',
  'oklahoma',
  'oregon',
  'pennsylvania',
  'rhode island',
  'south carolina',
  'south dakota',
  'tennessee',
  'texas',
  'utah',
  'vermont',
  'virginia',
  'washington',
  'west virginia',
  'wisconsin',
  'wyoming',
  'alberta',
  'british columbia',
  'manitoba',
  'new brunswick',
  'newfoundland',
  'nova scotia',
  'ontario',
  'quebec',
  'saskatchewan',
]);

const isCode = (place: string) => REGION_CODES.has(place.toUpperCase());
const isName = (place: string) => REGION_NAMES.has(place.toLowerCase());

/**
 * Places with each state or province back on its city: Chicago and IL come to "Chicago, IL". A
 * comma used to end an entry in Profile's list of cities, so saved answers can hold them apart. A
 * state after a state stays on its own, as Ohio and Michigan are two places, and so is New York
 * after New Jersey, but NY still goes with New York, as a city.
 */
export function joinPlaces(places: readonly string[]): string[] {
  const joined: string[] = [];
  for (const place of places) {
    const last = joined.at(-1);
    const onLast =
      last !== undefined &&
      !last.includes(',') &&
      (isCode(place) ? !isCode(last) : isName(place) && !isCode(last) && !isName(last));
    if (onLast) joined[joined.length - 1] = `${last}, ${place}`;
    else joined.push(place);
  }
  return joined;
}

/**
 * The places in what's typed or pasted: "Chicago, IL" is one, "Chicago, Denver" is two, and so is
 * "Chicago, IL, Denver, CO".
 */
export function placesIn(text: string): string[] {
  return joinPlaces(
    text
      .split(/[,\n]/)
      .map((each) => each.trim())
      .filter(Boolean),
  );
}
