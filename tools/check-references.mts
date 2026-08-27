/**
 * Resolve every DOI on the method page and report what came back.
 *
 * The method page's whole argument is that the reader can check the work, so a
 * citation that leads nowhere costs more there than anywhere else in the app.
 * This reads the DOIs out of the page's own source — there is no second list to
 * drift — and asks doi.org to resolve each one.
 *
 * Run by hand, and in CI, where the network is not behind a proxy. It does not
 * gate the build: a DOI registry being briefly unreachable is not a reason to
 * stop publishing the app.
 */
import { readFileSync } from 'node:fs';

const SOURCE = 'src/views/method.ts';
const TIMEOUT_MS = 20_000;
const RETRIES = 3;
const RETRY_MS = 2_000;

interface Result {
  readonly doi: string;
  readonly ok: boolean;
  readonly detail: string;
}

async function main(): Promise<void> {
  const dois = [...readFileSync(SOURCE, 'utf8').matchAll(/doi:\s*'([^']+)'/g)].map(
    (match) => match[1] ?? '',
  );
  if (dois.length === 0) throw new Error(`no DOIs found in ${SOURCE}`);

  console.log(`resolving ${String(dois.length)} DOIs from ${SOURCE}\n`);
  // One at a time. Asking doi.org for three at once earns a 429, which reads
  // as a broken citation when it is only impatience.
  const results: Result[] = [];
  for (const doi of dois) {
    results.push(await resolve(doi));
  }

  for (const result of results) {
    console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.doi}  ${result.detail}`);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(`\n${String(failed.length)} of ${String(results.length)} did not resolve.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nall ${String(results.length)} resolve.`);
}

async function resolve(doi: string, attempt = 1): Promise<Result> {
  const url = `https://doi.org/${doi}`;
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Metadata rather than the publisher's page: a smaller answer, and it
        // proves the DOI is registered rather than that something served a page.
        accept: 'application/vnd.citationstyles.csl+json',
        // Anonymous bursts get throttled; saying who is asking is the courtesy
        // the registries ask for.
        'user-agent': 'gatha-reference-check (+https://github.com/chrmongeau/gatha)',
      },
    });

    if (response.status === 429 && attempt <= RETRIES) {
      await wait(attempt * RETRY_MS);
      return await resolve(doi, attempt + 1);
    }
    if (!response.ok) return { doi, ok: false, detail: `HTTP ${String(response.status)}` };

    const record = (await response.json()) as { title?: string | string[] };
    const title = Array.isArray(record.title) ? record.title[0] : record.title;
    return {
      doi,
      ok: true,
      // The title is the point: a DOI that resolves to the wrong paper is worse
      // than one that does not resolve at all.
      detail: typeof title === 'string' ? `“${title.slice(0, 60)}”` : 'registered',
    };
  } catch (error) {
    if (attempt <= RETRIES) {
      await wait(attempt * RETRY_MS);
      return await resolve(doi, attempt + 1);
    }
    return { doi, ok: false, detail: error instanceof Error ? error.message : 'unreachable' };
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
