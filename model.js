/* ==========================================================================================
 * model.js - the rota model as data, plus scoring. No searching happens here.
 *
 * This is the browser's copy of what rules.py holds. It is deliberately DATA, not code:
 * the page renders every rule as a tick box or a drop-down from this file, so turning a
 * rule off is a matter of flipping `on` rather than editing logic.
 *
 * Provenance: recovered from the git history of the Python model. The 12-attendee era
 * (the full group) is commit 1ee6126 and earlier; the small-group rewrite is 470ae82
 * onward. Every rule that was ever LIVE and not totally deleted appears here, with the
 * era it belongs to, so the page can offer all of them.
 * ========================================================================================== */

/* The six adults. These strings are internal KEYS ONLY and are never shown: the page is
 * published to a public URL, so everything a reader sees is the short form in LABELS -
 * the shortest unique prefix of each name (two letters where the first collides). Keep
 * it that way; do not print a raw key. */
export const ADULTS_ALL = ["P1", "P2", "P3", "P4", "P5", "P6"];
export const LABELS = { P1: "Ab", P2: "Ad", P3: "Al", P4: "Am", P5: "C", P6: "Z" };
export const label = (a) => LABELS[a] || a;
/* Children are present but hold no shifts, so only the count matters to the model. */
export const KID_COUNT = 6;

export const COLOURS = {
  P5: { bg: "#F2C230", fg: "#2A2000" },
  P4: { bg: "#C9A0DC", fg: "#241033" },
  P6: { bg: "#6FBF73", fg: "#0C2A0F" },
  P1: { bg: "#E86B93", fg: "#3A0A20" },
  P3: { bg: "#8FCCE8", fg: "#062533" },
  P2:  { bg: "#1A1A1A", fg: "#FFFFFF" },
};

export const WEEKDAY = {
  10: "Monday", 11: "Tuesday", 12: "Wednesday", 13: "Thursday",
  14: "Friday", 15: "Saturday", 16: "Sunday",
};

/* --- block shapes ----------------------------------------------------------------- R6
 * Two shapes were ever used: four 3-hour solo blocks, or two 6-hour half-day spans.
 * Everything downstream works off these tables, so the rest of the model does not care. */
export const SHAPES = {
  "3h": {
    childcare: ["b0710", "b1013", "b1316", "b1619"],
    hours: { b0710: [7, 10], b1013: [10, 13], b1316: [13, 16], b1619: [16, 19], b1922: [19, 22] },
    labels: { b0710: "07-10", b1013: "10-13", b1316: "13-16", b1619: "16-19", b1922: "19-22", night: "Nighttime" },
    cookSpans: { CookAM: ["b0710", "b1013"], CookPM: ["b1316", "b1619"] },
  },
  half: {
    childcare: ["h0713", "h1319"],
    hours: { h0713: [7, 13], h1319: [13, 19], b1922: [19, 22] },
    labels: { h0713: "07-13", h1319: "13-19", b1922: "19-22", night: "Nighttime" },
    cookSpans: { CookAM: ["h0713"], CookPM: ["h1319"] },
  },
};
export const GROUP_BLOCK = "b1922";

/* Roles. Misc existed in the full-group era and was dropped when the group shrank; the
 * page can switch it back on, which is why it is still here. */
export const ROLE_TYPE = { Misc: "Misc", Cook: "Cooking", CC: "Childcare", Sober: "Sober" };

export const BID_VALUE = { "++": 2, "+": 1, N: 0, "-": -1, "--": -2 };
export const COOK_UNITS = 2;          // a cooking span is two blocks long

/* Default bids, merged across both eras. The sixth person and the Misc column only matter when those
 * are switched on. */
export const DEFAULT_BIDS = {
  P1: { Childcare: "N",  Cooking: "+",  Misc: "-" },
  P2:  { Childcare: "-",  Cooking: "++", Misc: "N" },
  P3: { Childcare: "N",  Cooking: "-",  Misc: "+" },
  P4: { Childcare: "++", Cooking: "N",  Misc: "N" },
  P5: { Childcare: "+",  Cooking: "+",  Misc: "-" },
  P6: { Childcare: "++", Cooking: "N",  Misc: "N" },
};

export const DEFAULT_COUPLES = [["P2", "P4"], ["P4", "P6"], ["P5", "P6"], ["P1", "P5"]];

/* ==========================================================================================
 * THE RULES, as data.
 *
 * Each rule carries: an id, the prose, whether it is on by default, and - where the rule
 * has a parameter worth changing - a `vars` list that the page renders as drop-downs.
 * `kind: "hard"` rules constrain the search; `kind: "soft"` are the P-priorities and only
 * affect scoring. `era` records where it came from, so the page can explain itself.
 * ========================================================================================== */
export const RULES = [
  // ---- structural ----------------------------------------------------------------------
  { id: "R4/R5", kind: "hard", on: true, era: "both", fixed: true,
    text: "People who leave early are not scheduled once they have gone home.",
    note: "In the default setup one person leaves after Saturday morning and another arrives Thursday lunchtime. Set this in the Presence panel." },

  { id: "R6", kind: "hard", on: true, era: "both", fixed: true,
    text: "Childcare blocks are solo - exactly one adult each.",
    vars: [{ key: "shape", label: "Block shape", options: [["3h", "Four 3-hour blocks"], ["half", "Two 6-hour half-days"]] }] },

  { id: "R6b", kind: "hard", on: true, era: "both", fixed: true,
    text: "Two cooking spans a day, 07-13 and 13-19, one adult each. The last day has only the morning span." },

  { id: "R6c", kind: "hard", on: true, era: "small",
    text: "Tuesday morning childcare is PAIRED - two adults, not one.",
    vars: [{ key: "pairDay", label: "Day", options: "days" }] },

  { id: "R7", kind: "hard", on: true, era: "both", fixed: true,
    text: "The 19-22 block takes everyone present (minus anyone on Misc, when Misc is on)." },

  { id: "R8", kind: "hard", on: true, era: "both", fixed: true,
    text: "The last day runs only the morning; no afternoon, evening or night." },

  { id: "R8b", kind: "hard", on: true, era: "both", fixed: true,
    text: "Nobody cooks and holds a childcare block inside the same hours." },

  // ---- the Misc role, dropped when the group shrank  -------------------------------------
  { id: "Misc", kind: "hard", on: false, era: "big",
    text: "The Misc role exists - one adult per block, on top of childcare.",
    note: "Dropped when the group got smaller: with four people, one day needed three roles filled by two and was infeasible. Switch on only with a large group." },

  { id: "R17", kind: "hard", on: false, era: "big", needs: "Misc",
    text: "Two adults on Misc on the afternoon of the travel days." },

  { id: "R19", kind: "hard", on: false, era: "big", needs: "Misc",
    text: "One person does childcare on the outward journey and still gets a Misc shift elsewhere.",
    vars: [{ key: "journeyWho", label: "Who", options: "adultsPlusNone" }] },

  { id: "R25", kind: "hard", on: false, era: "big", needs: "Misc",
    text: "One person is on Misc for a whole morning.",
    vars: [
      { key: "miscMorningWho", label: "Who", options: "adultsPlusNone" },
      { key: "miscMorningDay", label: "Day", options: "days" },
    ],
    note: "Replaced by R6c in the small-group setup, where that morning became childcare." },

  // ---- forced freetime ------------------------------------------------------------------
  { id: "R14", kind: "hard", on: true, era: "both",
    text: "One person is free for two whole days, plus half of a third.",
    vars: [
      { key: "twoDayWho", label: "Who", options: "adultsPlusNone" },
      { key: "twoDayA", label: "Free day", options: "days" },
      { key: "twoDayB", label: "and", options: "days" },
      { key: "twoDayHalf", label: "Half day", options: "daysPlusNone" },
      { key: "freeHalfWhich", label: "Which half", options: [["pm", "Afternoon (13-19)"], ["am", "Morning (07-13)"], ["none", "Neither"]] },
    ] },

  { id: "R15", kind: "hard", on: true, era: "both",
    text: "One person gets a whole free day, plus a half day either side of it.",
    vars: [
      { key: "freeWho", label: "Who", options: "adultsPlusNone" },
      { key: "freeDayWhich", label: "Free day", options: "days" },
      { key: "freeHalfDay", label: "Half day", options: "daysPlusNone" },
      { key: "freeHalfSide", label: "Which half", options: [["pm", "From 13:00"], ["am", "Until 13:00"]] },
    ] },

  { id: "R15b", kind: "hard", on: true, era: "both",
    text: "A free day does not excuse the 19-22 group block - except for one named exemption.",
    vars: [
      { key: "exemptWho", label: "Exempt", options: "adultsPlusNone" },
      { key: "exemptDay", label: "On", options: "days" },
    ] },

  { id: "R20", kind: "soft", on: true, era: "both",
    text: "Freetime already committed to something else counts HALF, in both what you receive and your capacity." },

  // ---- the sober rota -------------------------------------------------------------------
  { id: "R16", kind: "hard", on: true, era: "both",
    text: "The Sober adult is a fixed rota rather than something the solver chooses.",
    vars: [{ key: "soberMode", label: "Mode", options: [["table", "Per-night table"], ["alternate", "Two people alternating"]] }],
    note: "Set the per-night table in the Sober rota panel below." },

  // ---- pins -----------------------------------------------------------------------------
  { id: "R22", kind: "hard", on: true, era: "both",
    text: "Tuesday's childcare is pinned to named people.",
    note: "Edit the pins directly in the grid - click a cell and lock it." },

  { id: "R23", kind: "hard", on: true, era: "both",
    text: "Wednesday's first block is opened by one of a named pair.",
    vars: [
      { key: "openDay", label: "Day", options: "days" },
      { key: "openA", label: "Either", options: "adults" },
      { key: "openB", label: "or", options: "adults" },
    ] },

  { id: "R26", kind: "hard", on: true, era: "small",
    text: "One named person cooks exactly once all week.",
    vars: [
      { key: "quotaWho", label: "Who", options: "adultsPlusNone" },
      { key: "quotaN", label: "Spans", options: [["1", "1"], ["2", "2"], ["3", "3"]] },
    ] },

  { id: "R27", kind: "hard", on: true, era: "small",
    text: "The evening cooking rota is fixed, one span each, in a set order.",
    note: "Set the order in the Evening cooking panel below." },

  // ---- the couples / overlap rules -------------------------------------------------------
  { id: "R18", kind: "hard", on: true, era: "both",
    text: "A named couple share at least one daytime block of freetime, outside the free day.",
    vars: [
      { key: "overlapA", label: "Between", options: "adults" },
      { key: "overlapB", label: "and", options: "adults" },
    ] },

  { id: "R24", kind: "soft", on: true, era: "both",
    text: "Couple time only counts when no other partner of either of them is also free." },

  { id: "R21", kind: "soft", on: true, era: "both",
    text: "Childcaring groups, used by the childcare-distribution priorities.",
    note: "Group A and Group B are set in the Groups panel; C sits in both." },

  // ---- the priorities --------------------------------------------------------------------
  { id: "P0", kind: "soft", on: true, era: "both", weight: 100,
    text: "Every solo childcare block should be held by someone in a childcaring group." },

  { id: "P0a", kind: "soft", on: false, era: "big", weight: 60,
    text: "Group mixing - each group should be represented across the day.",
    note: "Turned off for small groups: with only two people per group it spends the wrong person on childcare and starves P0b. Earns its place again with a large group." },

  { id: "P0b", kind: "soft", on: true, era: "both", weight: 80,
    text: "One named person should have the FEWEST childcare blocks of the group members.",
    vars: [{ key: "fewestWho", label: "Who", options: "adultsPlusNone" }] },

  { id: "P0c", kind: "soft", on: false, era: "big", weight: 70,
    text: "People in a childcaring group get MORE childcare than people in neither.",
    note: "Dropped when every adult ended up in a group - there was nobody left to compare." },

  { id: "P1", kind: "soft", on: true, era: "both", weight: 50,
    text: "Roughly even freetime per adult, as a percentage of each adult's own capacity." },

  { id: "P2", kind: "soft", on: true, era: "both", weight: 40,
    text: "Freetime shared with others, prioritising the couples; the worst-off couple first." },

  { id: "P3", kind: "soft", on: false, era: "big", weight: 30,
    text: "Everyone gets at least one shift of each type.",
    note: "Dropped: it fought the bids directly, forcing people to cook spans they had bid against purely to tick a box." },

  { id: "P4", kind: "soft", on: true, era: "both", weight: 45,
    text: "BIDS - everyone rates each task, scored as a percentage of their own best.",
    note: "Set the bids in the Bids panel below." },

  { id: "P5", kind: "soft", on: true, era: "both", weight: 20,
    text: "Keep duties even and spread through the week, weighted by shift length." },
];

/* Default values for every `vars` key above. */
export const DEFAULT_VARS = {
  shape: "3h",
  pairDay: "11",
  twoDayWho: "P1",
  twoDayA: "13",
  twoDayB: "14",
  twoDayHalf: "12",
  freeHalfWhich: "pm",
  freeWho: "P2",
  freeDayWhich: "13",
  journeyWho: "P5",
  miscMorningWho: "P4",
  miscMorningDay: "11",
  freeHalfDay: "12",
  freeHalfSide: "pm",
  exemptWho: "P2",
  exemptDay: "12",
  soberMode: "table",
  openDay: "12",
  openA: "P6",
  openB: "P4",
  quotaWho: "P6",
  quotaN: "1",
  overlapA: "P2",
  overlapB: "P4",
  fewestWho: "P2",
};

/* ==========================================================================================
 * Building a concrete problem from the settings.
 * ========================================================================================== */

export function buildContext(cfg) {
  const shape = SHAPES[cfg.vars.shape] || SHAPES["3h"];
  const days = cfg.days.slice();
  const adults = cfg.adults.slice();
  const childcare = shape.childcare;
  const dayBlocks = [...childcare, GROUP_BLOCK];
  const periods = [...dayBlocks, "night"];
  const lastDay = Math.max(...days);
  const hours = { ...shape.hours };

  const ruleOn = {};
  for (const r of RULES) ruleOn[r.id] = !!cfg.ruleOn[r.id];
  // A rule that needs another rule is only live if its parent is.
  for (const r of RULES) if (r.needs && !ruleOn[r.needs]) ruleOn[r.id] = false;

  const periodWeight = {};
  for (const p of dayBlocks) periodWeight[p] = 2 * (hours[p][1] - hours[p][0]);
  periodWeight.night = 4;

  const lastDayBlocks = childcare.filter((p) => hours[p][1] <= 13);

  function rolesFor(day, period) {
    if (day === lastDay && period !== "night" && !lastDayBlocks.includes(period) && period !== GROUP_BLOCK) return [];
    if (day === lastDay && period === GROUP_BLOCK) return [];
    if (childcare.includes(period)) return ruleOn.Misc ? ["CC", "Misc"] : ["CC"];
    if (period === GROUP_BLOCK) return ["CC"];
    if (period === "night") return day === lastDay ? [] : ["Sober"];
    return [];
  }

  function cooksFor(day) {
    const spans = Object.keys(shape.cookSpans);
    if (day === lastDay) return spans.filter((s) => shape.cookSpans[s].every((b) => lastDayBlocks.includes(b)));
    return spans;
  }

  function present(adult, day, period) {
    const pr = cfg.presence[adult];
    if (!pr) return true;
    if (pr.absentDays && pr.absentDays.includes(day)) return false;
    if (pr.leaveDay != null && day === pr.leaveDay && period !== "night") {
      if (hours[period] && hours[period][0] >= pr.leaveHour) return false;
    }
    if (pr.leaveDay != null && day === pr.leaveDay && period === "night") return false;
    if (pr.arriveDay != null) {
      if (day < pr.arriveDay) return false;
      if (day === pr.arriveDay && period !== "night" && hours[period] && hours[period][0] < pr.arriveHour) return false;
    }
    return true;
  }

  function childcareCount(day, period) {
    if (ruleOn.R6c && String(day) === String(cfg.vars.pairDay)
        && childcare.includes(period) && hours[period][1] <= 13) return 2;
    return 1;
  }

  const blocks = [];
  for (const d of days) for (const p of periods) if (rolesFor(d, p).length) blocks.push([d, p]);

  return { cfg, shape, days, adults, childcare, dayBlocks, periods, lastDay, hours,
           periodWeight, lastDayBlocks, rolesFor, cooksFor, present, childcareCount,
           blocks, ruleOn, cookSpans: shape.cookSpans, labels: shape.labels };
}

/* --- the hard constraints, as a list of forced/forbidden facts --------------------------- */
export function hardConstraints(ctx) {
  const { cfg, ruleOn, childcare, dayBlocks, periods, hours } = ctx;
  const v = cfg.vars;
  const mustFree = [];        // [adult, day, period]
  const groupExempt = [];     // [adult, day]

  const from = (h) => childcare.filter((p) => hours[p][0] >= h);
  const until = (h) => childcare.filter((p) => hours[p][1] <= h);

  if (ruleOn.R14 && v.twoDayWho !== "none") {
    const who = v.twoDayWho;
    for (const d of [Number(v.twoDayA), Number(v.twoDayB)]) {
      if (!Number.isFinite(d)) continue;
      for (const p of dayBlocks) mustFree.push([who, d, p]);
    }
    if (v.twoDayHalf !== "none" && v.freeHalfWhich !== "none") {
      const hd = Number(v.twoDayHalf);
      const half = v.freeHalfWhich === "pm" ? from(13) : until(13);
      for (const p of half) mustFree.push([who, hd, p]);
    }
  }
  if (ruleOn.R15 && v.freeWho !== "none") {
    const who = v.freeWho;
    const fd = Number(v.freeDayWhich);
    for (const p of periods) mustFree.push([who, fd, p]);
    if (v.freeHalfDay !== "none") {
      const hd = Number(v.freeHalfDay);
      const blocksHalf = v.freeHalfSide === "pm" ? from(13) : until(13);
      for (const p of blocksHalf) mustFree.push([who, hd, p]);
      if (v.freeHalfSide === "pm") mustFree.push([who, hd, "night"]);
    }
  }
  if (ruleOn.R15b && v.exemptWho !== "none") groupExempt.push([v.exemptWho, Number(v.exemptDay)]);

  return { mustFree, groupExempt };
}

/* ==========================================================================================
 * SCORING. Pure arithmetic over a completed assignment - this is the part the WIP note in
 * commit f70e61a was right about. Returns a breakdown per soft rule plus a total.
 * ========================================================================================== */

export function score(ctx, sched) {
  const { cfg, adults, days, childcare, dayBlocks, periodWeight, blocks, ruleOn } = ctx;
  const v = cfg.vars;
  const out = { parts: {}, total: 0, detail: {} };

  const holders = (d, p) => sched.cc[`${d}|${p}`] || [];
  const isBusy = (a, d, p) => {
    if (holders(d, p).includes(a)) return true;
    if ((sched.misc[`${d}|${p}`] || []).includes(a)) return true;
    for (const [span, bs] of Object.entries(ctx.cookSpans)) {
      if (bs.includes(p) && sched.cook[`${d}|${span}`] === a) return true;
    }
    if (p === "night" && sched.sober[d] === a) return true;
    return false;
  };

  const ftWeight = (a, d, p) => {
    const w = periodWeight[p];
    if (!ruleOn.R20) return w;
    const half = (cfg.halfValue || []).some(([x, y]) => x === a && y === d);
    return half ? Math.floor(w / 2) : w;
  };

  // --- freetime, per adult -----------------------------------------------------------
  const free = {}, capacity = {};
  for (const a of adults) { free[a] = 0; capacity[a] = 0; }
  for (const [d, p] of blocks) {
    for (const a of adults) {
      if (!ctx.present(a, d, p)) continue;
      capacity[a] += ftWeight(a, d, p);
      if (!isBusy(a, d, p)) free[a] += ftWeight(a, d, p);
    }
  }
  const pct = {};
  for (const a of adults) pct[a] = capacity[a] ? (100 * free[a]) / capacity[a] : 0;
  out.detail.freetimePct = pct;

  // P1: even freetime as a percentage of own capacity
  if (ruleOn.P1) {
    const vals = adults.map((a) => pct[a]);
    const spread = Math.max(...vals) - Math.min(...vals);
    const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
    const dev = vals.reduce((s, x) => s + Math.abs(x - mean), 0);
    out.parts.P1 = -(spread * 2 + dev * 0.3);
  }

  // --- childcare counts ---------------------------------------------------------------
  const ccCount = {};
  for (const a of adults) ccCount[a] = 0;
  for (const d of days) for (const p of childcare) for (const a of holders(d, p)) ccCount[a] = (ccCount[a] || 0) + 1;
  out.detail.childcare = ccCount;

  const groupA = new Set(cfg.groups.A), groupB = new Set(cfg.groups.B);
  const grouped = new Set([...groupA, ...groupB]);

  if (ruleOn.P0) {
    let bad = 0;
    for (const d of days) for (const p of childcare) for (const a of holders(d, p)) if (!grouped.has(a)) bad++;
    out.parts.P0 = -bad * 10;
  }
  if (ruleOn.P0b && v.fewestWho !== "none") {
    const me = ccCount[v.fewestWho] || 0;
    let bad = 0;
    for (const a of grouped) if (a !== v.fewestWho && (ccCount[a] || 0) <= me) bad++;
    out.parts.P0b = -bad * 8;
  }
  if (ruleOn.P0c) {
    const ung = adults.filter((a) => !grouped.has(a));
    let bad = 0;
    for (const u of ung) for (const g of grouped) if ((ccCount[u] || 0) >= (ccCount[g] || 0)) bad++;
    out.parts.P0c = -bad * 6;
  }
  if (ruleOn.P0a) {
    // no run of three consecutive solo blocks missing a group
    let bad = 0;
    for (const d of days) {
      for (let i = 0; i + 2 < childcare.length; i++) {
        const win = [childcare[i], childcare[i + 1], childcare[i + 2]].flatMap((p) => holders(d, p));
        if (!win.some((a) => groupA.has(a))) bad++;
        if (!win.some((a) => groupB.has(a))) bad++;
      }
    }
    out.parts.P0a = -bad * 5;
  }

  // --- P2: shared freetime, couples first ---------------------------------------------
  if (ruleOn.P2) {
    const partners = {};
    for (const a of adults) partners[a] = new Set();
    for (const [x, y] of cfg.couples) { if (partners[x]) partners[x].add(y); if (partners[y]) partners[y].add(x); }
    const coupleTime = {};
    for (const [x, y] of cfg.couples) coupleTime[`${x}|${y}`] = 0;
    const pairSeen = new Set();
    for (const [d, p] of blocks) {
      if (p === "night") continue;
      const freeHere = adults.filter((a) => ctx.present(a, d, p) && !isBusy(a, d, p));
      for (let i = 0; i < freeHere.length; i++) for (let j = i + 1; j < freeHere.length; j++) {
        pairSeen.add([freeHere[i], freeHere[j]].sort().join("|"));
      }
      for (const [x, y] of cfg.couples) {
        if (!freeHere.includes(x) || !freeHere.includes(y)) continue;
        if (ruleOn.R24) {
          const rivals = new Set([...(partners[x] || []), ...(partners[y] || [])]);
          rivals.delete(x); rivals.delete(y);
          if (freeHere.some((a) => rivals.has(a))) continue;   // spoiled
        }
        coupleTime[`${x}|${y}`] += Math.min(ftWeight(x, d, p), ftWeight(y, d, p));
      }
    }
    const times = Object.values(coupleTime);
    out.parts.P2 = (times.length ? Math.min(...times) * 3 : 0) + pairSeen.size * 0.5;
    out.detail.coupleTime = coupleTime;
  }

  // --- R18 overlap guarantee (hard, but scored so a near-miss is visible) --------------
  if (ruleOn.R18 && v.overlapA !== v.overlapB) {
    const fd = Number(v.freeDayWhich);
    let got = 0;
    for (const [d, p] of blocks) {
      if (d === fd || !dayBlocks.includes(p)) continue;
      if (ctx.present(v.overlapA, d, p) && ctx.present(v.overlapB, d, p)
          && !isBusy(v.overlapA, d, p) && !isBusy(v.overlapB, d, p)) got++;
    }
    out.parts.R18 = got > 0 ? 0 : -200;
    out.detail.overlapBlocks = got;
  }

  // --- P4: bids ------------------------------------------------------------------------
  if (ruleOn.P4) {
    const fit = {};
    for (const a of adults) {
      let held = [], sc = 0;
      for (const d of days) for (const p of childcare) if (holders(d, p).includes(a)) held.push("Childcare");
      for (const d of days) for (const p of childcare) if ((sched.misc[`${d}|${p}`] || []).includes(a)) held.push("Misc");
      for (const d of days) for (const s of ctx.cooksFor(d)) if (sched.cook[`${d}|${s}`] === a) held.push("Cooking", "Cooking");
      if (!held.length) { fit[a] = 100; continue; }
      const bids = cfg.bids[a] || {};
      for (const t of held) sc += BID_VALUE[bids[t] || "N"];
      const best = held.length * 2, worst = held.length * -2;
      fit[a] = best === worst ? 100 : (100 * (sc - worst)) / (best - worst);
    }
    const vals = Object.values(fit);
    out.parts.P4 = (vals.length ? Math.min(...vals) : 0) * 0.8
                 + (vals.reduce((s, x) => s + x, 0) / (vals.length || 1)) * 0.2;
    out.detail.bidFit = fit;
  }

  // --- P5: even workload ----------------------------------------------------------------
  if (ruleOn.P5) {
    const load = {};
    for (const a of adults) load[a] = 0;
    for (const d of days) {
      for (const p of [...childcare, GROUP_BLOCK]) for (const a of holders(d, p)) load[a] += periodWeight[p] || 0;
      for (const p of childcare) for (const a of (sched.misc[`${d}|${p}`] || [])) load[a] += periodWeight[p] || 0;
      for (const s of ctx.cooksFor(d)) { const a = sched.cook[`${d}|${s}`]; if (a) load[a] += 12; }
      const so = sched.sober[d]; if (so) load[so] += 4;
    }
    const vals = Object.values(load);
    out.parts.P5 = -(Math.max(...vals) - Math.min(...vals)) * 0.8;
    out.detail.workload = load;
  }

  for (const k of Object.keys(out.parts)) {
    const r = RULES.find((x) => x.id === k);
    const w = r && r.weight ? r.weight / 50 : 1;
    out.total += out.parts[k] * w;
  }
  return out;
}
