import { query } from './dom';

/**
 * Why the app measures what it measures (SPEC.md §7.3).
 *
 * Its real job is to explain an absence. Anyone arriving from a fitness app will
 * notice there is no streak and assume it was an oversight; this says it was a
 * decision, and shows the work.
 *
 * The structural rhyme is deliberate: the app cites every passage back to a
 * source the reader can check, and this page does the same for its own
 * behaviour. Claim, then provenance, set in the same face as a sutta reference.
 *
 * Tone, per the spec: plain declarative sentences. No hedging adverbs, no
 * enthusiasm, no second-person coaching. The reader is capable of evaluating
 * evidence and is being shown it, not sold on it.
 */
export interface MethodView {
  readonly element: HTMLElement;
  destroy(): void;
}

interface Claim {
  readonly heading: string;
  readonly body: readonly string[];
  readonly consequence: string;
}

const CLAIMS: readonly Claim[] = [
  {
    heading: 'Repetition in a stable context is the mechanism.',
    body: [
      'Automaticity grows with each repetition of a behaviour in a consistent setting, following an asymptotic curve. Lally et al. (2010) tracked 96 people forming daily habits and found a median of 66 days to reach 95% of that asymptote, with a range of 18 to 254 days. The demanding behaviours sat at the slow end.',
      'Wood and Neal (2007) describe what the repetition builds: a direct association between a context and a response, so that the context comes to cue the behaviour without the goal being consulted each time. This is why the setting matters as much as the intention, and why a practice that happens at a different hour in a different room each day stays effortful for longer.',
    ],
    consequence: 'So the app asks for a daily occurrence, not a daily quota.',
  },
  {
    heading: 'Duration is not the variable being trained.',
    body: [
      'This one is an inference, not a finding. Lally did not manipulate session length. What the study shows is that simpler behaviours automated faster than demanding ones. The two-minute floor follows from that, plus the mechanism in the first claim. It is this app’s reasoning rather than a tested result.',
    ],
    consequence: 'So two minutes counts as a full session.',
  },
  {
    heading: 'A missed day is not a reset.',
    body: [
      'Lally et al. found that missing a single opportunity did not materially affect the habit formation process. Automaticity dipped by under half a point and recovered.',
      'The familiar 21-day figure is a misreading of Maxwell Maltz’s 1960 observation about patients adjusting to their appearance after surgery. It is not a habit-formation finding at all.',
    ],
    consequence:
      'So the primary metric is days in the last 30, which no single day can break.',
  },
  {
    heading: 'A goal framed as something amassed beats one framed as something protected.',
    body: [
      'Cochran and Tesser’s account of the “what the hell” effect distinguishes acquisitional goals, which are about gaining something, from inhibitional ones, which are about not breaking something. Failing an inhibitional goal reads as a loss. Falling short of an acquisitional one reads merely as a lack of gain.',
      'A streak is inhibitional by construction. Its whole value is in not being broken.',
    ],
    consequence: 'So the app counts sessions accumulated, never a record defended.',
  },
];

const ASK = [
  'The if-then anchor is the one thing the app asks for. Specifying when and where in advance has a medium-to-large effect on goal attainment — d = .65 across 94 independent tests — and a comparable effect on preventing the derailment of a pursuit already under way, at d = .77.',
  'A stated cue outperforms a stated goal.',
];

interface Reference {
  readonly text: string;
  readonly doi?: string;
  /**
   * Where the full text stands. §7.3 asks for no paywalled-only citation
   * without saying the abstract is free, so a reader knows what a link gives
   * them before they follow it.
   */
  readonly access: string;
}

/**
 * Every DOI here is resolved against doi.org by `npm run check:references`,
 * which also runs in CI. A citation nobody can follow is worse than no citation
 * on a page whose whole argument is that the reader can check the work.
 */
const REFERENCES: readonly Reference[] = [
  {
    text: 'Lally, P., van Jaarsveld, C. H. M., Potts, H. W. W., & Wardle, J. (2010). How are habits formed: Modelling habit formation in the real world. European Journal of Social Psychology, 40(6), 998–1009.',
    doi: '10.1002/ejsp.674',
    access: 'Abstract free; full text paywalled.',
  },
  {
    text: 'Gollwitzer, P. M., & Sheeran, P. (2006). Implementation intentions and goal achievement: A meta-analysis of effects and processes. Advances in Experimental Social Psychology, 38, 69–119.',
    doi: '10.1016/S0065-2601(06)38002-1',
    access: 'Abstract free; full text paywalled.',
  },
  {
    text: 'Cochran, W., & Tesser, A. (1996). The “what the hell” effect: Some effects of goal proximity and goal framing on performance. In L. L. Martin & A. Tesser (Eds.), Striving and Feeling: Interactions Among Goals, Affect, and Self-Regulation (pp. 99–120). Lawrence Erlbaum.',
    access: 'A book chapter, with no DOI of its own. In print only.',
  },
  {
    text: 'Wood, W., & Neal, D. T. (2007). A new look at habits and the habit–goal interface. Psychological Review, 114(4), 843–863.',
    doi: '10.1037/0033-295X.114.4.843',
    access: 'Abstract free; full text paywalled.',
  },
];

const LIMITATIONS = [
  'Lally et al. is one study of 96 volunteers, mostly postgraduate students with a mean age of 27. It has not been replicated at scale.',
  'The asymptotic model was a good fit for 39 participants, not all of them. The 66-day median describes that subset.',
  'Participants self-reported both the behaviour and how automatic it felt, and logged on a median of 47 of 84 days.',
  'None of this research studied meditation. The behaviours were eating, drinking and exercise. Applying it here is an extrapolation.',
  'The two-minute floor is this app’s inference, not a finding.',
];

export interface MethodViewOptions {
  readonly onBack: () => void;
}

export function createMethodView(options: MethodViewOptions): MethodView {
  const element = document.createElement('section');
  element.className = 'screen screen--method';
  element.innerHTML = `
    <nav class="discourse__nav">
      <button type="button" class="action action--quiet" data-role="back">Back</button>
    </nav>
    <article class="method">
      <h1 class="method__title">What this app counts</h1>
      <p class="method__lead">
        There is no streak here. That is a decision rather than an oversight, and
        this is the reasoning behind it.
      </p>
      <div data-role="claims"></div>
      <h2 class="method__heading">And the one thing it asks of you</h2>
      <div data-role="ask"></div>
      <h2 class="method__heading">References</h2>
      <ul class="method__references" data-role="references"></ul>
      <h2 class="method__heading">Limitations</h2>
      <ul class="method__limitations" data-role="limitations"></ul>
      <p class="method__close">
        These are the best available findings, not settled fact, and the app is
        built on them provisionally.
      </p>
    </article>
  `;

  const claims = query(element, '[data-role="claims"]', HTMLElement);
  for (const [index, claim] of CLAIMS.entries()) {
    const section = document.createElement('section');
    section.className = 'method__claim';

    const heading = document.createElement('h2');
    heading.className = 'method__heading';
    heading.textContent = `${String(index + 1)}. ${claim.heading}`;
    section.append(heading);

    for (const paragraph of claim.body) {
      const p = document.createElement('p');
      p.textContent = paragraph;
      section.append(p);
    }

    const consequence = document.createElement('p');
    consequence.className = 'method__consequence';
    consequence.textContent = claim.consequence;
    section.append(consequence);

    claims.append(section);
  }

  const ask = query(element, '[data-role="ask"]', HTMLElement);
  for (const paragraph of ASK) {
    const p = document.createElement('p');
    p.textContent = paragraph;
    ask.append(p);
  }

  const references = query(element, '[data-role="references"]', HTMLElement);
  for (const reference of REFERENCES) {
    const item = document.createElement('li');
    item.append(document.createTextNode(reference.text));
    if (reference.doi !== undefined) {
      item.append(document.createTextNode(' '));
      const link = document.createElement('a');
      link.href = `https://doi.org/${reference.doi}`;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = `doi:${reference.doi}`;
      item.append(link);
    }

    const access = document.createElement('span');
    access.className = 'method__access';
    access.textContent = reference.access;
    item.append(access);

    references.append(item);
  }

  const limitations = query(element, '[data-role="limitations"]', HTMLElement);
  for (const limitation of LIMITATIONS) {
    const item = document.createElement('li');
    item.textContent = limitation;
    limitations.append(item);
  }

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
