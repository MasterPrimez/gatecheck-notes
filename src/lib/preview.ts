/**
 * Server-side link preview.
 *
 * Browsers can't fetch arbitrary cross-origin pages (CORS), so the Worker does
 * it: fetch the page, stream just the <head> through HTMLRewriter, and pull the
 * OpenGraph / Twitter-card / <title> / favicon out. Results are cached in D1
 * (see notes_link_cache) so we never re-scrape the same URL.
 *
 * Known media providers (YouTube, Vimeo, X) are handled CLIENT-SIDE by URL
 * pattern — they get real embeds, no scraping needed. This path is for generic
 * websites and direct image links.
 */
import type { LinkPreview } from "../types";

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024; // first 512 KB of HTML is plenty for <head>
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 GateCheckNotes/1.0";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)(\?.*)?$/i;

/**
 * Block obviously-internal targets. Workers fetch already can't reach the
 * caller's localhost, but this keeps us from being a generic SSRF proxy.
 */
export function isPublicHttpUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return null;
  }
  // Block private / loopback / link-local IPv4 literals.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 10 ||
      a === 127 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254) ||
      a === 0
    ) {
      return null;
    }
  }
  // Block IPv6 loopback / link-local / unique-local.
  if (host === "[::1]" || host.startsWith("[fe80") || host.startsWith("[fc") || host.startsWith("[fd")) {
    return null;
  }
  return u;
}

function absolutize(maybeRelative: string | null, base: URL): string | null {
  if (!maybeRelative) return null;
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return null;
  }
}

/** Decode the handful of HTML entities that commonly appear in og: content. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export async function fetchLinkPreview(raw: string): Promise<LinkPreview> {
  const url = isPublicHttpUrl(raw);
  if (!url) {
    return errorPreview(raw);
  }

  // Direct image link → no scraping, just present it as an image.
  if (IMAGE_EXT.test(url.pathname)) {
    return {
      url: url.toString(),
      type: "image",
      title: null,
      description: null,
      image: url.toString(),
      site_name: url.hostname.replace(/^www\./, ""),
      favicon: null,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/*;q=0.8,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch {
    clearTimeout(timer);
    return errorPreview(url.toString());
  }
  clearTimeout(timer);

  const finalUrl = (() => {
    try {
      return new URL(res.url || url.toString());
    } catch {
      return url;
    }
  })();

  const contentType = res.headers.get("content-type") || "";

  // The server handed us an image directly.
  if (contentType.startsWith("image/")) {
    return {
      url: finalUrl.toString(),
      type: "image",
      title: null,
      description: null,
      image: finalUrl.toString(),
      site_name: finalUrl.hostname.replace(/^www\./, ""),
      favicon: null,
    };
  }

  if (!res.ok || !contentType.includes("html")) {
    return {
      url: finalUrl.toString(),
      type: "link",
      title: null,
      description: null,
      image: null,
      site_name: finalUrl.hostname.replace(/^www\./, ""),
      favicon: absolutize("/favicon.ico", finalUrl),
    };
  }

  // Bounded read — we only need the <head>.
  const html = await readBounded(res, MAX_BYTES);

  const meta: Record<string, string> = {};
  let titleText = "";
  let favicon: string | null = null;

  const rewriter = new HTMLRewriter()
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") || el.getAttribute("name") || "").toLowerCase();
        const content = el.getAttribute("content");
        if (key && content != null && !(key in meta)) meta[key] = content;
      },
    })
    .on("title", {
      text(t) {
        titleText += t.text;
      },
    })
    .on("link", {
      element(el) {
        const rel = (el.getAttribute("rel") || "").toLowerCase();
        if (!favicon && (rel.includes("icon") || rel === "apple-touch-icon")) {
          favicon = el.getAttribute("href");
        }
      },
    });

  await rewriter.transform(new Response(html)).arrayBuffer();

  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      if (meta[k]) return decodeEntities(meta[k]);
    }
    return null;
  };

  const title = pick("og:title", "twitter:title") || (titleText ? decodeEntities(titleText) : null);
  const description = pick("og:description", "twitter:description", "description");
  const image = absolutize(pick("og:image", "og:image:url", "og:image:secure_url", "twitter:image"), finalUrl);
  const site_name = pick("og:site_name") || finalUrl.hostname.replace(/^www\./, "");
  const favAbs = absolutize(favicon, finalUrl) || absolutize("/favicon.ico", finalUrl);

  return {
    url: finalUrl.toString(),
    type: "link",
    title,
    description,
    image,
    site_name,
    favicon: favAbs,
  };
}

function errorPreview(url: string): LinkPreview {
  return { url, type: "error", title: null, description: null, image: null, site_name: null, favicon: null };
}

/** Read at most `max` bytes of a response body, then stop. */
async function readBounded(res: Response, max: number): Promise<string> {
  if (!res.body) return await res.text().catch(() => "");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < max) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c.subarray(0, Math.min(c.length, buf.length - offset)), offset);
    offset += c.length;
    if (offset >= buf.length) break;
  }
  return new TextDecoder("utf-8").decode(buf);
}
