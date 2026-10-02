import type { FullConfig, FullResult, Reporter } from '@playwright/test/reporter';
import { redactRun, secretsFromEnv } from './redact';

/**
 * §12.86. Runs after every test has written its artifacts, and scrubs the
 * e2e password out of this run's folder (see redact.ts for where it hides).
 *
 * A reporter rather than an afterEach hook because `onEnd` is the one point
 * guaranteed to come after every worker has written its trace and its
 * `error-context.md`. If anything survives the pass the run FAILS: a gate
 * that passes while leaving a credential on disk is not one to trust.
 *
 * Not the only pass any more (§12.96): a run given its own `--reporter`
 * drops this one, so the global teardown scrubs the same folders first,
 * whatever the reporters. This second pass costs a walk of a few files.
 */
export default class RedactReporter implements Reporter {
  private outputDirs: string[] = [];

  onBegin(config: FullConfig): void {
    this.outputDirs = [...new Set(config.projects.map((p) => p.outputDir))];
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const { replaced, files, remaining } = redactRun(this.outputDirs, secretsFromEnv());
    if (replaced > 0) {
      console.info(
        `e2e: redacted the e2e password (${replaced} occurrence${replaced === 1 ? '' : 's'}) from ${files.length} artifact${files.length === 1 ? '' : 's'}`,
      );
    }
    if (remaining.length > 0) {
      console.error(`e2e: the e2e password is STILL in: ${remaining.join(', ')}`);
      return { status: 'failed' };
    }
    return result.status === 'passed' ? undefined : { status: result.status };
  }
}
