/**
 * World Cup live dashboard API.
 *
 *   GET /api/worldcup            — the whole dashboard payload (schedule +
 *                                  live/derived statuses + standings)
 *   GET /api/worldcup?demo=1     — synthesise live scores so the realtime
 *                                  behaviour is visible before kick-off
 *
 * Auth-gated like the rest of the app. The client polls this every ~20s; the
 * heavy lifting (clock-derived statuses, live-feed overlay, standings) lives in
 * lib/worldcup so there is a single source of truth.
 */
import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuthJson } from "../lib/auth";
import { buildDashboard } from "../lib/worldcup";

const app = new Hono<AppEnv>();
app.use("*", requireAuthJson);

app.get("/", async (c) => {
  const demo = c.req.query("demo") === "1" || c.env.WORLDCUP_DEMO === "1";
  const dashboard = await buildDashboard(c.env, { demo });
  // Don't let the browser cache a live payload.
  c.header("cache-control", "no-store");
  return c.json(dashboard);
});

export default app;
