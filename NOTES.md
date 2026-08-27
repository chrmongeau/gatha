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
- *The opening and closing bells still do not sound clear.* Clipping was real
  and is fixed, but only slightly improved the result, so something else is
  going on. The remaining suspect is the fundamentals: 196 Hz and 174 Hz, where
  the interval bell that sounds fine is 294 Hz. A phone speaker cannot reproduce
  much below about 500 Hz and distorts when driven there. Headphones against
  speaker will settle it.

`createBellPreview()` rings one bell on demand from the start screen, with no
session and no keepalive in the graph. Tuning a bell through twenty-minute sits
is not a workable loop. It also separates two explanations that otherwise look
the same: wrong in preview is the synthesis or the speaker, right in preview and
wrong in a session implicates the keepalive tone underneath it.

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
