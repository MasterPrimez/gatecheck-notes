/**
 * ID + hashing helpers.
 */

export function uuid(): string {
  return crypto.randomUUID();
}

/** SHA-256 hex of an arbitrary string — used to key the link-preview cache. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
