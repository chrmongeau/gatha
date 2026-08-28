# Gatha

A meditation timer that opens with a short passage from the Pali canon and
closes by offering the whole discourse it came from.

**[chrmongeau.github.io/gatha](https://chrmongeau.github.io/gatha/)**

## What it does

One screen, one job: help someone sit, daily, with a text worth carrying into
the silence. A session has three parts, and their order is deliberate.

**Passage.** A short canonical extract, readable in under a minute. The date
decides which one, so it is the same on every device, and no passage comes round
again until every other one has been shown.

**Silence.** A timer with a bell at the start, at chosen intervals, and at the
end. The sitting screen shows no numbers: a countdown invites clock-watching,
which is the opposite of what a sit is for. Instead a single thin line fills
from left to right as the session runs, with small notches cut into it where the
interval bells fall — so you can see how far along you are at a glance, with no
number to count down. Elapsed time is there on a tap, for anyone who wants it.

**Discourse.** After the closing bell, the full text the passage came from,
offered but never insisted on. It comes last on purpose: a long text opened
thirty seconds before closing your eyes starts exactly the kind of thinking the
sit is meant to settle.

It works offline after first load, installs to a home screen, and keeps
everything on the device. There is no account, nothing kept on a server, and no
network request you did not ask for.

## What it does not do

No streak. The practice view shows days sat in the last thirty, days practised,
and hours sat — three numbers that only ever rise, and that no single missed day
can break. The app has a page explaining why, with the research it rests on and
what that research does not cover.

No notifications, no badges, no celebration, no analytics.

## The text

Every word of translated sutta comes from
[SuttaCentral's bilara-data](https://github.com/suttacentral/bilara-data),
translated by Bhikkhu Sujato and dedicated to the public domain under CC0.
Nothing in this repository writes, paraphrases or edits canonical text: the
extraction script copies passages out word for word, and the app displays them
as plain text, never as markup. If a passage looks wrong, the fix belongs in the
rules that choose it, never in the text itself.

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
npm run build
npm run preview       # then check it loads at /gatha/
```

The corpus in `public/corpus/` is generated and committed, so a fresh clone
needs nothing else to run. Rebuilding it is a separate, deliberate step: it
clones the part of bilara-data it needs into `.cache/`, which is not committed.

```
npm run corpus                                    # en, translated by Sujato
npm run corpus -- --lang de --translator sabbamitta
```

`npm run icons` redraws the app icon, which is drawn by a script rather than
kept as an image file.

## Reading further

`SPEC.md` is the source of truth for what this is and why — the content
pipeline, the timer's clock model, the design direction, and the reasoning
behind the choices that look odd. `NOTES.md` is the build log: what was made in
each phase, what was decided that the spec did not cover, and what turned out to
be wrong. `CLAUDE.md` is the working agreement for building it.

## Licence

The software here is under the [BSD Zero Clause License](LICENSE) — the same
spirit as the CC0 on the text it serves: use it for anything, with no conditions
at all, not even keeping the notice.

Two things distributed here keep their own terms. The canonical text under
`public/corpus/` is CC0, from bilara-data. The fonts under `src/styles/fonts/`
are Gentium Plus, copyright SIL International, under the
[SIL Open Font License 1.1](src/styles/fonts/OFL.txt) — chosen because the
translations are full of Pali words written with their diacritics, and most
typefaces have no glyphs for them and silently drop them mid-word.
