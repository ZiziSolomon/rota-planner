/* Runs the search off the main thread so the page stays responsive while it works. */
import { buildContext } from "./model.js?v=6";
import { solve } from "./solver.js?v=6";
import { diagnose, slack } from "./diagnose.js?v=6";

self.onmessage = (e) => {
  const { job, cfg, opts } = e.data;
  try {
    if (job === "solve") {
      const ctx = buildContext(cfg);
      /* Solve in waves rather than one long run, posting the best rota after each. A
       * phone is roughly four times slower than a laptop here, so a single big search
       * means a blank screen for half a minute; this puts a usable rota on screen in a
       * second or two and quietly improves it while you look at it. */
      const waves = (opts && opts.waves) || [
        { restarts: 10, iters: 200 },     // ~0.5s here, ~2s on a phone
        { restarts: 20, iters: 300 },
        { restarts: 32, iters: 420 },     // ~4s here, ~17s on a phone
      ];
      let best = null;
      for (let w = 0; w < waves.length; w++) {
        const res = solve(ctx, { ...opts, ...waves[w], options: 1,
                                 seed: ((opts && opts.seed) || 1) + w * 7919 });
        if (res.feasible && (!best || res.options[0].total > best.options[0].total)) best = res;
        if (best) {
          self.postMessage({ ok: true, phase: w === waves.length - 1 ? "done" : "partial",
            feasible: true, wave: w + 1, waves: waves.length,
            options: best.options.map((o) => ({ sched: o.sched, total: o.total, score: o.score })),
            slack: slack(ctx, best.options[0].sched) });
        }
      }
      if (best) return;

      // Nothing legal in any wave - work out which rule is to blame.
      const empty = { feasible: false, options: [], slack: [] };
      self.postMessage({ ok: true, phase: "diagnosing", ...empty });
      const d = diagnose(cfg, { restarts: 12, iters: 140,
        onProgress: (done, total, what) =>
          self.postMessage({ ok: true, phase: "progress", done, total, what }) });
      self.postMessage({ ok: true, phase: "done", ...empty, diagnosis: d });
    }
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.stack || err) });
  }
};
