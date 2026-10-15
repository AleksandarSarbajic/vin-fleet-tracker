/**
 * Phase 3ac. Where a run-together street and city divide: "1907 4th Ave NW
 * Unit 200 West Fargo" is "1907 4th Ave NW Unit 200" and "West Fargo". Pure.
 *
 * Used ONLY by the Route blocks template, for a stop its summary line does
 * not name (Alex, 2026-10-15), and the split it makes is always marked for
 * the dispatcher to confirm. A pasted address that runs together is still
 * never split (§12.121); no other reader calls this.
 *
 * The grammar, over the words before ", ST 12345":
 *
 *   street = NUMBER NAME+ TYPE [DIR] [UNIT]
 *   city   = WORD WORD? WORD?
 *
 *   NUMBER  a house number: digits, then a letter or "-digits" at most ("4001", "12B", "10-20")
 *   NAME    any words, at least one of them not an abbreviated directional
 *   TYPE    a street-type word (`STREET_TYPE`)
 *   DIR     an abbreviated directional: N, S, E, W, NE, NW, SE, SW
 *   UNIT    ONE of UNIT, STE, SUITE, APT, BLDG, RM, FL and one token of letters and
 *           digits; or "#" and one ("# 4"), or "#4"
 *   WORD    letters (and . ' -), so no number; never a unit word; the FIRST is never
 *           an abbreviated directional ("St N Fargo" is "St N" and "Fargo")
 *
 * Every division of the words that fits is a candidate, and the split is
 * taken only when there is EXACTLY ONE whose city does not begin with a
 * street-type word. A candidate whose city DOES begin with one still counts:
 * that is where the division is ambiguous ("Main St St Louis" could be "St
 * Louis", "Main St Park Ridge" could be "Park Ridge"), so it makes the answer
 * "no split", never the other reading. FORT and MOUNT begin cities ("Fort
 * Worth"), so they are not street-type words here; WEST, EAST, NORTH, SOUTH
 * and NEW are not street-type words at all. No split, and the caller reads
 * nothing.
 */

/**
 * USPS Publication 28, Appendix C1: each primary street suffix name and its
 * Postal Service standard abbreviation, without FORT/FT's FORT and
 * MOUNT/MT's MOUNT (above). Transcribed for this phase; public.
 */
export const STREET_TYPE: ReadonlySet<string> = new Set(
  (
    'ALLEY ALY ANEX ANX ARCADE ARC AVENUE AVE BAYOU BYU BEACH BCH BEND BND BLUFF BLF BLUFFS BLFS BOTTOM BTM ' +
    'BOULEVARD BLVD BRANCH BR BRIDGE BRG BROOK BRK BROOKS BRKS BURG BG BURGS BGS BYPASS BYP CAMP CP CANYON CYN ' +
    'CAPE CPE CAUSEWAY CSWY CENTER CTR CENTERS CTRS CIRCLE CIR CIRCLES CIRS CLIFF CLF CLIFFS CLFS CLUB CLB ' +
    'COMMON CMN COMMONS CMNS CORNER COR CORNERS CORS COURSE CRSE COURT CT COURTS CTS COVE CV COVES CVS CREEK CRK ' +
    'CRESCENT CRES CREST CRST CROSSING XING CROSSROAD XRD CROSSROADS XRDS CURVE CURV DALE DL DAM DM DIVIDE DV ' +
    'DRIVE DR DRIVES DRS ESTATE EST ESTATES ESTS EXPRESSWAY EXPY EXTENSION EXT EXTENSIONS EXTS FALL FALLS FLS ' +
    'FERRY FRY FIELD FLD FIELDS FLDS FLAT FLT FLATS FLTS FORD FRD FORDS FRDS FOREST FRST FORGE FRG FORGES FRGS ' +
    'FORK FRK FORKS FRKS FT FREEWAY FWY GARDEN GDN GARDENS GDNS GATEWAY GTWY GLEN GLN GLENS GLNS GREEN GRN ' +
    'GREENS GRNS GROVE GRV GROVES GRVS HARBOR HBR HARBORS HBRS HAVEN HVN HEIGHTS HTS HIGHWAY HWY HILL HL HILLS HLS ' +
    'HOLLOW HOLW INLET INLT ISLAND IS ISLANDS ISS ISLE JUNCTION JCT JUNCTIONS JCTS KEY KY KEYS KYS KNOLL KNL ' +
    'KNOLLS KNLS LAKE LK LAKES LKS LAND LANDING LNDG LANE LN LIGHT LGT LIGHTS LGTS LOAF LF LOCK LCK LOCKS LCKS ' +
    'LODGE LDG LOOP MALL MANOR MNR MANORS MNRS MEADOW MDW MEADOWS MDWS MEWS MILL ML MILLS MLS MISSION MSN ' +
    'MOTORWAY MTWY MT MOUNTAIN MTN MOUNTAINS MTNS NECK NCK ORCHARD ORCH OVAL OVERPASS OPAS PARK PARKS PARKWAY ' +
    'PKWY PARKWAYS PASS PASSAGE PSGE PATH PIKE PINE PNE PINES PNES PLACE PL PLAIN PLN PLAINS PLNS PLAZA PLZ ' +
    'POINT PT POINTS PTS PORT PRT PORTS PRTS PRAIRIE PR RADIAL RADL RAMP RANCH RNCH RAPID RPD RAPIDS RPDS REST RST ' +
    'RIDGE RDG RIDGES RDGS RIVER RIV ROAD RD ROADS RDS ROUTE RTE ROW RUE RUN SHOAL SHL SHOALS SHLS SHORE SHR ' +
    'SHORES SHRS SKYWAY SKWY SPRING SPG SPRINGS SPGS SPUR SPURS SQUARE SQ SQUARES SQS STATION STA STRAVENUE STRA ' +
    'STREAM STRM STREET ST STREETS STS SUMMIT SMT TERRACE TER THROUGHWAY TRWY TRACE TRCE TRACK TRAK TRAFFICWAY ' +
    'TRFY TRAIL TRL TRAILER TRLR TUNNEL TUNL TURNPIKE TPKE UNDERPASS UPAS UNION UN UNIONS UNS VALLEY VLY VALLEYS ' +
    'VLYS VIADUCT VIA VIEW VW VIEWS VWS VILLAGE VLG VILLAGES VLGS VILLE VL VISTA VIS WALK WALKS WALL WAY WAYS ' +
    'WELL WL WELLS WLS'
  ).split(' '),
);

const DIRECTIONAL: ReadonlySet<string> = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const UNIT_WORD: ReadonlySet<string> = new Set(['UNIT', 'STE', 'SUITE', 'APT', 'BLDG', 'RM', 'FL']);
const NUMBER = /^\d+(?:[A-Z]|-\d+)?$/;
const TOKEN = /^[A-Z0-9]+$/;
const CITY_WORD = /^[A-Z][A-Z.'-]*$/;
const MAX_CITY_WORDS = 3;

/** How many words a unit phrase takes at `at`: 2 ("UNIT 200", "# 4"), 1 ("#4"), or 0. */
function unitAt(up: readonly string[], at: number): number {
  const word = up[at] ?? '';
  if ((UNIT_WORD.has(word) || word === '#') && TOKEN.test(up[at + 1] ?? '')) return 2;
  return /^#[A-Z0-9]+$/.test(word) ? 1 : 0;
}

function cityFits(up: readonly string[], at: number): boolean {
  const city = up.slice(at);
  return (
    city.length >= 1 &&
    city.length <= MAX_CITY_WORDS &&
    city.every((w) => CITY_WORD.test(w) && !UNIT_WORD.has(w)) &&
    !DIRECTIONAL.has(city[0]!)
  );
}

/** The street and the city, when exactly one division fits; otherwise null. */
export function splitStreetCity(text: string): { street: string; city: string } | null {
  const words = text.trim().split(/\s+/);
  const up = words.map((w) => w.toUpperCase().replace(/[.,]+$/, ''));
  if (!NUMBER.test(up[0] ?? '')) return null;
  const starts = new Set<number>();
  for (let t = 2; t < up.length - 1; t += 1) {
    if (!STREET_TYPE.has(up[t]!) || !up.slice(1, t).some((w) => !DIRECTIONAL.has(w))) continue;
    const ends = DIRECTIONAL.has(up[t + 1]!) ? [t + 1, t + 2] : [t + 1];
    for (const end of [...ends]) {
      const unit = unitAt(up, end);
      if (unit > 0) ends.push(end + unit);
    }
    for (const end of ends) if (cityFits(up, end)) starts.add(end);
  }
  if (starts.size !== 1) return null;
  const at = [...starts][0]!;
  if (STREET_TYPE.has(up[at]!)) return null;
  return { street: words.slice(0, at).join(' '), city: words.slice(at).join(' ') };
}
