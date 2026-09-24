import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

/**
 * Sentry's build-time half (phase 6, item 4).
 *
 * v11 moved this import to `@sentry/nextjs/config`; on v10 and earlier it came
 * from `@sentry/nextjs`, so a copied-in snippet from an older answer fails to
 * resolve rather than failing quietly.
 *
 * Source maps are uploaded only when `SENTRY_AUTH_TOKEN` is present, which it
 * is not in ordinary local development. Without them a production stack trace
 * is minified to `a.b is not a function` and the report is barely worth having
 * — with them it names the file and line.
 */
export default withSentryConfig(nextConfig, {
  // Spread rather than assigned: `exactOptionalPropertyTypes` distinguishes an
  // absent key from an explicit undefined, and these are absent in local dev.
  ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT ? { project: process.env.SENTRY_PROJECT } : {}),
  ...(process.env.SENTRY_AUTH_TOKEN ? { authToken: process.env.SENTRY_AUTH_TOKEN } : {}),

  /**
   * Browser requests to Sentry go through our own origin instead of straight
   * to ingest.de.sentry.io. Ad and tracker blockers routinely block requests
   * to Sentry's domain, and a dispatcher running one would silently be the
   * user whose errors never arrive — which is the population most likely to
   * have an unusual browser and therefore the bugs worth seeing.
   */
  tunnelRoute: '/sentry-tunnel',

  /** Quiet locally, verbose in CI where the log is the only witness. */
  silent: !process.env.CI,
});
