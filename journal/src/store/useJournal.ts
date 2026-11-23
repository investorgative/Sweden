import { create } from 'zustand'
import type { Settings, Trade } from '@/data/types'
import { generateTrades } from '@/data/generate'
import { api, annotationOf, NotLoggedIn, toTrade, type Annotation, type RawTrip, type WalletStart } from '@/lib/sweden'

export type RangeKey = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'

export interface Filters {
  range: RangeKey
  symbols: string[]
  setups: string[]
  side: 'all' | 'long' | 'short'
}

export type LoadState = 'loading' | 'ready' | 'login' | 'error'

interface JournalState {
  trades: Trade[]
  settings: Settings
  filters: Filters
  /** ids of achievements the user has already "seen" (for unlock toasts) */
  seenAchievements: string[]
  /** isDemo = the generated demo journal is shown (view only, nothing is saved) */
  isDemo: boolean
  // ---- Sweden
  load: LoadState
  error: string
  address: string | null
  openPositions: number
  raw: RawTrip[]
  notes: Record<string, Annotation>
  manual: Trade[]
  hidden: string[]
  solUsd: number
  me: string
  walletStart: WalletStart | null
  refresh: () => Promise<void>
  setDemo: (on: boolean) => void
  restoreHidden: () => void
  // ---- original actions
  setFilters: (f: Partial<Filters>) => void
  updateSettings: (s: Partial<Settings>) => void
  togglePrivacy: () => void
  addTrade: (t: Trade) => void
  updateTrade: (t: Trade) => void
  deleteTrade: (id: string) => void
  importTrades: (t: Trade[], mode: 'append' | 'replace') => void
  resetDemo: () => void
  clearAll: () => void
  markSeen: (ids: string[]) => void
}

export const DEFAULT_SETTINGS: Settings = {
  traderName: '',
  handle: '',
  currency: 'USD',
  startingBalance: 1000,
  goalName: 'Lakeside Villa',
  goalAmount: 10000,
  maxDailyLoss: 100,
  maxTradesPerDay: 15,
  privacy: false,
  weekStartsMonday: true,
  stopPct: 30,
  targetPct: 50,
  autoStart: true,
  shareCircle: false,
}

/** Demo settings: the generated journal is a stock / futures trader in USD. */
const DEMO_SETTINGS: Settings = { ...DEFAULT_SETTINGS, traderName: 'Demo trader', handle: 'demo', startingBalance: 75000, goalAmount: 250000, maxDailyLoss: 2500, maxTradesPerDay: 5 }

function build(s: Pick<JournalState, 'raw' | 'notes' | 'manual' | 'hidden' | 'settings' | 'solUsd'>): Trade[] {
  const hide = new Set(s.hidden)
  const wallet = s.raw.filter((r) => !hide.has(r.tid)).map((r) => toTrade(r, s.notes[r.tid], s.settings, s.solUsd))
  return [...wallet, ...s.manual.map((t) => ({ ...t, source: 'manual' as const, logged: true }))]
}

const local = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* ignore */
    }
  },
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function saveSettings(settings: Settings, seen: string[]) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void api.settings({ ...settings, seenAchievements: seen }).catch(() => {}), 700)
}

const fail = (e: unknown) => console.warn('journal save failed', e)

export const useJournal = create<JournalState>()((set, get) => ({
  trades: [],
  settings: DEFAULT_SETTINGS,
  filters: { range: 'ALL', symbols: [], setups: [], side: 'all', ...(JSON.parse(local.get('swedenJournalFilters') || '{}') as Partial<Filters>) },
  seenAchievements: [],
  isDemo: false,
  load: 'loading',
  error: '',
  address: null,
  openPositions: 0,
  raw: [],
  notes: {},
  manual: [],
  hidden: [],
  solUsd: 0,
  me: '',
  walletStart: null,

  refresh: async () => {
    try {
      const p = await api.load()
      const { seenAchievements, ...saved } = p.settings || {}
      const settings: Settings = { ...DEFAULT_SETTINGS, traderName: p.me, handle: (p.me || '').toLowerCase().replace(/[^a-z0-9_]/g, ''), ...saved }
      const next = { raw: p.trades, notes: p.notes || {}, manual: p.manual || [], hidden: p.hidden || [], settings, solUsd: p.sol_usd }
      set({
        ...next,
        load: 'ready',
        address: p.address,
        openPositions: p.open,
        me: p.me,
        walletStart: p.start ?? null,
        seenAchievements: seenAchievements ?? [],
        ...(get().isDemo ? {} : { trades: build(next) }),
      })
    } catch (e) {
      set(e instanceof NotLoggedIn ? { load: 'login' } : { load: get().load === 'ready' ? 'ready' : 'error', error: String(e) })
    }
  },

  setDemo: (on) => {
    const s = get()
    set(on ? { isDemo: true, trades: generateTrades() } : { isDemo: false, trades: build(s) })
  },

  restoreHidden: () => {
    const s = get()
    void api.hide(s.hidden, false).catch(fail)
    set({ hidden: [], trades: s.isDemo ? s.trades : build({ ...s, hidden: [] }) })
  },

  setFilters: (f) =>
    set((s) => {
      const filters = { ...s.filters, ...f }
      local.set('swedenJournalFilters', JSON.stringify(filters))
      return { filters }
    }),

  updateSettings: (u) =>
    set((s) => {
      const settings = { ...s.settings, ...u }
      if (!s.isDemo) saveSettings(settings, s.seenAchievements)
      if ('shareCircle' in u && !u.shareCircle) void api.share(null).catch(fail)
      return { settings, ...(s.isDemo ? {} : { trades: build({ ...s, settings }) }) }
    }),

  togglePrivacy: () => get().updateSettings({ privacy: !get().settings.privacy }),

  addTrade: (t) => {
    const s = get()
    if (s.isDemo) return set({ trades: [...s.trades, t] })
    const m = { ...t, source: 'manual' as const }
    void api.manual(m.id, m).catch(fail)
    const manual = [...s.manual, m]
    set({ manual, trades: build({ ...s, manual }) })
  },

  updateTrade: (t) => {
    const s = get()
    if (s.isDemo) return set({ trades: s.trades.map((x) => (x.id === t.id ? t : x)) })
    if (s.raw.some((r) => r.tid === t.id)) {
      const a = annotationOf(t)
      void api.note(t.id, a).catch(fail)
      const notes = { ...s.notes, [t.id]: a }
      return set({ notes, trades: build({ ...s, notes }) })
    }
    void api.manual(t.id, t).catch(fail)
    const manual = s.manual.map((x) => (x.id === t.id ? t : x))
    set({ manual, trades: build({ ...s, manual }) })
  },

  /** wallet trades are hidden (they come back with "restore"), hand-logged trades are deleted */
  deleteTrade: (id) => {
    const s = get()
    if (s.isDemo) return set({ trades: s.trades.filter((x) => x.id !== id) })
    if (s.raw.some((r) => r.tid === id)) {
      void api.hide([id], true).catch(fail)
      const hidden = [...s.hidden, id]
      return set({ hidden, trades: build({ ...s, hidden }) })
    }
    void api.manual(id, null).catch(fail)
    const manual = s.manual.filter((x) => x.id !== id)
    set({ manual, trades: build({ ...s, manual }) })
  },

  importTrades: (ts, mode) => {
    const s = get()
    if (s.isDemo) return
    if (mode === 'replace') {
      for (const m of s.manual) void api.manual(m.id, null).catch(fail)
      const tids = s.raw.map((r) => r.tid)
      void api.hide(tids, true).catch(fail)
      s.hidden = tids
      s.manual = []
    }
    const seen = new Set(s.manual.map((m) => m.id))
    const added = ts.map((t) => (seen.has(t.id) ? { ...t, id: `${t.id}-${Math.random().toString(36).slice(2, 6)}` } : t)).map((t) => ({ ...t, source: 'manual' as const }))
    for (const t of added) void api.manual(t.id, t).catch(fail)
    const manual = [...s.manual, ...added]
    set({ manual, hidden: s.hidden, trades: build({ ...s, manual }) })
  },

  resetDemo: () => get().setDemo(true),

  /** "start fresh": hide every wallet trade and delete the hand-logged ones */
  clearAll: () => get().importTrades([], 'replace'),

  markSeen: (ids) =>
    set((s) => {
      const seenAchievements = [...new Set([...s.seenAchievements, ...ids])]
      if (!s.isDemo) saveSettings(s.settings, seenAchievements)
      return { seenAchievements }
    }),
}))

export { DEMO_SETTINGS }

export function rangeStart(range: RangeKey, latest: Date): Date | null {
  const d = new Date(latest)
  switch (range) {
    case '1M':
      d.setMonth(d.getMonth() - 1)
      return d
    case '3M':
      d.setMonth(d.getMonth() - 3)
      return d
    case '6M':
      d.setMonth(d.getMonth() - 6)
      return d
    case '1Y':
      d.setFullYear(d.getFullYear() - 1)
      return d
    case 'YTD':
      return new Date(latest.getFullYear(), 0, 1)
    default:
      return null
  }
}

/** The money put into trading: today's cash + open positions at cost - the result of the wallet trades shown, so
 *  the equity line ends at what the wallet really holds. null while the wallet balance is unknown. */
export function moneyPutIn(s: Settings, ws: WalletStart | null, trades: Trade[]): number | null {
  if (!ws) return null
  const sol = s.currency === 'SOL'
  const now = sol ? ws.cash_sol + ws.open_sol : ws.cash_usd + ws.open_usd
  const result = trades.filter((t) => t.source === 'wallet').reduce((a, t) => a + t.pnl, 0)
  return Math.max(0, now - result)
}

/** Settings with the starting balance taken from the wallet when "from wallet" is on. */
export function effectiveSettings(s: Settings, ws: WalletStart | null, trades: Trade[], demo: boolean): Settings {
  if (demo) return { ...DEMO_SETTINGS, privacy: s.privacy }
  const put = s.autoStart ? moneyPutIn(s, ws, trades) : null
  return put == null ? s : { ...s, startingBalance: Math.round(put * 1000) / 1000 }
}

/** The settings the pages work with: the demo journal has its own (USD, stock-trader sizes). */
export function useSettings(): Settings {
  const s = useJournal((st) => st.settings)
  const demo = useJournal((st) => st.isDemo)
  const ws = useJournal((st) => st.walletStart)
  const trades = useJournal((st) => st.trades)
  return effectiveSettings(s, ws, trades, demo)
}
