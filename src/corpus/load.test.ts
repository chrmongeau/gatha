import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadCorpus, loadDiscourse } from './load';

/**
 * The language fallback has never run.
 *
 * `ACTIVE_LANGUAGE` is `'en'`, so every path below that fills a gap from English
 * is dormant code — it will first execute on the day a second language ships,
 * which is exactly the case SPEC.md §15 says to prove rather than assume. §15
 * asked for one manual run against a second language during phase 2; this is
 * that run, kept.
 */

const BASE = import.meta.env.BASE_URL;

/** Serves what it is given and 404s everything else, recording what was asked. */
function serve(files: Readonly<Record<string, unknown>>): { asked: string[] } {
  const asked: string[] = [];
  vi.stubGlobal('fetch', (input: string) => {
    asked.push(input);
    const body = files[input];
    return Promise.resolve(
      body === undefined
        ? { ok: false, status: 404, json: () => Promise.reject(new Error('not found')) }
        : { ok: true, status: 200, json: () => Promise.resolve(body) },
    );
  });
  return { asked };
}

const ORDER = [`${BASE}corpus/order.json`];
const EN = `${BASE}corpus/en/passages.json`;
const DE = `${BASE}corpus/de/passages.json`;

const passage = (text: string) => ({
  text,
  reference: 'Dhammapada 1',
  title: 'Pairs',
  parentUid: 'dhp1-20',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loading the corpus', () => {
  it('keys every passage by its uid, which the file itself does not carry', async () => {
    serve({ [ORDER[0] ?? '']: ['dhp1'], [EN]: { dhp1: passage('Mind precedes all things.') } });

    const corpus = await loadCorpus();

    expect(corpus.order).toEqual(['dhp1']);
    expect(corpus.passages.get('dhp1')).toEqual({ uid: 'dhp1', ...passage('Mind precedes all things.') });
  });

  it('asks for English only once when English is what was asked for', async () => {
    const { asked } = serve({ [ORDER[0] ?? '']: ['dhp1'], [EN]: { dhp1: passage('One.') } });

    await loadCorpus('en');

    expect(asked.filter((url) => url === EN)).toHaveLength(1);
  });

  it('fills a gap in another language from English rather than skipping the day', async () => {
    serve({
      [ORDER[0] ?? '']: ['dhp1', 'dhp2'],
      [DE]: { dhp1: passage('Der Geist geht allem voran.') },
      [EN]: { dhp1: passage('Mind precedes all things.'), dhp2: passage('Untranslated yet.') },
    });

    const corpus = await loadCorpus('de');

    // The translated one is the German; the missing one falls back rather than
    // leaving a day with no passage at all.
    expect(corpus.passages.get('dhp1')?.text).toBe('Der Geist geht allem voran.');
    expect(corpus.passages.get('dhp2')?.text).toBe('Untranslated yet.');
    expect(corpus.passages.size).toBe(2);
  });

  it('never lets the fallback overwrite a passage the language does have', async () => {
    serve({
      [ORDER[0] ?? '']: ['dhp1'],
      [DE]: { dhp1: passage('Der Geist.') },
      [EN]: { dhp1: passage('Mind.') },
    });

    const corpus = await loadCorpus('de');

    expect(corpus.passages.get('dhp1')?.text).toBe('Der Geist.');
  });

  it('fails with the status when the corpus is not there', async () => {
    serve({});
    await expect(loadCorpus()).rejects.toThrow('404');
  });
});

describe('loading a discourse', () => {
  const discourse = (title: string) => ({
    uid: 'dhp1-20',
    title,
    reference: 'Dhammapada 1–20',
    blocks: [],
  });

  it('reads it in the language asked for', async () => {
    serve({ [`${BASE}corpus/de/suttas/dhp1-20.json`]: discourse('Zwillingsverse') });

    await expect(loadDiscourse('dhp1-20', 'de')).resolves.toEqual(discourse('Zwillingsverse'));
  });

  it('falls back to English for a discourse the language has not translated', async () => {
    serve({ [`${BASE}corpus/en/suttas/dhp1-20.json`]: discourse('Pairs') });

    await expect(loadDiscourse('dhp1-20', 'de')).resolves.toEqual(discourse('Pairs'));
  });

  it('gives up rather than looping when English itself is missing', async () => {
    const { asked } = serve({});

    await expect(loadDiscourse('dhp1-20', 'en')).rejects.toThrow('404');
    expect(asked).toHaveLength(1);
  });
});
