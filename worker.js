/* Runs the search off the main thread so the page stays responsive while it works. */
import { buildContext } from "./model.js?v=2";
import { solve } from "./solver.js?v=2";
import { diagnose, slack } from "./diagnose.js?v=2";

self.onmessage = (e) => {
  const { job, cfg, opts } = e.data;
  try {
    if (job === "solve") {
      const ctx = buildContext(cfg);
      const res = solve(ctx, opts || {});
      const payload = {
        feasible: res.feasible,
        options: res.options.map((o) => ({ sched: o.sched, total: o.total, score: o.score })),
        slack: res.options.length ? slack(ctx, res.options[0].sched) : [],
      };
      if (!res.feasible) {
        self.postMessage({ ok: true, phase: "diagnosing", ...payload });
        const d = diagnose(cfg, { restarts: 15, iters: 150,
          onProgress: (done, total, what) =>
            self.postMessage({ ok: true, phase: "progress", done, total, what }) });
        self.postMessage({ ok: true, phase: "done", ...payload, diagnosis: d });
        return;
      }
      self.postMessage({ ok: true, phase: "done", ...payload });
    }
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.stack || err) });
  }
};
