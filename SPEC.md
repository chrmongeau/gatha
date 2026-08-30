# Gatha — Build Specification

A meditation timer that opens with a short passage from the Pali canon and closes
by offering the whole discourse it came from.

This document is the source of truth for the build. Where it states a decision,
follow it. Where it says **OPEN**, ask before choosing.

Where a decision here turns out to be wrong in practice, amend it to describe
what actually works, say so, and note the evidence. A spec that disagrees with a
measured device is not a spec worth following. Section 5 has been amended this
way already.

---

## 1. Product intent

One screen, one job: help someone sit, daily, with a text worth carrying into
the silence.

The session has three beats:

1. **Passage** — a short canonical extract, readable in under a minute. Sets an
   intention for the sit.
2. **Silence** — a customisable timer with a bell at the start, at intervals,
   and at the end.
3. **Expansion** — after the bell, the full discourse the passage came from,
   available but never insisted on.

The ordering is deliberate. The passage precedes the sit because a text gives
the session direction; the full discourse follows it because tapping into a
long text thirty seconds before closing your eyes generates exactly the
discursive thinking the sit is meant to settle.

### Non-goals

Do not build these. If a feature request sounds like one of these, stop and ask.

- Accounts, login, cloud sync, or any backend
- Push notifications or scheduled reminders
- Social features, sharing feeds, leaderboards
- Guided meditation audio, ambient soundscapes, music
- Analytics, telemetry, or third-party trackers of any kind
- Commentary, interpretation, or generated content layered onto the canon

The app ships as static files and works fully offline after first load. That
constraint is a feature, not a limitation to route around.

---

## 2. Stack and constraints

- **Vanilla TypeScript + Vite.** No React, no framework. The UI is a handful of
  views; a framework would be more code than the app.
- **No runtime dependencies** in the core app. Build-time tooling is fine.
  The optional TTS phase is the single exception.
- **Deployed to GitHub Pages** from a GitHub Actions workflow.
- **Target browsers:** current Chrome, Safari (incl. iOS), Firefox. Mobile-first;
  this is used one-handed, in low light, often on a phone propped nearby.

### GitHub Pages gotchas — get these right up front

The site is served from a subpath (`username.github.io/gatha/`), which breaks
several defaults:

- Set `base: '/gatha/'` in `vite.config.ts`.
- Build every asset URL from `import.meta.env.BASE_URL`. Never hardcode a
  leading `/`.
- The web app manifest's `start_url` and `scope` must both include the base path.
- Register the service worker with a scope inside the base path.
- Emit a `.nojekyll` file into `dist/`. Without it, GitHub Pages' Jekyll layer
  silently drops Vite's `_`-prefixed output.
- Service workers and the Wake Lock API both require a secure context. GitHub
  Pages provides HTTPS, so this works — but it will *not* work over plain
  `http://localhost` on some APIs. Use `vite --host` with HTTPS locally if you
  hit this.

---

## 3. Content pipeline

### Source

SuttaCentral's `bilara-data` repository, `published` branch.
`https://github.com/suttacentral/bilara-data`

All translations there are **CC0**. There is no attribution obligation and no
non-commercial restriction. Credit Bhikkhu Sujato and SuttaCentral anyway — it
is right, and it is what makes the app trustworthy — but there is no licensing
question to resolve.

Do **not** vendor the repo as a git submodule, and do **not** call the
SuttaCentral HTTP API at runtime. The API blocks cross-origin requests from
other sites and is an internal, unversioned interface. Extract at build time
instead.

### Extraction script

`tools/build-corpus.mts`, run manually (not on every build — the canon is not
changing).

1. Shallow sparse-clone the source:

   ```bash
   git clone --depth 1 --filter=blob:none --sparse \
     -b published https://github.com/suttacentral/bilara-data .cache/bilara-data
   cd .cache/bilara-data
   git sparse-checkout set "translation/${LANG}/${TRANSLATOR}"
   ```

   `LANG` and `TRANSLATOR` are parameters, defaulting to `en` and `sujato`.
   Do not hardcode them anywhere in the script. The Pali root text under
   `root/pli/ms` is **not** fetched — it is not displayed (see §4).

2. Walk the translation tree. Each file is a JSON object mapping segment IDs
   (`ud1.1:2.1`) to strings. Segment IDs are stable across every language, which
   is what makes the split in step 6 possible.

3. Filter to the short-form collections. Default include list:

   | Collection | Code | Why |
   |---|---|---|
   | Udāna | `ud` | Short scene + verse. The ideal shape. |
   | Itivuttaka | `iti` | 112 short prose-and-verse pieces. |
   | Dhammapada | `dhp` | 423 standalone verses. |
   | Theragāthā | `thag` | Verses of early monks. |
   | Therīgāthā | `thig` | Verses of early nuns. |
   | Khuddakapāṭha | `kp` | Includes Mettā and Maṅgala suttas. |
   | Sutta Nipāta | `snp` | Selected short suttas. |
   | Saṃyutta Nikāya | `sn` | Many are a single paragraph. |

   Exclude `dn`, `mn`, and most of `an` — wrong length entirely.

4. **Deduplicate the peyyāla series.** SN and AN contain long runs of
   near-identical suttas generated by an abbreviation convention, where a single
   term is swapped across dozens of entries. Pulling randomly from these will
   serve fifteen variations of the same text. Normalise each candidate (lowercase,
   strip punctuation and proper nouns), hash it, and keep only the first of any
   near-duplicate group. Log how many were dropped so the filter can be tuned.

5. **Select the passage** for each sutta:
   - For `ud` and `iti`: the verse segments (the inspired utterance itself).
   - For `dhp`, `thag`, `thig`: each verse is its own passage.
   - For prose suttas: the concluding or most self-contained paragraph, or skip
     the sutta if no segment stands alone. Bias toward skipping. A passage that
     needs context is a bad passage.
   - Hard cap: **60 words**. Anything longer is not a one-minute read on a phone.

6. Emit, splitting language-neutral structure from per-language text:

   ```
   public/corpus/selection.json          # chosen segment IDs per passage + parent uid
   public/corpus/order.json              # fixed shuffled permutation of passage IDs
   public/corpus/languages.json          # available languages + translator credit
   public/corpus/en/passages.json        # rendered passage text
   public/corpus/en/suttas/{uid}.json    # full discourse text, fetched lazily
   public/corpus/SOURCE                  # upstream commit SHA + extraction date
   ```

   **This split is the whole parameterisation.** Which segments constitute a
   passage is a structural fact about the canon, not about English — so choose
   them once, in the reference language, and write them to `selection.json`.
   Adding a language then becomes a data operation: run the builder with a new
   `LANG`, emit one more directory, append to `languages.json`. No re-derivation,
   and every language shows the same passage on the same day.

   Validate the 60-word cap against the reference language only. Word counts
   differ across languages; the structural choice should not.

   **Handle partial coverage.** Not every language has every collection
   translated. `passages.json` for a given language will legitimately be a subset
   of `selection.json`. When the day's passage is missing in the active language,
   fall back to English rather than skipping the day or showing an empty screen.

   Commit all of it. Record the upstream SHA so any passage can be traced back.

### Daily selection

Compute `dayNumber = floor(Date.now() / 86400000)` in the user's local timezone.
Index into `order.json` at `dayNumber % order.length`. Because the order is a
fixed shuffle generated at build time, this gives a stable passage for the whole
day, identical across devices, with no repeat until the corpus is exhausted.

Let the user re-roll to a different passage, but keep the day's default as the
one shown on open.

---

## 4. Screens

Four views, no router library — a small state machine is enough.

**Today.** The passage, its source reference (e.g. "Udāna 1.3"), and a single
primary action: **Begin**. Duration and interval are adjustable
here, inline, without leaving the screen. This is the screen people see most, so
it should be the most finished.

**Sitting.** Almost nothing. See §5 and §9 — this screen's design is the app's
signature and its hardest problem.

**After.** The bell has rung. Confirm the session was recorded, show the passage
again, and offer **Read the full discourse**. No score, no congratulation.

**Discourse.** The full sutta in the active language. No Pali alongside — the
root text is not fetched or displayed. Long-form reading typography. A link out to `suttacentral.net/{uid}` for parallels and
other translations. If TTS is enabled, the play control lives here.

A fifth, reachable but not prominent: **Practice** — the session history (§7)
and settings.

A sixth, reachable only from Practice: **Method** — why the app measures what it
measures, with references (§7.3).

---

## 5. Timer engine

This is where meditation timers fail, so build it carefully and test it on a
real phone with the screen locked before calling it done.

### The failure mode

`setInterval` is throttled when a tab is backgrounded and frozen outright when
an iOS device locks. A timer that counts ticks will drift, then stall, then fire
every missed bell at once when the user picks the phone up. Never count ticks.

### The design

**Wall clock is the only truth.** Store `startedAt = Date.now()` when the
session begins. Derive elapsed time as `Date.now() - startedAt`, recomputed on
every animation frame and again on every `visibilitychange`. State is a
timestamp, never an accumulator.

**Schedule every bell in advance, in the audio clock.** The Web Audio API has
its own sample-accurate scheduler running off the main thread, which survives
the main thread being throttled or suspended. At session start — inside the user
gesture handler, which is required by autoplay policy — create the `AudioContext`
and schedule all bells at once:

```ts
const ctx = new AudioContext();
for (const offsetSeconds of bellOffsets) {
  strikeBell(ctx, ctx.currentTime + offsetSeconds, kindOf(offsetSeconds));
}
```

Do not schedule bells one at a time as the session progresses. The whole point
is that the schedule survives the main thread being suspended.

**But the schedule is not sufficient on its own, and the audio clock is not the
wall clock.** Two failures were measured on a real device, and both must be
handled:

- *A frozen page takes the schedule with it.* Chrome froze a backgrounded tab
  ninety seconds after the screen locked and held it frozen for eight minutes;
  every bell scheduled inside it was lost. Nothing survives a freeze. Avoiding
  the freeze is the keepalive's job, below.
- *A suspended `AudioContext` stops advancing `currentTime`.* Bells scheduled
  against it then fire late by the length of the suspension. So keep the offset
  each bell was scheduled for, and when the page comes back, re-anchor the bells
  still ahead to the wall clock. Give each ringing its own gain node so an
  unstarted one can be cancelled with a single disconnect, and leave a bell
  already sounding to finish.

Do not hang that recovery on `visibilitychange` alone. A device test showed a
page thawing after eight minutes without that event ever firing. Reach it from
the `resume` (thaw) event and from a periodic timer as well.

**Keep the audio context alive, and keep the tab audible.** iOS suspends an
`AudioContext` when the page is backgrounded unless audio is actively playing,
and Chrome freezes a hidden tab it considers silent. Both are answered by a
continuous inaudible tone running for the session duration.

**The level matters more than anything else here.** Chrome's audio power monitor
puts its silence threshold near **-72 dBFS**, and a tab under that line counts as
silent however much is nominally playing. A first attempt used near-silent noise
at 0.0001 — -80 dBFS — which sat below the threshold, was frozen, and lost the
session's bells. Use roughly **0.002, about -54 dBFS**, at a frequency low enough
that no phone speaker can reproduce it (30 Hz works). Do not use noise: at an
audible level it is heard as a continuous hiss, which was reported from a device
as sounding "like an old analogue LP".

Add the `MediaSession` API as well, so the OS treats the session as active media
and is correspondingly less willing to freeze it. Set `mediaSession.metadata` to
the passage's source reference — it reads nicely on a lock screen. Offer a
`stop` action only; a sit has no meaningful pause, and a transport control that
does nothing is worse than no control.

If a bell is ever reported as unclear during a session but clean when rung on
its own, suspect this tone: a phone speaker asked to move at 30 Hz can muddy
everything above it. Duck the keepalive around each ringing — the bell is far
above the silence threshold by itself.

**Hold the screen awake.** Request `navigator.wakeLock.request('screen')` on
start. Wake locks are automatically released when the page is hidden, so
re-request on `visibilitychange` when the page becomes visible again. Feature-
detect; Firefox may not have it. This is the pragmatic answer to background
suspension: if the screen stays on, most of the problem disappears.

**Resync, don't replay.** On returning to visibility, recompute elapsed time from
the wall clock. If bells were missed while suspended, mark them fired and move
on. Never fire a backlog.

**Handle the edges:** a system clock change mid-session; the user backgrounding
and returning after the session should have ended (show the After screen with
the true end time); a reload mid-session (persist `startedAt` and offer to
resume).

**Take two clock readings, not one.** A monotonic clock is right for elapsed
time, because a system clock correction must not move the bells. But
`performance.now()` can stall outright while a device sleeps, and a session that
believes no time passed runs long — which is the worse failure, since the sitter
waits past a bell that never comes with no way to know. So read both, and prefer
the monotonic one *except* when the wall clock has advanced materially further
(about 2s), which is what a stall looks like. A wall clock running behind has
been set backwards; ignore it. Floor elapsed time at its previous value so it
never decreases whatever the clocks do.

`Date.now()` is still what the session record stores, since it is the only
reading that survives a reload.

### Configuration

- Duration: presets at 5 / 10 / 15 / 20 / 30 / 45 minutes, plus a custom value.
- Interval bells: off by default; configurable every N minutes.
- Optional preparation delay before the opening bell (default 10s) so the phone
  can be set down.
- Optional silent lead-out after the closing bell.

---

## 6. The bell

**Synthesise it. Do not ship an audio file.** Additive synthesis gives a
credible singing bowl in about forty lines, adds zero bytes to the bundle,
sidesteps sample licensing entirely, and can be retuned per bell type.

A struck bowl has *inharmonic* partials — that inharmonicity is what makes it
sound like metal rather than a synth pad. Build `strikeBell(ctx, when, kind)`:

- Sine oscillators at ratios of roughly `[1, 2.0, 2.7, 4.2, 5.4]` above the
  fundamental, with descending gain.
- Per-partial exponential decay, longer for lower partials — around 8s for the
  fundamental down to 1.5s for the highest.
- A 5ms attack ramp on each. A hard start produces an audible click.
- A brief filtered noise burst at onset for the strike transient.
- Tiny random detune per strike so repeated bells aren't identical.

Distinguish the three bell types by fundamental and strike count: **opening**
three strikes spaced ~4s, **interval** a single lighter strike at a higher
fundamental, **closing** three strikes with the longest decay.

Expose volume, and a genuinely silent mode for anyone sitting near a sleeping
household — in silent mode, the interval markers become a brief screen
brightening instead.

---

## 7. Practice history

Store locally. There is no backend and there will not be one.

- Settings → `localStorage`.
- Session log → `localStorage` as JSON. A record is `{ startedAt, durationMs,
  completed, passageId }`, roughly 80 bytes; a decade of daily practice is under
  300KB, comfortably inside quota.
- Provide **Export** and **Import** as a JSON file. With no account, this is the
  only way the user's history survives a cleared cache or a new device. Make it
  easy to find, not buried.

### Habit design — the evidence, and what it implies

The goal is a daily practice that survives bad days. Three findings shape it.

**1. Occurrence matters more than duration.** Automaticity is driven by
repetition of a behaviour in a stable context. Lally et al. (2010, *European
Journal of Social Psychology*) tracked 96 people forming daily habits and found
a median of 66 days to reach 95% of asymptotic automaticity, with a range of
18–254 days driven largely by how demanding the behaviour was. Simple behaviours
automated fastest; demanding ones took far longer.

The implication is direct: **a two-minute sit counts as fully as a thirty-minute
one.** Same cue, same context, same repetition. The app must treat it that way —
never grade a session by length, never imply a short sit was a partial success.

**2. One missed day does not break anything.** The same study found that missing
a single opportunity did not materially affect the habit formation process;
automaticity dipped slightly and recovered. The streak's all-or-nothing logic
does not describe anything real about how habits form. It is a game mechanic
borrowed from elsewhere, and its main effect is the abstinence-violation
response — once the record is "ruined," the goal loses its grip and abandonment
follows. This is why people quit *after* a long run ends rather than during a
short one.

**3. If-then plans close the intention–behaviour gap.** Specifying when, where,
and how in advance has a medium-to-large effect on goal attainment across 94
independent tests (d = .65; Gollwitzer & Sheeran, 2006), with a comparable
effect on preventing derailment of an ongoing pursuit (d = .77). A stated cue
outperforms a stated goal.

### What to build

**A floor, not a streak.** The unit of success is *any session of two minutes or
more*. Offer a **2-minute** preset alongside the others, as a first-class option
rather than a consolation. When a day is still open, the Today screen should
make the floor visible in plain interface voice: "Two minutes counts."

**Rolling consistency, not consecutive days.** The primary metric is **days sat
in the last 30**, shown as a fraction (e.g. 24/30). It is robust to gaps, it
recovers on its own, and no single day can destroy it. This delivers the 2–3
days of slack structurally, with no grace mechanic to configure or spend.

**Totals that only rise.** Total days practised, total hours. Monotonic, so the
app never shows something being lost.

**A heat map as the main visualisation.** Squares for the last few months,
opacity by duration. It shows the true shape of a practice, gaps included,
without scoring it. Gaps read as texture rather than failure.

**One if-then prompt, asked once.** During first run: "I'll sit after ___." The
answer is a free-text anchor tied to an existing daily event — after coffee,
after the kids leave, before bed. Store it and surface it on the Today screen
when no session has been recorded yet that day. This is the highest-leverage
feature in the entire history system and costs about twenty lines.

### What not to build

- No consecutive-day counter as a headline number. If present at all, it is
  secondary and never coloured as a warning.
- No red, no "lost," no "broken," no "don't lose your progress."
- No badges, milestones, or celebrations at arbitrary thresholds.
- No notifications — recovery should be the user's own move, not a nudge.
- No goal-setting UI with targets to miss.

Returning after a gap must be the most ordinary thing in the app. The Today
screen after ten days away looks exactly like the Today screen after one: the
day's passage, and Begin.


### 7.3 The Method page

A dedicated view explaining the reasoning above, reachable from a quiet link at
the foot of Practice. Not in any navigation bar.

Its real job is to **explain an absence**. Anyone arriving from Duolingo or a
fitness app will notice there is no streak and assume it was an oversight. This
page says it was a decision, and shows the work.

There is a structural rhyme worth honouring in the design: the app already cites
every passage back to a source the reader can check. This page does the same
thing for its own behaviour. Same treatment — claim, then provenance. Set the
references in the same face as the sutta references, at the same size.

#### Structure

Four claims, each with what the app does about it. Then references. Then
limitations.

**1. Repetition in a stable context is the mechanism.**
Automaticity grows with each repetition in a consistent setting, following an
asymptotic curve. Lally et al. (2010) found a median of 66 days to reach 95% of
that asymptote, with a range of 18–254 days — and the demanding behaviours sat
at the slow end.
→ *So the app asks for a daily occurrence, not a daily quota.*

**2. Duration is not the variable being trained.**
Mark this one honestly as an inference, not a finding. Lally did not manipulate
session length. What the study shows is that simpler behaviours automated faster
than demanding ones; the two-minute floor follows from that plus the mechanism
in (1), and it is the app's reasoning rather than a tested result. Say so in
those words. A page that overclaims is worse than no page.
→ *So two minutes counts as a full session.*

**3. A missed day is not a reset.**
Lally et al. found that missing one opportunity did not materially affect the
habit formation process — automaticity dipped by under half a point and
recovered. Also worth stating plainly here: the familiar "21 days" figure is a
misreading of Maxwell Maltz's 1960 observation about patients adjusting to
post-surgical body image, not a habit-formation finding at all.
→ *So the primary metric is days in the last 30, which no single day can break.*

**4. Framing a goal as something amassed beats framing it as something
protected.** Cochran & Tesser's account of the "what the hell effect"
distinguishes *acquisitional* goals (gaining something) from *inhibitional* ones
(not breaking something): failing an inhibitional goal reads as a loss, while
falling short of an acquisitional one reads merely as a lack of gain. A streak
is inhibitional by construction — its whole value is in not being broken.
→ *So the app counts sessions accumulated, never a record defended.*

**Plus the one thing it asks of you.** Close with the if-then anchor, since it
is the only place the app requests anything: specifying when and where in
advance has a medium-to-large effect on goal attainment (d = .65 across 94
independent tests) and on preventing derailment (d = .77).

#### References

Render as a plain list. Include DOIs where they exist; make them links. No
paywalled-only citations without a note that the abstract is free.

- Lally, P., van Jaarsveld, C. H. M., Potts, H. W. W., & Wardle, J. (2010).
  How are habits formed: Modelling habit formation in the real world.
  *European Journal of Social Psychology*, 40(6), 998–1009.
  doi:10.1002/ejsp.674
- Gollwitzer, P. M., & Sheeran, P. (2006). Implementation intentions and goal
  achievement: A meta-analysis of effects and processes. *Advances in
  Experimental Social Psychology*, 38, 69–119.
  doi:10.1016/S0065-2601(06)38002-1
- Cochran, W., & Tesser, A. (1996). The "what the hell" effect: Some effects of
  goal proximity and goal framing on performance. In L. L. Martin & A. Tesser
  (Eds.), *Striving and Feeling: Interactions Among Goals, Affect, and
  Self-Regulation* (pp. 99–120). Lawrence Erlbaum.
- Wood, W., & Neal, D. T. (2007). A new look at habits and the habit–goal
  interface. *Psychological Review*, 114(4), 843–863.

#### Limitations — include these, do not soften them

The page loses its point if it reads as marketing. State the weaknesses in the
same voice as the claims:

- Lally et al. is **one study of 96 volunteers**, mostly postgraduate students
  with a mean age of 27. It has not been replicated at scale.
- The asymptotic model was a **good fit for 39 participants**, not all of them.
  The 66-day median describes that subset.
- Participants **self-reported** both the behaviour and how automatic it felt,
  and logged on a median of 47 of 84 days.
- **None of this research studied meditation.** The behaviours were eating,
  drinking, and exercise. Applying it here is an extrapolation.
- The two-minute floor is this app's inference, not a finding (see claim 2).

Close with one line: these are the best available findings, not settled fact,
and the app is built on them provisionally.

#### Tone

Plain declarative sentences. No hedging adverbs, no enthusiasm, no second-person
coaching. The reader is capable of evaluating evidence and is being shown it, not
sold on it. Around 500–700 words plus references — long enough to be real,
short enough to finish.
---

## 8. Imagery — dropped

**The app carries no photographs.** This section previously specified one image
per day, hand-picked under the Unsplash License, processed at build time into
AVIF and WebP. That was built, proved out against test images, and then removed
deliberately. It is recorded here so it is not reintroduced as an oversight.

Three reasons it does not earn its place:

- **Offline cost.** Section 1 makes working fully offline a feature. Sixty to
  ninety photographs is six to nine megabytes to precache — several times the
  rest of the app — spent on decoration. Not precaching them instead makes the
  daily image the one thing that breaks without a network.
- **It competes with section 9.** The identity here is typographic: the passage
  set large in a lot of space, the incised line, the notches. A photograph of
  mist over water is what every other meditation app looks like, and the
  restraint is the distinctiveness.
- **Curation never finishes.** The rotation is only ever as good as its worst
  photograph, and only the owner can judge that, indefinitely.

The pipeline is in the history if it is ever wanted again — `git log --diff-filter=D
-- tools/build-imagery.mts` finds it. Reintroducing it should be a decision with
an answer to the offline cost, not a revival.

---

## 9. Design direction

The brief is calm, minimal, beautiful. Minimal directions live or die on
precision in spacing, type, and detail — so execute this tightly rather than
adding.

### Grounding

The subject's own artifact is the **palm-leaf manuscript**: how these texts
physically survived for two millennia. Narrow horizontal strips of prepared
leaf, text incised with a stylus then rubbed with soot so the letters darken,
bound with cord through two holes. Tan-olive ground, near-black characters, a
strong horizontal grain. That is the visual world to draw from — not generic
wellness-app serenity, and not the warm-cream-and-terracotta register that every
contemplative app defaults to.

### Palette

Dark by default. The Sitting screen is looked at in a dim room, often at dawn or
before sleep; a bright screen there is actively wrong. The reading views may
lift, but the app's resting state is low-luminance.

```
--ink      #121511   near-black, faint green cast — soot
--leaf     #D8CFBA   aged palm leaf, greyer and greener than cream
--soot     #3A3D36   secondary text on light ground
--bronze   #8E7B4A   the single accent — the bell's own material
--dusk     #1E231D   raised surfaces on dark
```

One accent only. Bronze earns its place by coming from the bell; do not add a
second.

### Typography

**Gentium Plus** for all canonical text. This is not an aesthetic pick, it is a
functional one with a pleasant side effect.

**This requirement survives the decision not to display Pali.** The English
translations are dense with Pali proper nouns and terms set with full diacritics
— Sāvatthī, Ānanda, nibbāna, Theragāthā, bhikkhunī — so the app needs
`ā ī ū ṃ ṅ ñ ṭ ḍ ṇ ḷ` on every screen regardless. Most display faces have no
Latin Extended Additional coverage at all and will silently fall back mid-word,
wrecking the setting. Gentium was designed by SIL precisely for diacritic-heavy
typesetting, is open-licensed, and is quietly beautiful at reading sizes.

Verify glyph coverage as a build check: assert the subset font renders every
codepoint present in the corpus, and fail the build if not. Do not swap this
face for something more fashionable without running that check.

For UI chrome — buttons, settings, the history view — use a restrained system
sans stack. Self-host Gentium as a subset WOFF2; do not load webfonts from a CDN
in an app that must work offline.

Set a deliberate scale. The passage should be the largest type in the app, set
generously, with the source reference small and quiet beneath it. Do not centre
long text; centre only the passage if it is short.

### Signature: the incised line

**The Sitting screen shows no numbers.** A countdown invites clock-watching,
which is the opposite of the intended state.

Instead: a single thin line running the width of the screen, filling from left
to right over the session — the incised line of a palm-leaf strip.

**Amended after use.** This was written as a *hairline* filling *imperceptibly*,
and built at two pixels with the unfilled part at 2.3∶1 against the ground. On a
phone propped a metre away that is not restraint, it is illegibility: the eye
can just resolve a two-pixel line, and with the unfilled part invisible there is
nothing to judge the filled part against, so the sit has no readable shape at
all. The line is three pixels now and the unfilled part clears 3∶1. Restraint
here means one thin mark and no numbers — not a mark too faint to read. Interval bells appear as small notches cut into the line at
their positions, so the shape of the sit is legible at a glance without any
digit being readable as time remaining. At the closing bell the line completes
and the screen holds still for several seconds before offering anything.

Elapsed time is available on tap, for anyone who wants it. It is not shown by
default.

Spend the app's boldness here and keep everything else disciplined and quiet.

### Motion

Almost none. Cross-fades measured in whole seconds rather than milliseconds —
the pacing of a breath, not of a UI. Respect `prefers-reduced-motion` by
removing transitions entirely, not by shortening them.

---

## 10. PWA and offline

- Precache the shell, fonts, `passages.json`, and `order.json`.
- Cache sutta full texts on demand, `stale-while-revalidate`.
- The app must be **fully functional offline after first load**, including
  starting a session and recording it. Someone sitting at 6am on airplane mode
  is the expected case, not an edge case.
- Installable: proper manifest, maskable icons, `display: standalone`,
  `theme_color` matching `--ink`.
- Handle service worker updates without disrupting an in-progress session.
  Never reload the page mid-sit.

---

## 11. Text-to-speech (optional, later phase)

Do not build this until everything above is done and used for a week.

**Phase A — Web Speech API.** Zero download, available everywhere. Chunk the
text into sentences before speaking; iOS truncates long utterances. `getVoices()`
resolves asynchronously and returns empty on first call — wait for the
`voiceschanged` event. Always `cancel()` on navigation away.

**Phase B — Kokoro via Transformers.js.** An 82M-parameter TTS model that runs
entirely in the browser, Apache 2.0 licensed, with WebGPU acceleration and a
WebAssembly fallback.

```ts
import { KokoroTTS } from "kokoro-js";
const tts = await KokoroTTS.from_pretrained(
  "onnx-community/Kokoro-82M-v1.0-ONNX",
  { dtype: navigator.gpu ? "fp32" : "q8",
    device: navigator.gpu ? "webgpu" : "wasm" },
);
```

Requirements if this is built:

- **Explicit opt-in with the download size stated.** The fp32 weights are
  several hundred megabytes. Never fetch them without the user agreeing to that
  specific number.
- Run inference in a **Web Worker**. It will block the main thread otherwise.
- Feature-detect `navigator.gpu` and fall back to `q8` on wasm.
- Cache weights in Cache Storage so the download happens once.
- Stream sentence by sentence via `TextSplitterStream` rather than generating
  the whole discourse before playback starts.
- Keep Phase A as the permanent fallback. Phase B is a bonus, never a dependency.

---

## 12. Quality floor

Build to this without announcing it in the UI.

- Responsive to 320px. Primary actions reachable one-handed.
- Visible keyboard focus throughout. Full keyboard operation.
- `prefers-reduced-motion` and `prefers-color-scheme` respected.
- Tap targets ≥ 44px.
- The Sitting screen should be quiet for screen readers — announce the start and
  the end, not the progress.
- No layout shift on load; reserve space for anything that arrives late.
- Lighthouse: 100 on Accessibility and Best Practices, ≥95 on Performance.

---

## 13. Repository layout

```
gatha/
├── README.md
├── LICENSE
├── .github/workflows/deploy.yml
├── tools/
│   ├── build-corpus.mts        # bilara-data → public/corpus
│   └── build-icons.mts         # the app icon, drawn in code
├── public/
│   ├── corpus/
│   ├── icons/
│   └── manifest.webmanifest
├── src/
│   ├── main.ts
│   ├── state.ts                # view state machine
│   ├── storage.ts              # every read and write of local storage
│   ├── pwa.ts                  # registration, and when an update may take over
│   ├── sw/
│   │   ├── routes.ts           # which request gets which strategy
│   │   └── service-worker.ts   # built to dist/sw.js by vite.config.ts
│   ├── timer/
│   │   ├── session.ts          # wall-clock session model
│   │   ├── bell.ts             # additive synthesis
│   │   └── wakelock.ts
│   ├── corpus/
│   │   ├── daily.ts            # day → passage selection
│   │   └── load.ts
│   ├── history/
│   │   ├── store.ts
│   │   └── metrics.ts          # not streak.ts, and §7 explains why
│   ├── views/
│   │   ├── today.ts
│   │   ├── sitting.ts
│   │   ├── after.ts
│   │   ├── discourse.ts
│   │   └── practice.ts
│   ├── tts/                    # phase 6, if it is built at all
│   └── styles/
│       └── fonts/              # subsets, with the OFL beside them
├── SPEC.md
└── vite.config.ts
```

---

## 14. Build order

Ship each phase in a working state before starting the next.

1. **Timer alone.** Session model, bell synthesis, wake lock, Sitting screen
   with the incised line. Hardcode a duration. Test on a real phone, screen
   locked, for a full 20 minutes. Do not proceed until the bells are reliable —
   everything else is decoration on top of this.
2. **Corpus.** Extraction script, daily selection, Today and Discourse screens.
3. **History.** Session log, practice view, export/import.
4. **Design pass.** Full type and palette system, motion, polish.
5. **PWA.** Manifest, service worker, offline, install.
6. **TTS.** Phase A, then optionally Phase B.

---

## 15. Decisions and open questions

### Resolved

- **Pali alongside the translation: no.** Not displayed, not fetched. `root/pli/ms`
  is out of the sparse checkout entirely. Note that this does *not* relax the
  font requirement — see §9.
- **Languages: English only at launch, parameterised from day one.** Ship `en`
  and nothing else. But build the pipeline with `LANG` and `TRANSLATOR` as
  parameters and the language-neutral/per-language split described in §3 step 6,
  so a second language is a data operation rather than a refactor.

  **Prove the abstraction during phase 2.** Run the builder once against a
  second language, confirm it produces a valid directory, then delete the output
  and do not ship it. A parameterisation never exercised against a real second
  case is not a parameterisation — it is a guess about one. This costs ten
  minutes now and catches the assumptions that only surface with a second
  language present.

  Do not build a language-picker UI while only one language ships. Read the
  active language from a constant with a clear TODO.

### Still open

- **Private or public?** If others will use it, the copy, the empty states, the
  first-run explanation, and the Method page (§7.3) all need real attention. If
  it is personal, they do not. This affects phase 4, not phases 1–3 — so it does
  not block starting.
