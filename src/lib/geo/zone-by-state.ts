/**
 * A facility's time zone from its state. Moved here from AppointmentFields
 * (§12.120) so the ZIP table's build script and the modal read one map.
 *
 * A DEFAULT, never an answer, in a state with more than one zone: North
 * Dakota runs Central and Mountain, and this fleet has trucks in both halves
 * of it. `zoneForAddress` settles those from the ZIP.
 */
export const ZONE_BY_STATE: Readonly<Record<string, string>> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix',
  AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York', DC: 'America/New_York', DE: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  IA: 'America/Chicago', ID: 'America/Boise', IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis', KS: 'America/Chicago', KY: 'America/New_York',
  LA: 'America/Chicago', MA: 'America/New_York', MD: 'America/New_York',
  ME: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MO: 'America/Chicago', MS: 'America/Chicago', MT: 'America/Denver',
  NC: 'America/New_York', ND: 'America/Chicago', NE: 'America/Chicago',
  NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NV: 'America/Los_Angeles', NY: 'America/New_York', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York',
  PR: 'America/Puerto_Rico', RI: 'America/New_York', SC: 'America/New_York',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VA: 'America/New_York', VT: 'America/New_York',
  WA: 'America/Los_Angeles', WI: 'America/Chicago', WV: 'America/New_York',
  WY: 'America/Denver',
};

/** Every zone the modal offers, sorted. */
export const ZONES: readonly string[] = [...new Set(Object.values(ZONE_BY_STATE))].sort();

/** The state's zone; Chicago for none, or for a code that is not a state. */
export function zoneForState(state: string | null): string {
  if (!state) return 'America/Chicago';
  return ZONE_BY_STATE[state.toUpperCase()] ?? 'America/Chicago';
}
