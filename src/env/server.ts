import 'server-only';
import { ServerEnv, report } from './schema';

/**
 * Server-only configuration. The `server-only` import makes reaching this
 * from a client component a BUILD error rather than a runtime leak — that
 * import is the guardrail, not a convention. Never re-export these values
 * from a module a client component can reach.
 */
const result = ServerEnv.safeParse(process.env);
if (!result.success) throw new Error(report('server', result.error));

export const serverEnv = result.data;
