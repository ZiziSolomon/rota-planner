# Shift rota planner

A constraint-based rota planner for a small group sharing childcare, cooking and night
cover over a week. It runs entirely in the browser — no server, no build step, no data
leaving the page.

**[Open the planner →](https://zizisolomon.github.io/rota-planner/)**

## What it does

- **Every rule is a tick box.** Turn any rule off and re-run to see what it was costing
  you. Rules that are structural (a day has blocks; absent people are not scheduled)
  cannot be switched off, and say so.
- **Parameters are drop-downs.** Who gets the free day, which day, which half of which
  other day, who opens the morning, who cooks how often — all editable, none hardcoded.
- **Shifts can be pinned two ways.** *Must include* locks people to a shift; *only these*
  locks a shift to a list of people; *lock as is* freezes whatever is currently there.
  All three are honoured inside the search, not merely checked afterwards.
- **It explains overconstraint.** When no legal rota exists, it re-runs the search with
  each rule and each individual pin removed in turn, then lists every single one whose
  removal makes the week solvable again, each with a one-click "turn off" button.
- **The whole setup lives in the URL.** A rota you like is a link you can keep or send.

## How it works

Scoring an assignment is plain arithmetic; searching for one is the hard part. The
original model used CP-SAT, which cannot run on a static page, so the search here is
purpose-built for a problem of this size (~60 role-slots over six people): a constructive
random assignment that respects the hard rules, then hill climbing with a directed move
that evens out childcare counts, then random restarts keeping the best result. It
typically returns five good options in a few seconds, running in a Web Worker so the page
stays responsive.

This is not a proof of optimality the way a real CP solver gives you — it returns the
best rota it found.

| file | what it holds |
|---|---|
| `model.js` | the rules as data, and the scoring functions |
| `solver.js` | the search |
| `diagnose.js` | the overconstraint analysis |
| `app.js` | the page and its controls |
| `worker.js` | runs the search off the main thread |

## Privacy

People are shown as initials only. There are no names, dates, locations or contact
details anywhere in this repository.

## Licence

MIT.
