/**
 * Countries, by the names people and forms give them, for answering where you can work: "Are you
 * authorized to work in the US?" names the United States, as "U.S.", "USA" and "America" do. A
 * question that names a region, such as "the EU", names no one country.
 */

/**
 * Each country by its two letters, then the names a form may list it by, its usual one first, and
 * after a slash, other words that name it in a sentence.
 */
const TABLE = `
AF Afghanistan
AL Albania
DZ Algeria
AD Andorra
AO Angola
AG Antigua and Barbuda
AR Argentina
AM Armenia
AU Australia / New South Wales; Queensland; Tasmania; Western Australia; South Australia
AT Austria
AZ Azerbaijan
BS Bahamas; The Bahamas
BH Bahrain
BD Bangladesh
BB Barbados
BY Belarus
BE Belgium
BZ Belize
BJ Benin
BT Bhutan
BO Bolivia
BA Bosnia and Herzegovina / Bosnia
BW Botswana
BR Brazil; Brasil
BN Brunei
BG Bulgaria
BF Burkina Faso
BI Burundi
CV Cabo Verde; Cape Verde
KH Cambodia
CM Cameroon
CA Canada / Ontario; Quebec; British Columbia; Alberta; Manitoba; Saskatchewan; Nova Scotia; New Brunswick; Newfoundland; Prince Edward Island
CF Central African Republic
TD Chad
CL Chile
CN China; People's Republic of China; Mainland China / PRC
CO Colombia
KM Comoros
CG Republic of the Congo; Congo-Brazzaville
CD Democratic Republic of the Congo; DR Congo; Congo-Kinshasa / DRC
CR Costa Rica
CI Côte d'Ivoire; Ivory Coast
HR Croatia
CU Cuba
CY Cyprus
CZ Czechia; Czech Republic
DK Denmark
DJ Djibouti
DM Dominica
DO Dominican Republic
EC Ecuador
EG Egypt
SV El Salvador
GQ Equatorial Guinea
ER Eritrea
EE Estonia
SZ Eswatini; Swaziland
ET Ethiopia
FJ Fiji
FI Finland
FR France
GA Gabon
GM Gambia; The Gambia
DE Germany; Deutschland
GH Ghana
GR Greece
GD Grenada
GT Guatemala
GN Guinea
GW Guinea-Bissau
GY Guyana
HT Haiti
HN Honduras
HK Hong Kong
HU Hungary
IS Iceland
IN India
ID Indonesia
IR Iran
IQ Iraq
IE Ireland; Republic of Ireland
IL Israel
IT Italy
JM Jamaica
JP Japan
JO Jordan
KZ Kazakhstan
KE Kenya
KI Kiribati
XK Kosovo
KW Kuwait
KG Kyrgyzstan
LA Laos
LV Latvia
LB Lebanon
LS Lesotho
LR Liberia
LY Libya
LI Liechtenstein
LT Lithuania
LU Luxembourg
MO Macao; Macau
MG Madagascar
MW Malawi
MY Malaysia
MV Maldives
ML Mali
MT Malta
MH Marshall Islands
MR Mauritania
MU Mauritius
MX Mexico; México
FM Micronesia
MD Moldova
MC Monaco
MN Mongolia
ME Montenegro
MA Morocco
MZ Mozambique
MM Myanmar; Burma
NA Namibia
NR Nauru
NP Nepal
NL Netherlands; The Netherlands; Holland
NZ New Zealand / NZ
NI Nicaragua
NE Niger
NG Nigeria
KP North Korea
MK North Macedonia; Macedonia
NO Norway
OM Oman
PK Pakistan
PW Palau
PS Palestine
PA Panama
PG Papua New Guinea
PY Paraguay
PE Peru
PH Philippines; The Philippines
PL Poland
PT Portugal
PR Puerto Rico
QA Qatar
RO Romania
RU Russia; Russian Federation
RW Rwanda
KN Saint Kitts and Nevis
LC Saint Lucia
VC Saint Vincent and the Grenadines
WS Samoa
SM San Marino
ST Sao Tome and Principe
SA Saudi Arabia
SN Senegal
RS Serbia
SC Seychelles
SL Sierra Leone
SG Singapore
SK Slovakia
SI Slovenia
SB Solomon Islands
SO Somalia
ZA South Africa
KR South Korea; Korea; Republic of Korea
SS South Sudan
ES Spain; España
LK Sri Lanka
SD Sudan
SR Suriname
SE Sweden
CH Switzerland
SY Syria
TW Taiwan
TJ Tajikistan
TZ Tanzania
TH Thailand
TL Timor-Leste; East Timor
TG Togo
TO Tonga
TT Trinidad and Tobago
TN Tunisia
TR Türkiye; Turkey
TM Turkmenistan
TV Tuvalu
UG Uganda
UA Ukraine
AE United Arab Emirates; UAE; U.A.E.
GB United Kingdom; UK; U.K.; Great Britain; United Kingdom of Great Britain and Northern Ireland / Britain; England; Scotland; Wales; Northern Ireland
US United States; United States of America; USA; US; U.S.; U.S.A. / America
UY Uruguay
UZ Uzbekistan
VU Vanuatu
VA Vatican City; Holy See
VE Venezuela
VN Vietnam; Viet Nam
YE Yemen
ZM Zambia
ZW Zimbabwe
`;

/** US states by their two letters, so "CO" picks "Colorado", and "Colorado" picks "CO". */
export const US_STATES: Readonly<Record<string, string>> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

/** Canada's provinces and territories by their two letters, as "Toronto, ON" has them. */
const CANADA = new Set([
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
]);

/** Words, compared: lowercase, letters and digits. */
const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

interface Country {
  code: string;
  /** The names a form may list it by, its usual one first. */
  names: readonly string[];
  /** Every word that names it, as compared. */
  words: readonly string[];
}

const COUNTRIES: readonly Country[] = TABLE.trim()
  .split('\n')
  .map((line) => {
    const [listed = '', also = ''] = line.slice(3).split(' / ');
    const names = listed.split('; ');
    const words = [...names, ...(also ? also.split('; ') : [])].map(plain);
    return { code: line.slice(0, 2), names, words };
  });

/** Words that name more than one country: a region, or anywhere at all. */
const REGIONS = [
  'EU',
  'EEA',
  'European Union',
  'European Economic Area',
  'Europe',
  'Schengen',
  'EMEA',
  'APAC',
  'Asia',
  'Asia Pacific',
  'LATAM',
  'Latin America',
  'South America',
  'North America',
  'Central America',
  'Americas',
  'Africa',
  'Middle East',
  'Nordics',
  'Scandinavia',
  'Benelux',
  'DACH',
  'GCC',
  'Oceania',
  'Caribbean',
  'Balkans',
  'anywhere',
  'any country',
  'worldwide',
];

/**
 * The words that name a country in a sentence, or a region, as compared, longest first, so
 * "Papua New Guinea" is found before "Guinea" is, "New Mexico" before "Mexico", and "Latin
 * America" before "America". The US states name the United States, but for Georgia, a country
 * too. "US" is found only in capitals, as "us" is a word.
 */
const SENTENCE_WORDS: readonly { code: string; word: string }[] = [
  ...COUNTRIES.flatMap(({ code, words }) =>
    words.filter((word) => word !== 'us').map((word) => ({ code, word })),
  ),
  ...Object.values(US_STATES)
    .filter((state) => state !== 'Georgia')
    .map((state) => ({ code: 'US', word: plain(state) })),
  ...REGIONS.map((region) => ({ code: '', word: plain(region) })),
].sort((a, b) => b.word.length - a.word.length);

/** The countries some words name, by their two letters, and whether they name a region. */
export function placesIn(text: string): { countries: string[]; region: boolean } {
  let said = ` ${plain(text)} `;
  const countries = new Set<string>();
  let region = false;
  for (const { code, word } of SENTENCE_WORDS) {
    const padded = ` ${word} `;
    if (!said.includes(padded)) continue;
    if (code) countries.add(code);
    else region = true;
    // Found once, its words name nothing else: "Northern Ireland" isn't Ireland too.
    said = said.split(padded).join(' ');
  }
  // In capitals, as "Are you authorized to work in the US?" has it, unless all of it is.
  if (/[a-z]/.test(text) && /(^|[^A-Za-z])US([^A-Za-z]|$)/.test(text)) countries.add('US');
  return { countries: [...countries], region };
}

/**
 * The countries a job's location is in, as "Denver, CO", "Remote - US" or "Toronto, ON" say: none
 * when it doesn't say, as "Remote" doesn't, or when it names a region.
 */
export function countriesOfPlace(location: string): string[] {
  const { countries, region } = placesIn(location);
  if (region) return [];
  const found = new Set(countries);
  for (const [, code = ''] of location.matchAll(/,\s*([A-Z]{2})\b/g)) {
    if (US_STATES[code]) found.add('US');
    else if (CANADA.has(code)) found.add('CA');
  }
  return [...found];
}

/** The country a name is, by its two letters: "USA", "us" and "America" are the United States. */
export function countryCode(name: string): string | null {
  const said = plain(name);
  if (!said) return null;
  const code = name.trim().toUpperCase();
  return (
    COUNTRIES.find((country) => country.code === code || country.words.includes(said))?.code ?? null
  );
}

/** The names forms list a country by, as it's put first: "United States" is also "USA". */
export function countryNames(country: string): string[] {
  const code = countryCode(country);
  const names = COUNTRIES.find((each) => each.code === code)?.names ?? [];
  return [country, ...names.filter((name) => plain(name) !== plain(country))];
}
