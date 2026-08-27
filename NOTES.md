# Progress notes

Appended at each phase boundary. Written for a version of me with no memory of
the day it was written.

---

## Phase 1 — Timer alone

**Built**

- Vite + TypeScript scaffold. `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitReturns`, `verbatimModuleSyntax`.
  `base: '/gatha/'`. Scripts: `dev`, `build`, `preview`, `typecheck`, `lint`,
  `test`. ESLint flat config on `strictTypeChecked` + `stylisticTypeChecked`.
  No runtime dependencies; everything installed is build-time tooling.
- `src/timer/clock.ts` — the `Clock` interface and `systemClock`. **The only
  file in the app that calls `Date.now()` or `performance.now()`.**
- `src/timer/session.ts` — the session model. Pure; takes an injected clock.
- `src/timer/bell.ts` — additive synthesis, five inharmonic partials, per-partial
  exponential decay, 5ms attack, noise-burst transient, per-strike detune.
- `src/timer/audio.ts` — owns the AudioContext, schedules the whole bell plan in
  advance, runs the near-silent keepalive loop, sets MediaSession metadata.
- `src/timer/wakelock.ts` — feature-detected screen wake lock that re-acquires on
  `visibilitychange`.
- `src/timer/active-session.ts` — `{ startedAt, config }` in `localStorage`, with
  a validating parser, so a reload mid-sit can offer to resume.
- `src/views/sitting.ts` + `src/styles/` — the Sitting screen: the incised line,
  notches at the interval bells, elapsed time on tap, nothing else.
- `src/main.ts` — a deliberately minimal start screen (Begin / Resume) and the
  session runner. Duration hardcoded to 10 minutes, interval 5.

**Decisions SPEC.md did not cover**

- *Two clock readings, not one.* §5 says prefer `performance.now()` for elapsed
  and `Date.now()` for the record. Taken literally that breaks on iOS, where
  `performance.now()` can stall while the device sleeps and the session would
  then run long. So `Clock` exposes both. Elapsed comes from the monotonic
  reading, except when the wall clock has advanced more than
  `SUSPENSION_TOLERANCE_MS` (2s) further — which means the monotonic clock
  stalled, and the wall clock is believed instead. A wall clock running *behind*
  has been set backwards and is ignored. Elapsed is additionally floored at its
  previous value, so it never decreases whatever the clocks do.
- *`RESYNC_TOLERANCE_MS` = 2s.* A bell more than two seconds late is reported as
  `skipped` rather than `due`. This is the "resync, don't replay" rule made
  testable. The audio engine skips the same bells on the same tolerance.
- *The model reports bells; it does not ring them.* Bells reach the speakers via
  the audio clock, scheduled once at the start. `read()` returns `due`/`skipped`
  for the UI and for the resync rule. Nothing is scheduled incrementally.
- *`prepareMs` and `leadOutMs` are in the model.* Both are §5 timer-engine
  configuration and both are pure offset arithmetic. Hardcoded to 10s and 12s;
  no configuration UI, which is phase 2's. The lead-out is what §9's "the screen
  holds still for several seconds before offering anything" is made of — the End
  button and the elapsed readout fade out during it.
- *The closing bell outlasts the lead-out.* Three strikes 4.5s apart with an 11s
  decay is about 20s; the lead-out is 12s. The AudioContext is closed on a timer
  after the tail rather than at the transition, so the last strike is not cut
  off. Ending a session early cuts it deliberately.
- *First paint does not fade or take focus.* Views cross-fade in over 2.4s and
  move focus, but the cold load would otherwise open on a blank screen with a
  focus ring drawn on it.
- *Resume is offered only while the session is still running.* A stored record
  whose end has passed is cleared silently. Showing the true end time of a
  session that finished while the app was closed belongs with the After screen.

**Deferred, deliberately**

- No Today screen, no corpus, no history, no PWA, no imagery. Phases 2–5.
- **Gentium Plus is not shipped yet.** §9 requires it for canonical text, and
  there is no canonical text on any screen in phase 1. It arrives with the
  corpus, together with the glyph-coverage build check.
- No manifest, no service worker, no icons. Phase 5.
- No volume control and no silent mode (§6). `strikeBell` takes a `volume`
  already; the setting and the screen-brightening substitute need the settings
  UI, which is phase 3/4.
- MediaSession metadata is a placeholder (`Sitting` / `Gatha`). §5 wants the
  passage's source reference, which does not exist until phase 2.
- No `src/state.ts`. Two views do not need a state machine; it earns its place
  when the fourth view lands.
- No `import.meta.env.BASE_URL` usage anywhere, because no asset is referenced
  yet. The rule stands for phase 2.

**Pulled forward from phase 5, on request**

`.github/workflows/deploy.yml` and `public/.nojekyll`, so the app can be reached
over HTTPS on a phone — the phase 1 device test needs a secure context for the
wake lock, and there is no other way to get one. Deploys on push to `main`, and
by manual dispatch so a feature branch can be published during testing. The
four gates run before the deploy step; a red build does not publish.

Only the deploy path came forward. The rest of phase 5 — manifest, service
worker, offline, install — is still phase 5.

`main` had to be created before any of this worked. The repository was empty
when the first branch was pushed, so GitHub made the feature branch the default
and no `main` existed — while the `github-pages` environment, created when Pages
was enabled, had its deployment branch policy pinned to `main`. The first run
built green and then failed the deploy job in one second with no logs, which is
what an environment branch-policy rejection looks like. Creating `main` fixed
it; the next run deployed. If a deploy ever fails instantly with no step logs
again, look at the environment rule before looking at the workflow.

**Testing scaffolding, added because the tester cannot edit code**

Phase 1 is verified on a phone by someone working from the Android app, with no
local checkout. Two stopgaps follow from that, and **both come out in phase 2**:

- Session-length buttons on the start screen, gated by `scaffoldingEnabled()`
  in `src/main.ts`. The first device test was run from a URL carrying the
  session settings, and the report — three opening gongs then silence, still
  running well past its own end — is what a *lost query string* looks like: the
  app falls back to the default ten minutes and behaves perfectly, which reads
  as a broken timer. Buttons cannot be stripped in transit. Flipping
  `scaffoldingEnabled()` to false restores the one-button screen the spec
  describes.
- `src/timer/test-options.ts` — session settings from the URL query string:
  `?minutes=20&interval=5&prepare=10&leadout=12`, `interval=off`, `diag=1`.
  Bounded and validated; nonsense falls back to the defaults. Absent a query
  string the app is exactly what it was: ten minutes, a bell at five. Delete
  this when the Today screen lands — that screen is where duration belongs.
- `src/timer/diagnostics.ts` — a log of what the session actually did, shown on
  the done screen with `?diag=1` and copyable. It records the bells marked due
  and skipped with their lateness, every visibility change with the
  AudioContext state and whether the wake lock was held, and whether either API
  is supported at all. Without it a failed bell reports as "it did not ring",
  which does not say whether the audio context was suspended, the wake lock was
  dropped, or the model never marked the bell.

**A flaw the first device test made me find**

The audio clock is not the wall clock. SPEC.md section 5 says to schedule every
bell in advance against `ctx.currentTime`, and that is right — but a suspended
AudioContext stops advancing its own clock, so every bell still pending drifts
late by exactly the length of the suspension. On a locked phone that is the
whole session. It is the same failure the session model exists to prevent, one
layer down, and the spec does not mention it.

`AudioEngine.resync(bells, elapsedMs)` now re-anchors the pending bells to the
wall clock whenever the page becomes visible, and reports the drift it found so
the log shows it. Each ringing gets its own gain node, so cancelling one that
has not started is a single disconnect; a bell already sounding is left to
finish. Tested against the fake context: a five-minute suspension that advanced
the audio clock by two seconds reports -298s and re-lays the closing bell where
the wall clock says it belongs.

This does not remove the need to keep the context alive — a bell can only be
re-laid once the page is visible again, and on a locked phone that is too late.
It is a second line of defence, and the log will now say whether the first one
held.

**Device test 1 — passed, on Android**

Chrome 151 on Android 10, one minute, screen on and foregrounded throughout.
Bells at 00:05.0, 00:35.0 and 01:05.0 against a schedule of 5s / 35s / 65s, all
marked live, none late. Finished at 01:09.0 against a total of 69s. Wake lock
held. Nothing about suspension is proven by this run: the log carries no
visibility change, because the page never went to the background.

The run before it was reported as a failure and was not one. The session
settings were being passed in the URL, the query string did not survive the trip
to the phone, and the app ran its default ten minutes correctly — which, cut
short at 2:03, presents as three opening gongs and then silence. Lesson worth
keeping: a test harness that can fail silently will eventually be read as a
failure of the thing under test.

**Device test 2 — failed, and what it found**

Twenty minutes, Chrome 151 on Android 10, screen locked after the opening bell.
The bells at 5:00 and 10:00 did not sound. The log:

    01:55.2  page FROZEN by the browser
    10:28.6  page thawed

Chrome froze the tab ninety seconds after the screen locked and held it frozen
for eight and a half minutes. Nothing scheduled in the audio clock survives
that. **SPEC.md section 5's central claim — that the Web Audio scheduler "keeps
running when the page is backgrounded" — is not true on Android Chrome for a tab
the browser considers silent.** The advance scheduling is still right; it just
is not sufficient on its own.

Three faults, all now fixed:

1. *The keepalive was below the threshold it existed to clear.* Chrome's audio
   power monitor calls a tab silent below about -72 dBFS. The keepalive was
   white noise at 0.0001, which is -80 dBFS — under the line, so the tab counted
   as silent and was frozen. It is now a 30 Hz sine at 0.002, about -54 dBFS:
   eighteen decibels of margin, at a pitch no phone speaker can reproduce.
2. *That same noise was audible.* Reported as sounding "like an old analogue LP
   disk" — which is what continuous low-level white noise is. The bell itself
   has not been touched, so the next listen tells us whether the bell was ever
   the problem.
3. *The recovery never ran.* `visibilitychange` did not fire on the way back
   from the freeze — the log shows `page thawed` with no `visible` line after
   it — and the audio resync was hung on that event alone. It is now reachable
   from the thaw, from a visibility change, and from the background heartbeat,
   and it logs every time it runs rather than only when it finds drift.

Also added a MediaSession `stop` action, so the system treats the sit as active
media and is correspondingly less willing to freeze it. Only `stop`: a sit has
no meaningful pause, and a transport control that does nothing is worse than
none.

Whether this is enough cannot be settled here. The freeze is the browser's
decision and the fix is a hypothesis about what drives it, well-founded but
untested on a device.

**Device test 3 — the freeze is fixed, and the bell was clipping**

Three minutes, screen locked after the opening bell. No `page FROZEN` line;
heartbeats every 30.0s straight through the locked period, so the page stayed
fully alive and was not even throttled; audio clock drift of 0.1s over three
minutes; every bell heard. The keepalive level was the whole problem.

The same run reported the opening and closing bells as scratchy while the
interval bell was fine, and that difference is the diagnosis. The five partials
share one 5ms attack, so their peaks coincide and sum, and nothing normalised
them. Measured against the real summed waveform:

    opening   1.473  clipped
    interval  0.873  clean
    closing   1.479  clipped

The interval bell is quieter (voice gain 0.5 against 0.85), which is exactly why
it was the only one under full scale and the only one that sounded right.
Partial gains are now divided by their total, master gain carries 0.9 for
headroom, and the peaks are 0.62 / 0.37 / 0.62. `bell.test.ts` asserts no bell's
summed peak crosses unity, so this cannot come back silently.

The strike transient was also shortened from 60ms to 30ms, narrowed, and
lowered — a long broad noise burst reads as a scrape rather than a strike. That
one is a judgement, not a measurement.

**A bug introduced by the previous fix**

Making the audio resync reachable from several events meant several callers
asking the session for the time, and `read()` advances the bell cursor. The
resync was consuming bells before the animation frame could act on them — the
test 3 log shows a whole session with no bell lines between the opening and the
finish. `Session.elapsedMs` now reports the time without consuming anything, and
`read()` is called from exactly two places. Worth remembering: a reader that
mutates is a trap the second caller always falls into.

**Device test 4 — the twenty-minute locked test passed**

Chrome 151 on Android 10. Twenty minutes, screen locked after the opening bell,
woken briefly three times. No freeze; heartbeats every 30.0s for the full
duration; resync drift of 0.0s every time, including after sixteen unbroken
minutes hidden. Every bell heard. **The timer requirement of phase 1 is met on
Android.** It is not met on iOS, which has not been tested and suspends audio
far more aggressively.

The four `not marked live` lines at the end are correct: the animation frame was
stopped, so the model noted those bells on return instead of replaying them,
while the audio rang them from the schedule laid down at the start.

Two things the run found:

- *The Sitting screen was illegible.* Woken at 1:48 into the sit it showed a
  32px lit segment at the far left and, for the rest of the width, a 1px line of
  `--leaf` at 15% over `--ink` — invisible on a phone. The screen was doing
  exactly what section 9 specifies and conveying nothing, which reads as a
  stopped app. The track is now its own token at 32%. The hairline, the absence
  of numbers, and the notches are unchanged: this is legibility, not a redesign.
- *The opening and closing bells still do not sound clear.* Since resolved —
  see below.

`createBellPreview()` rings one bell on demand from the start screen, with no
session and no keepalive in the graph. Tuning a bell through twenty-minute sits
is not a workable loop. It also separates two explanations that otherwise look
the same: wrong in preview is the synthesis or the speaker, right in preview and
wrong in a session implicates the keepalive tone underneath it.

**The bell is accepted**

Judged good on a device through the preview buttons: all three bells, no
clipping, no scratchiness. Clipping was the fault; the fundamentals were not.

One loose end, recorded because it is easy to lose. The synthesis the bells were
judged good in preview is byte-for-byte the synthesis that sounded unclear in
the twenty-minute session two commits earlier, and the levels are identical —
preview rings at volume 0.9 into the destination, a session rings at 1.0 through
a master of 0.9. The one difference is that a session has the 30 Hz keepalive
running underneath. That is weak evidence, since the two listens were minutes
apart in different conditions, but it is the only concrete difference, and a
phone speaker asked to move at 30 Hz can muddy everything above it. If a session
ever sounds worse than the preview, duck the keepalive around each ringing: the
bell is far above the silence threshold on its own, so nothing needs to run
under it. Deliberately not built on a hypothesis.

**The incised line, at the sitter's request**

Line weight 1px to 2px, notches 1x9px to 2x14px, both behind tokens. SPEC.md
section 9 says "hairline", and 2px is a departure from that word — made because
the person sitting with it asked for it after using it, which is better evidence
than the word.

**Spec amended, and a standing rule**

SPEC.md section 5 now describes what the device tests established rather than
what was assumed: that a frozen page takes the whole audio schedule with it,
that the keepalive's *level* is the thing that prevents it and the threshold is
about -72 dBFS, that a suspended AudioContext stops advancing its own clock, that
the recovery must not hang on `visibilitychange` alone, and that elapsed time
needs both a monotonic and a wall reading because `performance.now()` can stall
while a device sleeps.

The owner's standing rule, now recorded at the top of SPEC.md: where the spec
turns out to be wrong, amend it to what works, say so, and note the evidence.
Do not route around it and do not wait to be asked.

**Verified here**

`npm run typecheck`, `lint`, `test` (49 tests), `build` all pass, and the built
output serves correctly from the `/gatha/` subpath under `npm run preview`.

The whole session was also driven in headless Chromium with `Date.now` and
`performance.now` overridden to run fast: start → sit → lead-out → done, the
notch at the midpoint of the line, elapsed revealed on tap, reload mid-sit
offering Resume and picking up at the right point, and the stored record cleared
on End. No console errors. That exercise found two real bugs (the End button's
`margin-top: auto` was pulling the line off centre; the entry fade left the cold
load blank for 2.4s), both fixed.

**Not verified — needs a physical device**

Everything that matters most about this phase:

- Whether the bells fire with the screen locked on a real iPhone.
- Whether the wake lock survives a real backgrounding cycle.
- Whether the bell sounds like a bell.
- Whether the design looks right in a dim room.

See the handoff message for the exact 20-minute test. **Phase 2 does not start
until that comes back clean.**


---

## Phase 2 — Corpus

**Built**

- `tools/build-corpus.mts` — bilara-data to `public/corpus`, run by hand. Shallow,
  blobless, sparse clone of the `published` branch. `--lang` and `--translator`
  are parameters throughout, defaulting to `en` and `sujato`.
- `src/corpus/daily.ts` — day number to passage. Pure, takes a `Date` rather than
  reading a clock.
- `src/corpus/load.ts` — fetches the corpus, every URL built from
  `import.meta.env.BASE_URL`.
- `src/state.ts` — the view state machine, which four screens finally justify.
- `src/views/today.ts`, `after.ts`, `discourse.ts`.
- `src/styles/fonts.css` plus two self-hosted Gentium Plus subsets, and
  `tools/check-fonts.mts` as the build check.
- 1035 passages from all eight collections, 673 discourses, 3.4MB. No repeat for
  nearly three years.

**Decisions SPEC.md did not cover**

- *Verse is identified from the html tree, not by heuristic.* `html/pli/ms`
  carries `<blockquote class='gatha'>` and `<span class='verse-line'>` markup,
  and segment ids are shared across languages, so this is exactly the
  "structural fact about the canon, not about English" the split in §3 step 6
  depends on. It is markup, not Pali text: the root text under `root/pli/ms` is
  still not fetched and never displayed.
- *Selection rules.* A sutta that ends in an utterance contributes that closing
  verse block. A sutta that is itself a verse contributes the whole of it if it
  fits in sixty words; if it does not — Mettā and Maṅgala are each one
  blockquote of ten stanzas — it contributes a single stanza, and only one that
  opens without a word that depends on the line before it and closes a sentence.
  Most do not, and are skipped. **No prose passage is ever taken.** SN prose
  almost always opens mid-scene, and §3 says to bias toward skipping.
- *One passage per sutta.* §3 says each verse of dhp/thag/thig is its own
  passage, and for dhp that is automatic since each verse is its own uid. For a
  long Theragāthā only the first qualifying stanza is taken. Corpus breadth is
  not the constraint at 1035.
- *Dedup is corpus-wide, not per collection.* Mettā and Maṅgala appear in both
  Khuddakapāṭha and the Sutta Nipāta; the day should not serve the same text
  under two names. Jaccard similarity at 0.75 within a collection also removes
  the peyyāla runs, which is what §3 asks for — 160 dropped.
- *Citation labels are a table in the builder.* "Udāna", "Theragāthā" and the
  rest are bibliographic metadata rather than canonical text; every title, every
  passage and every line of every discourse still comes from the data verbatim.
- *Fonts are Google's own Gentium Plus subsets, self-hosted.* No subsetting
  tool is needed and none is a dependency. `latin` and `latin-ext` together
  carry all ten diacritics the corpus uses. 91KB, served from the app's origin.

**Proved, per SPEC.md §15**

The builder was run against `de`/`sabbamitta`: 1035 of 1035 passages covered,
same ids, same segments, same passage on the same day, genuinely German text.
That run also caught a real design error — the script had been re-deriving the
selection for every language instead of reading `selection.json`, which would
have made the split nominal rather than real. Fixed, then the German output was
deleted and is not shipped, exactly as §15 instructs.

**Deferred**

- The day's image on Today. Phase 4.
- "Confirm the session was recorded" on After — there is no session log yet, and
  the screen does not claim there is. Phase 3.
- The two-minute floor and its copy. That belongs with §7's reasoning, phase 3.
- No language picker while one language ships. `ACTIVE_LANGUAGE` is a constant
  with a TODO, as §15 requires.

**Fixed while building**

- Two rows of choice buttons carried identical accessible names — "5 min" under
  both Duration and Interval bell — so a screen reader could not tell them
  apart. Each now says what it sets.
- A cold load flashed a placeholder and then cross-faded for 2.4s. The
  placeholder now appears only if loading actually takes longer than 400ms.
- A re-roll rebuilt and cross-faded the whole screen. Only the passage changes,
  so only the passage fades now — which in turn exposed a worse bug, that "Read
  the discourse" was opening the passage that had been on screen when the screen
  was built rather than the one showing.

**Fixed after the first look on a device**

- Six duration presets wrapped to two rows on a phone. The buttons are now bare
  numbers in an equal six-column grid, with the unit moved into the legend, and
  the accessible name still spells out "Sit for 20 minutes". One row at 320px.
- An interval bell could be set longer than the sit. `bellSchedule` places
  interval bells strictly inside the silence, so that combination produced no
  bell at all — a setting that looked set and did nothing. `intervalFits` is now
  the rule, intervals that cannot ring are disabled rather than hidden, and
  `withDuration` drops an interval that stops fitting when a sit is shortened.
  `loadPreferences` applies the same rule to a stored pair.

**Needs human verification**

- Whether the passages read well on a phone, and whether the type sizes are
  right in a dim room.
- Whether any passage looks wrong. If one does, the fix is in the selection
  rules in `tools/build-corpus.mts` — never in the output.


---

## Phase 3 — History

**Built**

- `src/history/store.ts` — the session log, the if-then anchor, and export and
  import as a JSON file. A record is `{ startedAt, durationMs, completed,
  passageId }`.
- `src/history/metrics.ts` — the floor, days in the last thirty, monotonic
  totals, and the calendar.
- `src/views/practice.ts` — the practice view.
- `src/views/method.ts` — why the app counts what it counts (§7.3).
- Today gained the two-minute preset, the floor line while a day is open, the
  anchor, and a quiet way through to Practice. After now says whether the sit was
  recorded.
- The device-testing scaffolding is gone: the bell preview, the URL overrides
  and the diagnostic log. The audio resync, the heartbeat and the thaw handler
  stayed — those are recovery, not diagnostics.

**Decisions SPEC.md did not cover**

- *`metrics.ts`, not `streak.ts`.* §13 names the file `streak.ts`, and §7 spends
  a page explaining why there is no streak. A file called that invites someone
  to add one. The name is the only deviation from the layout.
- *`src/day.ts`.* Two unrelated things need the same "today": which passage the
  day shows, and which day a sit belongs to. If they disagreed a sit at 00:30
  could land on the previous day's square.
- *What is recorded is time actually sat*, from the opening bell, not the length
  that was chosen. A sit ended early is still a sit. `completed` records whether
  it reached the closing bell, and nothing in the interface treats it as better.
- *Sits under the floor are stored but do not count.* They stay in the log and in
  an export because they happened; they light no square and move no number.
- *Import merges, never replaces.* Restoring a backup onto a phone that has been
  sat on since must not delete the sits made in between. Deduplicated on
  `startedAt`, and an anchor already answered is not overwritten.
- *The anchor is asked once*, on a first run, and never again however it is
  answered — including when it is skipped. `gatha.anchorAsked` records that the
  question was put, separately from the answer.

**Held to §7's "what not to build"**

No consecutive-day counter anywhere. No red, and nothing that could read as a
warning: a day not sat is drawn no differently from the ground it sits on, so
gaps read as texture. No badges, no milestones, no celebration at any threshold,
no notifications, no goal-setting UI. A browser check asserts none of "streak",
"lost", "broken", "congrat" appears on the practice screen.

**Needs human verification**

- Whether the practice screen reads as calm rather than as a dashboard.
- Whether returning after a gap genuinely feels ordinary. That is the thing §7 is
  built around and the one thing a test cannot check.
- Whether the Method page reads as showing the work rather than as marketing.


---

## A light theme

Asked for after reading in daylight. Dark stays the default.

SPEC.md §9 anticipated this more precisely than it looks: it defines `--soot` as
"secondary text on light ground", a token the dark theme never uses, and it says
the reading views may lift. The light theme is the palm-leaf manuscript the right
way up — tan-olive ground, near-black characters incised into it — which is the
grounding §9 sets out. No colour was invented for it.

- Three preferences: dark, light, and system. Dark is what a fresh install gets
  whatever the phone is set to, because the app's resting state is low-luminance;
  `system` exists so `prefers-color-scheme` is genuinely respected (§12) for
  anyone who wants it.
- `system` is resolved to an explicit value before the stylesheet sees it, so
  `tokens.css` needs no media query and no duplicated block.
- An inline script in `index.html` sets the theme before first paint. Without it
  a light reader gets a dark flash on every load. It deliberately duplicates
  three lines of `src/theme.ts`; the comment says so.

**A contrast failure that predated the request.** Working out the light ladder
meant computing the dark one, which turned out to fail: `--text-faint` sat at
**2.29:1** against ink — the source reference, the legends, the quiet actions,
all small text needing 4.5:1. Every pair in both themes is now computed rather
than eyeballed, and measured in the browser afterwards: dark 11.88 / 7.1 / 4.59,
light 11.88 / 7.13 / 4.70. Bronze needed handling too — 4.45:1 on ink is fine for
a border but thin for text, and only 2.67:1 on leaf, so `--accent-text` lifts it
on dark and `--accent` deepens it on light.

**Two bugs found by looking rather than by measuring.** The incised line's fill
was painted `--leaf` directly, which on a light ground is the ground. And
restructuring the tokens deleted the block holding `--line-weight`, so the line
had zero height and was invisible in *both* themes — while the contrast probe
happily reported correct colours for an element nobody could see. The line now
has its own themed token, `--line-cut`: soot on leaf, which is what an incised
line rubbed with soot actually is.


---

## Phase 4 — Imagery pipeline and the design pass

Photographs are deferred: every image host is blocked from the build environment
— Unsplash, Wikimedia and Openverse all refuse — so sourcing was never something
this end could do. The machinery is built and proven; the pictures wait for a
desk. Adding them is a data operation, like adding a language.

**Built**

- `tools/build-imagery.mts` — AVIF with a WebP fallback at two widths, a 4×4
  average as the placeholder, aspect ratio in the manifest. Reads
  `assets/imagery/` and `credits.json`, writes `public/imagery/`.
- `src/imagery.ts` — rotates by the same day number as the passage, so the
  pairing is stable for the day and identical on every device.
- The Today screen shows it with its space reserved. Measured cumulative layout
  shift: **0.0000**.
- `assets/imagery/README.md` — what belongs there and what the build enforces.
- `sharp`, a devDependency. Section 8 requires build-time AVIF and the
  environment has no encoder at all: no ImageMagick, ffmpeg, cwebp or avifenc.
  It never enters the runtime bundle.

**Proven, then removed**

Two generated fixtures, run end to end: eight encoded files all decoding at the
right dimensions, the browser choosing AVIF over WebP, aspect ratios preserved,
placeholder and credit rendering, no layout shift. Then deleted, exactly as the
second-language corpus run was in phase 2. The manifest ships empty and Today
simply has no image.

Two flaws the fixtures found, both mine:

- The size guard printed `OVER 150KB` and shipped the file anyway. A warning
  that stops nothing is not a guard. It now steps quality further down and, if a
  file still cannot fit, names it and exits non-zero.
- Removing every image left the previously generated files in `public/imagery/`.
  The output directory is now cleared on every run, not only when there is
  something to put in it.

**The design pass, measured rather than asserted**

Audited every screen at 320px and 390px:

- *Today had no `h1` at all* — the screen people see most, with no heading for a
  screen reader to navigate by. Section 9 spends its boldness on the passage and
  wants no visible title, so the heading is present and unseen. After gained one
  too.
- The discourse's source link was a 15px-tall target. It is hand-sized now. The
  DOI links are inline in citations, where a 44px target would break the line, so
  they gained vertical padding instead.
- The import control's file input carries its own label rather than relying on
  the element that wraps it.
- No overflow at 320px, no skipped heading levels, nothing unlabelled.

Verified, having previously only claimed it: under `prefers-reduced-motion:
reduce` the animation name computes to `none` and every duration to `0s` —
removed entirely, not shortened, which is what section 9 asks for. Thirteen tab
stops on Today, every one showing a focus ring.

Performance was checked rather than assumed and needs nothing: the corpus is
served gzipped at 82KB against 279KB on disk, and first contentful paint is
100ms. Section 10 precaches it in phase 5, making that a one-time cost.

**Needs human verification**

- Whether the imagery looks right, once there are photographs. Everything above
  is proven against two synthetic gradients, which is enough to trust the
  pipeline and says nothing about how a photograph sits under a passage.

---

## Imagery, dropped

Decided after the fact, on the owner's prompting, and worth recording as a
reversal rather than quietly deleting: the daily photograph is gone. The
pipeline worked. It was removed because it did not earn its place, not because
it failed.

The argument, in full, is in SPEC.md §8, which now describes the absence. In
short: precaching sixty to ninety photographs would multiply the offline
footprint several times over for decoration, and section 1 makes offline a
feature; a stock photograph competes with the typographic identity section 9
builds; and curating a rotation is work only the owner can do, forever.

Removed rather than left dormant. A pipeline with no inputs is exactly the
half-built thing CLAUDE.md warns about — it would have rotted, and phase 5 would
have had to keep reasoning about whether to precache it. `git log
--diff-filter=D -- tools/build-imagery.mts` finds it if it is ever wanted.

Gone: `tools/build-imagery.mts`, `src/imagery.ts` and its tests, `assets/imagery/`,
`public/imagery/`, the `today__image` markup and CSS, the `imagery` npm script,
and `sharp` from devDependencies — which leaves the project with no native build
dependency at all. Section 8, and the mentions in §6, §10, §12, §13 and §14, now
describe an app without photographs.

Note that this supersedes the phase 4 entry above: "whether the imagery looks
right, once there are photographs" is no longer outstanding, because there will
not be photographs.

---

## Design, after the imagery came out

Two changes, chosen so the app reads as designed rather than as unstyled once
there is no photograph to carry it.

**One mark, everywhere.** The Sitting screen's signature is a line cut into the
ground with notches at the interval bells. Every rule elsewhere in the app was a
full-width `1px solid var(--hairline)` — chrome, borrowed from nothing. They are
now the same cut: one short stroke, `--line-weight`, in `--line-track`. A
divider belongs to a UI; a cut belongs to a leaf. Repeating one gesture is what
keeps a minimal app from looking like an unfinished one.

**The choices are bare numbers.** Today carried eleven bordered rectangles below
the passage — by a distance the least quiet thing on the screen section 9 asks to
keep quiet. The borders are gone; the chosen option carries the same cut mark
instead, growing outward from the centre over a whole second. Begin is now the
only bordered element on the screen, which is the correct hierarchy for the only
primary action. Measured after: no overflow at 320px, every target still ≥44px,
the mark 4.45:1 against ink and 5.88:1 against leaf — comfortably over the 3:1
that a state indicator needs, given nothing frames these controls now.

**The grain was tried and rejected.** Section 9 names a strong horizontal grain
as part of the palm-leaf material, and it was never built, so it looked like the
obvious third move. It is not affordable. The palette has no headroom: with a
grain lightening the ink ground, `--text-faint` falls from 4.59:1 to 4.18:1 and
`--accent-text` from 4.71:1 to 4.29:1 at the peak of the ramp, both under the
floor this project set. Solving for the largest amplitude that holds 4.5:1 gives
1% on dark and 2% on light — invisible. Reversing its direction per theme, so it
shadows on ink and highlights on leaf, does hold contrast, but needs 50% black to
reach a visible amplitude on a ground already near black, which shifts the mean
ground measurably off `--ink`. Both prices are real and the thing bought is a
texture nobody consciously sees. Section 9's grain stays unbuilt on purpose; if
it is ever wanted, it needs a `--text-faint` with room in it first.

The measuring script is not kept. It is four lines of luminance maths against
`getComputedStyle`, easier to rewrite than to maintain, and a previous version of
it had a bug that the product code never had.
