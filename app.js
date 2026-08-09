/* ==========================================================================================
 * app.js - the page. Renders the rota, the rule controls and the diagnostics, and drives
 * the worker. State lives in one config object (see config.js) and round-trips through the
 * URL hash, so a rota you like is a link you can send.
 * ========================================================================================== */

import { RULES, WEEKDAY, COLOURS, label, GROUP_BLOCK, SHAPES, buildContext, BID_VALUE } from "./model.js";
import { defaultConfig, encode, decode } from "./config.js";

let cfg = decode((location.hash || "").slice(1)) || defaultConfig();
let result = null;          // last solve result
let showing = 0;            // which option is on screen
let worker = null;
let busy = false;

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* --- driving the search ------------------------------------------------------------------ */
function run() {
  if (busy) return;
  busy = true;
  $("#status").className = "status working";
  $("#status").textContent = "Searching…";
  $("#run").disabled = true;

  if (worker) worker.terminate();
  worker = new Worker("./worker.js", { type: "module" });
  worker.onmessage = (e) => {
    const d = e.data;
    if (!d.ok) {
      busy = false; $("#run").disabled = false;
      $("#status").className = "status bad";
      $("#status").textContent = "Solver error — " + d.error.split("\n")[0];
      console.error(d.error);
      return;
    }
    if (d.phase === "diagnosing") {
      $("#status").textContent = "No legal rota — working out which rule is to blame…";
      return;
    }
    if (d.phase === "progress") {
      $("#status").textContent = `Testing which rule to blame… ${d.done}/${d.total}`;
      return;
    }
    busy = false; $("#run").disabled = false;
    result = d; showing = 0;
    render();
  };
  worker.postMessage({ job: "solve", cfg, opts: { restarts: 80, iters: 600, options: 5, seed: Date.now() & 0xffff } });
}

/* --- rendering --------------------------------------------------------------------------- */
function render() {
  saveHash();
  renderRules();
  renderGrid();
  renderDiagnostics();
  renderScores();
}

function saveHash() {
  const h = encode(cfg);
  if (h) history.replaceState(null, "", "#" + h);
}

function optionList() {
  const box = $("#options");
  box.innerHTML = "";
  if (!result || !result.options.length) return;
  result.options.forEach((o, i) => {
    const b = el("button", "opt" + (i === showing ? " on" : ""), `Option ${i + 1}`);
    b.title = `score ${o.total.toFixed(1)}`;
    b.onclick = () => { showing = i; render(); };
    box.appendChild(b);
  });
}

/* ---- the rota grid, with click-to-lock --------------------------------------------------- */
function renderGrid() {
  optionList();
  const host = $("#grid");
  host.innerHTML = "";
  if (!result || !result.options.length) {
    host.appendChild(el("p", "muted", "No rota to show."));
    return;
  }
  const ctx = buildContext(cfg);
  const sched = result.options[showing].sched;
  const shape = SHAPES[cfg.vars.shape];
  const rows = [...shape.childcare, GROUP_BLOCK, "night"];

  const table = el("table", "grid");
  const head = el("tr");
  head.appendChild(el("th", "corner", ""));
  for (const d of ctx.days) {
    const th = el("th");
    th.appendChild(el("div", "dayname", WEEKDAY[d]));
    th.appendChild(el("div", "daynum", String(d)));
    head.appendChild(th);
  }
  table.appendChild(head);

  // cooking spans get their own two rows at the top
  for (const span of ["CookAM", "CookPM"]) {
    const tr = el("tr", "cookrow");
    tr.appendChild(el("th", "rowhead", span === "CookAM" ? "Cook 07-13" : "Cook 13-19"));
    for (const d of ctx.days) {
      const td = el("td");
      if (!ctx.cooksFor(d).includes(span)) { td.className = "off"; tr.appendChild(td); continue; }
      const who = sched.cook[`${d}|${span}`];
      const key = `${d}|${span}`;
      td.appendChild(chip(who, !!(cfg.locks.cook || {})[key]));
      if ((cfg.pins || {})[key]) td.classList.add("pinned");
      td.onclick = (ev) => openCellEditor(ev, "cook", d, span, key, who ? [who] : []);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  for (const p of rows) {
    const tr = el("tr");
    tr.appendChild(el("th", "rowhead", shape.labels[p] || p));
    for (const d of ctx.days) {
      const td = el("td");
      const roles = ctx.rolesFor(d, p);
      if (!roles.length) { td.className = "off"; tr.appendChild(td); continue; }
      const key = `${d}|${p}`;
      if (p === "night") {
        td.appendChild(chip(sched.sober[d], false));
        td.classList.add("night");
      } else {
        const held = sched.cc[key] || [];
        const locked = !!(cfg.locks.cc || {})[key];
        const wrap = el("div", "people");
        for (const a of held) wrap.appendChild(chip(a, locked));
        td.appendChild(wrap);
        if (p !== GROUP_BLOCK) td.onclick = (ev) => openCellEditor(ev, "cc", d, p, key, held);
        if ((cfg.pins || {})[key]) td.classList.add("pinned");
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  host.appendChild(table);

  const help = el("p", "muted",
    "Click any childcare or cooking cell to lock it — a locked cell keeps its people through every re-run. Click again to unlock.");
  host.appendChild(help);

  // slack warnings
  if (result.slack) {
    const tight = result.slack.filter((s) => s.tight);
    if (tight.length) {
      const w = el("div", "warn");
      w.appendChild(el("strong", null, "Tight days: "));
      w.appendChild(document.createTextNode(
        tight.map((s) => `${WEEKDAY[s.day]} (${s.spare} spare)`).join(", ")
        + " — one more request on these and the week may stop solving."));
      host.appendChild(w);
    }
  }
}

function chip(who, locked) {
  if (!who) return el("span", "chip empty", "—");
  const c = COLOURS[who] || { bg: "#ddd", fg: "#000" };
  const n = el("span", "chip" + (locked ? " locked" : ""), label(who));
  n.style.background = c.bg;
  n.style.color = c.fg;
  return n;
}

function toggleLock(kind, key, who) {
  cfg.locks[kind] = cfg.locks[kind] || {};
  if (cfg.locks[kind][key]) delete cfg.locks[kind][key];
  else cfg.locks[kind][key] = who;
  render();
}

/* ---- the cell editor ---------------------------------------------------------------------
 * Both halves of "set and lock particular shifts":
 *   LOCK AS IS   - freeze whoever is in the cell now, so re-running never moves them
 *   MUST INCLUDE - these people hold this shift, whoever else does  (people -> shift)
 *   ONLY THESE   - the shift may go to nobody outside this list     (shift -> people)
 * The last two are constraints the search honours, not fixed answers, so the solver still
 * has room to work around them. */
let openPop = null;

function closePop() {
  if (openPop) { openPop.remove(); openPop = null; }
  document.removeEventListener("click", onDocClick, true);
}
function onDocClick(e) {
  if (openPop && !openPop.contains(e.target)) closePop();
}

function openCellEditor(ev, kind, day, period, key, current) {
  ev.stopPropagation();
  closePop();

  const pop = el("div", "pop");
  const ctx = buildContext(cfg);
  const per = ctx.labels[period] || (period === "CookAM" ? "Cook 07-13" : period === "CookPM" ? "Cook 13-19" : period);
  pop.appendChild(el("div", "pophead", `${WEEKDAY[day]} ${day} · ${per}`));

  const locked = !!(cfg.locks[kind] || {})[key];
  const lockBtn = el("button", "popbtn" + (locked ? " on" : ""), locked ? "Unlock this cell" : "Lock as is");
  lockBtn.onclick = () => { toggleLock(kind, key, current); closePop(); };
  pop.appendChild(lockBtn);

  const pin = (cfg.pins || {})[key] || {};
  const mk = (title, hint, field) => {
    pop.appendChild(el("div", "poplabel", title));
    pop.appendChild(el("div", "pophint", hint));
    const row = el("div", "popppl");
    for (const a of cfg.adults) {
      const on = (pin[field] || []).includes(a);
      const b = el("button", "ppl" + (on ? " on" : ""), label(a));
      const c = COLOURS[a] || {};
      if (on) { b.style.background = c.bg; b.style.color = c.fg; }
      b.onclick = () => {
        cfg.pins[key] = cfg.pins[key] || {};
        const list = cfg.pins[key][field] || [];
        cfg.pins[key][field] = on ? list.filter((x) => x !== a) : [...list, a];
        if (!(cfg.pins[key].must || []).length && !(cfg.pins[key].only || []).length) delete cfg.pins[key];
        closePop(); render();
      };
      row.appendChild(b);
    }
    pop.appendChild(row);
  };
  mk("Must include", "These people hold this shift.", "must");
  mk("Only these", "The shift can go to nobody else.", "only");

  if (cfg.pins[key]) {
    const clr = el("button", "popbtn", "Clear pins on this cell");
    clr.onclick = () => { delete cfg.pins[key]; closePop(); render(); };
    pop.appendChild(clr);
  }

  document.body.appendChild(pop);
  const r = ev.currentTarget.getBoundingClientRect();
  pop.style.left = Math.min(window.innerWidth - pop.offsetWidth - 10, r.left + window.scrollX) + "px";
  pop.style.top = (r.bottom + window.scrollY + 5) + "px";
  openPop = pop;
  setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
}

/* ---- the rules panel: a tick box each, plus drop-downs for the parameters ---------------- */
function renderRules() {
  const host = $("#rules");
  host.innerHTML = "";
  const ctx = buildContext(cfg);

  const groups = [["hard", "Hard rules — these must hold"], ["soft", "Priorities — these are traded off"]];
  for (const [kind, title] of groups) {
    host.appendChild(el("h3", null, title));
    for (const r of RULES.filter((x) => x.kind === kind)) {
      const row = el("div", "rule" + (cfg.ruleOn[r.id] ? "" : " off"));

      const top = el("label", "ruletop");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!cfg.ruleOn[r.id];
      cb.disabled = !!r.fixed;
      cb.onchange = () => { cfg.ruleOn[r.id] = cb.checked; render(); };
      top.appendChild(cb);
      const idTag = el("span", "rid", r.id);
      if (r.era === "big") idTag.classList.add("era-big");
      if (r.era === "small") idTag.classList.add("era-small");
      top.appendChild(idTag);
      top.appendChild(el("span", "rtext", r.text));
      row.appendChild(top);

      if (r.fixed) row.appendChild(el("div", "muted small", "Structural — cannot be switched off."));
      if (r.note) row.appendChild(el("div", "muted small", r.note));

      if (r.vars && cfg.ruleOn[r.id]) {
        const vs = el("div", "vars");
        for (const v of r.vars) {
          const wrap = el("label", "var");
          wrap.appendChild(el("span", null, v.label));
          const sel = el("select");
          for (const [val, txt] of optionsFor(v.options, ctx)) {
            const o = el("option", null, txt);
            o.value = val;
            if (String(cfg.vars[v.key]) === String(val)) o.selected = true;
            sel.appendChild(o);
          }
          sel.onchange = () => { cfg.vars[v.key] = sel.value; render(); };
          wrap.appendChild(sel);
          vs.appendChild(wrap);
        }
        row.appendChild(vs);
      }
      host.appendChild(row);
    }
  }
}

function optionsFor(spec, ctx) {
  if (Array.isArray(spec)) return spec;
  if (spec === "days") return ctx.days.map((d) => [String(d), `${WEEKDAY[d]} ${d}`]);
  if (spec === "daysPlusNone") return [["none", "None"], ...ctx.days.map((d) => [String(d), `${WEEKDAY[d]} ${d}`])];
  if (spec === "adults") return cfg.adults.map((a) => [a, label(a)]);
  if (spec === "adultsPlusNone") return [["none", "Nobody"], ...cfg.adults.map((a) => [a, label(a)])];
  return [];
}

/* ---- diagnostics: what is overconstrained, and what to give up --------------------------- */
function renderDiagnostics() {
  const host = $("#diag");
  host.innerHTML = "";
  if (!result) return;

  if (result.feasible) {
    $("#status").className = "status good";
    $("#status").textContent = `${result.options.length} legal rota${result.options.length === 1 ? "" : "s"} found.`;
    if (result.options.length === 1) {
      const w = el("div", "warn");
      w.appendChild(el("strong", null, "Only one legal rota. "));
      w.appendChild(document.createTextNode(
        "Every degree of freedom is used up — the next request you add will probably make the week impossible."));
      host.appendChild(w);
    }
    return;
  }

  $("#status").className = "status bad";
  $("#status").textContent = "Overconstrained — no legal rota exists.";

  const d = result.diagnosis || {};
  const box = el("div", "diagbox");
  box.appendChild(el("h3", null, "This is overconstrained"));

  if (d.nearest && d.nearest.length) {
    box.appendChild(el("p", "muted", "The closest near-miss broke these:"));
    const ul = el("ul", "misses");
    for (const m of d.nearest.slice(0, 6)) ul.appendChild(el("li", null, m));
    box.appendChild(ul);
  }

  if (d.culprits && d.culprits.length) {
    box.appendChild(el("p", null, "Turning off any ONE of these makes it solvable again:"));
    for (const c of d.culprits) {
      const row = el("div", "culprit");
      const b = el("button", "fixbtn", "Turn off");
      b.onclick = () => { applyRelax(c.id); run(); };
      row.appendChild(b);
      const t = el("div", "ctext");
      t.appendChild(el("strong", null, c.id.startsWith("pin:") || c.id.startsWith("lock:") ? "Pin" : c.id));
      t.appendChild(document.createTextNode(" — " + c.text));
      if (c.note) t.appendChild(el("div", "muted small", c.note));
      row.appendChild(t);
      box.appendChild(row);
    }
  } else if (d.pairs && d.pairs.length) {
    box.appendChild(el("p", null,
      "No single rule unblocks it — the conflict needs two relaxed. Any of these pairs works:"));
    for (const p of d.pairs) {
      const row = el("div", "culprit");
      const b = el("button", "fixbtn", "Turn off both");
      b.onclick = () => { p.ids.forEach(applyRelax); run(); };
      row.appendChild(b);
      row.appendChild(el("div", "ctext", p.ids.join("  +  ") + " — " + p.texts.join(" / ")));
      box.appendChild(row);
    }
  } else {
    box.appendChild(el("p", "muted",
      "No single rule or pin unblocks it, and no pair was found within the search budget. "
      + "Something structural is wrong — try relaxing the forced free days or the pinned Tuesday."));
  }
  host.appendChild(box);
}

function applyRelax(id) {
  if (id.startsWith("pin:")) {
    const rest = id.slice(4);
    const lastColon = rest.lastIndexOf(":");
    const key = rest.slice(0, lastColon), who = rest.slice(lastColon + 1);
    if (!cfg.pins[key]) return;
    if (who === "only") delete cfg.pins[key].only;
    else cfg.pins[key].must = (cfg.pins[key].must || []).filter((x) => x !== who);
    if (!(cfg.pins[key].must || []).length && !(cfg.pins[key].only || []).length) delete cfg.pins[key];
  } else if (id.startsWith("lock:")) {
    const [, kind, ...rest] = id.split(":");
    delete cfg.locks[kind][rest.join(":")];
  } else {
    cfg.ruleOn[id] = false;
    for (const o of RULES) if (o.needs === id) cfg.ruleOn[o.id] = false;
  }
}

/* ---- the numbers ------------------------------------------------------------------------- */
function renderScores() {
  const host = $("#scores");
  host.innerHTML = "";
  if (!result || !result.options.length) return;
  const sc = result.options[showing].score;

  const mk = (title, obj, fmt = (x) => x) => {
    const card = el("div", "card");
    card.appendChild(el("h4", null, title));
    const t = el("table", "mini");
    for (const [k, v] of Object.entries(obj)) {
      const tr = el("tr");
      tr.appendChild(el("td", null, label(k)));
      tr.appendChild(el("td", "num", fmt(v)));
      t.appendChild(tr);
    }
    card.appendChild(t);
    return card;
  };

  if (sc.detail.freetimePct) host.appendChild(mk("Freetime, % of own capacity", sc.detail.freetimePct, (x) => x.toFixed(0) + "%"));
  if (sc.detail.childcare) host.appendChild(mk("Childcare blocks", sc.detail.childcare));
  if (sc.detail.bidFit) host.appendChild(mk("Bid fit, % of own best", sc.detail.bidFit, (x) => x.toFixed(0) + "%"));
  if (sc.detail.workload) host.appendChild(mk("Weighted workload", sc.detail.workload));
}

/* --- wiring -------------------------------------------------------------------------------- */
$("#run").onclick = run;
$("#reset").onclick = () => { cfg = defaultConfig(); result = null; render(); run(); };
$("#clearlocks").onclick = () => { cfg.locks = { cc: {}, cook: {}, misc: {} }; render(); };
$("#copy").onclick = async () => {
  saveHash();
  try { await navigator.clipboard.writeText(location.href); $("#copy").textContent = "Copied!"; }
  catch { $("#copy").textContent = "Copy failed"; }
  setTimeout(() => { $("#copy").textContent = "Copy link"; }, 1500);
};

render();
run();
