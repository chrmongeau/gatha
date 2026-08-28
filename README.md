# Gatha

A meditation timer that opens with a short passage from the Pali canon and
closes by offering the whole discourse it came from.

**[chrmongeau.github.io/gatha](https://chrmongeau.github.io/gatha/)**

## What it does

One screen, one job: help someone sit, daily, with a text worth carrying into
the silence. A session has three beats.

**Passage.** A short canonical extract, readable in under a minute, chosen by
the day so it is the same on every device and does not repeat until the corpus
is exhausted.

**Silence.** A timer with a bell at the start, at chosen intervals, and at the
end. The Sitting screen shows no numbers — a countdown invites clock-watching,
which is the opposite of the intended state. Instead a single hairline fills
across the screen, with notches cut into it where the interval bells fall, so
the shape of the sit is legible at a glance without any digit being readable as
time remaining. Elapsed time is there on a tap, for anyone who wants it.

**Expansion.** After the bell, the full discourse the passage came from,
available but never insisted on. The ordering is deliberate: a long text opened
thirty seconds before closing your eyes generates exactly the discursive
thinking the sit is meant to settle.

It works offline after first load, installs to a home screen, and keeps
everything on the device. There is no account, no backend, and no network call
the user did not initiate.

## What it does not do

No streak. The practice view counts days sat in the last thirty, hours
accumulated, and days practised — three numbers that only ever rise and that no
single missed day can break. The app has a page explaining why, with the
research it rests on and the places that research does not reach.

No notifications, no badges, no celebration, no analytics.

## The text

Every word of Pali or translated sutta comes from
[SuttaCentral's bilara-data](https://github.com/suttacentral/bilara-data),
translated by Bhikkhu Sujato and dedicated to the public domain under CC0.
Nothing in this repository writes, paraphrases, edits or repairs canonical
text; the extraction script selects passages and copies them verbatim, and the
app renders them with `textContent` and never as markup. If a passage looks
wrong, the fix belongs in the selection rules, never in the output.

## Running it

```
npm ci
npm run dev
```

Everything that has to pass before a change is finished:

```
npm run typecheck     # tsc --noEmit, strict
npm run lint
npm run test
npm run build         # must succeed with base: '/gatha/'
npm run preview       # then check it loads at the subpath
```

The corpus in `public/corpus/` is generated and committed, so a fresh clone
needs nothing to run. Rebuilding it is a separate, deliberate step — it makes a
shallow sparse clone of bilara-data into `.cache/`, which is not committed:

```
npm run corpus                                    # en, translated by Sujato
npm run corpus -- --lang de --translator sabbamitta
```

`npm run icons` redraws the app icon, which is generated from code rather than
committed as an image somebody would have to trust.

## Reading further

`SPEC.md` is the source of truth for what this is and why — the content
pipeline, the timer's clock model, the design direction, and the reasoning
behind the choices that look odd. `NOTES.md` is the build log: what was made in
each phase, what was decided that the spec did not cover, and what turned out to
be wrong. `CLAUDE.md` is the working agreement for building it.

## Licence

The software here is under the [BSD Zero Clause License](LICENSE) — the same
spirit as the CC0 on the text it serves: use it for anything, with no
conditions at all, not even keeping the notice.

Two things distributed here keep their own terms. The canonical text under
`public/corpus/` is CC0, from bilara-data. The fonts under `src/styles/fonts/`
are Gentium Plus, copyright SIL International, under the
[SIL Open Font License 1.1](src/styles/fonts/OFL.txt) — chosen because the
translations are dense with Pali set in full diacritics, and most faces drop
them mid-word.
