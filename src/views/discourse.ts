import { suttaCentralUrl, type Discourse } from '../corpus/load';
import { query } from './dom';

/**
 * The full discourse, in the active language. No Pali alongside — the root text
 * is neither fetched nor displayed (SPEC.md §15).
 *
 * Long-form reading typography, and a link out to SuttaCentral for parallels
 * and other translations.
 */
export interface DiscourseView {
  readonly element: HTMLElement;
  destroy(): void;
}

export interface DiscourseViewOptions {
  readonly discourse: Discourse;
  readonly onBack: () => void;
}

export function createDiscourseView(options: DiscourseViewOptions): DiscourseView {
  const element = document.createElement('section');
  element.className = 'screen screen--discourse';
  element.innerHTML = `
    <nav class="discourse__nav">
      <button type="button" class="action action--quiet" data-role="back">Back</button>
    </nav>
    <article class="discourse" lang="en">
      <header class="discourse__header">
        <p class="discourse__reference"></p>
        <h1 class="discourse__title"></h1>
      </header>
      <div class="discourse__body"></div>
      <footer class="discourse__footer">
        <a class="discourse__source" target="_blank" rel="noreferrer noopener"></a>
        <p class="discourse__credit">
          Translated by Bhikkhu Sujato. From SuttaCentral’s bilara-data, dedicated
          to the public domain under CC0.
        </p>
      </footer>
    </article>
  `;

  query(element, '.discourse__reference', HTMLElement).textContent = options.discourse.reference;
  query(element, '.discourse__title', HTMLElement).textContent = options.discourse.title;

  // Every line is canonical text, written with textContent and never parsed.
  const body = query(element, '.discourse__body', HTMLElement);
  for (const block of options.discourse.blocks) {
    if (block.kind === 'verse') {
      const stanza = document.createElement('p');
      stanza.className = 'discourse__verse';
      for (const [index, line] of block.lines.entries()) {
        if (index > 0) stanza.append(document.createElement('br'));
        stanza.append(document.createTextNode(line));
      }
      body.append(stanza);
    } else {
      const paragraph = document.createElement('p');
      paragraph.className = 'discourse__prose';
      paragraph.textContent = block.lines.join(' ');
      body.append(paragraph);
    }
  }

  const link = query(element, '.discourse__source', HTMLAnchorElement);
  link.href = suttaCentralUrl(options.discourse.uid);
  link.textContent = `Parallels and other translations on SuttaCentral`;

  const back = query(element, '[data-role="back"]', HTMLButtonElement);
  back.addEventListener('click', options.onBack);

  return {
    element,
    destroy(): void {
      back.removeEventListener('click', options.onBack);
      element.remove();
    },
  };
}
