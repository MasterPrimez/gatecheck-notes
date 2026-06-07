/**
 * World Cup 2026 live dashboard — data + logic.
 *
 * This module owns everything the dashboard needs that isn't UI:
 *
 *   - The static tournament reference data (teams, groups, 16 host venues,
 *     US broadcasters) and the full 72-match group-stage fixture list. Match-ups
 *     come from the confirmed Final Draw (5 Dec 2025) expanded with FIFA's
 *     canonical 4-team group fixture order; the announced opening-week games
 *     (11–14 June) carry exact kick-offs / venues / networks, later matchdays
 *     are flagged provisional.
 *   - `buildDashboard()` — merges any live feed over the schedule, derives each
 *     match's status (upcoming / live+minute / finished) from the real clock,
 *     computes group standings (W-D-L, GF/GA/GD, Pts), and returns one JSON DTO.
 *
 * Source of truth for *scores* in production is the live feed the Worker fetches
 * server-side (`WORLDCUP_API_URL`, normalised below). With no feed configured
 * the board still runs in "schedule" mode — statuses tick over in real time from
 * kick-off — and `?demo=1` synthesises live scores so the realtime behaviour is
 * visible before a ball is kicked.
 */
import type { Env } from "../types";

// ── Reference data ──────────────────────────────────────────────────────────

export interface Team {
  code: string;
  name: string;
  flag: string;
  group: string;
}

export interface Venue {
  id: string;
  city: string;
  stadium: string;
  country: "USA" | "Mexico" | "Canada";
  tz: string;
}

export interface Broadcaster {
  name: string;
  lang: "English" | "Spanish";
  kind: "TV" | "Stream";
  free: boolean;
  note: string;
}

type Slot = "noon" | "afternoon" | "evening" | "night";

interface SeedMatch {
  id: string;
  group: string;
  matchday: 1 | 2 | 3;
  home: string; // team code
  away: string; // team code
  kickoff: string; // ISO UTC
  venue: string; // venue id
  marquee: boolean; // marquee window → FOX / Telemundo (else FS1 / Universo)
  free: boolean; // also a free Tubi 4K simulcast
  confirmed: boolean; // exact kickoff + venue announced (vs provisional)
}

/** Teams in draw-position order 1..4 per group (drives the fixture generator). */
const GROUPS: Record<string, [string, string, string, string]> = {
  A: ["MEX", "RSA", "KOR", "CZE"],
  B: ["CAN", "BIH", "QAT", "SUI"],
  C: ["BRA", "MAR", "HAI", "SCO"],
  D: ["USA", "PAR", "AUS", "TUR"],
  E: ["GER", "CUW", "CIV", "ECU"],
  F: ["NED", "JPN", "SWE", "TUN"],
  G: ["BEL", "EGY", "IRN", "NZL"],
  H: ["ESP", "CPV", "KSA", "URU"],
  I: ["FRA", "SEN", "IRQ", "NOR"],
  J: ["ARG", "ALG", "AUT", "JOR"],
  K: ["POR", "COD", "UZB", "COL"],
  L: ["ENG", "CRO", "GHA", "PAN"],
};

const TEAM_INFO: Record<string, { name: string; flag: string }> = {
  MEX: { name: "Mexico", flag: "🇲🇽" },
  RSA: { name: "South Africa", flag: "🇿🇦" },
  KOR: { name: "South Korea", flag: "🇰🇷" },
  CZE: { name: "Czechia", flag: "🇨🇿" },
  CAN: { name: "Canada", flag: "🇨🇦" },
  BIH: { name: "Bosnia & Herz.", flag: "🇧🇦" },
  QAT: { name: "Qatar", flag: "🇶🇦" },
  SUI: { name: "Switzerland", flag: "🇨🇭" },
  BRA: { name: "Brazil", flag: "🇧🇷" },
  MAR: { name: "Morocco", flag: "🇲🇦" },
  HAI: { name: "Haiti", flag: "🇭🇹" },
  SCO: { name: "Scotland", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  USA: { name: "United States", flag: "🇺🇸" },
  PAR: { name: "Paraguay", flag: "🇵🇾" },
  AUS: { name: "Australia", flag: "🇦🇺" },
  TUR: { name: "Türkiye", flag: "🇹🇷" },
  GER: { name: "Germany", flag: "🇩🇪" },
  CUW: { name: "Curaçao", flag: "🇨🇼" },
  CIV: { name: "Côte d'Ivoire", flag: "🇨🇮" },
  ECU: { name: "Ecuador", flag: "🇪🇨" },
  NED: { name: "Netherlands", flag: "🇳🇱" },
  JPN: { name: "Japan", flag: "🇯🇵" },
  SWE: { name: "Sweden", flag: "🇸🇪" },
  TUN: { name: "Tunisia", flag: "🇹🇳" },
  BEL: { name: "Belgium", flag: "🇧🇪" },
  EGY: { name: "Egypt", flag: "🇪🇬" },
  IRN: { name: "Iran", flag: "🇮🇷" },
  NZL: { name: "New Zealand", flag: "🇳🇿" },
  ESP: { name: "Spain", flag: "🇪🇸" },
  CPV: { name: "Cape Verde", flag: "🇨🇻" },
  KSA: { name: "Saudi Arabia", flag: "🇸🇦" },
  URU: { name: "Uruguay", flag: "🇺🇾" },
  FRA: { name: "France", flag: "🇫🇷" },
  SEN: { name: "Senegal", flag: "🇸🇳" },
  IRQ: { name: "Iraq", flag: "🇮🇶" },
  NOR: { name: "Norway", flag: "🇳🇴" },
  ARG: { name: "Argentina", flag: "🇦🇷" },
  ALG: { name: "Algeria", flag: "🇩🇿" },
  AUT: { name: "Austria", flag: "🇦🇹" },
  JOR: { name: "Jordan", flag: "🇯🇴" },
  POR: { name: "Portugal", flag: "🇵🇹" },
  COD: { name: "DR Congo", flag: "🇨🇩" },
  UZB: { name: "Uzbekistan", flag: "🇺🇿" },
  COL: { name: "Colombia", flag: "🇨🇴" },
  ENG: { name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  CRO: { name: "Croatia", flag: "🇭🇷" },
  GHA: { name: "Ghana", flag: "🇬🇭" },
  PAN: { name: "Panama", flag: "🇵🇦" },
};

export const VENUES: Venue[] = [
  { id: "nyj", city: "New York / New Jersey", stadium: "MetLife Stadium", country: "USA", tz: "America/New_York" },
  { id: "lax", city: "Los Angeles", stadium: "SoFi Stadium", country: "USA", tz: "America/Los_Angeles" },
  { id: "dal", city: "Dallas", stadium: "AT&T Stadium", country: "USA", tz: "America/Chicago" },
  { id: "sfo", city: "San Francisco Bay", stadium: "Levi's Stadium", country: "USA", tz: "America/Los_Angeles" },
  { id: "mia", city: "Miami", stadium: "Hard Rock Stadium", country: "USA", tz: "America/New_York" },
  { id: "atl", city: "Atlanta", stadium: "Mercedes-Benz Stadium", country: "USA", tz: "America/New_York" },
  { id: "sea", city: "Seattle", stadium: "Lumen Field", country: "USA", tz: "America/Los_Angeles" },
  { id: "hou", city: "Houston", stadium: "NRG Stadium", country: "USA", tz: "America/Chicago" },
  { id: "phi", city: "Philadelphia", stadium: "Lincoln Financial Field", country: "USA", tz: "America/New_York" },
  { id: "kan", city: "Kansas City", stadium: "Arrowhead Stadium", country: "USA", tz: "America/Chicago" },
  { id: "bos", city: "Boston", stadium: "Gillette Stadium", country: "USA", tz: "America/New_York" },
  { id: "mex", city: "Mexico City", stadium: "Estadio Azteca", country: "Mexico", tz: "America/Mexico_City" },
  { id: "gdl", city: "Guadalajara", stadium: "Estadio Akron", country: "Mexico", tz: "America/Mexico_City" },
  { id: "mty", city: "Monterrey", stadium: "Estadio BBVA", country: "Mexico", tz: "America/Monterrey" },
  { id: "tor", city: "Toronto", stadium: "BMO Field", country: "Canada", tz: "America/Toronto" },
  { id: "van", city: "Vancouver", stadium: "BC Place", country: "Canada", tz: "America/Vancouver" },
];

export const BROADCASTERS: Broadcaster[] = [
  { name: "FOX", lang: "English", kind: "TV", free: false, note: "70 matches incl. the opener & final" },
  { name: "FS1", lang: "English", kind: "TV", free: false, note: "34 matches" },
  { name: "Telemundo", lang: "Spanish", kind: "TV", free: false, note: "Spanish-language flagship" },
  { name: "Universo", lang: "Spanish", kind: "TV", free: false, note: "Spanish-language overflow" },
  { name: "Tubi", lang: "English", kind: "Stream", free: true, note: "Free 4K simulcast of the opener & USMNT opener" },
  { name: "FOX One / FOX Sports App", lang: "English", kind: "Stream", free: false, note: "Every match streams live" },
  { name: "Peacock", lang: "Spanish", kind: "Stream", free: false, note: "Telemundo's Spanish streams" },
];

const VENUE_BY_ID = new Map(VENUES.map((v) => [v.id, v]));

// ── Fixture generation ──────────────────────────────────────────────────────

/** FIFA canonical 4-team group order, by draw position (0-indexed here). */
const FIXTURE_ORDER: Record<1 | 2 | 3, [number, number][]> = {
  1: [
    [0, 1],
    [2, 3],
  ],
  2: [
    [0, 2],
    [3, 1],
  ],
  3: [
    [3, 0],
    [1, 2],
  ],
};

const GROUP_LETTERS = Object.keys(GROUPS);

// Provisional kick-off slots (US Eastern). June is EDT = UTC-4.
const SLOT_UTC_HOUR: Record<Slot, number> = { noon: 16, afternoon: 19, evening: 22, night: 1 };
const SLOT_ROTATION: Slot[] = ["noon", "afternoon", "evening", "night"];

// A rough but plausible venue rotation so provisional games aren't all in one city.
const VENUE_ROTATION = ["nyj", "lax", "dal", "atl", "mia", "sea", "hou", "phi", "kan", "bos", "sfo", "tor", "van", "mex", "gdl", "mty"];

function iso(year: number, monthIndex: number, day: number, utcHour: number): string {
  // night slots (1:00 UTC) belong to the following calendar day
  return new Date(Date.UTC(year, monthIndex, day, utcHour, 0, 0)).toISOString();
}

/**
 * Exact, announced opening-week games (date / kick-off / venue / networks).
 * Keyed by `${group}${matchday}-${homeIdx}` so the generator can stamp them.
 */
const CONFIRMED: Record<string, { kickoff: string; venue: string; marquee: boolean; free: boolean }> = {
  // Thu 11 Jun — opener
  "A1-0": { kickoff: iso(2026, 5, 11, 19), venue: "mex", marquee: true, free: true }, // MEX v RSA, 3pm ET
  "A1-2": { kickoff: iso(2026, 5, 12, 1), venue: "gdl", marquee: false, free: false }, // KOR v CZE, late
  // Fri 12 Jun
  "B1-0": { kickoff: iso(2026, 5, 12, 19), venue: "tor", marquee: true, free: false }, // CAN v BIH, 3pm ET
  "D1-0": { kickoff: iso(2026, 5, 13, 1), venue: "lax", marquee: true, free: true }, // USA v PAR, 9pm ET
  // Sat 13 Jun
  "B1-2": { kickoff: iso(2026, 5, 13, 19), venue: "sfo", marquee: false, free: false }, // QAT v SUI, 3pm ET
  "C1-0": { kickoff: iso(2026, 5, 13, 22), venue: "nyj", marquee: true, free: false }, // BRA v MAR, 6pm ET
  "C1-2": { kickoff: iso(2026, 5, 14, 1), venue: "kan", marquee: false, free: false }, // HAI v SCO, 9pm ET
  "D1-2": { kickoff: iso(2026, 5, 14, 4), venue: "sea", marquee: false, free: false }, // AUS v TUR, late
  // Sun 14 Jun
  "E1-0": { kickoff: iso(2026, 5, 14, 17), venue: "phi", marquee: true, free: false }, // GER v CUW, 1pm ET
  "F1-0": { kickoff: iso(2026, 5, 14, 20), venue: "nyj", marquee: true, free: false }, // NED v JPN, 4pm ET
  "E1-2": { kickoff: iso(2026, 5, 14, 23), venue: "atl", marquee: false, free: false }, // CIV v ECU, 7pm ET
  "F1-2": { kickoff: iso(2026, 5, 15, 2), venue: "lax", marquee: false, free: false }, // SWE v TUN, 10pm ET
};

function buildSeed(): SeedMatch[] {
  const out: SeedMatch[] = [];
  let venueTick = 0;

  for (let gi = 0; gi < GROUP_LETTERS.length; gi++) {
    const letter = GROUP_LETTERS[gi];
    const teams = GROUPS[letter];

    ([1, 2, 3] as const).forEach((md) => {
      FIXTURE_ORDER[md].forEach(([hIdx, aIdx], pairIdx) => {
        const key = `${letter}${md}-${hIdx}`;
        const confirmed = CONFIRMED[key];

        // Provisional scheduling: MD1 ~Jun 11–18, MD2 ~Jun 18–24, MD3 24–27.
        const baseDay = md === 1 ? 11 + Math.floor(gi / 2) : md === 2 ? 18 + Math.floor(gi / 2) : 24 + Math.floor(gi / 4);
        const slot = SLOT_ROTATION[(gi + pairIdx * 2 + md) % SLOT_ROTATION.length];
        const hour = SLOT_UTC_HOUR[slot];
        const provisionalKick = iso(2026, 5, baseDay + (slot === "night" ? 1 : 0), hour);
        const provisionalVenue = VENUE_ROTATION[venueTick++ % VENUE_ROTATION.length];

        out.push({
          id: `${letter}-md${md}-${teams[hIdx]}-${teams[aIdx]}`,
          group: letter,
          matchday: md,
          home: teams[hIdx],
          away: teams[aIdx],
          kickoff: confirmed ? confirmed.kickoff : provisionalKick,
          venue: confirmed ? confirmed.venue : provisionalVenue,
          marquee: confirmed ? confirmed.marquee : pairIdx === 0,
          free: confirmed ? confirmed.free : false,
          confirmed: !!confirmed,
        });
      });
    });
  }

  return out.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}

const SEED = buildSeed();

// ── Output DTOs ─────────────────────────────────────────────────────────────

export type MatchStatus = "upcoming" | "live" | "halftime" | "finished";

export interface WatchInfo {
  label: string;
  lang: "English" | "Spanish";
  kind: "TV" | "Stream";
  free: boolean;
}

export interface MatchDTO {
  id: string;
  group: string;
  matchday: 1 | 2 | 3;
  kickoff: string;
  status: MatchStatus;
  minute: number | null;
  confirmed: boolean;
  live: boolean; // score came from a live feed / demo
  home: { code: string; name: string; flag: string; score: number | null };
  away: { code: string; name: string; flag: string; score: number | null };
  winner: "home" | "away" | "draw" | null;
  venue: { city: string; stadium: string; country: string };
  watch: WatchInfo[];
}

export interface StandingRow {
  code: string;
  name: string;
  flag: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

export interface Dashboard {
  generatedAt: number;
  source: "live" | "demo" | "schedule";
  tournament: { name: string; hosts: string; start: string; end: string; teams: number; venues: number };
  matches: MatchDTO[];
  groups: { letter: string; table: StandingRow[] }[];
  venues: Venue[];
  broadcasters: Broadcaster[];
}

// ── Live feed (server-side; overlays real scores) ───────────────────────────

interface LiveResult {
  home: string; // team code
  away: string; // team code
  homeScore: number | null;
  awayScore: number | null;
  status?: MatchStatus;
  minute?: number | null;
}

const NAME_TO_CODE: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [code, info] of Object.entries(TEAM_INFO)) {
    m.set(norm(info.name), code);
    m.set(norm(code), code);
  }
  // common aliases seen in feeds
  const alias: Record<string, string> = {
    "korea republic": "KOR",
    "south korea": "KOR",
    "ivory coast": "CIV",
    "cote divoire": "CIV",
    "turkey": "TUR",
    "czech republic": "CZE",
    "usa": "USA",
    "united states of america": "USA",
    "bosnia and herzegovina": "BIH",
    "dr congo": "COD",
    "congo dr": "COD",
    "iran": "IRN",
    "ir iran": "IRN",
  };
  for (const [k, v] of Object.entries(alias)) m.set(norm(k), v);
  return m;
})();

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function codeFor(name: unknown): string | null {
  if (typeof name !== "string") return null;
  return NAME_TO_CODE.get(norm(name)) ?? null;
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapStatus(raw: unknown): MatchStatus | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.toLowerCase();
  if (/(finished|ft|full|aet|after extra|ended|fin)/.test(s)) return "finished";
  if (/(ht|half[- ]?time)/.test(s)) return "halftime";
  if (/(1h|2h|live|play|in progress|\d)/.test(s)) return "live";
  if (/(ns|not started|sched|upcoming|fixture)/.test(s)) return "upcoming";
  return undefined;
}

/** Normalise a feed payload (TheSportsDB-style or generic) to LiveResult[]. */
function normalizeFeed(data: unknown): LiveResult[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const rows = (obj.events ?? obj.matches ?? obj.results ?? (Array.isArray(data) ? data : [])) as unknown[];
  if (!Array.isArray(rows)) return [];

  const out: LiveResult[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const e = r as Record<string, unknown>;
    const home = codeFor(e.strHomeTeam ?? e.home ?? e.homeTeam ?? e.home_name);
    const away = codeFor(e.strAwayTeam ?? e.away ?? e.awayTeam ?? e.away_name);
    if (!home || !away) continue;
    out.push({
      home,
      away,
      homeScore: toInt(e.intHomeScore ?? e.homeScore ?? e.home_score ?? e.scoreHome),
      awayScore: toInt(e.intAwayScore ?? e.awayScore ?? e.away_score ?? e.scoreAway),
      status: mapStatus(e.strStatus ?? e.status ?? e.state),
      minute: toInt(e.strProgress ?? e.minute ?? e.elapsed),
    });
  }
  return out;
}

async function fetchLive(env: Env): Promise<LiveResult[] | null> {
  const url = env.WORLDCUP_API_URL?.trim();
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
      cf: { cacheTtl: 15, cacheEverything: true },
    } as RequestInit);
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const live = normalizeFeed(data);
    return live.length ? live : null;
  } catch {
    return null;
  }
}

// ── Demo simulation (so realtime is visible before kick-off) ─────────────────

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic goal minutes for one side of a match (stable across polls). */
function goalMinutes(matchId: string, side: "h" | "a"): number[] {
  const seed = hash(matchId + side);
  const count = seed % 4; // 0..3 goals
  const mins: number[] = [];
  for (let i = 0; i < count; i++) {
    mins.push(5 + (hash(matchId + side + i) % 88)); // minute 5..92
  }
  return mins.sort((x, y) => x - y);
}

function demoScore(matchId: string, side: "h" | "a", clampMinute: number): number {
  return goalMinutes(matchId, side).filter((m) => m <= clampMinute).length;
}

// ── Status from the clock ───────────────────────────────────────────────────

const REGULATION_MS = 105 * 60 * 1000; // 90' + ~stoppage, treat as "live" window
const FINAL_WHISTLE_MS = 118 * 60 * 1000;

function statusFromClock(kickoffMs: number, now: number): { status: MatchStatus; minute: number | null } {
  if (now < kickoffMs) return { status: "upcoming", minute: null };
  const elapsed = now - kickoffMs;
  if (elapsed >= FINAL_WHISTLE_MS) return { status: "finished", minute: null };
  const min = Math.floor(elapsed / 60000);
  if (min >= 45 && min < 60) return { status: "halftime", minute: 45 };
  if (elapsed >= REGULATION_MS) return { status: "live", minute: 90 };
  return { status: "live", minute: Math.max(1, min > 45 ? min - 15 : min) };
}

// ── Build the dashboard ─────────────────────────────────────────────────────

function watchFor(m: SeedMatch): WatchInfo[] {
  const out: WatchInfo[] = [
    { label: m.marquee ? "FOX" : "FS1", lang: "English", kind: "TV", free: false },
    { label: m.marquee ? "Telemundo" : "Universo", lang: "Spanish", kind: "TV", free: false },
    { label: "FOX One", lang: "English", kind: "Stream", free: false },
  ];
  if (m.free) out.unshift({ label: "Tubi (free 4K)", lang: "English", kind: "Stream", free: true });
  return out;
}

function winnerOf(h: number | null, a: number | null, status: MatchStatus): MatchDTO["winner"] {
  if (h === null || a === null) return null;
  if (status !== "finished" && status !== "live" && status !== "halftime") return null;
  if (h > a) return "home";
  if (a > h) return "away";
  return status === "finished" ? "draw" : null;
}

export async function buildDashboard(env: Env, opts: { demo: boolean }): Promise<Dashboard> {
  const now = Date.now();
  const live = opts.demo ? null : await fetchLive(env);
  const liveByPair = new Map<string, LiveResult>();
  if (live) for (const r of live) liveByPair.set(`${r.home}-${r.away}`, r);

  let usedLive = false;
  let usedDemo = false;

  const matches: MatchDTO[] = SEED.map((m) => {
    const kickoffMs = Date.parse(m.kickoff);
    let { status, minute } = statusFromClock(kickoffMs, now);
    let hScore: number | null = null;
    let aScore: number | null = null;
    let fromLive = false;

    const feed = liveByPair.get(`${m.home}-${m.away}`);
    if (feed) {
      if (feed.homeScore !== null && feed.awayScore !== null) {
        hScore = feed.homeScore;
        aScore = feed.awayScore;
        fromLive = true;
        usedLive = true;
      }
      if (feed.status) status = feed.status;
      if (feed.minute !== null && feed.minute !== undefined) minute = feed.minute;
    } else if (opts.demo && (status === "live" || status === "halftime" || status === "finished")) {
      const clamp = status === "finished" ? 95 : minute ?? 0;
      hScore = demoScore(m.id, "h", clamp);
      aScore = demoScore(m.id, "a", clamp);
      fromLive = true;
      usedDemo = true;
    }

    const venue = VENUE_BY_ID.get(m.venue)!;
    const home = TEAM_INFO[m.home];
    const away = TEAM_INFO[m.away];

    return {
      id: m.id,
      group: m.group,
      matchday: m.matchday,
      kickoff: m.kickoff,
      status,
      minute: status === "live" ? minute : status === "halftime" ? 45 : null,
      confirmed: m.confirmed,
      live: fromLive,
      home: { code: m.home, name: home.name, flag: home.flag, score: hScore },
      away: { code: m.away, name: away.name, flag: away.flag, score: aScore },
      winner: winnerOf(hScore, aScore, status),
      venue: { city: venue.city, stadium: venue.stadium, country: venue.country },
      watch: watchFor(m),
    };
  });

  const groups = computeStandings(matches);

  return {
    generatedAt: now,
    source: usedLive ? "live" : usedDemo ? "demo" : "schedule",
    tournament: {
      name: "FIFA World Cup 2026",
      hosts: "United States · Canada · Mexico",
      start: "2026-06-11",
      end: "2026-07-19",
      teams: 48,
      venues: VENUES.length,
    },
    matches,
    groups,
    venues: VENUES,
    broadcasters: BROADCASTERS,
  };
}

function computeStandings(matches: MatchDTO[]): Dashboard["groups"] {
  return GROUP_LETTERS.map((letter) => {
    const rows = new Map<string, StandingRow>();
    for (const code of GROUPS[letter]) {
      const t = TEAM_INFO[code];
      rows.set(code, {
        code,
        name: t.name,
        flag: t.flag,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        points: 0,
      });
    }

    for (const m of matches) {
      if (m.group !== letter || m.status !== "finished") continue;
      if (m.home.score === null || m.away.score === null) continue;
      const h = rows.get(m.home.code)!;
      const a = rows.get(m.away.code)!;
      h.played++;
      a.played++;
      h.gf += m.home.score;
      h.ga += m.away.score;
      a.gf += m.away.score;
      a.ga += m.home.score;
      if (m.home.score > m.away.score) {
        h.won++;
        h.points += 3;
        a.lost++;
      } else if (m.away.score > m.home.score) {
        a.won++;
        a.points += 3;
        h.lost++;
      } else {
        h.drawn++;
        a.drawn++;
        h.points++;
        a.points++;
      }
    }

    const table = [...rows.values()];
    for (const r of table) r.gd = r.gf - r.ga;
    table.sort((x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name));
    return { letter, table };
  });
}
