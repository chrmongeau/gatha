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
