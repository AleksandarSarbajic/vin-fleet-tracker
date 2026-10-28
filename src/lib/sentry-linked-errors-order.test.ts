import { randomUUID } from 'node:crypto';
import * as SentryNode from '@sentry/node';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterAll, expect, it } from 'vitest';
import { sentryCapture } from '@/test/sentry-capture';
import { withoutAiIntegrations } from './sentry-reader';
import { textlessErrors } from './sentry-server-errors';

/**
 * §12.143. The rebuilt exception list is the same whether `textlessErrors`
 * sits before or after Sentry's linkedErrors in the integration list: it
 * rebuilds the WHOLE list, causes included, and its listener runs after
 * linkedErrors' either way (it hooks in `afterAllSetup`). Two real clients,
 * one per order, the same error each time.
 */

const S = `sx${randomUUID().replaceAll('-', '')}`;

class o extends Error {
  severity = 'ERROR';
  code = '23505';
}

const make = () =>
  new DrizzleQueryError(
    'insert into drivers (name)\n  values ($1)',
    [`Meet at dock ${S}`],
    new o(`duplicate key "drivers_${S}"\n    at ${S} (evil.js:1:2)`),
  );

async function captureWith(place: 'first' | 'last', error: Error) {
  await SentryNode.close();
  const capture = sentryCapture();
  SentryNode.init({
    ...capture.options,
    integrations: (defaults) => {
      const rest = withoutAiIntegrations(defaults);
      return place === 'first' ? [textlessErrors(), ...rest] : [...rest, textlessErrors()];
    },
  });
  const names = SentryNode.getClient()?.getOptions().integrations.map((i) => i.name) ?? [];
  SentryNode.captureException(error);
  await SentryNode.flush(2000);
  return { names, values: capture.events()[0]?.exception?.values, sent: capture.sent.join('\n') };
}

afterAll(() => SentryNode.close());

it('gives the same exception list, causes included, with the integration before or after linkedErrors', async () => {
  // Made in one loop, so both errors have the same stack.
  const errors: Error[] = [];
  for (let i = 0; i < 2; i += 1) errors.push(make());

  const first = await captureWith('first', errors[0]!);
  const last = await captureWith('last', errors[1]!);

  expect(first.names.indexOf('TextlessErrors')).toBeLessThan(first.names.indexOf('LinkedErrors'));
  expect(last.names.indexOf('TextlessErrors')).toBeGreaterThan(last.names.indexOf('LinkedErrors'));
  expect(first.values?.map((v) => v.type)).toEqual(['PostgresError', 'DrizzleQueryError']);
  expect(last.values).toEqual(first.values);
  expect(first.sent).not.toContain(S);
  expect(last.sent).not.toContain(S);
});
