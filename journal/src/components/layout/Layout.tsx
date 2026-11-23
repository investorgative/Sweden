import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Users, BookOpen, CalendarDays, ChartNoAxesCombined, Eye, EyeOff, House, LayoutDashboard, Plus, Radar, Search, Settings, Trophy, Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Logo } from './Logo'
import { useJournal, useSettings, type RangeKey } from '@/store/useJournal'
import { useAnalytics } from '@/store/analytics'
import { cx, Segmented, Bar } from '@/components/ui/primitives'
import { api } from '@/lib/sweden'
import { traderScore } from '@/lib/stats'
import { CommandPalette } from './CommandPalette'
import { TradeForm } from '@/components/TradeForm'
import { UnlockToasts } from './UnlockToasts'
import { TradeDrawer } from '@/components/TradeDrawer'

export const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/journal', label: 'Journal', icon: BookOpen },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
  { to: '/edge', label: 'Edge Report', icon: Radar, badge: true },
  { to: '/dream', label: 'Dream House', icon: House },
  { to: '/achievements', label: 'Achievements', icon: Trophy },
]

const RANGES: { value: RangeKey; label: string }[] = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1Y' },
  { value: 'ALL', label: 'All' },
]

export function Layout() {
  const location = useLocation()
  const settings = useSettings()
  const togglePrivacy = useJournal((s) => s.togglePrivacy)
  const filters = useJournal((s) => s.filters)
  const setFilters = useJournal((s) => s.setFilters)
  const { lifetime, insights } = useAnalytics()
  const [cmdOpen, setCmdOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const leaks = insights.filter((i) => i.kind === 'leak' && i.severity >= 2).length
  const load = useJournal((s) => s.load)
  const isDemo = useJournal((s) => s.isDemo)
  const setDemo = useJournal((s) => s.setDemo)
  const refresh = useJournal((s) => s.refresh)
  const nTrades = useJournal((s) => s.trades.length)
  const address = useJournal((s) => s.address)
  const openPositions = useJournal((s) => s.openPositions)

  // trading circle (opt-in): score, level, win rate, streak, unlocks - never amounts
  const share = load === 'ready' && !isDemo && settings.shareCircle
  const circleData = share
    ? JSON.stringify({
        score: traderScore(lifetime.summary).score,
        level: lifetime.xp.level.level,
        title: lifetime.xp.level.title,
        winRate: lifetime.summary.winRate,
        consistency: lifetime.summary.dayWinRate,
        trades: lifetime.summary.count,
        streak: Math.max(0, lifetime.summary.currentStreak),
        achievements: lifetime.achievements
          .filter((a) => a.unlocked)
          .sort((a, b) => (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? ''))
          .slice(0, 8)
          .map((a) => ({ name: a.name, tier: a.tier, icon: a.icon, at: a.unlockedAt ?? '' })),
      })
    : ''
  useEffect(() => {
    if (circleData) void api.share(JSON.parse(circleData)).catch(() => {})
  }, [circleData])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => document.visibilityState === 'visible' && void refresh(), 60000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen((o) => !o)
      }
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey) setAddOpen(true)
      if (e.key === 'p' && !e.metaKey && !e.ctrlKey) togglePrivacy()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [togglePrivacy])

  useEffect(() => {
    setMobileOpen(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  const xp = lifetime.xp
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-6 pt-6">
        <Logo />
        <div>
          <div className="font-display text-[26px] leading-none tracking-tight">Aurum</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.24em] text-ink-3">Sweden journal</div>
        </div>
      </div>
      <a href="../" className="mx-3 mb-4 flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px] text-ink-3 transition hover:border-gold/30 hover:text-ink">
        <ArrowLeft size={14} /> Back to the terminal
      </a>
      <a href="../#friends" className="mx-3 -mt-2 mb-4 flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px] text-ink-3 transition hover:border-gold/30 hover:text-ink">
        <Users size={14} /> Friends
      </a>
      <nav className="flex-1 space-y-1 px-3">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className="focus-ring group relative block rounded-xl">
            {({ isActive }) => (
              <div className={cx('relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] transition-colors', isActive ? 'text-ink' : 'text-ink-3 hover:text-ink')}>
                {isActive && (
                  <motion.div layoutId="nav-active" className="absolute inset-0 rounded-xl border border-gold/15 bg-gradient-to-r from-gold/[0.12] to-transparent" transition={{ type: 'spring', stiffness: 450, damping: 38 }}>
                    <div className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gold shadow-[0_0_12px_rgba(227,196,141,.8)]" />
                  </motion.div>
                )}
                <n.icon size={17} className={cx('relative', isActive && 'text-gold')} strokeWidth={1.8} />
                <span className="relative">{n.label}</span>
                {n.badge && leaks > 0 && <span className="relative ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-loss/15 px-1.5 text-[10px] font-semibold text-loss">{leaks}</span>}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 p-3">
        <NavLink to="/achievements" className="card block p-4 transition hover:border-gold/30">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-ink-3">Level {xp.level.level}</div>
              <div className="font-display text-xl leading-tight gold-text">{xp.level.title}</div>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-full border border-gold/30 bg-gold/10 font-display text-lg text-gold">{xp.level.level}</div>
          </div>
          <Bar value={xp.progress} className="mt-3" height={4} />
          <div className="num mt-1.5 flex justify-between text-[10px] text-ink-3">
            <span>{xp.xp.toLocaleString()} XP</span>
            <span>{xp.next ? `${xp.next.xp.toLocaleString()} XP` : 'Max'}</span>
          </div>
        </NavLink>
        <div className="flex items-center gap-1">
          <button onClick={togglePrivacy} className="focus-ring flex flex-1 items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] text-ink-3 hover:bg-white/5 hover:text-ink" title="Privacy mode (P)">
            {settings.privacy ? <EyeOff size={15} /> : <Eye size={15} />}
            {settings.privacy ? 'Amounts hidden' : 'Privacy mode'}
          </button>
          <NavLink to="/settings" className={({ isActive }) => cx('focus-ring rounded-xl p-2', isActive ? 'text-gold' : 'text-ink-3 hover:bg-white/5 hover:text-ink')} title="Settings">
            <Settings size={16} />
          </NavLink>
        </div>
      </div>
    </div>
  )

  return (
    <div className="relative z-10 flex min-h-full">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 border-r border-line bg-bg-0/60 backdrop-blur-xl lg:block">{sidebar}</aside>

      {/* mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div className="fixed inset-0 z-[60] lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur" onClick={() => setMobileOpen(false)} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', stiffness: 380, damping: 36 }} className="absolute left-0 top-0 h-full w-[270px] border-r border-line bg-bg-1">
              <button className="absolute right-3 top-6 rounded-full p-2 text-ink-3" onClick={() => setMobileOpen(false)}>
                <X size={18} />
              </button>
              {sidebar}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <header className="sticky top-0 z-40 border-b border-line bg-bg-0/70 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1480px] items-center gap-3 px-4 py-3 sm:px-8">
            <button className="rounded-xl p-2 text-ink-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu">
              <Menu size={20} />
            </button>
            <a href="../" className="lg:hidden" title="Back to the terminal">
              <Logo size={28} />
            </a>
            <button onClick={() => setCmdOpen(true)} className="focus-ring group hidden min-w-0 max-w-[340px] flex-1 items-center gap-2.5 rounded-full border border-line bg-white/[0.02] px-4 py-2 text-[13px] text-ink-3 transition hover:border-line-2 hover:text-ink-2 md:flex">
              <Search size={15} />
              <span className="truncate">Search trades, symbols, setups…</span>
              <kbd className="ml-auto rounded-md border border-line bg-bg-2 px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <div className="no-scrollbar hidden overflow-x-auto sm:block">
                <Segmented layoutId="range" size="sm" options={RANGES} value={filters.range} onChange={(range) => setFilters({ range })} />
              </div>
              <button onClick={() => setCmdOpen(true)} className="rounded-full p-2 text-ink-2 md:hidden" aria-label="Search">
                <Search size={18} />
              </button>
              <button onClick={togglePrivacy} className="rounded-full p-2 text-ink-2 hover:bg-white/5 lg:hidden" aria-label="Privacy">
                {settings.privacy ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
              <button
                onClick={() => setAddOpen(true)}
                className="focus-ring relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-gradient-to-b from-[#f4dfb4] to-[#c9a466] px-3.5 py-2 text-[13px] font-semibold text-[#1a1408] shadow-[0_8px_30px_-8px_rgba(227,196,141,.55),inset_0_1px_0_rgba(255,255,255,.5)] transition hover:brightness-110 sm:px-4"
              >
                <Plus size={16} strokeWidth={2.4} />
                <span className="hidden sm:inline">Log trade</span>
              </button>
            </div>
          </div>
          <div className="no-scrollbar overflow-x-auto px-4 pb-3 sm:hidden">
            <Segmented layoutId="range-m" size="sm" options={RANGES} value={filters.range} onChange={(range) => setFilters({ range })} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1480px] flex-1 px-4 pb-28 pt-6 sm:px-8 sm:pt-10 lg:pb-16">
          {load === 'login' && (
            <div className="mx-auto max-w-lg rounded-3xl border border-line bg-bg-1 p-8 text-center">
              <div className="font-display text-3xl">Log in first</div>
              <p className="mt-3 text-sm text-ink-3">The journal uses your Sweden account. Open the terminal, enter the passkey and log in, then come back.</p>
              <a href="../" className="mt-6 inline-block rounded-full bg-gold/15 px-5 py-2.5 text-sm font-medium text-gold">Open the terminal</a>
            </div>
          )}
          {load === 'error' && <div className="mx-auto max-w-lg rounded-2xl border border-loss/30 bg-loss/10 p-5 text-sm">The terminal did not answer. It retries every minute.</div>}
          {load === 'loading' && <div className="py-20 text-center text-sm text-ink-3">Loading your trades…</div>}
          {load === 'ready' && isDemo && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/25 bg-gold/[0.06] px-5 py-3 text-[13px]">
              <span>Demo journal (a made-up stock trader) - nothing here is yours and nothing is saved.</span>
              <button className="rounded-full border border-gold/40 px-3 py-1 text-gold" onClick={() => setDemo(false)}>Back to my trades</button>
            </div>
          )}
          {load === 'ready' && !isDemo && nTrades === 0 && (
            <div className="mx-auto mb-8 max-w-2xl rounded-3xl border border-line bg-bg-1 p-8 text-center">
              <div className="font-display text-3xl">No closed trades yet</div>
              <p className="mt-3 text-sm text-ink-3">
                {address
                  ? `Your wallet has ${openPositions} open position${openPositions === 1 ? '' : 's'} and no closed round trip yet. A trade appears here as soon as you have sold (almost) all of a coin.`
                  : 'Add your wallet in the terminal (Portfolio) - every coin you buy and sell then shows up here automatically, with its price path from the recorded pump.fun trades.'}{' '}
                You can also log trades by hand.
              </p>
              <div className="mt-6 flex justify-center gap-2">
                <a href="../#wallet" className="rounded-full bg-gold/15 px-5 py-2.5 text-sm font-medium text-gold">Open the portfolio</a>
                <button className="rounded-full border border-line px-5 py-2.5 text-sm text-ink-2" onClick={() => setDemo(true)}>Look at the demo</button>
              </div>
            </div>
          )}
          {load === 'ready' && (
          // fade in only: an exit animation (AnimatePresence mode="wait") got stuck at opacity 0 on the Journal page
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
            <Outlet />
          </motion.div>
          )}
        </main>

        {/* mobile tab bar */}
        <nav className="fixed inset-x-3 bottom-3 z-50 flex items-center justify-around rounded-2xl border border-line-2 bg-bg-2/90 px-1 py-1.5 shadow-2xl backdrop-blur-xl lg:hidden" style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom))' }}>
          {NAV.filter((n) => ['/', '/journal', '/edge', '/dream', '/achievements'].includes(n.to)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="flex-1">
              {({ isActive }) => (
                <div className={cx('relative flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[10px]', isActive ? 'text-gold' : 'text-ink-3')}>
                  {isActive && <motion.div layoutId="tab-active" className="absolute inset-0 rounded-xl bg-gold/10" />}
                  <n.icon size={19} strokeWidth={1.8} className="relative" />
                  <span className="relative">{n.label.split(' ')[0]}</span>
                </div>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onNewTrade={() => setAddOpen(true)} />
      <TradeForm open={addOpen} onClose={() => setAddOpen(false)} />
      {load === 'ready' && !isDemo && <UnlockToasts />}
      <TradeDrawer />
    </div>
  )
}
