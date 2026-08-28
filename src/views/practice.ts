import {
  WINDOW_DAYS,
  calendar,
  daysInWindow,
  intensity,
  totals,
  weekdayOffset,
  type DaySummary,
} from '../history/metrics';
import type { SessionRecord } from '../history/store';
import type { ThemePreference } from '../theme';
import { query, screenElement } from './dom';

/**
 * The practice history. Reachable, but not prominent (SPEC.md §4).
 *
 * What is absent is deliberate and argued at length in SPEC.md §7: no
 * consecutive-day counter, nothing coloured as a warning, no badges, no
 * milestones, no goal-setting. The primary number is days sat in the last
 * thirty, which is robust to gaps and which no single day can destroy; the
 * totals only ever rise. Returning after a gap is meant to be the most ordinary
 * thing in the app.
 */
export interface PracticeView {
  readonly element: HTMLElement;
  destroy(): void;
}

export interface PracticeViewOptions {
  readonly sessions: readonly SessionRecord[];
  readonly today: number;
  readonly anchor: string | null;
  readonly onAnchorChange: (anchor: string | null) => void;
  readonly onExport: () => void;
  readonly onImport: (file: File) => void;
  readonly theme: ThemePreference;
  readonly onThemeChange: (preference: ThemePreference) => void;
  readonly onMethod: () => void;
  readonly onBack: () => void;
}

/** Seventeen weeks: a few months, which is the shape of a practice. */
const CALENDAR_DAYS = 7 * 17;

const MARKUP = `
  <nav class="discourse__nav">
    <button type="button" class="action action--quiet" data-role="back">Back</button>
  </nav>
  <article class="practice">
    <h1 class="practice__title">Practice</h1>

    <p class="practice__headline">
      <span class="practice__fraction" data-role="fraction"></span>
      <span class="practice__caption">days sat in the last ${String(WINDOW_DAYS)}</span>
    </p>

    <div class="practice__calendar" data-role="calendar" role="img"></div>

    <dl class="practice__totals">
      <div class="practice__total">
        <dt>Days practised</dt>
        <dd data-role="total-days"></dd>
      </div>
      <div class="practice__total">
        <dt>Hours sat</dt>
        <dd data-role="total-hours"></dd>
      </div>
    </dl>

    <section class="practice__block">
      <label class="choice__legend" for="anchor">I’ll sit after</label>
      <input class="practice__anchor" id="anchor" type="text" autocomplete="off"
             placeholder="my morning coffee" data-role="anchor" />
    </section>

    <section class="practice__block">
      <h2 class="choice__legend">Appearance</h2>
      <div class="choice__row" data-role="theme"></div>
    </section>

    <section class="practice__block">
      <h2 class="choice__legend">Your history</h2>
      <p class="practice__note">
        There is no account and no backup on a server. Exporting is the only way
        this survives a cleared cache or a new phone.
      </p>
      <div class="practice__row">
        <button type="button" class="choice__button" data-role="export">Export</button>
        <label class="choice__button practice__import">
          Import
          <input type="file" accept="application/json,.json" data-role="import"
                 aria-label="Import a backup file" />
        </label>
      </div>
      <p class="practice__result" role="status" data-role="result"></p>
    </section>

    <footer class="practice__footer">
      <button type="button" class="action action--quiet" data-role="method">
        Why this app counts what it counts
      </button>
    </footer>
  </article>
`;

export function createPracticeView(options: PracticeViewOptions): PracticeView {
  const element = screenElement('practice', MARKUP);

  const sat = daysInWindow(options.sessions, options.today);
  query(element, '[data-role="fraction"]', HTMLElement).textContent = `${String(sat)}/${String(WINDOW_DAYS)}`;

  const overall = totals(options.sessions);
  query(element, '[data-role="total-days"]', HTMLElement).textContent = String(overall.days);
  query(element, '[data-role="total-hours"]', HTMLElement).textContent = String(
    Math.round(overall.totalMs / 3_600_000),
  );

  const squares = calendar(options.sessions, options.today, CALENDAR_DAYS);
  paintCalendar(query(element, '[data-role="calendar"]', HTMLElement), squares);

  const themes = query(element, '[data-role="theme"]', HTMLElement);
  const paintTheme = (chosen: ThemePreference): void => {
    for (const button of themes.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.theme === chosen));
    }
  };
  for (const [preference, label] of [
    ['dark', 'Dark'],
    ['light', 'Light'],
    ['system', 'System'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice__button';
    button.dataset.theme = preference;
    button.textContent = label;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      paintTheme(preference);
      options.onThemeChange(preference);
    });
    themes.append(button);
  }
  paintTheme(options.theme);

  const anchor = query(element, '[data-role="anchor"]', HTMLInputElement);
  anchor.value = options.anchor ?? '';
  anchor.addEventListener('change', () => {
    options.onAnchorChange(anchor.value.trim() === '' ? null : anchor.value);
  });

  const importInput = query(element, '[data-role="import"]', HTMLInputElement);
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (file !== undefined) options.onImport(file);
    importInput.value = '';
  });

  query(element, '[data-role="export"]', HTMLButtonElement).addEventListener('click', options.onExport);
  query(element, '[data-role="method"]', HTMLButtonElement).addEventListener('click', options.onMethod);
  query(element, '[data-role="back"]', HTMLButtonElement).addEventListener('click', options.onBack);

  return {
    element,
    /*
     * The element and everything bound to it goes at once. No listener here is
     * attached to anything that outlives this subtree — no document, no window —
     * so unbinding them one by one was bookkeeping with nothing to keep.
     */
    destroy(): void {
      element.remove();
    },
  };
}

/** Set the result line from outside, once an import or export has happened. */
export function reportResult(view: PracticeView, text: string): void {
  query(view.element, '[data-role="result"]', HTMLElement).textContent = text;
}

/**
 * Squares in weekday rows, oldest column first — the shape of a practice with
 * its gaps left in. Gaps are texture, so an empty square is drawn no differently
 * from the ground it sits on.
 */
function paintCalendar(into: HTMLElement, squares: readonly DaySummary[]): void {
  const offset = weekdayOffset(squares[0]?.day ?? 0);
  for (let i = 0; i < offset; i += 1) {
    const blank = document.createElement('span');
    blank.className = 'day day--blank';
    into.append(blank);
  }

  let sat = 0;
  for (const square of squares) {
    const cell = document.createElement('span');
    cell.className = 'day';
    const weight = intensity(square.totalMs);
    if (weight > 0) {
      sat += 1;
      cell.style.setProperty('--weight', weight.toFixed(3));
      cell.dataset.sat = 'true';
    }
    into.append(cell);
  }

  into.setAttribute(
    'aria-label',
    `${String(sat)} days sat in the last ${String(squares.length)}`,
  );
}
