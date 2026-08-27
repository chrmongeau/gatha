/**
 * Fetching the corpus.
 *
 * The site is served from a subpath, so every URL is built from
 * `import.meta.env.BASE_URL` and never from a leading slash (SPEC.md §2).
 *
 * English only for now. The pipeline is parameterised by language, and the
 * corpus directory is per-language, but no picker ships while one language
 * does — SPEC.md §15 says read it from a constant.
 */
// TODO(phase: languages): read from settings once a second language ships.
export const ACTIVE_LANGUAGE = 'en';

/** The language every passage falls back to when the active one lacks it. */
export const FALLBACK_LANGUAGE = 'en';

export interface Passage {
  readonly uid: string;
  readonly text: string;
  /** Citation, e.g. "Udāna 1.3". */
  readonly reference: string;
  readonly title: string;
  /** The discourse this passage came from, as SuttaCentral serves it. */
  readonly parentUid: string;
}

export interface DiscourseBlock {
  readonly kind: 'prose' | 'verse';
  readonly lines: readonly string[];
}

export interface Discourse {
  readonly uid: string;
  readonly title: string;
  readonly reference: string;
  readonly blocks: readonly DiscourseBlock[];
}

export interface Corpus {
  readonly order: readonly string[];
  readonly passages: ReadonlyMap<string, Passage>;
}

export function corpusUrl(path: string): string {
  return `${import.meta.env.BASE_URL}corpus/${path}`;
}

export function suttaCentralUrl(uid: string): string {
  return `https://suttacentral.net/${uid}`;
}

/** Order and passages together: neither is useful without the other. */
export async function loadCorpus(language: string = ACTIVE_LANGUAGE): Promise<Corpus> {
  const [order, passages] = await Promise.all([
    fetchJson<string[]>(corpusUrl('order.json')),
    loadPassages(language),
  ]);
  return { order, passages };
}

async function loadPassages(language: string): Promise<Map<string, Passage>> {
  const raw = await fetchJson<Record<string, RawPassage>>(corpusUrl(`${language}/passages.json`));
  const passages = new Map<string, Passage>();
  for (const [uid, entry] of Object.entries(raw)) {
    passages.set(uid, { uid, ...entry });
  }

  // A language legitimately covers only part of the corpus. Rather than skip
  // the day or show an empty screen, fill the gaps from English (SPEC.md §3).
  if (language !== FALLBACK_LANGUAGE) {
    const fallback = await fetchJson<Record<string, RawPassage>>(
      corpusUrl(`${FALLBACK_LANGUAGE}/passages.json`),
    );
    for (const [uid, entry] of Object.entries(fallback)) {
      if (!passages.has(uid)) passages.set(uid, { uid, ...entry });
    }
  }

  return passages;
}

/** Fetched on demand, and only when someone asks to read the whole thing. */
export async function loadDiscourse(
  parentUid: string,
  language: string = ACTIVE_LANGUAGE,
): Promise<Discourse> {
  try {
    return await fetchJson<Discourse>(corpusUrl(`${language}/suttas/${parentUid}.json`));
  } catch (error) {
    if (language === FALLBACK_LANGUAGE) throw error;
    return fetchJson<Discourse>(corpusUrl(`${FALLBACK_LANGUAGE}/suttas/${parentUid}.json`));
  }
}

interface RawPassage {
  readonly text: string;
  readonly reference: string;
  readonly title: string;
  readonly parentUid: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${String(response.status)}`);
  return (await response.json()) as T;
}
