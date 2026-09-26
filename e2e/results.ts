import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Per-run results folders (§12.84).
 *
 * Every run used to write to one shared `test-results/`, which Playwright
 * empties at the start of each run — so a flaky failure's trace survived
 * exactly until the next run, which is the run anyone investigating it makes
 * first. One failure in seventeen runs could not be named for that reason.
 */

export const RESULTS_ROOT = 'test-results';

/** How many past runs to keep. Enough to span a day of investigating. */
export const RUNS_KEPT = 20;

/** `2026-09-26T01-52-07-123Z` — sortable as text, safe as a folder name. */
const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

export function newRunId(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

/**
 * Deletes all but the newest `keep` run folders under `root`. Only folders
 * named like a run id are touched — never anything else someone put there.
 * Returns what it removed.
 */
export function pruneRuns(root: string, keep: number = RUNS_KEPT): string[] {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return []; // No results yet: nothing to prune.
  }
  const runs = names
    .filter((n) => RUN_ID.test(n) && statSync(join(root, n)).isDirectory())
    .sort()
    .reverse();
  const doomed = runs.slice(keep);
  for (const n of doomed) rmSync(join(root, n), { recursive: true, force: true });
  return doomed;
}
