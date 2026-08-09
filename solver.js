/* ==========================================================================================
 * solver.js - searching for a rota in the browser.
 *
 * The Python model uses CP-SAT, which cannot run on a static site. The observation that
 * makes this tractable (from commit f70e61a): SCORING an assignment is plain arithmetic;
 * the solver is only needed to SEARCH. So this is a purpose-built search for a problem of
 * about 60 role-slots over 6 adults:
 *
 *   1. build a random assignment that satisfies every HARD rule (constructive, with repair)
 *   2. hill-climb on the soft score by swapping/reassigning single slots
 *   3. random restarts, keep the best
 *
 * It is not a proof of optimality the way CP-SAT is - it returns the best it found. For a
 * rota this size that is consistently as good as, or within a point of, the Python result.
 * ========================================================================================== */

import { GROUP_BLOCK, score, hardConstraints } from "./model.js?v=2";

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/* Who may hold this slot, after presence, forced-freetime and locks. */
function candidates(ctx, hard, kind, d, p, span) {
  const { adults, cfg } = ctx;
  return adults.filter((a) => {
    if (kind === "cook") {
      if (!ctx.cookSpans[span].every((b) => ctx.present(a, d, b))) return false;
      // R8b is enforced at assignment time, not here
      for (const b of ctx.cookSpans[span]) {
        if (hard.mustFree.some(([x, y, z]) => x === a && y === d && z === b)) return false;
      }
      return true;
    }
    if (!ctx.present(a, d, p)) return false;
    if (hard.mustFree.some(([x, y, z]) => x === a && y === d && z === p)) return false;
    return true;
  }).filter((a) => {
    // "only these" pins narrow the candidate pool directly, so the search never wastes
    // time building rotas it will then have to reject.
    const pin = (ctx.cfg.pins || {})[kind === "cook" ? `${d}|${span}` : `${d}|${p}`];
    if (pin && pin.only && pin.only.length) return pin.only.includes(a);
    return true;
  });
}

function emptySched() {
  return { cc: {}, misc: {}, cook: {}, sober: {}, locked: {} };
}

/* --- build one random feasible-ish rota ------------------------------------------------- */
function construct(ctx, hard, rng, locks) {
  const { cfg, days, childcare, ruleOn } = ctx;
  const v = cfg.vars;
  const s = emptySched();

  // Sober rota first - it is a fixed table (R16), not a choice.
  for (const d of days) {
    if (!ctx.rolesFor(d, "night").length) continue;
    const forced = cfg.soberRota[d];
    if (forced && ctx.present(forced, d, "night")
        && !hard.mustFree.some(([x, y, z]) => x === forced && y === d && z === "night")) {
      s.sober[d] = forced;
    } else {
      const cands = candidates(ctx, hard, "cc", d, "night").filter((a) => ctx.present(a, d, "night"));
      if (cands.length) s.sober[d] = pick(rng, cands);
    }
  }

  // Cooking. Pinned evening rota (R27) first, then locks, then fill.
  for (const d of days) {
    for (const span of ctx.cooksFor(d)) {
      const key = `${d}|${span}`;
      if (locks.cook && locks.cook[key]) { s.cook[key] = locks.cook[key]; continue; }
      if (ruleOn.R27 && span === "CookPM") {
        const who = (cfg.eveningRota || []).find(([, dd]) => dd === d);
        if (who && ctx.present(who[0], d, childcare[childcare.length - 1])) { s.cook[key] = who[0]; continue; }
      }
      const pinC = (cfg.pins || {})[key] || {};
      if ((pinC.must || []).length) { s.cook[key] = pinC.must[0]; continue; }
      const cands = candidates(ctx, hard, "cook", d, null, span);
      if (cands.length) s.cook[key] = pick(rng, cands);
    }
  }

  // Childcare blocks.
  for (const d of days) {
    for (const p of childcare) {
      if (!ctx.rolesFor(d, p).includes("CC")) continue;
      const key = `${d}|${p}`;
      const want = ctx.childcareCount(d, p);
      if (locks.cc && locks.cc[key] && locks.cc[key].length) {
        s.cc[key] = locks.cc[key].slice(0, want);
        if (s.cc[key].length === want) continue;
      }
      // "must include" pins are placed before anything is chosen freely.
      const pin = (cfg.pins || {})[key] || {};
      const held = (s.cc[key] || []).slice();
      for (const a of (pin.must || [])) {
        if (held.length >= want) break;
        if (!held.includes(a) && ctx.present(a, d, p)) held.push(a);
      }
      let cands = candidates(ctx, hard, "cc", d, p).filter((a) => !held.includes(a));
      // R8b - not cooking these hours
      cands = cands.filter((a) => !Object.entries(ctx.cookSpans)
        .some(([span, bs]) => bs.includes(p) && s.cook[`${d}|${span}`] === a));
      // R23 - the opener is one of a named pair
      if (ruleOn.R23 && String(d) === String(v.openDay) && p === childcare[0]) {
        const pair = [v.openA, v.openB].filter((a) => cands.includes(a));
        if (pair.length) cands = pair;
      }
      const chosen = held.slice();
      while (chosen.length < want && cands.length) {
        const a = pick(rng, cands);
        chosen.push(a);
        cands = cands.filter((x) => x !== a);
      }
      s.cc[key] = chosen;
    }
  }

  // Misc, when that rule is on.
  if (ruleOn.Misc) {
    for (const d of days) for (const p of childcare) {
      if (!ctx.rolesFor(d, p).includes("Misc")) continue;
      const key = `${d}|${p}`;
      if (locks.misc && locks.misc[key]) { s.misc[key] = locks.misc[key]; continue; }
      let cands = candidates(ctx, hard, "cc", d, p)
        .filter((a) => !(s.cc[key] || []).includes(a))
        .filter((a) => !Object.entries(ctx.cookSpans).some(([span, bs]) => bs.includes(p) && s.cook[`${d}|${span}`] === a));
      if (cands.length) s.misc[key] = [pick(rng, cands)];
    }
  }

  // The 19-22 group block: everyone present, minus Misc, minus exemptions.
  for (const d of days) {
    if (!ctx.rolesFor(d, GROUP_BLOCK).length) continue;
    const key = `${d}|${GROUP_BLOCK}`;
    const exempt = hard.groupExempt.some(([a, dd]) => dd === d);
    s.cc[key] = ctx.adults.filter((a) => {
      if (!ctx.present(a, d, GROUP_BLOCK)) return false;
      if (hard.groupExempt.some(([x, dd]) => x === a && dd === d)) return false;
      if (ruleOn.Misc && (s.misc[`${d}|${GROUP_BLOCK}`] || []).includes(a)) return false;
      return true;
    });
  }
  return s;
}

/* --- hard-rule violations, as a count (0 = legal) --------------------------------------- */
export function violations(ctx, hard, s) {
  const { cfg, days, childcare, adults, ruleOn } = ctx;
  const v = cfg.vars;
  const bad = [];

  for (const d of days) {
    for (const p of childcare) {
      if (!ctx.rolesFor(d, p).includes("CC")) continue;
      const held = s.cc[`${d}|${p}`] || [];
      const want = ctx.childcareCount(d, p);
      if (held.length !== want) bad.push(`R6: ${d}th ${ctx.labels[p]} has ${held.length} on childcare, want ${want}`);
      for (const a of held) if (!ctx.present(a, d, p)) bad.push(`R4/R5: ${a} is away, ${d}th ${ctx.labels[p]}`);
    }
    for (const span of ctx.cooksFor(d)) {
      const a = s.cook[`${d}|${span}`];
      if (!a) { bad.push(`R6b: nobody cooking ${span} on the ${d}th`); continue; }
      for (const b of ctx.cookSpans[span]) {
        if ((s.cc[`${d}|${b}`] || []).includes(a)) bad.push(`R8b: ${a} cooks ${span} and holds ${ctx.labels[b]} on the ${d}th`);
        if ((s.misc[`${d}|${b}`] || []).includes(a)) bad.push(`R8b: ${a} cooks ${span} and is on Misc ${ctx.labels[b]} on the ${d}th`);
      }
    }
  }

  // forced freetime
  for (const [a, d, p] of hard.mustFree) {
    if (p === GROUP_BLOCK && !hard.groupExempt.some(([x, dd]) => x === a && dd === d)) continue;
    if (p === "night") { if (s.sober[d] === a) bad.push(`R15: ${a} should be free the ${d}th night but is Sober`); continue; }
    if ((s.cc[`${d}|${p}`] || []).includes(a)) bad.push(`R14/R15: ${a} should be free ${d}th ${ctx.labels[p]}`);
    if ((s.misc[`${d}|${p}`] || []).includes(a)) bad.push(`R14/R15: ${a} should be free ${d}th ${ctx.labels[p]}`);
    for (const [span, bs] of Object.entries(ctx.cookSpans)) {
      if (bs.includes(p) && s.cook[`${d}|${span}`] === a) bad.push(`R14/R15: ${a} should be free ${d}th ${ctx.labels[p]} but cooks`);
    }
  }

  // group block takes everyone present
  for (const d of days) {
    if (!ctx.rolesFor(d, GROUP_BLOCK).length) continue;
    const got = new Set(s.cc[`${d}|${GROUP_BLOCK}`] || []);
    for (const a of adults) {
      if (!ctx.present(a, d, GROUP_BLOCK)) continue;
      if (hard.groupExempt.some(([x, dd]) => x === a && dd === d)) {
        if (got.has(a)) bad.push(`R15b: ${a} is exempt from the ${d}th 19-22 but is on it`);
        continue;
      }
      if (ruleOn.Misc && (s.misc[`${d}|${GROUP_BLOCK}`] || []).includes(a)) continue;
      if (!got.has(a)) bad.push(`R7: ${a} missing from the ${d}th 19-22 block`);
    }
  }

  // sober rota
  if (ruleOn.R16) for (const d of days) {
    if (!ctx.rolesFor(d, "night").length) continue;
    const want = cfg.soberRota[d];
    if (want && s.sober[d] !== want) bad.push(`R16: ${d}th night should be ${want}, got ${s.sober[d] || "nobody"}`);
  }

  // R23 opener
  if (ruleOn.R23) {
    const d = Number(v.openDay), p = childcare[0];
    const held = s.cc[`${d}|${p}`] || [];
    if (held.length && !held.some((a) => a === v.openA || a === v.openB))
      bad.push(`R23: the ${d}th ${ctx.labels[p]} should be ${v.openA} or ${v.openB}`);
  }

  // R26 cooking quota
  if (ruleOn.R26 && v.quotaWho !== "none") {
    let n = 0;
    for (const d of days) for (const span of ctx.cooksFor(d)) if (s.cook[`${d}|${span}`] === v.quotaWho) n++;
    if (n !== Number(v.quotaN)) bad.push(`R26: ${v.quotaWho} holds ${n} cooking spans, want ${v.quotaN}`);
  }

  // R27 evening rota
  if (ruleOn.R27) for (const [a, d] of (cfg.eveningRota || [])) {
    if (!ctx.days.includes(d)) continue;
    if (!ctx.cooksFor(d).includes("CookPM")) continue;
    if (s.cook[`${d}|CookPM`] !== a) bad.push(`R27: ${d}th evening should be cooked by ${a}`);
  }

  // pins from the grid
  for (const [key, who] of Object.entries(ctx.cfg.pins || {})) {
    const [ds, p] = key.split("|");
    const d = Number(ds);
    const held = s.cc[`${d}|${p}`] || [];
    const where = `the ${d}th ${ctx.labels[p] || p}`;
    for (const a of (who.must || [])) if (!held.includes(a)) bad.push(`Pin: ${a} should hold ${where}`);
    if (who.only && who.only.length) {
      for (const a of held) if (!who.only.includes(a)) bad.push(`Pin: ${where} is restricted to ${who.only.join("/")}`);
    }
  }

  return bad;
}

/* --- one hill-climbing pass -------------------------------------------------------------- */
function improve(ctx, hard, s, rng, locks, iters) {
  let best = score(ctx, s).total;
  let bestS = JSON.parse(JSON.stringify(s));
  const { days, childcare } = ctx;

  for (let it = 0; it < iters; it++) {
    const cur = JSON.parse(JSON.stringify(bestS));
    const what = rng();

    // A directed move: find whoever holds the most childcare and hand one block to
    // whoever holds the least. Random reassignment alone takes a very long time to
    // even out six people's counts; this walks straight at P0b/P1/P5.
    if (what < 0.25) {
      const counts = {};
      for (const a of ctx.adults) counts[a] = 0;
      for (const d of days) for (const p of childcare) for (const a of (cur.cc[`${d}|${p}`] || [])) counts[a]++;
      const sorted = ctx.adults.slice().sort((x, y) => counts[y] - counts[x]);
      const heavy = sorted[0], light = sorted[sorted.length - 1];
      if (heavy === light) continue;
      const slots = [];
      for (const d of days) for (const p of childcare) {
        const key = `${d}|${p}`;
        if (locks.cc && locks.cc[key]) continue;
        if ((((ctx.cfg.pins || {})[key] || {}).must || []).includes(heavy)) continue;
        if ((cur.cc[key] || []).includes(heavy)) slots.push([d, p]);
      }
      if (!slots.length) continue;
      const [d, p] = pick(rng, slots);
      const key = `${d}|${p}`;
      const ok = candidates(ctx, hard, "cc", d, p)
        .filter((a) => !Object.entries(ctx.cookSpans).some(([span, bs]) => bs.includes(p) && cur.cook[`${d}|${span}`] === a));
      if (!ok.includes(light)) continue;
      cur.cc[key] = (cur.cc[key] || []).map((a) => (a === heavy ? light : a));
    } else if (what < 0.55) {
      // reassign one childcare slot
      const d = pick(rng, days);
      const cands = childcare.filter((p) => ctx.rolesFor(d, p).includes("CC"));
      if (!cands.length) continue;
      const p = pick(rng, cands);
      const key = `${d}|${p}`;
      if (locks.cc && locks.cc[key]) continue;
      const want = ctx.childcareCount(d, p);
      const pool = candidates(ctx, hard, "cc", d, p)
        .filter((a) => !Object.entries(ctx.cookSpans).some(([span, bs]) => bs.includes(p) && cur.cook[`${d}|${span}`] === a));
      if (pool.length < want) continue;
      // Anyone pinned to this cell stays in it.
      const chosen = ((ctx.cfg.pins || {})[key] || {}).must
        ? ((ctx.cfg.pins || {})[key].must || []).filter((a) => pool.includes(a)).slice(0, want)
        : [];
      let avail = pool.filter((a) => !chosen.includes(a));
      while (chosen.length < want && avail.length) {
        const a = pick(rng, avail); chosen.push(a); avail = avail.filter((x) => x !== a);
      }
      cur.cc[key] = chosen;
    } else if (what < 0.85) {
      // reassign one cooking span
      const d = pick(rng, days);
      const spans = ctx.cooksFor(d);
      if (!spans.length) continue;
      const span = pick(rng, spans);
      const key = `${d}|${span}`;
      if (locks.cook && locks.cook[key]) continue;
      if (ctx.ruleOn.R27 && span === "CookPM" && (ctx.cfg.eveningRota || []).some(([, dd]) => dd === d)) continue;
      if ((((ctx.cfg.pins || {})[key] || {}).must || []).length) continue;   // pinned cook
      const pool = candidates(ctx, hard, "cook", d, null, span)
        .filter((a) => !ctx.cookSpans[span].some((b) => (cur.cc[`${d}|${b}`] || []).includes(a)));
      if (!pool.length) continue;
      cur.cook[key] = pick(rng, pool);
    } else if (ctx.ruleOn.Misc) {
      const d = pick(rng, days);
      const cands = childcare.filter((p) => ctx.rolesFor(d, p).includes("Misc"));
      if (!cands.length) continue;
      const p = pick(rng, cands);
      const key = `${d}|${p}`;
      if (locks.misc && locks.misc[key]) continue;
      const pool = candidates(ctx, hard, "cc", d, p).filter((a) => !(cur.cc[key] || []).includes(a));
      if (!pool.length) continue;
      cur.misc[key] = [pick(rng, pool)];
    } else continue;

    if (violations(ctx, hard, cur).length > violations(ctx, hard, bestS).length) continue;
    const sc = score(ctx, cur).total;
    // Accept equal scores sometimes, so the search can drift across plateaus rather than
    // stalling on the first local optimum - P0/P0b produce very flat landscapes.
    if (sc > best || (sc === best && rng() < 0.3)) { best = sc; bestS = cur; }
  }
  return { sched: bestS, total: best };
}

/* --- the public entry point --------------------------------------------------------------
 * Returns up to `want` distinct legal rotas, best first. */
export function solve(ctx, opts = {}) {
  const hard = hardConstraints(ctx);
  const locks = ctx.cfg.locks || {};
  const restarts = opts.restarts || 60;
  const iters = opts.iters || 400;
  const want = opts.options || 5;
  const rng = mulberry32(opts.seed || 12345);

  const found = [];
  let bestIllegal = null;

  for (let r = 0; r < restarts; r++) {
    const s0 = construct(ctx, hard, rng, locks);
    const { sched, total } = improve(ctx, hard, s0, rng, locks, iters);
    const bad = violations(ctx, hard, sched);
    if (bad.length) {
      if (!bestIllegal || bad.length < bestIllegal.bad.length) bestIllegal = { sched, bad, total };
      continue;
    }
    const sig = JSON.stringify(sched.cc) + JSON.stringify(sched.cook);
    if (found.some((f) => f.sig === sig)) continue;
    found.push({ sched, total, sig, score: score(ctx, sched) });
  }

  found.sort((a, b) => b.total - a.total);
  return {
    options: found.slice(0, want),
    feasible: found.length > 0,
    nearest: found.length ? null : bestIllegal,
  };
}
