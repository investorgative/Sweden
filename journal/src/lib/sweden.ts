/**
 * Connection to the Sweden terminal (same origin): the journal's trades are the user's closed wallet round trips
 * (built by the terminal from the wallet history), plus trades logged by hand. Annotations, manual trades and
 * settings are stored per Sweden account on the Pi — nothing in this browser except the login the terminal set.
 */
import type { Emotion, Mistake, Settings, Trade } from '@/data/types'

export interface RawTrip {
  tid: string
  mint: string
  t0: number
  t1: number
  cost_sol: number
  proceeds_sol: number
  pnl_sol: number
  cost_usd: number
  pnl_usd: number
  tokens: number
  sold: number
  buys: number
  sells: number
  fees_sol: number
  transferred: boolean
  entry_mc: number
  exit_mc: number
  sym: string
  name: string | null
  image: string | null
  path: number[] | null
  mae: number | null
  mfe: number | null
  after_hi: number | null
  after_lo: number | null
  stage: 'curve' | 'graduated' | null
  age_s: number | null
  signal: 'entry' | 'recommended' | null
  coin_note: { text: string; tag: string } | null
  starred: boolean
}

/** What the user adds to a wallet trade (stored on the Pi). */
export interface Annotation {
  setup?: string
  tags?: string[]
  mistakes?: Mistake[]
  emotion?: Emotion
  rating?: number
  followedPlan?: boolean
  notes?: string
}

export interface Payload {
  ok: boolean
  address: string | null
  trades: RawTrip[]
  open: number
  notes: Record<string, Annotation>
  manual: Trade[]
  hidden: string[]
  settings: Partial<Settings> & { seenAchievements?: string[] }
  sol_usd: number
  me: string
  start: WalletStart | null
}

/** today's cash and open positions at cost (the money put in is derived from it) */
export interface WalletStart {
  cash_sol: number
  cash_usd: number
  open_sol: number
  open_usd: number
}

export interface CircleRow {
  name: string
  me: boolean
  ts: number
  score: number
  level: number
  title: string
  winRate: number
  consistency?: number
  trades: number
  streak: number
  achievements: { name: string; tier: string; icon: string; at: string }[]
}

function headers(): Record<string, string> {
  let tok = '', user = ''
  try {
    tok = localStorage.getItem('swedenToken') || ''
    user = localStorage.getItem('swedenUser') || ''
  } catch {
    /* storage blocked */
  }
  return { 'Content-Type': 'application/json', 'X-Sweden-Token': tok, 'X-Sweden-User': user }
}

export class NotLoggedIn extends Error {}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? { headers: headers() } : { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  if (r.status === 401) throw new NotLoggedIn('login')
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

/** API base: the terminal serves the app at /journal/, the API at /api/. */
const API = '../api'

export const api = {
  load: () => call<Payload>(`${API}/journal`),
  note: (tid: string, data: Annotation | null) => call(`${API}/journal/note`, { tid, data }),
  manual: (tid: string, data: Trade | null) => call(`${API}/journal/manual`, { tid, data }),
  hide: (tids: string[], on: boolean) => call(`${API}/journal/hide`, { tids, on }),
  settings: (settings: object) => call(`${API}/journal/settings`, { settings }),
  circle: () => call<{ circle: CircleRow[] }>(`${API}/journal/circle`),
  share: (data: object | null) => call(`${API}/journal/circle`, { tid: 'me', data }),
}

const pad = (n: number) => String(n).padStart(2, '0')
export function localIso(sec: number) {
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function ageTag(s: number | null) {
  if (s == null) return null
  if (s < 60) return 'launch <1m'
  if (s < 180) return 'launch 1-3m'
  if (s < 600) return 'launch 3-10m'
  if (s < 3600) return 'launch 10-60m'
  return 'launch >1h'
}

export function autoSetup(r: RawTrip) {
  return r.signal === 'entry' ? 'Sweden entry signal' : r.signal === 'recommended' ? 'Sweden recommended' : 'Own pick'
}

export function autoTags(r: RawTrip) {
  const out: string[] = []
  if (r.stage) out.push(r.stage)
  const a = ageTag(r.age_s)
  if (a) out.push(a)
  if (r.starred) out.push('watchlist')
  if (r.coin_note?.tag) out.push(`note: ${r.coin_note.tag}`)
  if (r.transferred) out.push('tokens sent away')
  return out
}

/** A wallet round trip as a journal trade. Money in the chosen currency (USD: USDC exact, SOL at today's price). */
export function toTrade(r: RawTrip, a: Annotation | undefined, s: Settings, solUsd: number): Trade {
  const usd = s.currency !== 'SOL'
  const k = usd ? solUsd || 0 : 1                                      // SOL -> display currency
  const stop = Math.min(0.95, Math.max(0.05, (s.stopPct ?? 30) / 100))
  const tp = Math.max(0.05, (s.targetPct ?? 50) / 100)
  const cost = usd ? r.cost_usd : r.cost_sol
  const pnl = usd ? r.pnl_usd : r.pnl_sol
  const ret = cost > 0 ? pnl / cost : 0
  const entry = r.entry_mc * (usd ? solUsd || 1 : 1)
  const exit = r.exit_mc * (usd ? solUsd || 1 : 1)
  const logged = !!a && Object.keys(a).length > 0
  return {
    id: r.tid,
    symbol: (r.sym || r.mint.slice(0, 4)).toUpperCase().slice(0, 14),
    assetClass: 'Crypto',
    side: 'long',
    entryTime: localIso(r.t0),
    exitTime: localIso(r.t1),
    entryPrice: entry,
    exitPrice: exit,
    stopPrice: entry * (1 - stop),
    targetPrice: entry * (1 + tp),
    quantity: r.tokens,
    multiplier: 1,
    fees: r.fees_sol * k,
    pnl,
    risk: cost * stop,
    mae: r.mae != null ? r.mae / stop : Math.min(0, ret) / stop,
    mfe: r.mfe != null ? r.mfe / stop : Math.max(0, ret) / stop,
    setup: a?.setup || autoSetup(r),
    tags: a?.tags ?? autoTags(r),
    mistakes: a?.mistakes ?? [],
    emotion: a?.emotion ?? 'Not logged',
    rating: a?.rating ?? 3,
    followedPlan: a?.followedPlan ?? true,
    notes: a?.notes ?? (r.coin_note?.text || ''),
    path: r.path ? r.path.map((v) => v / stop) : undefined,
    logged,
    source: 'wallet',
    mint: r.mint,
    name: r.name ?? undefined,
    image: r.image ?? undefined,
    afterHi: r.after_hi,
    afterLo: r.after_lo,
    ageS: r.age_s,
    costBasis: cost,
    buys: r.buys,
    sells: r.sells,
  }
}

/** The annotation part of an edited wallet trade (what is stored on the Pi). */
export function annotationOf(t: Trade): Annotation {
  return { setup: t.setup, tags: t.tags, mistakes: t.mistakes, emotion: t.emotion, rating: t.rating, followedPlan: t.followedPlan, notes: t.notes }
}
