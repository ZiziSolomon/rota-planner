/* ==========================================================================================
 * export.js - turn the chosen rota into a standalone HTML file.
 *
 * Self-contained: inline CSS, no scripts, nothing fetched. Opens anywhere, mails to
 * anyone, and prints properly - the main rota is the thing that has to survive contact
 * with a printer, so it gets explicit print rules: no controls, no page break inside a
 * day, repeated table headers on every sheet, and black-on-white colours that do not
 * eat a cartridge.
 * ========================================================================================== */

import { dayView, typeView, statsHtml, legendHtml } from "./view.js?v=2";
import { WEEKDAY } from "./model.js?v=2";

const PRINT_CSS = `
:root { --ink:#1b1b1f; --muted:#6b6b76; --line:#e3e3e8; --paper:#fff; --bg:#faf9fb; }
* { box-sizing:border-box; }
body { margin:0; padding:28px; background:var(--bg); color:var(--ink);
       font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
h1 { font-size:22px; margin:0 0 4px; }
h2 { font-size:17px; margin:28px 0 10px; }
h3 { font-size:13px; margin:0 0 8px; color:var(--muted); text-transform:uppercase;
     letter-spacing:.05em; }
.sub { color:var(--muted); font-size:13px; margin:0 0 20px; }
.legend { display:flex; flex-wrap:wrap; gap:.5rem; margin-bottom:1.25rem; }
.chip { padding:.3rem .8rem; border-radius:999px; font-weight:650; font-size:.9rem; }
.minichip { display:inline-block; padding:.1rem .45rem; border-radius:999px;
            font-size:.75rem; font-weight:650; margin:0 2px 2px 0; }
.scroll { overflow-x:auto; background:var(--paper); border:1px solid var(--line);
          border-radius:10px; }
table { border-collapse:collapse; width:100%; font-size:.875rem; }
th,td { padding:.45rem .6rem; text-align:left; white-space:nowrap; }
thead th { background:var(--paper); font-size:.8rem; border-bottom:2px solid var(--line); }
thead th.who { text-align:center; }
tbody td, tbody th { border-bottom:1px solid #ececf0; }
tbody th { font-weight:600; color:var(--muted); font-size:.82rem; }
th.day { border-right:1px solid var(--line); vertical-align:top; font-weight:700;
         color:var(--ink); }
.daynum { font-size:1.05rem; }
tr.day-start > * { border-top:2px solid var(--line); }
td.cell { text-align:center; font-weight:640; font-size:.82rem;
          border-left:1px solid #ececf0; height:2.1rem; }
td.free { background:#fcfcfd; color:#b8b8bf; font-weight:500; text-align:center; }
td.freelist { font-size:.75rem; white-space:normal; max-width:230px; }
td.away { background:repeating-linear-gradient(45deg,#f0f0f3,#f0f0f3 5px,#e7e7ec 5px,#e7e7ec 10px);
          color:#9a9aa2; font-weight:500; text-align:center; }
.split { display:flex; height:100%; min-height:1.8rem; border-radius:4px; overflow:hidden; }
.split span { flex:1; display:flex; align-items:center; justify-content:center;
              font-size:.78rem; font-weight:650; padding:.15rem .2rem; }
.cards { display:grid; gap:1.25rem; grid-template-columns:repeat(auto-fit,minmax(290px,1fr));
         margin-top:1rem; }
.card { background:var(--paper); border:1px solid var(--line); border-radius:10px;
        padding:1rem 1.1rem; }
.card td.num { text-align:right; font-variant-numeric:tabular-nums; }
.bar { display:inline-block; height:.55rem; border-radius:3px; background:var(--ink);
       vertical-align:middle; }
.note { color:var(--muted); font-size:.82rem; margin:.75rem 0 0; white-space:normal; }
.foot { color:var(--muted); font-size:12px; margin-top:34px; border-top:1px solid var(--line);
        padding-top:12px; }

/* ---- print -------------------------------------------------------------------------------
 * The rota is the point of printing, so it gets the whole first page and is never split
 * mid-day. Everything decorative gets out of the way. */
@media print {
  @page { margin:12mm; }
  body { background:#fff; padding:0; font-size:11pt; }
  .scroll { overflow:visible; border:none; border-radius:0; }
  thead { display:table-header-group; }          /* repeat headings on every sheet */
  tr, td, th { page-break-inside:avoid; break-inside:avoid; }
  tr.day-start { page-break-before:auto; }
  h2 { page-break-after:avoid; break-after:avoid; }
  .cards { page-break-before:page; break-before:page;
           grid-template-columns:repeat(2,1fr); }
  .card { break-inside:avoid; }
  .foot { page-break-before:avoid; }
  /* Keep the colour coding legible in greyscale: every coloured cell keeps a border. */
  td.cell, .chip, .minichip, .split span { -webkit-print-color-adjust:exact;
                                           print-color-adjust:exact; }
  td.free, td.away { background:#fff !important; }
}
`;

/* The views mark cells as editable for the live page; an exported file has no JS behind
 * those hooks, so they are stripped rather than shipped as dead attributes. */
const inert = (html) => html
  .replace(/ data-(edit|key|day|period)="[^"]*"/g, "")
  .replace(/ class="cell editable"/g, ' class="cell"');

export function exportHtml(ctx, opt, cfg, meta = {}) {
  const when = new Date().toLocaleDateString("en-GB",
    { day: "numeric", month: "long", year: "numeric" });
  const days = ctx.days;
  const span = `${WEEKDAY[days[0]]} ${days[0]} – ${WEEKDAY[days[days.length - 1]]} ${days[days.length - 1]}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shift rota${meta.optionLabel ? " — " + meta.optionLabel : ""}</title>
<style>${PRINT_CSS}</style></head><body>
<h1>Shift rota</h1>
<p class="sub">${span} · ${ctx.adults.length} people${meta.optionLabel ? " · " + meta.optionLabel : ""}
   · exported ${when}</p>
${legendHtml(ctx.adults)}

<h2>The rota</h2>
${inert(dayView(ctx, opt.sched, cfg))}

<h2>By person</h2>
${inert(typeView(ctx, opt.sched, cfg))}

<h2>How it balances</h2>
${statsHtml(ctx, opt, cfg)}

<p class="foot">Generated by the browser rota planner. Every hard rule in force at the time
of export is satisfied by this rota.</p>
</body></html>`;
}
