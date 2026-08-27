# CLAUDE.md — working agreement for Gatha

`SPEC.md` is the source of truth for *what* to build. This file is *how we work*.
Read both before writing code. When they conflict, SPEC.md wins.

---

## The one rule

**Work one phase at a time, in the order given in SPEC.md §14. Finish a phase in
a working, committed, verified state before starting the next.**

Do not scaffold future phases "while you're in there." A half-built history view
sitting in the repo during phase 1 is worse than no history view.

---

## Autonomy

Proceed without asking on: implementation approach, file organisation within the
layout in §13, naming, refactors, test structure, CSS architecture, error
handling, edge cases in the timer, anything SPEC.md already decides.

**Stop and ask only when:**

- SPEC.md is silent *and* the choice is expensive to reverse later (a data
  format, the storage schema, whether something is a build step or a runtime
  step).
- You want to add a dependency. Justify it against "no runtime dependencies" and
  wait.
- You want to do something in the Non-goals list (§1). The answer is almost
  certainly no, but ask rather than assume the spec is out of date.
- A phase's verification cannot be completed without a physical device (see
  below).
- Something in SPEC.md turns out to be wrong. Say so plainly and propose the fix;
  do not silently route around it.

Otherwise: decide, implement, verify, commit, continue. Batch questions rather
than interrupting per-item — if three ambiguities surface in a phase, raise them
together at the phase boundary.

---

## Verification — what you can check, and what you can't

Run these yourself after every meaningful change. A phase is not done until they
all pass.

```
npm run typecheck      # tsc --noEmit, strict
npm run lint
npm run test           # unit tests
npm run build          # must succeed with base: '/gatha/'
npm run preview        # then check it actually loads at the subpath
```

**Design the timer so you can test it without a device.** The session model in
`src/timer/session.ts` must be a pure function of an injected clock — take
`now()` as a parameter or constructor argument, never call `Date.now()` inside
the logic. Then you can unit-test: bell offsets computed correctly, a 40-minute
suspension resyncing without firing a backlog, a mid-session reload resuming,
the clock jumping backwards. Write those tests. They are the bulk of what makes
phase 1 verifiable.

**What you cannot verify, and must not claim to have verified:**

- That bells actually fire with the screen locked on a real iPhone.
- That the wake lock behaves across a real backgrounding cycle.
- That the bell *sounds* like a bell.
- That the design looks right.

For these, stop at the phase boundary, say exactly what needs checking and how
to check it, and wait. Phase 1 in particular ends with a request for a 20-minute
locked-screen test on a physical phone. Do not proceed to phase 2 until that
comes back clean — everything after it is decoration on a timer that has to work.

---

## Conventions

- TypeScript, `strict: true`. No `any` without a comment explaining why.
- No framework. No runtime dependencies (see §2). Build-time tooling is fine.
- No CSS framework. Hand-written CSS with custom properties, tokens from §9.
- Feature-detect every modern API (Wake Lock, WebGPU, MediaSession, AudioContext
  state) and degrade rather than throw.
- Prefer a small pure module plus a thin DOM adapter over a class that does both.
  It is what makes the above testable.
- Commit per logical change with a plain-English subject. No emoji, no
  `feat(scope):` prefixes.
- **Commits are authored by the repository owner, with Claude as co-author.**
  Set `user.name` to `chrmongeau` and `user.email` to the owner's address, and
  end the message with a `Co-Authored-By: Claude <noreply@anthropic.com>`
  trailer. GitHub's contributor list should show the owner, not the assistant.
- **Never put a session URL, a chat link, or a model name in a commit message**,
  a PR, a code comment, or anything else that lands in the repository. They mean
  nothing to a future reader and they do not belong in the history.

## Hard prohibitions

- **Never write, paraphrase, edit, or invent canonical text.** Every word of
  Pali or translated sutta comes from `tools/build-corpus.mts` reading
  `bilara-data`, and nowhere else. If a passage looks wrong, fix the extraction
  script — never the output.
- Never hand-edit anything under `public/corpus/`. It is generated.
- Never add analytics, telemetry, or a network call the user did not initiate.
- Never hardcode a leading `/` in an asset path. Use `import.meta.env.BASE_URL`.
- Never add a notification, a badge, a celebration, or a consecutive-day counter
  as a headline number. §7 explains why at length.
- Do not commit the `.cache/bilara-data` clone.

---

## Progress notes

Keep `NOTES.md` at the repo root. Append at each phase boundary: what was built,
decisions taken that SPEC.md did not cover, anything deferred, and what needs
human verification. Short entries. This is the handoff between sessions — write
it for a version of yourself with no memory of today.

---

## Definition of done, per phase

1. Everything in the phase's scope works end to end.
2. Typecheck, lint, tests, and build all pass.
3. Nothing from a later phase has been half-started.
4. `NOTES.md` updated.
5. Committed.
6. Any device-dependent verification is explicitly requested, not assumed.
