import type { DataCollection } from '@sentry/core';

/**
 * What Sentry is allowed to collect, decided once for all four runtimes.
 *
 * **Sentry v11 inverted this default.** In v10 an unset `sendDefaultPii` was
 * restrictive; in v11 that option is gone and an unset `dataCollection`
 * collects nearly everything — cookies, HTTP request and response bodies,
 * bound database query parameters, and local variables from stack frames.
 * Upgrading without noticing would quietly have started shipping:
 *
 *   - the dispatcher's Supabase **session cookie**, which is an auth
 *     credential and is squarely covered by the rule that secrets do not
 *     leave the server;
 *   - **stop edit payloads** — the street address, the dock, the dispatcher's
 *     free-text note, the driver's name;
 *   - **bound query parameters**, which is the same data again by another
 *     route.
 *
 * None of that is needed to find out why a route handler threw. The stack, the
 * route and the reference code are.
 *
 * It lives here rather than in each config because there are FOUR init sites —
 * Node, edge, browser and the worker — and a privacy rule that has to be
 * remembered four times is one that will eventually be applied three times.
 * Import it; do not re-state it.
 */
export const SENTRY_DATA_COLLECTION: DataCollection = {
  /** Populated from cookies and headers we are not collecting anyway. */
  userInfo: false,

  /** The session cookie. Non-negotiable. */
  cookies: false,

  /** `authorization`, `cookie`, and nothing else in here is worth the risk. */
  httpHeaders: false,

  /** Stop edits, bulk overrides, assignment saves. An empty array is "none". */
  httpBodies: [],

  /**
   * KEPT. Query parameters here are truck and stop ids — the single most
   * useful thing for reproducing an error, and not personal data. This is the
   * one field where the debugging value genuinely outweighs the exposure.
   */
  urlQueryParams: true,

  /**
   * Bound parameters and returned rows. The sanitised statement text is
   * unaffected by this and still arrives, which is the part worth having.
   */
  databaseQueryData: false,

  /**
   * Locals in a worker frame are position rows and driver names; locals in a
   * route-handler frame are the parsed request body. Costs some debuggability
   * and is the right trade for a console holding real people's movements.
   */
  stackFrameVariables: false,
};
