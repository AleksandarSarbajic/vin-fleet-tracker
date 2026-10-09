/**
 * Builds `src/lib/geo/zip-zones.data.ts`: the time zone of every ZIP (ZCTA)
 * in a state that has more than one (§12.120).
 * `npm run zip-zones:build -- <zcta-county-rel.txt> <county-adjacency.txt>`
 *
 * ## Sources — all public domain, works of the US federal government
 *
 *   1. 49 CFR Part 71, "Standard Time Zone Boundaries", §§ 71.5, 71.7, 71.9,
 *      71.12 — eCFR, title 49 as amended to 2026-10-05. The boundary lines are
 *      written county by county; the counties each line names are written out
 *      below, paragraph by paragraph.
 *   2. Census 2020 ZCTA-to-county relationship file —
 *      https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt
 *   3. Census county adjacency file, 2023 —
 *      https://www2.census.gov/geo/docs/reference/county_adjacency/county_adjacency2023.txt
 *
 * Neither file is committed: they are 7 MB and 1 MB, and the output is what
 * the app reads. Re-running this against the same two files rebuilds the
 * output byte for byte.
 *
 * ## How a county gets its zone
 *
 * A line follows county lines, so the text names the counties on each side
 * of it. Each side is flood-filled from the counties it names, across the
 * adjacency file, never into a county named for the other side or one the
 * line cuts through. The build REFUSES unless every county in the state is
 * reached by exactly one side or is split — a county left out of the lists
 * below lets one side leak into the other, and that is an overlap, not a
 * guess.
 *
 * A county the line cuts through — a river, a township line, a highway — is
 * SPLIT, and so is every ZIP that touches it. Not guessed.
 *
 * ## How a ZIP gets its zone
 *
 * From the counties its land lies in. One zone → that zone. Two zones, or a
 * split county → uncertain. A sliver under SLIVER_SHARE of the ZIP's land is
 * ignored: the two files are digitised separately, and a ZIP that sits
 * wholly in one county routinely overlaps the next by a few hundred square
 * metres along the shared line. How many ZIPs that rule decides is printed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ZONE_BY_STATE } from '../src/lib/geo/zone-by-state';

const SLIVER_SHARE = 0.005;

const CENTRAL = 'America/Chicago';
const EASTERN = 'America/New_York';
const MOUNTAIN = 'America/Denver';
const PACIFIC = 'America/Los_Angeles';

interface Side {
  zone: string;
  /** The counties the CFR text names on this side, without " County". */
  named: string[];
}

interface StateSpec {
  state: string;
  /** Paragraph cited. */
  cfr: string;
  sides: Side[];
  /** Counties a line cuts through. */
  split: string[];
}

/**
 * The state's own zone from ZONE_BY_STATE, so that the side which is "the
 * rest of the state" carries the identifier the modal already uses there
 * (Detroit for Michigan, Indianapolis for Indiana, Boise for Idaho).
 */
const own = (state: string) => ZONE_BY_STATE[state]!;

const SPECS: StateSpec[] = [
  {
    state: 'MI',
    cfr: '71.5(a)',
    sides: [
      { zone: CENTRAL, named: ['Gogebic', 'Iron', 'Dickinson', 'Menominee'] },
      { zone: own('MI'), named: ['Ontonagon', 'Houghton', 'Baraga', 'Marquette', 'Delta'] },
    ],
    split: [],
  },
  {
    state: 'IN',
    cfr: '71.5(b)',
    sides: [
      {
        zone: CENTRAL,
        named: [
          'Lake', 'Porter', 'LaPorte', 'Starke', 'Jasper', 'Newton',
          'Gibson', 'Posey', 'Vanderburgh', 'Warrick', 'Spencer', 'Perry',
        ],
      },
      {
        zone: own('IN'),
        named: [
          'St. Joseph', 'Marshall', 'Fulton', 'Pulaski', 'White', 'Benton',
          'Knox', 'Pike', 'Dubois', 'Crawford',
        ],
      },
    ],
    split: [],
  },
  {
    state: 'KY',
    cfr: '71.5(c)',
    sides: [
      { zone: own('KY'), named: ['Meade', 'Hardin', 'Larue', 'Taylor', 'Casey', 'Pulaski', 'Wayne'] },
      {
        zone: CENTRAL,
        named: ['Breckinridge', 'Grayson', 'Hart', 'Green', 'Adair', 'Russell', 'Clinton'],
      },
    ],
    split: [],
  },
  {
    state: 'TN',
    cfr: '71.5(d)',
    sides: [
      { zone: EASTERN, named: ['Scott', 'Morgan', 'Roane', 'Rhea', 'Hamilton'] },
      {
        zone: own('TN'),
        named: ['Pickett', 'Fentress', 'Cumberland', 'Bledsoe', 'Sequatchie', 'Marion'],
      },
    ],
    split: [],
  },
  {
    state: 'FL',
    cfr: '71.5(f)',
    sides: [
      {
        zone: CENTRAL,
        named: [
          'Escambia', 'Santa Rosa', 'Okaloosa', 'Walton', 'Holmes',
          'Washington', 'Bay', 'Jackson', 'Calhoun',
        ],
      },
      { zone: own('FL'), named: ['Gadsden', 'Liberty', 'Franklin'] },
    ],
    // The Intracoastal Waterway crosses Gulf County.
    split: ['Gulf'],
  },
  {
    state: 'ND',
    cfr: '71.7(a)',
    sides: [
      {
        zone: MOUNTAIN,
        named: [
          'Adams', 'Billings', 'Bowman', 'Dunn', 'Golden Valley', 'Grant',
          'Hettinger', 'Slope', 'Stark',
        ],
      },
      { zone: own('ND'), named: ['Williams', 'Mountrail', 'McLean', 'Mercer', 'Oliver', 'Morton'] },
    ],
    // Township lines cross McKenzie; State Highway 31 crosses Sioux.
    split: ['McKenzie', 'Sioux'],
  },
  {
    state: 'SD',
    cfr: '71.7(b)',
    sides: [
      {
        zone: MOUNTAIN,
        named: [
          'Harding', 'Perkins', 'Corson', 'Butte', 'Meade', 'Ziebach',
          'Dewey', 'Lawrence', 'Pennington', 'Haakon', 'Custer', 'Jackson',
          'Fall River', 'Oglala Lakota', 'Bennett',
        ],
      },
      {
        zone: own('SD'),
        named: [
          'Campbell', 'Walworth', 'Potter', 'Sully', 'Hughes', 'Lyman',
          'Jones', 'Mellette', 'Todd',
        ],
      },
    ],
    // The line runs south-west from Pierre to the Jones County line.
    split: ['Stanley'],
  },
  {
    state: 'NE',
    cfr: '71.7(c)',
    sides: [
      {
        zone: MOUNTAIN,
        named: [
          'Sioux', 'Dawes', 'Sheridan', 'Box Butte', 'Scotts Bluff', 'Banner',
          'Morrill', 'Garden', 'Grant', 'Hooker', 'Arthur', 'Kimball',
          'Cheyenne', 'Deuel', 'Keith', 'Perkins', 'Chase', 'Dundy',
        ],
      },
      {
        zone: own('NE'),
        named: [
          'Keya Paha', 'Brown', 'Blaine', 'Thomas', 'McPherson', 'Logan',
          'Lincoln', 'Hayes', 'Hitchcock',
        ],
      },
    ],
    // Range and section lines cross Cherry.
    split: ['Cherry'],
  },
  {
    state: 'KS',
    cfr: '71.7(d)',
    sides: [
      { zone: MOUNTAIN, named: ['Sherman', 'Wallace', 'Greeley', 'Hamilton'] },
      // Rawlins and Grant touch Sherman and Hamilton only at a corner.
      {
        zone: own('KS'),
        named: ['Cheyenne', 'Rawlins', 'Thomas', 'Logan', 'Wichita', 'Kearny', 'Grant', 'Stanton'],
      },
    ],
    split: [],
  },
  {
    state: 'TX',
    cfr: '71.7(e)',
    sides: [
      { zone: MOUNTAIN, named: ['El Paso', 'Hudspeth'] },
      { zone: own('TX'), named: ['Culberson', 'Jeff Davis', 'Presidio'] },
    ],
    split: [],
  },
  {
    state: 'ID',
    cfr: '71.9(a)',
    sides: [
      {
        zone: PACIFIC,
        named: [
          'Boundary', 'Bonner', 'Kootenai', 'Benewah', 'Shoshone', 'Latah',
          'Clearwater', 'Nez Perce', 'Lewis',
        ],
      },
      { zone: own('ID'), named: ['Lemhi', 'Valley', 'Adams'] },
    ],
    // The Salmon River crosses Idaho County.
    split: ['Idaho'],
  },
  {
    state: 'OR',
    cfr: '71.9(a)',
    sides: [{ zone: own('OR'), named: ['Baker', 'Harney'] }],
    // Mountain but for the part south of T. 35 S.
    split: ['Malheur'],
  },
  {
    state: 'NV',
    cfr: '71.9(b)',
    sides: [{ zone: own('NV'), named: ['Humboldt', 'Lander', 'Eureka', 'White Pine'] }],
    // The City of West Wendover is Mountain.
    split: ['Elko'],
  },
  {
    state: 'AK',
    cfr: '71.12',
    sides: [{ zone: own('AK'), named: ['Aleutians East'] }],
    // Hawaii-Aleutian west of 169° 30′ W.
    split: ['Aleutians West'],
  },
  {
    state: 'AZ',
    // Not a zone line: Arizona keeps no daylight time (A.R.S. § 1-242) and the
    // Navajo Nation does, while the Hopi Reservation inside it does not.
    // Reservation lines are not county lines, so the three counties the
    // Navajo Nation lies in are split, whole.
    cfr: 'DST: A.R.S. § 1-242; Navajo Nation',
    sides: [{ zone: own('AZ'), named: ['Mohave', 'Yavapai', 'Gila', 'Graham', 'Greenlee'] }],
    split: ['Apache', 'Navajo', 'Coconino'],
  },
];

const UNCERTAIN = '?';

function main() {
  const [relPath, adjPath] = process.argv.slice(2);
  if (!relPath || !adjPath) {
    throw new Error('usage: build-zip-zones <zcta-county-rel.txt> <county-adjacency.txt>');
  }

  // --- counties: GEOID → name, state FIPS ------------------------------------
  const adjacency = new Map<string, Set<string>>();
  const countyName = new Map<string, string>();
  for (const line of readFileSync(adjPath, 'utf8').split('\n').slice(1)) {
    const [name, geoid, , neighbour] = line.split('|');
    if (!name || !geoid || !neighbour) continue;
    countyName.set(geoid, name);
    if (!adjacency.has(geoid)) adjacency.set(geoid, new Set());
    adjacency.get(geoid)!.add(neighbour.trim());
  }

  // --- ZCTA land, per county --------------------------------------------------
  const zctaParts = new Map<string, { county: string; land: number }[]>();
  const relLines = readFileSync(relPath, 'utf8').replace(/^﻿/, '').split('\n');
  const header = relLines[0]!.split('|');
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`relationship file has no ${name} column`);
    return i;
  };
  const cZcta = col('GEOID_ZCTA5_20');
  const cCounty = col('GEOID_COUNTY_20');
  const cCountyName = col('NAMELSAD_COUNTY_20');
  const cLand = col('AREALAND_PART');
  for (const line of relLines.slice(1)) {
    const f = line.split('|');
    const zcta = f[cZcta];
    const county = f[cCounty];
    if (!zcta || !county) continue;
    if (!countyName.has(county)) countyName.set(county, f[cCountyName] ?? county);
    const land = Number(f[cLand]);
    if (!zctaParts.has(zcta)) zctaParts.set(zcta, []);
    zctaParts.get(zcta)!.push({ county, land });
  }

  const stateFips = stateFipsFrom(countyName);

  // --- the zone of every county in a split state ------------------------------
  const countyZone = new Map<string, string>();
  for (const spec of SPECS) {
    const fips = stateFips.get(spec.state);
    if (!fips) throw new Error(`no counties for ${spec.state}`);
    const inState = [...countyName.keys()].filter((g) => g.startsWith(fips) && g.length === 5);
    const byName = (name: string) => {
      const matches = inState.filter((g) => baseName(countyName.get(g)!) === name);
      if (matches.length !== 1) {
        throw new Error(`${spec.state}: "${name}" matches ${matches.length} counties`);
      }
      return matches[0]!;
    };
    const split = new Set(spec.split.map(byName));
    const sides = spec.sides.map((side) => ({ ...side, seeds: side.named.map(byName) }));
    const claimed = new Map<string, string>();
    for (const [i, side] of sides.entries()) {
      const blocked = new Set([
        ...split,
        ...sides.flatMap((other, j) => (j === i ? [] : other.seeds)),
      ]);
      const queue = [...side.seeds];
      const seen = new Set(queue);
      while (queue.length > 0) {
        const county = queue.pop()!;
        const before = claimed.get(county);
        if (before !== undefined && before !== side.zone) {
          throw new Error(
            `${spec.state}: ${countyName.get(county)} is reached from both ${before} and ${side.zone} — a neighbour across the line is missing from the lists`,
          );
        }
        claimed.set(county, side.zone);
        for (const next of adjacency.get(county) ?? []) {
          if (!next.startsWith(fips) || seen.has(next) || blocked.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
    }
    const missing = inState.filter((g) => !claimed.has(g) && !split.has(g));
    if (missing.length > 0) {
      throw new Error(
        `${spec.state}: no side reaches ${missing.map((g) => countyName.get(g)).join(', ')}`,
      );
    }
    for (const g of inState) countyZone.set(g, split.has(g) ? UNCERTAIN : claimed.get(g)!);
    const counts = new Map<string, number>();
    for (const g of inState) counts.set(countyZone.get(g)!, (counts.get(countyZone.get(g)!) ?? 0) + 1);
    console.info(
      `${spec.state} (${spec.cfr}): ${[...counts].map(([z, n]) => `${z === UNCERTAIN ? 'split' : z} ${n}`).join(', ')}`,
    );
  }

  // --- the zone of every ZCTA that touches a split state ----------------------
  const fipsToState = new Map([...stateFips].map(([s, f]) => [f, s]));
  const splitStates = new Set(SPECS.map((s) => s.state));
  const zoneOfCounty = (county: string) => {
    const known = countyZone.get(county);
    if (known) return known;
    const state = fipsToState.get(county.slice(0, 2));
    return state ? ZONE_BY_STATE[state] ?? UNCERTAIN : UNCERTAIN;
  };

  const rows = new Map<string, Map<string, string>>(); // state → zcta → zone
  let decidedBySliver = 0;
  for (const [zcta, parts] of zctaParts) {
    const states = new Set(
      parts.flatMap((p) => {
        const s = fipsToState.get(p.county.slice(0, 2));
        return s ? [s] : [];
      }),
    );
    if (![...states].some((s) => splitStates.has(s))) continue;
    const total = parts.reduce((sum, p) => sum + p.land, 0);
    const zonesOf = (keep: (p: { land: number }) => boolean) =>
      new Set(parts.filter(keep).map((p) => zoneOfCounty(p.county)));
    const all = zonesOf((p) => p.land > 0);
    const real = zonesOf((p) => total > 0 && p.land / total >= SLIVER_SHARE);
    const verdict = (zones: Set<string>) =>
      zones.size === 1 && !zones.has(UNCERTAIN) ? [...zones][0]! : UNCERTAIN;
    const zone = verdict(real);
    if (zone !== verdict(all)) {
      decidedBySliver += 1;
      const minor = parts
        .filter((p) => p.land > 0 && p.land / total < SLIVER_SHARE)
        .map((p) => `${countyName.get(p.county)} ${((100 * p.land) / total).toFixed(3)}%`);
      console.info(`sliver: ${zcta} → ${zone}, ignoring ${minor.join('; ')}`);
    }
    for (const state of states) {
      if (!splitStates.has(state)) continue;
      // A ZCTA's state is the one its land is in; one with no land in it is not.
      if (!parts.some((p) => fipsToState.get(p.county.slice(0, 2)) === state && p.land > 0)) continue;
      if (!rows.has(state)) rows.set(state, new Map());
      rows.get(state)!.set(zcta, zone);
    }
  }

  writeFileSync('src/lib/geo/zip-zones.data.ts', render(rows));
  writeFileSync('src/lib/geo/zip3-states.data.ts', renderZip3(zctaParts, fipsToState));
  const total = [...rows.values()].reduce((n, m) => n + m.size, 0);
  const uncertain = [...rows.values()].reduce(
    (n, m) => n + [...m.values()].filter((z) => z === UNCERTAIN).length,
    0,
  );
  console.info(`\n${total} ZIPs in ${rows.size} states; ${uncertain} uncertain; ${decidedBySliver} decided by the sliver rule`);
}

/**
 * §12.122. Which states each ZIP's first three digits are found in, from the
 * same relationship file: a ZIP prefix belongs to every state any of its
 * ZCTAs has land in. A prefix and a state that never meet are a typo in one
 * or the other.
 */
function renderZip3(
  zctaParts: Map<string, { county: string; land: number }[]>,
  fipsToState: Map<string, string>,
): string {
  const byPrefix = new Map<string, Set<string>>();
  for (const [zcta, parts] of zctaParts) {
    for (const part of parts) {
      const state = fipsToState.get(part.county.slice(0, 2));
      if (!state || part.land <= 0) continue;
      const prefix = zcta.slice(0, 3);
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Set());
      byPrefix.get(prefix)!.add(state);
    }
  }
  const entries = [...byPrefix.keys()]
    .sort()
    .map((prefix) => `${prefix}:${[...byPrefix.get(prefix)!].sort().join('/')}`);
  const rows: string[] = [];
  for (let i = 0; i < entries.length; i += 12) rows.push(entries.slice(i, i + 12).join(' '));
  return `/**
 * The states each ZIP prefix (first three digits) has land in. GENERATED by
 * scripts/build-zip-zones.mts — do not edit by hand. §12.122.
 *
 * Source: Census 2020 ZCTA-to-county relationship file — a work of the US
 * federal government, public domain, no licence, no attribution requirement.
 *
 * Each entry is \`PREFIX:ST[/ST…]\`. ${entries.length} prefixes.
 */
export const ZIP3_STATE_DATA = \`
${rows.join('\n')}
\`;
`;
}

/** "St. Joseph County, IN" → "St. Joseph"; "Aleutians West Census Area, AK" → "Aleutians West". */
function baseName(full: string): string {
  return full
    .replace(/, [A-Z]{2}$/, '')
    .replace(/ (County|Census Area|Borough|City and Borough|Municipality)$/, '');
}

/** State code → FIPS, from the adjacency file's "Name, ST" labels. */
function stateFipsFrom(names: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [geoid, name] of names) {
    const match = /, ([A-Z]{2})$/.exec(name);
    if (match && geoid.length === 5) out.set(match[1]!, geoid.slice(0, 2));
  }
  return out;
}

/**
 * One line per state and zone: the ZIPs, each as the difference from the one
 * before it in base 36. Sorted ZIPs are dense within a state, so most entries
 * are one or two characters.
 */
function render(rows: Map<string, Map<string, string>>): string {
  const lines: string[] = [];
  for (const state of [...rows.keys()].sort()) {
    const byZone = new Map<string, string[]>();
    for (const [zcta, zone] of rows.get(state)!) {
      if (!byZone.has(zone)) byZone.set(zone, []);
      byZone.get(zone)!.push(zcta);
    }
    for (const zone of [...byZone.keys()].sort()) {
      const zips = byZone.get(zone)!.map(Number).sort((a, b) => a - b);
      const deltas = zips.map((z, i) => (i === 0 ? z : z - zips[i - 1]!).toString(36));
      lines.push(`${state} ${zone} ${deltas.join(',')}`);
    }
  }
  const total = [...rows.values()].reduce((n, m) => n + m.size, 0);
  return `/**
 * The time zone of every ZIP in a state with more than one. GENERATED by
 * scripts/build-zip-zones.mts — do not edit by hand. §12.120.
 *
 * Sources, all works of the US federal government — public domain, no
 * licence, no attribution requirement:
 *   - 49 CFR Part 71, §§ 71.5, 71.7, 71.9, 71.12 (eCFR, as amended to 2026-10-05)
 *   - Census 2020 ZCTA-to-county relationship file
 *   - Census county adjacency file, 2023
 * Arizona's split is daylight time, not a zone line: see the script.
 *
 * Each line is \`STATE ZONE zips\`: ZONE an IANA zone, or \`?\` where the ZIP
 * crosses a zone line or touches a county a line cuts through. The ZIPs are
 * sorted, each written as its difference from the one before, in base 36.
 *
 * ${total} ZIPs.
 */
export const ZIP_ZONE_DATA = \`
${lines.join('\n')}
\`;
`;
}

main();
