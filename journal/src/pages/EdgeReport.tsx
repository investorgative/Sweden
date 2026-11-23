import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Brain, Check, Clock, Lightbulb, Scale, Shield, Target, TrendingUp, Crosshair, Sparkles } from 'lucide-react'
import { useAnalytics } from '@/store/analytics'
import { useUI } from '@/store/useUI'
import { Card, Money, Pill, SectionTitle, cx, Bar, usePrivacy } from '@/components/ui/primitives'
import { EquityChart } from '@/components/charts/EquityChart'
import { equityCurve, sortByExit } from '@/lib/stats'
import { money } from '@/lib/format'
import type { Insight } from '@/lib/insights'

const CAT_ICON = { Psychology: Brain, Strategy: Target, Timing: Clock, Risk: Shield, Execution: Crosshair }
/** Leaks that can be simulated as "these trades never happened" (or capped at −1R). */
const SIMULATABLE = (i: Insight) => i.kind === 'leak' && !['capture', 'hold-losers', 'gave-back', 'daily-limit'].includes(i.id)

export function EdgeReport() {
  const { insights, trades, startEquity, summary, curve } = useAnalytics()
  const setDrill = useUI((s) => s.setDrill)
  const nav = useNavigate()
  const privacy = usePrivacy()
  const leaks = insights.filter((i) => i.kind === 'leak')
  const strengths = insights.filter((i) => i.kind !== 'leak')
  const sim = leaks.filter(SIMULATABLE)
  const [on, setOn] = useState<Set<string>>(() => new Set(sim.slice(0, 3).map((i) => i.id)))
  const [pledges, setPledges] = useState<Set<string>>(new Set())

  useEffect(() => {
    const el = location.hash.split('#')[2]
    if (el) setTimeout(() => document.getElementById(el)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400)
  }, [])

  const ghost = useMemo(() => {
    if (!on.size) return null
    const remove = new Set<string>()
    const cap = new Set<string>()
    for (const i of sim) {
      if (!on.has(i.id)) continue
      if (i.id === 'mistake-Moved stop' || i.id === 'mistake-Averaged down') i.tradeIds.forEach((id) => cap.add(id))
      else i.tradeIds.forEach((id) => remove.add(id))
    }
    const adjusted = sortByExit(trades)
      .filter((t) => !remove.has(t.id))
      .map((t) => (cap.has(t.id) && t.pnl < -t.risk ? { ...t, pnl: -t.risk } : t))
    return equityCurve(adjusted, startEquity)
  }, [on, sim, trades, startEquity])

  const ghostNet = ghost ? (ghost.length ? ghost[ghost.length - 1].equity : startEquity) - startEquity : summary.netPnl
  const delta = ghostNet - summary.netPnl
  const totalLeak = leaks.reduce((s, l) => s + Math.min(0, l.impact), 0)
  const cats = Object.entries(
    leaks.reduce<Record<string, number>>((m, l) => {
      m[l.category] = (m[l.category] ?? 0) + Math.min(0, l.impact)
      return m
    }, {}),
  ).sort((a, b) => a[1] - b[1])
  const maxCat = Math.max(1, ...cats.map((c) => Math.abs(c[1])))

  const drill = (i: Insight) => {
    setDrill({ label: i.title, ids: i.tradeIds })
    nav('/journal')
  }

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Weak-spot detection" title={<>Edge <span className="italic gold-text">Report</span></>}>
        {leaks.length} patterns are statistically costing you money, and {strengths.length} are working for you. Each finding comes from your own trades: timestamps, tags, sizing and excursions, compared with your baseline.
      </SectionTitle>

      {/* ── what-if */}
      <Card className="overflow-hidden">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_auto]">
          <div>
            <div className="text-[13px] text-ink-2">If you had plugged the selected leaks…</div>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <motion.span key={delta} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cx('num font-display text-[52px] leading-none sm:text-[64px]', delta >= 0 ? 'gold-text' : 'text-loss', privacy && 'privacy-blur')}>
                {money(delta, { sign: true })}
              </motion.span>
              <span className="text-sm text-ink-3">more net profit</span>
            </div>
            <div className="mt-2 text-xs text-ink-3">
              <Money value={summary.netPnl} /> actual → <Money value={ghostNet} className="text-info" /> simulated · dashed blue line
            </div>
          </div>
          <div className="flex max-w-xl flex-wrap content-start gap-2 lg:justify-end">
            {sim.map((i) => {
              const active = on.has(i.id)
              return (
                <button
                  key={i.id}
                  onClick={() => setOn((s) => {
                    const n = new Set(s)
                    if (n.has(i.id)) n.delete(i.id)
                    else n.add(i.id)
                    return n
                  })}
                  className={cx('focus-ring inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition', active ? 'border-info/40 bg-info/10 text-info' : 'border-line text-ink-3 hover:text-ink')}
                >
                  <span className={cx('grid h-3.5 w-3.5 place-items-center rounded-full border', active ? 'border-info bg-info text-bg-0' : 'border-ink-4')}>{active && <Check size={9} strokeWidth={3} />}</span>
                  {i.title.replace('Mistake: ', '').replace(/^./, (c) => c.toUpperCase())}
                </button>
              )
            })}
          </div>
        </div>
        <div className="px-2 pb-3 sm:px-4">
          <EquityChart curve={curve} ghost={ghost} ghostLabel="without selected leaks" height={300} showDrawdown={false} baseline={startEquity} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* ── leaks */}
        <div className="space-y-4 lg:col-span-8">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-3xl">Leaks</h2>
            <span className="text-xs text-ink-3">ranked by estimated cost</span>
          </div>
          {leaks.map((l, i) => (
            <InsightCard key={l.id} i={l} rank={i + 1} onDrill={() => drill(l)} />
          ))}
          {leaks.length === 0 && <Card className="p-8 text-center text-ink-3">No significant leaks — your process is clean.</Card>}
        </div>

        {/* ── side */}
        <div className="space-y-6 lg:col-span-4">
          <Card className="p-5 sm:p-6">
            <div className="text-[13px] text-ink-2">Where the money leaks</div>
            <Money value={totalLeak} className="mt-2 block font-display text-4xl text-loss" />
            <div className="mt-1 text-[11px] text-ink-4">Overlapping estimate — trades can appear in several leaks.</div>
            <div className="mt-5 space-y-3">
              {cats.map(([c, v]) => {
                const Icon = CAT_ICON[c as keyof typeof CAT_ICON] ?? Scale
                return (
                  <div key={c}>
                    <div className="mb-1 flex items-center justify-between text-[12.5px]">
                      <span className="flex items-center gap-2 text-ink-2">
                        <Icon size={13} className="text-gold" /> {c}
                      </span>
                      <Money value={v} compact className="text-loss" />
                    </div>
                    <Bar value={Math.abs(v) / maxCat} color="loss" height={4} />
                  </div>
                )
              })}
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-2 text-[13px] text-ink-2">
              <Lightbulb size={15} className="text-gold" /> Your rules for next week
            </div>
            <p className="mt-1 text-[11.5px] text-ink-4">Commit to them — tick each one you will follow.</p>
            <div className="mt-4 space-y-2">
              {leaks.slice(0, 5).map((l) => {
                const done = pledges.has(l.id)
                return (
                  <button
                    key={l.id}
                    onClick={() => setPledges((s) => {
                      const n = new Set(s)
                      if (n.has(l.id)) n.delete(l.id)
                      else n.add(l.id)
                      return n
                    })}
                    className={cx('flex w-full items-start gap-3 rounded-xl border p-3 text-left text-[12.5px] leading-relaxed transition', done ? 'border-profit/25 bg-profit/[0.05] text-ink' : 'border-line text-ink-2 hover:border-line-2')}
                  >
                    <span className={cx('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border', done ? 'border-profit bg-profit text-bg-0' : 'border-ink-4')}>{done && <Check size={11} strokeWidth={3} />}</span>
                    {l.action}
                  </button>
                )
              })}
            </div>
            {pledges.size > 0 && pledges.size === Math.min(5, leaks.length) && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex items-center gap-2 rounded-xl bg-gold/10 p-3 text-xs text-gold">
                <Sparkles size={14} /> Committed. Future you says thanks.
              </motion.div>
            )}
          </Card>
        </div>
      </div>

      {/* ── strengths */}
      <div>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-3xl">What is working</h2>
          <span className="text-xs text-ink-3">double down here</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {strengths.map((s, i) => (
            <Card key={s.id} delay={i * 0.04} className="p-5" onClick={() => drill(s)}>
              <div className="flex items-start justify-between gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-profit/10 text-profit">
                  <TrendingUp size={16} />
                </div>
                <Pill tone="profit">{s.metric.value}</Pill>
              </div>
              <div className="mt-4 text-[15px] font-medium leading-snug">{s.title}</div>
              <div className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">{s.detail}</div>
              <div className="mt-3 border-t border-line pt-3 text-[12px] text-ink-2">→ {s.action}</div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

function InsightCard({ i, rank, onDrill }: { i: Insight; rank: number; onDrill: () => void }) {
  const Icon = CAT_ICON[i.category] ?? Scale
  const sev = ['', 'Minor', 'Notable', 'Critical'][i.severity]
  return (
    <motion.div id={i.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: Math.min(0.5, rank * 0.05), ease: [0.16, 1, 0.3, 1] }}>
      <Card noAnim className={cx('overflow-hidden', i.severity === 3 && 'border-loss/25')}>
        {i.severity === 3 && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-loss/60 to-transparent" />}
        <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:p-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-ink-4">#{rank}</span>
              <Pill tone={i.severity === 3 ? 'loss' : i.severity === 2 ? 'gold' : 'neutral'}>{sev}</Pill>
              <Pill>
                <Icon size={11} /> {i.category}
              </Pill>
            </div>
            <div className="mt-3 text-lg font-medium leading-snug">{i.title}</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{i.detail}</p>
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-gold/15 bg-gold/[0.04] p-3 text-[12.5px] leading-relaxed text-ink-2">
              <Lightbulb size={14} className="mt-0.5 shrink-0 text-gold" /> {i.action}
            </div>
          </div>
          <div className="flex flex-row items-end justify-between gap-4 sm:flex-col sm:items-end sm:text-right">
            <div>
              <div className="text-[11px] text-ink-4">Estimated cost</div>
              <Money value={i.impact} sign className="font-display text-3xl text-loss" />
              <div className="mt-2 text-[11px] text-ink-4">{i.metric.label}</div>
              <div className="num text-sm font-medium">{i.metric.value}</div>
            </div>
            <button onClick={onDrill} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-ink-2 transition hover:border-gold/40 hover:text-gold">
              {i.tradeIds.length} trades <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
