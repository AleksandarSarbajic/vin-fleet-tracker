import { zoneForState } from '@/lib/geo/zone-by-state';

/**
 * The appointment block's draft and its defaults, apart from the component (phase 3bw).
 *
 * `load-form.ts` needs these values, and scripts load `load-form.ts` outside React's client
 * build: `ratecon-eval-ai.mts` runs under `--conditions=react-server`, where React has no
 * `useState`. While they lived in `AppointmentFields.tsx`, every such script loaded the
 * component too, so the first state the component held (QoL 4's Today and Tomorrow) broke
 * them. Plain data lives here; the component re-exports it, so nothing that imported it
 * from there changes.
 */
export interface AppointmentDraft {
  enabled: boolean;
  type: 'APPT' | 'FCFS';
  /** yyyy-mm-dd, as the date input gives it. Split into parts on the wire. */
  date: string;
  /** HH:mm. The appointment (APPT), or the EARLIEST receiving hour (FCFS). */
  time: string;
  /** HH:mm. FCFS only: the LATEST receiving hour — the deadline (§12.22). */
  endTime: string;
  tz: string;
  windowMinutes: number;
}

/** §12.22. A new FCFS stop starts at the commonest receiving hours. */
export const FCFS_DEFAULT_EARLIEST = '07:00';
export const FCFS_DEFAULT_LATEST = '15:00';

/** §12.120: the state map moved to lib, where the ZIP table's build reads it too. */
export { zoneForState };
