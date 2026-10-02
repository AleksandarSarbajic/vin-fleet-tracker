'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { elapsed } from '@/lib/format';
import { BRAND } from '@/lib/brand';
import { AccountMenu, type AccountUser } from '../AccountMenu';
import { ScopeMenu, type ListsMenu } from '../SavedViews';
import type { SavedView } from '@/lib/views';

/**
 * §12.96, stage 1 — the phone's top bar, below 768px only (`md:hidden`; the
 * desktop header is `max-md:hidden`). Sticky at the top of a shell that does
 * not scroll as a page.
 *
 * Row 1: the monogram, the scope button with its ×, search, the account
 * menu — every control 44px. Row 2: the feed, always visible.
 *
 * It handles no keys (§12.96): the desktop header is still mounted, hidden,
 * and its listeners for `/`, `V` and 0–8 are the only ones. Search here is a
 * tap that opens a full-width field.
 */

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  totalCount: number;
  fetchedAt: string | null;
  feedNewestAt: string | null;
  feedStale: boolean;
  /** Back from the background and refetching (`useResumeRefetch`). */
  updating: boolean;
  user: AccountUser;
  views: {
    saved: SavedView[];
    active: SavedView | null;
    onApply: (view: SavedView) => void;
    onSave: (name: string) => string | null;
    onRemove: (id: string) => void;
    onRename: (id: string, name: string) => string | null;
    canSaveCurrent: boolean;
    lists?: ListsMenu;
  };
  scope: {
    count: number;
    fleetCount: number;
    viewCount: (view: SavedView) => number;
    onClear: () => void;
  };
}

export function PhoneTopBar({
  query,
  onQueryChange,
  matchCount,
  totalCount,
  fetchedAt,
  feedNewestAt,
  feedStale,
  updating,
  user,
  views,
  scope,
}: Props) {
  /** A link that carries a search opens with the field showing what it filters by. */
  const [searching, setSearching] = useState(() => query.trim() !== '');

  return (
    <div
      data-phone-topbar=""
      className="sticky top-0 z-20 shrink-0 border-b border-line-soft bg-surface-raised md:hidden"
    >
      {searching ? (
        <div className="relative flex h-14 items-center px-2">
          <input
            type="search"
            autoFocus
            enterKeyHint="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Filter list…"
            aria-label="Filter the list"
            className="h-11 w-full border border-accent bg-surface-base pl-3 pr-[108px] font-sans text-[15px] text-text outline-none placeholder:text-text-mutedOnOverlay [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query.trim() ? (
            <span className="pointer-events-none absolute right-[60px] font-sans text-[12px] tabular-nums text-text-muted">
              {matchCount} of {totalCount}
            </span>
          ) : null}
          {/* Closing clears it: a filter nobody can see is a filter nobody knows is on. */}
          <button
            type="button"
            aria-label="Close search"
            onClick={() => {
              onQueryChange('');
              setSearching(false);
            }}
            className="absolute right-2 flex h-11 w-11 items-center justify-center text-text-secondary"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex h-14 items-center gap-2 px-3">
          <Image
            src={BRAND.monogram.src}
            width={BRAND.monogram.width}
            height={BRAND.monogram.height}
            alt={BRAND.alt}
            unoptimized
            className="h-[26px] w-[26px] shrink-0"
          />
          <ScopeMenu
            phone
            views={views.saved}
            active={views.active}
            onApply={views.onApply}
            onSave={views.onSave}
            onRemove={views.onRemove}
            onRename={views.onRename}
            canSaveCurrent={views.canSaveCurrent}
            {...(views.lists ? { lists: views.lists } : {})}
            scopeCount={scope.count}
            fleetCount={scope.fleetCount}
            viewCount={scope.viewCount}
            onClear={scope.onClear}
          />
          <button
            type="button"
            data-phone-search=""
            aria-label="Search"
            onClick={() => setSearching(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center border border-line-control text-text-secondary"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
          <AccountMenu user={user} phone />
        </div>
      )}

      <PhoneFeed
        fetchedAt={fetchedAt}
        feedNewestAt={feedNewestAt}
        feedStale={feedStale}
        updating={updating}
      />
    </div>
  );
}

/**
 * The feed, always on screen: a green dot and "3s ago", or the red "Feed
 * down 25m". While the board refetches after a return from the background it
 * says "Updating…" and shows NO age: an age worked out before the tab was
 * frozen is the one number on screen that is certainly wrong (§12.96).
 */
function PhoneFeed({
  fetchedAt,
  feedNewestAt,
  feedStale,
  updating,
}: {
  fetchedAt: string | null;
  feedNewestAt: string | null;
  feedStale: boolean;
  updating: boolean;
}) {
  // Seeded from the fetch, as the desktop header is, so the server's render
  // and the browser's agree (ConsoleHeader's note).
  const [now, setNow] = useState(() => (fetchedAt ? new Date(fetchedAt) : new Date(0)));
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  // A fresh clock the moment the marker comes or goes, never a frozen one.
  useEffect(() => {
    setNow(new Date());
  }, [updating, fetchedAt]);

  const age = elapsed(fetchedAt, now);
  const feedAge = elapsed(feedNewestAt, now);

  return (
    <div
      data-phone-feed=""
      className="flex h-8 items-center gap-3 px-3 font-sans text-[12px]"
    >
      {/* The desktop header's live region is hidden with it; this is the phone's. */}
      <span role="status" aria-live="polite" className="sr-only">
        {feedStale ? 'Feed down.' : ''}
      </span>
      {feedStale ? (
        <span className="flex h-6 items-center gap-2 border border-status-late-bd bg-feed-downBg px-2 font-semibold text-status-late-fg">
          <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 bg-feed-down" />
          Feed down{feedAge && !updating ? ` ${feedAge}` : ''}
        </span>
      ) : (
        <span className="flex items-center gap-2 text-text-secondary">
          <span
            aria-hidden="true"
            className="h-[7px] w-[7px] shrink-0 bg-status-ontime-fg"
          />
          {updating ? null : age ? `${age} ago` : 'Syncing…'}
        </span>
      )}
      {updating ? (
        <span data-updating="" className="text-text-secondary">
          Updating…
        </span>
      ) : null}
    </div>
  );
}
