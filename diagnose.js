/* ==========================================================================================
 * diagnose.js - "why is this impossible, and what would I have to give up?"
 *
 * When the search finds nothing legal, knowing THAT it failed is useless; you need to know
 * which rule to relax. So: re-run the search with each hard rule switched off in turn, and
 * report every single rule whose removal makes the week solvable again.
 *
 * This is the automated version of the by-hand experiment that found the Ab-Tuesday
 * clash (she was pinned to Tuesday 16-19 childcare AND asked to cook 13-19, which R8b
 * forbids). Dropping one pin at a time was the only way to see which one was at fault.
 * ========================================================================================== */

import { RULES, buildContext, SHAPES, WEEKDAY, label as nameOf } from "./model.js";
import { solve, violations } from "./solver.js";
import { hardConstraints } from "./model.js";

/* "11|b1619" -> "Tuesday 11th, 16-19" - the diagnostics are read by people, not machines. */
function prettySlot(cfg, key) {
  const [d, p] = key.split("|");
  const labels = (SHAPES[cfg.vars.shape] || SHAPES["3h"]).labels;
  const per = labels[p] || (p === "CookAM" ? "cooking 07-13" : p === "CookPM" ? "cooking 13-19" : p);
  return `${WEEKDAY[Number(d)] || d} ${d}, ${per}`;
}

/* Rules worth trying to switch off. Structural ones (a day has blocks, people are absent
 * when they are absent) are not negotiable, so they are skipped - turning them off would
 * "solve" the problem by making it a different problem. */
const NEGOTIABLE = (r) => r.kind === "hard" && !r.fixed;

export function diagnose(cfg, opts = {}) {
  const budget = { restarts: opts.restarts || 30, iters: opts.iters || 300, options: 1 };

  const baseCtx = buildContext(cfg);
  const base = solve(baseCtx, budget);
  if (base.feasible) return { feasible: true, culprits: [], nearest: null };

  // What the closest attempt actually broke - a good hint even before the sweep.
  const nearest = base.nearest ? base.nearest.bad.slice(0, 12) : [];

  // Which rule ids are implicated in those failures? Used to order the sweep so the
  // likely culprits are tested first.
  const mentioned = new Set();
  for (const b of nearest) {
    const m = b.match(/^([A-Za-z0-9/]+):/);
    if (m) for (const part of m[1].split("/")) mentioned.add(part);
  }

  /* Individual grid pins and locks are candidates too - a single pin is very often the
   * thing that makes a week impossible, and it is not a numbered rule. Each one gets its
   * own trial so the page can say "unpin Ab from Tuesday 16-19" rather than the much
   * less useful "turn off R22". */
  const pinTrials = [];
  for (const [key, who] of Object.entries(cfg.pins || {})) {
    const [d, p] = key.split("|");
    for (const a of (who.must || [])) {
      pinTrials.push({
        id: `pin:${key}:${a}`, pin: true,
        text: `${nameOf(a)} pinned to ${prettySlot(cfg, key)}`,
        apply: (t) => { t.pins[key].must = t.pins[key].must.filter((x) => x !== a); },
      });
    }
    if (who.only && who.only.length) {
      pinTrials.push({
        id: `pin:${key}:only`, pin: true,
        text: `${prettySlot(cfg, key)} restricted to ${who.only.map(nameOf).join(" / ")}`,
        apply: (t) => { delete t.pins[key].only; },
      });
    }
  }
  for (const kind of ["cc", "cook", "misc"]) {
    for (const key of Object.keys((cfg.locks || {})[kind] || {})) {
      pinTrials.push({
        id: `lock:${kind}:${key}`, pin: true,
        text: `the lock you set on ${prettySlot(cfg, key)}`,
        apply: (t) => { delete t.locks[kind][key]; },
      });
    }
  }

  const ruleTrials = RULES.filter((r) => NEGOTIABLE(r) && cfg.ruleOn[r.id])
    .map((r) => ({ id: r.id, text: r.text, note: r.note || null,
                   apply: (t) => {
                     t.ruleOn[r.id] = false;
                     for (const o of RULES) if (o.needs === r.id) t.ruleOn[o.id] = false;
                   } }));

  const trials = [...pinTrials, ...ruleTrials];
  trials.sort((a, b) => (mentioned.has(b.id) ? 1 : 0) - (mentioned.has(a.id) ? 1 : 0));

  const culprits = [];
  let done = 0;
  for (const r of trials) {
    if (opts.onProgress) opts.onProgress(done, trials.length, r.text);
    done++;
    const trial = JSON.parse(JSON.stringify(cfg));
    r.apply(trial);
    const res = solve(buildContext(trial), budget);
    if (res.feasible) {
      culprits.push({ id: r.id, text: r.text, note: r.note || null, pin: !!r.pin,
                      score: res.options[0] ? res.options[0].total : null });
    }
  }

  /* Nothing single-handedly unblocks it: the conflict needs two rules relaxed. Try the
   * most-implicated pairs rather than all of them - the full sweep is quadratic and this
   * runs in a browser. */
  let pairs = [];
  if (!culprits.length) {
    const short = trials.slice(0, 6);
    outer:
    for (let i = 0; i < short.length; i++) {
      for (let j = i + 1; j < short.length; j++) {
        const trial = JSON.parse(JSON.stringify(cfg));
        short[i].apply(trial);
        short[j].apply(trial);
        const res = solve(buildContext(trial), budget);
        if (res.feasible) {
          pairs.push({ ids: [short[i].id, short[j].id], texts: [short[i].text, short[j].text] });
          if (pairs.length >= 3) break outer;
        }
      }
    }
  }

  return { feasible: false, culprits, pairs, nearest };
}

/* --- a cheaper, always-on health check --------------------------------------------------
 * Even when a rota IS found, some days can be pinched to the point where there is no
 * slack at all. Report those, because one more request on such a day makes the week
 * unsolvable - which is exactly how the Python model lost four of its five options. */
export function slack(ctx, sched) {
  const hard = hardConstraints(ctx);
  const out = [];
  for (const d of ctx.days) {
    let spare = 0, roles = 0;
    for (const p of ctx.childcare) {
      if (!ctx.rolesFor(d, p).length) continue;
      roles++;
      const busy = new Set([
        ...(sched.cc[`${d}|${p}`] || []),
        ...(sched.misc[`${d}|${p}`] || []),
      ]);
      for (const [span, bs] of Object.entries(ctx.cookSpans)) {
        if (bs.includes(p) && sched.cook[`${d}|${span}`]) busy.add(sched.cook[`${d}|${span}`]);
      }
      const avail = ctx.adults.filter((a) => ctx.present(a, d, p)
        && !hard.mustFree.some(([x, y, z]) => x === a && y === d && z === p));
      spare += Math.max(0, avail.length - busy.size);
    }
    if (roles) out.push({ day: d, spare, tight: spare <= 1 });
  }
  return out;
}
