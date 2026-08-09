/* ==========================================================================================
 * config.js - the default setup, and (de)serialisation to a URL hash.
 *
 * Everything the page can change lives in one plain object, so "share this rota" is just
 * "share this object", and the whole state round-trips through the address bar. No server,
 * no storage, nothing to log in to.
 * ========================================================================================== */

import { RULES, DEFAULT_VARS, DEFAULT_BIDS, DEFAULT_COUPLES, ADULTS_ALL } from "./model.js";

/* The full group: the six-person setup, everybody present.                     R1, R2 */
export function defaultConfig() {
  const ruleOn = {};
  for (const r of RULES) ruleOn[r.id] = !!r.on;

  return {
    adults: ADULTS_ALL.slice(),
    days: [11, 12, 13, 14, 15, 16],
    stubbed: [10],                       // the outward travel day, still undecided   R3, R8
    vars: { ...DEFAULT_VARS },
    ruleOn,
    bids: JSON.parse(JSON.stringify(DEFAULT_BIDS)),
    couples: DEFAULT_COUPLES.map((c) => c.slice()),
    groups: { A: ["P2", "P1", "P5"], B: ["P4", "P6", "P5"] },          // R21
    /* Who is away when.                                                          R4, R5 */
    presence: {
      P6: { leaveDay: 15, leaveHour: 13, absentDays: [16] },
    },
    /* Freetime already committed elsewhere, counting half.                          R20 */
    halfValue: [["P1", 12], ["P1", 13], ["P1", 14], ["P2", 13]],
    /* The Sober rota as a per-night table. Ad is skipped on her free day and on the
     * half-day night, so the alternation is stated explicitly rather than computed. R16 */
    soberRota: { 11: "P2", 12: "P3", 13: "P3", 14: "P2", 15: "P3" },
    /* The fixed evening cooking order.                                              R27 */
    eveningRota: [["P2", 11], ["P4", 12], ["P5", 13], ["P6", 14], ["P1", 15]],
    /* Grid pins: "day|period" -> { must: [...], only: [...] }.
     *   must — these people MUST hold the shift  (lock people to a shift)
     *   only — the shift may ONLY go to these    (lock a shift to a list of people)  R22 */
    pins: {
      "11|b0710": { must: ["P2"] },
      "11|b1013": { must: ["P2"] },
      "11|b1619": { must: ["P1"] },
    },
    /* Hard locks set by clicking the grid - these are never reassigned. */
    locks: { cc: {}, cook: {}, misc: {} },
  };
}

/* --- URL round-trip ---------------------------------------------------------------------
 * Compact enough for a hash, and human-inspectable if you squint. */
export function encode(cfg) {
  try {
    const json = JSON.stringify(cfg);
    return btoa(unescape(encodeURIComponent(json))).replace(/=+$/, "");
  } catch { return ""; }
}

export function decode(str) {
  try {
    const json = decodeURIComponent(escape(atob(str)));
    const got = JSON.parse(json);
    const base = defaultConfig();
    return { ...base, ...got, vars: { ...base.vars, ...(got.vars || {}) },
             ruleOn: { ...base.ruleOn, ...(got.ruleOn || {}) },
             locks: { cc: {}, cook: {}, misc: {}, ...(got.locks || {}) } };
  } catch { return null; }
}
