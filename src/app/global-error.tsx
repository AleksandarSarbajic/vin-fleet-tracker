'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import './globals.css';

/**
 * The last boundary: a render error that escaped every other one, including
 * anything thrown in the root layout.
 *
 * `global-error.tsx` REPLACES the root layout, so it carries its own <html>
 * and <body> and does not inherit the stylesheet the layout imports. Hence the
 * direct `./globals.css` import — without it this file has no tokens at all,
 * and the first draft of it responded to that by hand-writing hex colours,
 * which is exactly what §14.4 and the palette test forbid. Importing the
 * stylesheet here is the fix; writing the palette out again is not.
 *
 * The fonts are NOT re-declared. `next/font` variables are set on the <html>
 * element in the root layout, which by definition is not running. The body
 * falls back to the stack in globals.css, and a failure notice in a fallback
 * font is fine.
 *
 * Its real job is the report. Without this file a fatal client render is seen
 * by the dispatcher and by nobody else: the console goes blank mid-shift, the
 * dispatcher reloads, and there is no record it ever happened.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="grid min-h-screen place-items-center bg-surface-base p-6 text-text">
        <main className="max-w-lg text-center">
          <h1 className="mb-2 text-base font-semibold">The console stopped unexpectedly.</h1>
          <p className="mb-5 leading-relaxed text-text-secondary">
            This has been reported. Positions are still being recorded — the
            ingestion worker is a separate process and is unaffected, so nothing
            has been lost while this screen has been up.
          </p>
          {/*
            Next's own id for the error, and the only handle a dispatcher can
            read out over the phone that ties their screen to the report.
            Shown when there is one rather than assumed.
          */}
          {error.digest ? (
            <p className="mb-5 font-mono text-sm text-text-muted">Reference {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-line-hair bg-surface-raised px-5 py-2 font-semibold text-text"
          >
            Reload the console
          </button>
        </main>
      </body>
    </html>
  );
}
