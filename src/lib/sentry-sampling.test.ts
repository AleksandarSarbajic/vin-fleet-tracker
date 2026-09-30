import { describe, expect, it } from 'vitest';
import { DEFAULT_SAMPLE_RATE, SIGN_IN_SAMPLE_RATE, isSignInPost, sampleTraces } from './sentry-sampling';

/**
 * §12.87. The contexts below are the ones the real SDK passed during a local
 * sign-in against the production build (the sampler was made to log them):
 * Node names the span `POST /login`, the edge runtime `middleware POST
 * /login`, both carry `http.target`, and both arrive with `parentSampled:
 * false` because the browser runs at rate 0.
 */

const ctx = (
  name: string,
  attributes: Record<string, unknown> = {},
  parentSampled?: boolean,
) => ({ name, attributes, ...(parentSampled === undefined ? {} : { parentSampled }) });

describe('which traces are kept', () => {
  it('keeps every sign-in POST, from the Node server and from the middleware', () => {
    const node = ctx('POST /login', { 'http.request.method': 'POST', 'http.target': '/login' }, false);
    const edge = ctx('middleware POST /login', { 'http.method': 'POST', 'http.target': '/login' }, false);
    expect(sampleTraces(node)).toBe(SIGN_IN_SAMPLE_RATE);
    expect(sampleTraces(edge)).toBe(SIGN_IN_SAMPLE_RATE);
    expect(SIGN_IN_SAMPLE_RATE).toBe(1);
  });

  it('ignores an unsampled parent — the browser at rate 0 must not veto a sign-in', () => {
    expect(sampleTraces(ctx('POST /login', {}, false))).toBe(1);
  });

  it('keeps a span whose parent was kept, so a sign-in keeps its Supabase call', () => {
    const authCall = ctx('POST ywfotpjljshxrgxlgcdp.supabase.co', { 'url.path': '/auth/v1/token' }, true);
    expect(sampleTraces(authCall)).toBe(1);
  });

  it('samples 1% of everything else', () => {
    expect(DEFAULT_SAMPLE_RATE).toBe(0.01);
    for (const c of [
      ctx('GET /login', { 'http.request.method': 'GET', 'http.target': '/login' }, false),
      ctx('middleware GET /login', { 'http.method': 'GET', 'http.target': '/login' }),
      ctx('GET /api/fleet', { 'http.request.method': 'GET', 'http.target': '/api/fleet' }, false),
      ctx('POST /api/stops', { 'http.request.method': 'POST', 'http.target': '/api/stops' }, false),
      ctx('POST ywfotpjljshxrgxlgcdp.supabase.co', { 'url.path': '/auth/v1/token' }),
    ]) {
      expect(sampleTraces(c), c.name).toBe(DEFAULT_SAMPLE_RATE);
    }
  });

  it('matches the path exactly — not a prefix, and not a query string', () => {
    expect(isSignInPost(ctx('POST /login-help', { 'http.target': '/login-help' }))).toBe(false);
    expect(isSignInPost(ctx('POST /login', { 'http.target': '/login?next=/' }))).toBe(true);
    expect(isSignInPost(ctx('POST /api/login', { 'http.target': '/api/login' }))).toBe(false);
  });

  it('reads the request when the attributes are absent', () => {
    expect(
      isSignInPost({
        name: 'unknown',
        attributes: {},
        normalizedRequest: { method: 'post', url: 'https://vin-fleet-tracker.vercel.app/login' },
      }),
    ).toBe(true);
  });
});
