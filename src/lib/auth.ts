/**
 * Auth middleware for Notes.
 *
 * Identical strategy to every other GateCheck app Worker: read the
 * __Secure-gatecheck-session cookie set by auth.gatecheck.net, SHA-256 it,
 * and look it up in the SHARED D1 (`sessions.id_hash` JOIN `users`). No call
 * to auth.gatecheck.net is needed — both Workers bind the same database.
 *
 *   - Invalid/expired/missing on a JSON API route  → 401 JSON.
 *   - Invalid/expired/missing on an HTML page       → redirect to login.
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv, User } from "../types";

const SESSION_COOKIE_NAME = "__Secure-gatecheck-session";

function readSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return rest.join("=");
  }
  return null;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
}

async function lookupUser(env: AppEnv["Bindings"], request: Request): Promise<User | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const idHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name
       FROM users u
       INNER JOIN sessions s ON s.user_id = u.id
      WHERE s.id_hash = ? AND s.expires_at > ?`,
  )
    .bind(idHash, Math.floor(Date.now() / 1000))
    .first<UserRow>();
  return row ?? null;
}

/** Require auth on JSON API routes — returns 401 JSON if not signed in. */
export const requireAuthJson: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await lookupUser(c.env, c.req.raw);
  if (!user) return c.json({ error: "Not authenticated" }, 401);
  c.set("user", user);
  await next();
};

/** Require auth on HTML routes — redirects to gatecheck.net/login if not signed in. */
export const requireAuthPage: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await lookupUser(c.env, c.req.raw);
  if (!user) {
    const back = encodeURIComponent(c.env.SELF_BASE + c.req.path);
    return c.redirect(`${c.env.LOGIN_URL}?redirect=${back}`);
  }
  c.set("user", user);
  await next();
};
