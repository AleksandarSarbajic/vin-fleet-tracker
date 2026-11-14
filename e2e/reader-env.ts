/**
 * Phase 3bv (§12.161). The reader settings every e2e run gets, however it is started: the
 * fake vendor, its script, and an invented key. They lived only in the `e2e` npm script
 * until 3bu, so `npx playwright test` and `npm run e2e:ui` started the server with
 * `.env.local`'s own (the reader on, the live vendor and its key), and 3bu's three
 * ratecon-ai reads went to the live vendor that way and were refused with a 401.
 *
 * `playwright.config.ts` puts these in the runner's environment BEFORE it loads
 * `.env.local`, which never overrides a variable already set, so `.env.local`'s reader key
 * reaches no process of the run: not the runner, not a worker (they inherit the runner's
 * environment), not the build or the server (the config also passes these to the app's
 * `webServer.env`). Forced, not defaulted: a value in the shell does not win either.
 *
 * The key is SYNTHETIC: it opens nothing. `reader-key-bundle.spec.ts` looks for it in the
 * browser bundle. `LLM_READER_MODEL` is not here on purpose: the fake never reads it
 * (`parseReaderEnv` returns for the fake before it looks at the model).
 */
export const E2E_READER_ENV = {
  LLM_READER_ENABLED: 'true',
  LLM_READER_VENDOR: 'fake',
  /** Written by `ratecon-ai.spec.ts` before each read; read by the server for every read. Git-ignored. */
  LLM_READER_FAKE_SCRIPT: 'e2e/.fake-reader.json',
  LLM_READER_API_KEY: 'sk-ant-e2e-SYNTHETIC-not-a-real-key-4f1c9a',
} as const;
