import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Pause, Play, RotateCcw, Share2, Check, Lock, Pencil, CalendarClock, Hammer, Sparkles } from 'lucide-react'
import { useAnalytics } from '@/store/analytics'
import { useJournal, useSettings } from '@/store/useJournal'
import { Card, CardHeader, Money, Bar, Button, SectionTitle, cx, AnimatedNumber, usePrivacy } from '@/components/ui/primitives'
import { HouseScene, HOUSE_STAGES, STAGE_MONEY, houseProgress, stageFor } from '@/components/house/HouseScene'
import { EquityChart } from '@/components/charts/EquityChart'
import { ShareModal } from '@/components/ShareModal'
import { dateLong, money, monthYear, pct } from '@/lib/format'
import { dailyStats } from '@/lib/stats'

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function DreamHouse() {
  const { lifetime, all } = useAnalytics()
  const settings = useSettings()
  const isDemo = useJournal((s) => s.isDemo)
  const update = useJournal((s) => s.updateSettings)
  const privacy = usePrivacy()
  const curve = lifetime.curve
  const [idx, setIdx] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [share, setShare] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const raf = useRef(0)

  // ── journey replay
  useEffect(() => {
    if (!playing) return
    const dur = 14000
    const startIdx = idx == null || idx >= curve.length - 1 ? 0 : idx
    const t0 = performance.now() - (startIdx / (curve.length - 1)) * dur
    const tick = (now: number) => {
      const f = Math.min(1, (now - t0) / dur)
      const i = Math.round(f * (curve.length - 1))
      setIdx(i)
      if (f < 1) raf.current = requestAnimationFrame(tick)
      else setPlaying(false)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  const point = idx != null ? curve[idx] : curve[curve.length - 1]
  const cum = point ? point.cum : 0
  const p = houseProgress(clamp01(cum / settings.goalAmount))
  const mood = point ? clamp01(-point.drawdownPct / 0.14) : 0
  const stageIdx = stageFor(p)
  const current = HOUSE_STAGES[stageIdx]
  const livePct = houseProgress(clamp01(lifetime.summary.netPnl / settings.goalAmount))

  const reached = useMemo(
    () =>
      HOUSE_STAGES.map((s) => {
        const target = STAGE_MONEY[HOUSE_STAGES.indexOf(s)] * settings.goalAmount
        const pt = curve.find((c) => c.cum >= target && (s.at > 0 || c.tradeId))
        return { ...s, target, date: s.at === 0 ? curve[0]?.date : pt?.date }
      }),
    [curve, settings.goalAmount],
  )

  // ── projection at the last-90-session pace
  const projection = useMemo(() => {
    const days = dailyStats(all)
    const recent = days.slice(-90)
    const pace = recent.reduce((s, d) => s + d.pnl, 0) / Math.max(1, recent.length)
    const remaining = settings.goalAmount - lifetime.summary.netPnl
    if (remaining <= 0) return { done: true as const, pace }
    if (pace <= 0) return { done: false as const, pace, date: null, sessions: Infinity }
    const sessions = Math.ceil(remaining / pace)
    const d = new Date(lifetime.curve[lifetime.curve.length - 1]?.t ?? Date.now())
    let added = 0
    while (added < sessions) {
      d.setDate(d.getDate() + 1)
      if (!isDemo || (d.getDay() !== 0 && d.getDay() !== 6)) added++       // crypto trades every day
    }
    return { done: false as const, pace, date: d, sessions }
  }, [lifetime, all, settings.goalAmount, isDemo])

  const shareInput = useMemo(
    () => ({
      eyebrow: 'Dream house progress',
      title: `${settings.goalName} is ${Math.round(livePct * 100)}% built`,
      subtitle: `Stage: ${HOUSE_STAGES[stageFor(livePct)].name}`,
      stats: [
        { label: 'Funded', value: privacy ? `${Math.round(livePct * 100)}%` : money(lifetime.summary.netPnl, { compact: true }), tone: 'gold' as const },
        { label: 'Win rate', value: pct(lifetime.summary.winRate, 0) },
        { label: 'Profit factor', value: lifetime.summary.profitFactor.toFixed(2) },
      ],
      svg: svgRef.current,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [share],
  )

  return (
    <div className="space-y-6">
      <SectionTitle
        eyebrow="Your north star"
        title={
          <>
            The <span className="italic gold-text">{settings.goalName}</span>
          </>
        }
        right={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing((e) => !e)}>
              <Pencil size={14} /> Edit goal
            </Button>
            <Button variant="gold" onClick={() => (setIdx(null), setShare(true))}>
              <Share2 size={14} /> Share progress
            </Button>
          </div>
        }
      >
        Every profitable trade lays another board. The house is driven by your real cumulative net profit — scrub the timeline or replay your journey to watch it rise (and weather the storms of every drawdown).
      </SectionTitle>

      <AnimatePresence>
        {editing && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <Card className="grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noAnim>
              <label className="block">
                <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-ink-3">Goal name</span>
                <input className="focus-ring w-full rounded-xl border border-line bg-bg-1 px-3 py-2.5 text-sm" value={settings.goalName} onChange={(e) => update({ goalName: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-ink-3">Net profit needed ({settings.currency})</span>
                <input type="number" min={10} step={100} className="focus-ring num w-full rounded-xl border border-line bg-bg-1 px-3 py-2.5 text-sm" value={settings.goalAmount} onChange={(e) => update({ goalAmount: Math.max(10, +e.target.value || 0) })} />
              </label>
              <Button variant="gold" onClick={() => setEditing(false)}>
                <Check size={14} /> Done
              </Button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── The scene */}
      <Card className="overflow-hidden p-0">
        <div className="relative">
          <HouseScene svgRef={svgRef} progress={p} mood={mood} className="block h-auto w-full" />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-bg-0/80 to-transparent p-5 pb-16 sm:p-8">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold/80">
                Stage {stageIdx + 1} of {HOUSE_STAGES.length}
                {idx != null && point && <> · {dateLong(point.t)}</>}
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={current.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
                  <div className="mt-1 font-display text-3xl sm:text-5xl">{current.name}</div>
                  <div className="mt-1 max-w-sm text-xs text-ink-2 sm:text-sm">{current.desc}</div>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="text-right">
              <div className="font-display text-5xl leading-none gold-text sm:text-7xl">
                <AnimatedNumber value={p * 100} format={(v) => `${Math.round(v)}%`} duration={0.3} />
              </div>
              <div className={cx('num mt-1 text-xs text-ink-2 sm:text-sm', privacy && 'privacy-blur')}>
                {money(Math.max(0, cum))} / {money(settings.goalAmount, { compact: true })}
              </div>
            </div>
          </div>
          {mood > 0.3 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-info/30 bg-bg-0/80 px-4 py-1.5 text-xs text-info backdrop-blur">
              ⛈ Drawdown of {pct(point?.drawdownPct ?? 0)} — storms pass. Keep your process.
            </div>
          )}
        </div>

        {/* time machine */}
        <div className="border-t border-line bg-bg-1/60 p-4 sm:p-6">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <Button variant="gold" onClick={() => setPlaying((v) => !v)}>
              {playing ? <Pause size={14} /> : <Play size={14} />}
              {playing ? 'Pause' : idx != null && idx < curve.length - 1 ? 'Resume journey' : 'Replay my journey'}
            </Button>
            <Button variant="ghost" onClick={() => (setPlaying(false), setIdx(null))}>
              <RotateCcw size={14} /> Today
            </Button>
            <span className="ml-auto text-[11px] text-ink-3">Drag on the curve to travel in time</span>
          </div>
          <EquityChart curve={curve} height={190} showDrawdown={false} activeIndex={idx} stickyScrub onScrub={(i) => (setPlaying(false), setIdx(i))} milestones={HOUSE_STAGES.slice(1).map((s, i) => ({ amount: STAGE_MONEY[i + 1] * settings.goalAmount, label: s.name }))} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* stage timeline */}
        <Card className="lg:col-span-7">
          <CardHeader icon={<Hammer size={15} />} title="Construction log" subtitle="24 steps - many small ones early, so the first dollars count" />
          <div className="relative p-5 sm:p-6">
            <div className="absolute bottom-10 left-[39px] top-10 w-px bg-line sm:left-[43px]" />
            <div className="space-y-1">
              {reached.map((s, i) => {
                const done = !!s.date && livePct >= s.at
                const isCur = stageFor(livePct) === i
                return (
                  <motion.div key={s.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className={cx('relative flex items-center gap-4 rounded-2xl px-2 py-2.5', isCur && 'bg-gold/[0.06]')}>
                    <div className={cx('relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border text-xs', done ? 'border-gold/50 bg-bg-2 text-gold' : 'border-line bg-bg-1 text-ink-4', isCur && 'shadow-[0_0_0_4px_rgba(227,196,141,.12)]')}>{done ? <Check size={14} /> : <Lock size={12} />}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cx('text-sm font-medium', !done && 'text-ink-3')}>{s.name}</span>
                        {isCur && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold">Current</span>}
                      </div>
                      <div className="truncate text-[11.5px] text-ink-4">{s.desc}</div>
                    </div>
                    <div className="text-right">
                      <Money value={s.target} compact className={cx('text-[13px]', done ? 'text-ink-2' : 'text-ink-4')} />
                      <div className="text-[10.5px] text-ink-4">{done ? dateLong(s.date!) : `${pct(s.target / settings.goalAmount, s.target / settings.goalAmount < 0.01 ? 2 : s.target / settings.goalAmount < 0.1 ? 1 : 0)} of goal`}</div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </Card>

        <div className="space-y-6 lg:col-span-5">
          <Card className="p-6">
            <div className="flex items-center gap-2 text-[13px] text-ink-2">
              <CalendarClock size={15} className="text-gold" /> Projected key handover
            </div>
            {projection.done ? (
              <div className="mt-3 font-display text-4xl gold-text">Funded. Welcome home.</div>
            ) : projection.date ? (
              <>
                <div className="mt-3 font-display text-5xl leading-none">{monthYear(projection.date)}</div>
                <div className="mt-3 text-sm text-ink-3">
                  At your last-90-session pace of <Money value={projection.pace} className="text-ink-2" /> per session, about <span className="text-ink-2">{projection.sessions}</span> trading sessions to go.
                </div>
              </>
            ) : (
              <div className="mt-3 text-sm text-ink-3">Your recent pace is negative — focus on process, the projection returns once you are back above water.</div>
            )}
            <Bar value={livePct} className="mt-5" height={8} />
            <div className="mt-2 flex justify-between text-[11px] text-ink-3">
              <span>
                <Money value={lifetime.summary.netPnl} /> funded
              </span>
              <span>
                <Money value={Math.max(0, settings.goalAmount - lifetime.summary.netPnl)} /> to go
              </span>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-2 text-[13px] text-ink-2">
              <Sparkles size={15} className="text-gold" /> What one good habit is worth
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-3">Your Edge Report found leaks worth real money. Plug the biggest one and the house gets built faster — every avoided mistake is a board you never have to re-lay.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[0.1, 0.25].map((boost) => {
                const pace = projection.pace * (1 + boost)
                const remaining = Math.max(0, settings.goalAmount - lifetime.summary.netPnl)
                const sessions = pace > 0 ? Math.ceil(remaining / pace) : Infinity
                const saved = (projection.done ? 0 : (projection.sessions ?? 0)) - sessions
                return (
                  <div key={boost} className="rounded-2xl border border-line bg-white/[0.015] p-4">
                    <div className="text-[11px] text-ink-3">+{boost * 100}% better pace</div>
                    <div className="mt-1 font-display text-3xl">{isFinite(saved) && saved > 0 ? `${saved}` : '—'}</div>
                    <div className="text-[11px] text-ink-4">sessions sooner</div>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      </div>

      <ShareModal open={share} onClose={() => setShare(false)} input={share ? shareInput : null} slug="dream-house" />
    </div>
  )
}
