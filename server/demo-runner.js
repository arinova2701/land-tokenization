// server/demo-runner.js — Sprint 0a stub
// Sprint B2 (Vijay) implements the full demo runner.
// This stub satisfies the mount contract so orders-server.js compiles
// without errors before B2 is merged.

/**
 * Mount demo runner routes onto an Express app.
 * All routes are under /demo/* and require DEMO_MODE=1.
 *
 * @param {import('express').Application} app
 */
function mountDemoRunner(app) {
  app.use("/demo", (req, res) => {
    if (process.env.DEMO_MODE !== "1") {
      return res.status(403).json({ error: "Demo mode is not enabled." });
    }
    // stub: full implementation in Sprint B2
    res.status(501).json({ error: "Demo runner not yet implemented." });
  });
}

module.exports = mountDemoRunner;
