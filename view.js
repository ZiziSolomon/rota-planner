/* ==========================================================================================
 * view.js - the presentation layer, ported from render.py so the browser page looks like
 * the pages the family already reads.
 *
 * The idioms reproduced here, all of which the plain grid lacked:
 *   - a DAY view (day as a row-group down the left) and a BY-SHIFT-TYPE view
 *   - a six-hour cooking span merged into ONE tall rowspan cell, not repeated per block
 *   - shared blocks split lengthwise into equal colour bands, ordered by hue
 *   - a colour legend
 *   - bar charts for freetime / workload / bids instead of bare numbers
 *   - two-tone diagonal stripes for each couple's bar
 * ========================================================================================== */

import { COLOURS, WEEKDAY, GROUP_BLOCK, SHAPES, label, BID_VALUE } from "./model.js?v=2";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* --- rainbow ordering ---------------------------------------------------------------------
 * Sort people by the hue of their swatch, pushing achromatic swatches (the black one) to
 * the end - a hue of 0 would sort it among the reds. Straight from render.py's _hue_key. */
function hueKey(a) {
  const hex = (COLOURS[a] || { bg: "#888888" }).bg.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.08) return [1, 0];
  let h = 0;
  if (max === min) h = 0;
  else if (max === r) h = ((g - b) / (max - min)) / 6;
  else if (max === g) h = (2 + (b - r) / (max - min)) / 6;
  else h = (4 + (r - g) / (max - min)) / 6;
  return [0, (h + 1) % 1];
}
export function rainbow(adults) {
  return adults.slice().sort((x, y) => {
    const a = hueKey(x), b = hueKey(y);
    return a[0] - b[0] || a[1] - b[1];
  });
}

const swatch = (a) => {
  const c = COLOURS[a] || { bg: "#ddd", fg: "#000" };
  return `background:${c.bg};color:${c.fg}`;
};

/* A cell split lengthwise into one equal band per person. */
function splitCell(adults, order) {
  const ordered = adults.slice().sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const bands = ordered.map((a) => `<span style="${swatch(a)}">${esc(label(a))}</span>`).join("");
  return `<div class="split">${bands}</div>`;
}

/* (adult, length) if a cooking span STARTS at this block - used for the rowspan merge. */
function cookSpanStarting(ctx, sched, day, period) {
  for (const [span, blocks] of Object.entries(ctx.cookSpans)) {
    const who = sched.cook[`${day}|${span}`];
    if (who && blocks.length && blocks[0] === period && ctx.cooksFor(day).includes(span)) {
      return [who, blocks.length];
    }
  }
  return null;
}

export function legendHtml(adults) {
  return `<div class="legend">${rainbow(adults)
    .map((a) => `<span class="chip" style="${swatch(a)}">${esc(label(a))}</span>`)
    .join("")}</div>`;
}

/* --- the DAY view --------------------------------------------------------------------------
 * Day down the left as a row-group, one row per period. Mirrors render.py's option_table. */
export function dayView(ctx, sched, cfg) {
  const order = rainbow(ctx.adults);
  const shape = SHAPES[cfg.vars.shape];
  const periods = [...shape.childcare, GROUP_BLOCK, "night"];
  const rows = [];

  rows.push(`<thead><tr><th>Day</th><th>When</th><th>Cooking</th><th>Childcare</th>` +
            `<th>Night</th><th>Free</th></tr></thead><tbody>`);

  for (const d of ctx.days) {
    const live = periods.filter((p) => ctx.rolesFor(d, p).length);
    if (!live.length) continue;
    let first = true;
    const covered = new Set();

    for (const p of live) {
      const cells = [];
      if (first) {
        cells.push(`<th class="day" rowspan="${live.length}" scope="rowgroup">` +
                   `${WEEKDAY[d]}<br><span class="daynum">${d}</span></th>`);
      }
      cells.push(`<th>${esc(shape.labels[p] || p)}</th>`);

      // cooking, merged into one tall cell where a span starts
      if (p === "night") {
        cells.push(`<td class="free">&mdash;</td>`);
      } else if (covered.has(p)) {
        // consumed by a rowspan above - emit nothing
      } else {
        const cs = cookSpanStarting(ctx, sched, d, p);
        if (cs) {
          const [who, len] = cs;
          const spanName = Object.keys(ctx.cookSpans).find((s) => ctx.cookSpans[s][0] === p);
          for (const b of ctx.cookSpans[spanName] || []) covered.add(b);
          cells.push(`<td class="cell editable" style="${swatch(who)}" rowspan="${len}"` +
                     ` data-edit="cook" data-key="${d}|${spanName}" data-day="${d}" data-period="${p}">` +
                     `${esc(label(who))}</td>`);
        } else {
          cells.push(`<td class="free">&mdash;</td>`);
        }
      }

      // childcare
      if (p === "night") {
        cells.push(`<td class="free">&mdash;</td>`);
      } else {
        const held = sched.cc[`${d}|${p}`] || [];
        const ed = p === GROUP_BLOCK ? ""
          : ` data-edit="cc" data-key="${d}|${p}" data-day="${d}" data-period="${p}"`;
        cells.push(held.length
          ? `<td class="cell${ed ? " editable" : ""}"${ed}>${splitCell(held, order)}</td>`
          : `<td class="free">&mdash;</td>`);
      }

      // night
      if (p === "night") {
        const so = sched.sober[d];
        cells.push(so ? `<td class="cell" style="${swatch(so)}">${esc(label(so))}</td>`
                      : `<td class="free">&mdash;</td>`);
      } else {
        cells.push(`<td class="free"></td>`);
      }

      // free
      const busy = new Set(sched.cc[`${d}|${p}`] || []);
      for (const [span, bs] of Object.entries(ctx.cookSpans)) {
        if (bs.includes(p) && sched.cook[`${d}|${span}`]) busy.add(sched.cook[`${d}|${span}`]);
      }
      if (p === "night" && sched.sober[d]) busy.add(sched.sober[d]);
      const free = order.filter((a) => ctx.present(a, d, p) && !busy.has(a));
      cells.push(free.length
        ? `<td class="freelist">${free.map((a) => `<span class="minichip" style="${swatch(a)}">${esc(label(a))}</span>`).join("")}</td>`
        : `<td class="free">&mdash;</td>`);

      rows.push(`<tr${first ? ' class="day-start"' : ""}>${cells.join("")}</tr>`);
      first = false;
    }
  }
  rows.push("</tbody>");
  return `<div class="scroll"><table>${rows.join("")}</table></div>`;
}

/* --- the BY-SHIFT-TYPE view ---------------------------------------------------------------
 * Columns are people, rows are shifts - the other way of reading the same rota. */
export function typeView(ctx, sched, cfg) {
  const order = rainbow(ctx.adults);
  const shape = SHAPES[cfg.vars.shape];
  const periods = [...shape.childcare, GROUP_BLOCK, "night"];
  const out = [];

  out.push(`<thead><tr><th>Day</th><th>When</th>` +
    order.map((a) => `<th class="who"><span class="chip" style="${swatch(a)}">${esc(label(a))}</span></th>`).join("") +
    `</tr></thead><tbody>`);

  for (const d of ctx.days) {
    const live = periods.filter((p) => ctx.rolesFor(d, p).length);
    if (!live.length) continue;
    let first = true;
    for (const p of live) {
      const cells = [];
      if (first) cells.push(`<th class="day" rowspan="${live.length}" scope="rowgroup">${WEEKDAY[d]}<br><span class="daynum">${d}</span></th>`);
      cells.push(`<th>${esc(shape.labels[p] || p)}</th>`);
      for (const a of order) {
        if (!ctx.present(a, d, p)) { cells.push(`<td class="away">away</td>`); continue; }
        let role = null, kind = null, key = `${d}|${p}`;
        if ((sched.cc[`${d}|${p}`] || []).includes(a)) {
          role = p === GROUP_BLOCK ? "All in" : "Childcare";
          if (p !== GROUP_BLOCK) kind = "cc";
        }
        for (const [span, bs] of Object.entries(ctx.cookSpans)) {
          if (bs.includes(p) && sched.cook[`${d}|${span}`] === a) {
            role = "Cooking"; kind = "cook"; key = `${d}|${span}`;
          }
        }
        if (p === "night" && sched.sober[d] === a) role = "Sober";
        // Childcare and cooking cells stay editable here, exactly as in the grid view -
        // the by-person table is a different way of reading the rota, not a read-only one.
        const editable = kind ? ` data-edit="${kind}" data-key="${key}" data-day="${d}" data-period="${p}"` : "";
        cells.push(role
          ? `<td class="cell${kind ? " editable" : ""}" style="${swatch(a)}"${editable}>${esc(role)}</td>`
          : `<td class="free">free</td>`);
      }
      out.push(`<tr${first ? ' class="day-start"' : ""}>${cells.join("")}</tr>`);
      first = false;
    }
  }
  out.push("</tbody>");
  return `<div class="scroll"><table>${out.join("")}</table></div>`;
}

/* --- bar charts ---------------------------------------------------------------------------- */
function barRow(name, shown, value, vmax, colour) {
  const w = vmax === 0 ? 0 : Math.round((100 * value) / vmax);
  const style = `width:${Math.max(w, 2)}%` + (colour ? `;background:${colour}` : "");
  return `<tr><th scope="row">${esc(name)}</th><td class="num">${esc(shown)}</td>` +
         `<td style="width:48%"><span class="bar" style="${style}"></span></td></tr>`;
}

/* Diagonal two-tone stripe in both partners' colours, for a couple's bar. */
function coupleStripes(a, b, band = "7px") {
  const ca = (COLOURS[a] || {}).bg || "#888", cb = (COLOURS[b] || {}).bg || "#aaa";
  return `repeating-linear-gradient(135deg,${ca} 0 ${band},${cb} ${band} calc(${band} * 2))`;
}

export function statsHtml(ctx, opt, cfg) {
  const d = opt.score.detail;
  const order = rainbow(ctx.adults);
  const cards = [];

  const card = (title, rows, note) =>
    `<div class="card"><h3>${esc(title)}</h3><table>${rows}</table>` +
    (note ? `<p class="note">${note}</p>` : "") + `</div>`;

  if (d.freetimePct) {
    const max = Math.max(...Object.values(d.freetimePct), 1);
    cards.push(card("Freetime, as a share of capacity",
      order.map((a) => barRow(label(a), `${d.freetimePct[a].toFixed(0)}%`, d.freetimePct[a], max,
        (COLOURS[a] || {}).bg)).join(""),
      "What P1 equalises: each person's freetime as a percentage of the freetime they could possibly have, so leaving early does not earn a lighter or heavier share."));
  }
  if (d.workload) {
    const max = Math.max(...Object.values(d.workload), 1);
    cards.push(card("Shifts worked, weighted",
      order.map((a) => barRow(label(a), String(d.workload[a]), d.workload[a], max,
        (COLOURS[a] || {}).bg)).join(""),
      "Weighted by shift length, so a night is not counted the same as a morning of childcare. Cooking counts double."));
  }
  if (d.childcare) {
    const max = Math.max(...Object.values(d.childcare), 1);
    cards.push(card("Childcare blocks",
      order.map((a) => barRow(label(a), String(d.childcare[a]), d.childcare[a], max,
        (COLOURS[a] || {}).bg)).join("")));
  }
  if (d.bidFit) {
    const max = 100;
    cards.push(card("Bid fit, as a share of own best",
      order.map((a) => barRow(label(a), `${d.bidFit[a].toFixed(0)}%`, d.bidFit[a], max,
        (COLOURS[a] || {}).bg)).join(""),
      "How close each person is to the best set of shifts they could have had, given what they hold."));
  }
  if (d.coupleTime) {
    const vals = Object.values(d.coupleTime);
    const max = Math.max(...vals, 1);
    cards.push(card("Couple freetime together",
      Object.entries(d.coupleTime).map(([k, v]) => {
        const [x, y] = k.split("|");
        return barRow(`${label(x)} & ${label(y)}`, String(v), v, max, coupleStripes(x, y));
      }).join(""),
      "Blocks where both are free and no rival partner is (R24). The worst-off couple is what P2 lifts first."));
  }
  return `<div class="cards">${cards.join("")}</div>`;
}
