/**
 * §12.122. Two counts, kept in this browser tab's session and shown in the
 * fill strip, so drift is visible: how many rate confirmations were not
 * recognised, and how many filled fields were edited by hand afterwards.
 * Counts only — never which file, which field or what it said — and never
 * sent anywhere.
 */

export interface FillCounts {
  notRecognised: number;
  editedAfterFill: number;
}

const KEY = 'ft.ratecon.counts';
let memory: FillCounts = { notRecognised: 0, editedAfterFill: 0 };

export function readCounts(): FillCounts {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return memory;
    const parsed = JSON.parse(raw) as Partial<FillCounts>;
    memory = {
      notRecognised: Number(parsed.notRecognised) || 0,
      editedAfterFill: Number(parsed.editedAfterFill) || 0,
    };
    return memory;
  } catch {
    // Storage blocked or the value unreadable: the count lives in memory for
    // this page instead. Nothing depends on it but the strip's own line.
    return memory;
  }
}

export function bumpCount(which: keyof FillCounts, by = 1): FillCounts {
  const next = { ...readCounts(), [which]: readCounts()[which] + by };
  memory = next;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // As above: kept in memory for this page.
  }
  return next;
}
