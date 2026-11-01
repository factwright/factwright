/** The US's states and DC, and Canada's provinces and territories, by their two letters. */
const REGION_CODES = new Set(
  `AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY
   NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AB BC MB NB NL NS NT NU ON PE QC SK YT`.split(
    /\s+/,
  ),
);

/** Those by name, and the countries and continents people most often say, in lowercase. */
const REGION_NAMES = new Set(
  `alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|
  idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|
  minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|
  new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|
  south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|
  wisconsin|wyoming|alberta|british columbia|manitoba|new brunswick|newfoundland|nova scotia|
  ontario|quebec|saskatchewan|africa|asia|europe|latin america|north america|south america|
  argentina|australia|austria|belgium|brazil|canada|chile|china|
  colombia|czech republic|denmark|egypt|england|finland|france|germany|greece|hong kong|india|
  indonesia|ireland|israel|italy|japan|kenya|malaysia|mexico|netherlands|new zealand|nigeria|norway|
  pakistan|philippines|poland|portugal|romania|saudi arabia|scotland|singapore|south africa|
  south korea|spain|sweden|switzerland|taiwan|thailand|turkey|uae|uk|ukraine|united arab emirates|
  united kingdom|united states|usa|vietnam|wales`
    .split('|')
    .map((name) => name.trim()),
);

const isCode = (place: string) => REGION_CODES.has(place.toUpperCase());
/** Whether it's a state, a province, a country or a continent, by name, in any case. */
export const isRegion = (place: string) => REGION_NAMES.has(place.toLowerCase());

/** Places with each one that goes with the place before it joined on, as "City, State". */
function joined(
  places: readonly string[],
  goesWith: (place: string, last: string) => boolean,
): string[] {
  const kept: string[] = [];
  for (const place of places) {
    const last = kept.at(-1);
    if (last !== undefined && !last.includes(',') && goesWith(place, last)) {
      kept[kept.length - 1] = `${last}, ${place}`;
    } else {
      kept.push(place);
    }
  }
  return kept;
}

/**
 * The places in what's typed or pasted, where the person sees at once what it came to: "Chicago,
 * IL" is one, "Columbus, Ohio" and "Paris, France" are one each, and "Chicago, Denver" is two. A
 * region after a region stays on its own, as in "Ohio, Michigan", but NY goes with New York.
 */
export function placesIn(text: string): string[] {
  const parts = text
    .split(/[,\n]/)
    .map((each) => each.trim())
    .filter(Boolean);
  return joined(parts, (place, last) =>
    isCode(place) ? !isCode(last) : isRegion(place) && !isCode(last) && !isRegion(last),
  );
}

/**
 * Cities as Profile has them, with a state back on its city, as Chicago and IL used to be split by
 * the comma in "Chicago, IL". Saved, they can't say whether that's what happened, or whether they
 * were two places, and joining two places loses both where leaving a city and its state apart only
 * adds a search. So only a state's two letters join, and LA, NY and DC, which are also cities, do
 * only after the city they belong to, if any.
 */
export function savedPlaces(places: readonly string[]): string[] {
  const after: Readonly<Record<string, string>> = { NY: 'new york', DC: 'washington' };
  return joined(places, (place, last) => {
    const code = place.toUpperCase();
    if (!isCode(place) || code === 'LA') return false;
    if (after[code]) return after[code] === last.toLowerCase();
    return !isCode(last) && !isRegion(last);
  });
}
