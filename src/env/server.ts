import 'server-only';
import { AppEnv, parseReaderEnv, report } from './schema';

/**
 * Server-only configuration. The `server-only` import makes reaching this
 * from a client component a BUILD error rather than a runtime leak — that
 * import is the guardrail, not a convention. Never re-export these values
 * from a module a client component can reach.
 */
const result = AppEnv.safeParse(process.env);
if (!result.success) throw new Error(report('server', result.error));

export const serverEnv = result.data;

/**
 * The language-model reader's settings, parsed apart from the app's: a fault
 * here turns the reader off and never stops the app (`parseReaderEnv`).
 */
export const readerEnv = parseReaderEnv(process.env);
