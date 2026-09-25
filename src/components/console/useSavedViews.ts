'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FILTER_KEYS, type FilterKey } from './FilterChips';
import {
  VIEW_CAP,
  activeView,
  addView,
  readViews,
  removeView,
  renameView,
  writeViews,
  type SavedView,
  type SaveRefusal,
  type ViewState,
} from '@/lib/views';

/**
 * §14 feature 11. The saved views, their storage and what is on screen now.
 *
 * Beside `useChipFilters` rather than in `src/hooks`, because it needs
 * `FILTER_KEYS` — the chip list is what a stored view is validated against,
 * and that list belongs to the chip component. `lib/views` stays free of the
 * component layer by taking it as an argument.
 *
 * Read in an effect and not during render, the same as pins and density:
 * `localStorage` is invisible to the server, so reading it while rendering is
 * a hydration mismatch rather than a preference.
 */
export function useSavedViews(state: ViewState): {
  views: SavedView[];
  /** The saved view the board is showing right now, if it is showing one. */
  active: SavedView | null;
  save: (name: string) => SaveRefusal | null;
  remove: (id: string) => void;
  /** §12.81. Returns the refusal, or null when it renamed. */
  rename: (id: string, name: string) => SaveRefusal | null;
  atCap: boolean;
} {
  const [views, setViews] = useState<SavedView[]>([]);

  useEffect(() => setViews(readViews(FILTER_KEYS)), []);

  const save = useCallback(
    (name: string): SaveRefusal | null => {
      const result = addView(views, {
        name,
        state,
        /*
         * `randomUUID` where it exists, and a timestamp with a suffix where it
         * does not — it is served over https in every real deployment, but a
         * `localStorage` key is not worth a crash on a browser that disagrees.
         * Uniqueness only has to hold inside one person's list of eight.
         */
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      if (result.refused) return result.refused;
      setViews(result.views);
      writeViews(result.views);
      return null;
    },
    [views, state],
  );

  const remove = useCallback((id: string) => {
    setViews((current) => {
      const next = removeView(current, id);
      writeViews(next);
      return next;
    });
  }, []);

  const rename = useCallback(
    (id: string, name: string): SaveRefusal | null => {
      const result = renameView(views, id, name);
      if (result.refused) return result.refused;
      setViews(result.views);
      writeViews(result.views);
      return null;
    },
    [views],
  );

  const active = useMemo(() => activeView(views, state), [views, state]);

  return { views, active, save, remove, rename, atCap: views.length >= VIEW_CAP };
}

/** The chip list a view is applied as — narrowed, since storage is not typed. */
export function viewChips(view: SavedView): FilterKey[] {
  return view.chips.filter((c): c is FilterKey => FILTER_KEYS.includes(c as FilterKey));
}
