import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUpRight, Flame, House, Quote, Radar, ShieldCheck, Target, TrendingDown, Trophy, Sparkles, MousePointerClick } from 'lucide-react'
import { useAnalytics } from '@/store/analytics'
import { useSettings } from '@/store/useJournal'
import { useUI } from '@/store/useUI'
import { Card, CardHeader, Money, Ring, Bar, InfoTip, Pill, cx, AnimatedNumber, usePrivacy } from '@/components/ui/primitives'
import { EquityChart } from '@/components/charts/EquityChart'
import { HouseScene, HOUSE_STAGES, STAGE_MONEY, houseProgress, stageFor } from '@/components/house/HouseScene'
import { PnlBars } from '@/components/charts/Bars'
import { MonthCalendar } from '@/components/charts/MonthCalendar'
import { TradePath } from '@/components/charts/TradePath'
import { Badge } from '@/components/Badge'
import { dateLong, dateShort, money, num, pct, rFmt, time } from '@/lib/format'
import { greeting, quoteOfTheDay } from '@/lib/quotes'
import { rOf, traderScore } from '@/lib/stats'
import { profitMilestones } from '@/lib/achievements'

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function Overview() {
  const { summary: s, curve, days, trades, insights, lifetime, latest, startEquity } = useAnalytics()
  const settings = useSettings()
  const openTrade = useUI((u) => u.openTrade)
  const privacy = usePrivacy()
  const [scrub, setScrub] = useState<number | null>(null)
  const q = quoteOfTheDay()

  const point = scrub != null ? curve[scrub] : curve[curve.length - 1]
  const lifetimeCum = point ? point.equity - settings.startingBalance : 0
  const houseP = houseProgress(clamp01(lifetimeCum / settings.goalAmount))
  const mood = point ? clamp01(-point.drawdownPct / 0.14) : 0
  const stage = HOUSE_STAGES[stageFor(houseP)]
  const nextStage = HOUSE_STAGES[Math.min(HOUSE_STAGES.length - 1, stageFor(houseP) + 1)]

  const lastDay = days[days.length - 1]
  const last30 = days.slice(-30)
  const score = traderScore(s)
  const leaks = insights.filter((i) => i.kind === 'leak').slice(0, 3)
  const recent = [...trades].slice(-6).reverse()
  const nextAch = lifetime.achievements
    .filter((a) => !a.unlocked)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 3)
  const milestones = useMemo(
    () =>
      profitMilestones(settings.goalAmount).map((amount) => ({
        amount: amount - (startEquity - settings.startingBalance),
        label: amount === settings.goalAmount ? `${settings.goalName}` : `${money(amount, { compact: true })} club`,
      })),
    [settings, startEquity],
  )

  const streak = s.currentStreak
  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ── Greeting */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold/80">
            {dateLong(new Date())}
          </motion.div>
          <h1 className="font-display text-[40px] leading-[1] tracking-tight sm:text-[56px]">
            {greeting()}, <span className="italic gold-text">{settings.traderName.split(' ')[0]}</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm text-ink-2">
            {lastDay ? (
              <>
                Last session ({dateShort(lastDay.date)}) closed <span className={cx('num font-medium', lastDay.pnl >= 0 ? 'text-profit' : 'text-loss', privacy && 'privacy-blur')}>{money(lastDay.pnl, { sign: true })}</span> over {lastDay.trades} {lastDay.trades === 1 ? "trade" : "trades"}. Your villa is{' '}
                <span className="text-gold">{Math.round(houseProgress(clamp01(lifetime.summary.netPnl / settings.goalAmount)) * 100)}% built</span> — keep stacking good process.
              </>
            ) : (
              'Log your first trade to start building.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={streak >= 0 ? 'profit' : 'loss'} className="py-1.5 text-xs">
            <Flame size={13} /> {Math.abs(streak)} {streak >= 0 ? 'win' : 'loss'} streak
          </Pill>
          <Pill tone="gold" className="py-1.5 text-xs">
            <ShieldCheck size={13} /> {pct(s.planAdherence, 0)} plan adherence
          </Pill>
          <Pill tone="info" className="py-1.5 text-xs">
            <Target size={13} /> {s.count} trades
          </Pill>
        </div>
      </div>

      {/* ── Hero: Equity + House */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card className="overflow-hidden xl:col-span-8">
          <div className="flex flex-col gap-5 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-7 sm:pt-7">
            <div>
              <div className="flex items-center gap-2 text-[13px] text-ink-2">
                Net P&amp;L <InfoTip text="Realised profit after fees for the selected date range." />
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-3">
                <Money value={s.netPnl} sign animated className="font-display text-[52px] leading-none tracking-tight sm:text-[68px]" />
                <span className={cx('num rounded-full px-2.5 py-1 text-xs font-semibold', s.returnPct >= 0 ? 'bg-profit/10 text-profit' : 'bg-loss/10 text-loss')}>{pct(s.returnPct, 1, true)}</span>
              </div>
              <div className="mt-2 text-xs text-ink-3">
                Equity <Money value={s.equity} className="text-ink-2" /> · {s.tradingDays} sessions · {num(s.totalR, 1)}R total
              </div>
            </div>
            <div className="grid grid-cols-3 gap-5 sm:gap-7">
              {[
                { l: 'Best day', v: s.bestDay?.pnl ?? 0 },
                { l: 'Worst day', v: s.worstDay?.pnl ?? 0 },
                { l: 'Avg / day', v: s.avgDailyPnl },
              ].map((x) => (
                <div key={x.l}>
                  <div className="text-[11px] text-ink-3">{x.l}</div>
                  <Money value={x.v} sign colored compact className="mt-1 block text-base font-semibold" />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 px-5 text-[11px] text-ink-4 sm:px-7">
            <MousePointerClick size={12} className="text-gold/70" /> Drag across the curve — the house rebuilds to that moment.
          </div>
          <div className="px-2 pb-3 sm:px-4">
            <EquityChart toggle curve={curve} height={360} onScrub={setScrub} milestones={milestones} baseline={startEquity} />
          </div>
        </Card>

        <Card className="flex flex-col overflow-hidden xl:col-span-4" delay={0.08}>
          <CardHeader
            icon={<House size={15} />}
            title="Dream house"
            subtitle={scrub != null && point ? `As of ${dateLong(point.t)}` : settings.goalName}
            right={
              <Link to="/dream" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-gold">
                Open <ArrowUpRight size={13} />
              </Link>
            }
          />
          <div className="relative mx-4 mt-4 min-h-[260px] flex-1 overflow-hidden rounded-2xl border border-line">
            <HouseScene progress={houseP} mood={mood} slice className="absolute inset-0 block h-full w-full" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg-0/90 to-transparent p-4 pt-10">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-gold/80">Stage {stageFor(houseP) + 1} / {HOUSE_STAGES.length}</div>
                  <div className="font-display text-2xl leading-tight">{stage.name}</div>
                </div>
                <div className="font-display text-4xl leading-none gold-text">
                  <AnimatedNumber value={houseP * 100} format={(v) => `${Math.round(v)}%`} duration={0.5} />
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-3 p-5 sm:p-6">
            <Bar value={houseP} height={7} />
            <div className="flex justify-between text-xs">
              <span className="text-ink-3">
                <Money value={Math.max(0, lifetimeCum)} className="text-ink" /> of <Money value={settings.goalAmount} compact />
              </span>
              <span className="text-ink-3">
                {houseP < 1 ? (
                  <>
                    <Money value={Math.max(0, settings.goalAmount * STAGE_MONEY[HOUSE_STAGES.indexOf(nextStage)] - lifetimeCum)} compact className="text-gold" /> to “{nextStage.name}”
                  </>
                ) : (
                  <span className="text-gold">Complete ✦</span>
                )}
              </span>
            </div>
            {mood > 0.3 && <div className="rounded-xl border border-info/20 bg-info/5 px-3 py-2 text-[11px] text-info">Storm clouds: you were {pct(point?.drawdownPct ?? 0)} off the peak here. Every house survives weather.</div>}
          </div>
        </Card>
      </div>

      {/* ── KPI tiles */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Card className="p-5" delay={0.05}>
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-ink-3">Win rate</div>
            <InfoTip text="Share of trades closed in profit. Read it together with payoff ratio — a 40% win rate is excellent with 2:1 winners." />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Ring value={s.winRate} size={58} stroke={5} color="#4fdc9c">
              <span className="num text-[11px] font-semibold">{Math.round(s.winRate * 100)}</span>
            </Ring>
            <div className="text-[11px] leading-relaxed text-ink-3">
              <div>
                <span className="text-profit">{s.wins}</span> wins
              </div>
              <div>
                <span className="text-loss">{s.losses}</span> losses
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-5" delay={0.1}>
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-ink-3">Profit factor</div>
            <InfoTip text="Gross profit ÷ gross loss. Above 1.5 is solid, above 2 is exceptional." />
          </div>
          <div className="num mt-3 font-display text-[40px] leading-none">{isFinite(s.profitFactor) ? num(s.profitFactor) : '∞'}</div>
          <Bar value={Math.min(1, (s.profitFactor - 0.5) / 2.5)} className="mt-3" height={4} color={s.profitFactor >= 1 ? 'profit' : 'loss'} />
        </Card>
        <Card className="p-5" delay={0.15}>
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-ink-3">Expectancy</div>
            <InfoTip text="Average result per trade. In R it shows edge independent of position size." />
          </div>
          <div className={cx('num mt-3 font-display text-[40px] leading-none', s.expectancyR >= 0 ? 'text-ink' : 'text-loss')}>{rFmt(s.expectancyR)}</div>
          <div className="mt-2 text-[11px] text-ink-3">
            <Money value={s.expectancy} sign colored /> per trade
          </div>
        </Card>
        <Card className="p-5" delay={0.2}>
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-ink-3">Avg win / loss</div>
            <InfoTip text="Payoff ratio — how much your average winner earns versus how much your average loser costs." />
          </div>
          <div className="num mt-3 font-display text-[40px] leading-none">{num(s.payoff)}</div>
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full">
            <motion.div className="bg-profit" initial={{ width: 0 }} animate={{ width: `${(s.avgWin / (s.avgWin + s.avgLoss || 1)) * 100}%` }} transition={{ duration: 1.2 }} />
            <div className="flex-1 bg-loss/80" />
          </div>
          <div className="mt-1.5 flex justify-between text-[10.5px]">
            <Money value={s.avgWin} compact className="text-profit" />
            <Money value={-s.avgLoss} compact className="text-loss" />
          </div>
        </Card>
        <Card className="p-5" delay={0.25}>
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-ink-3">Max drawdown</div>
            <TrendingDown size={13} className="text-loss/70" />
          </div>
          <div className="num mt-3 font-display text-[40px] leading-none text-loss">{pct(s.maxDrawdownPct, 1)}</div>
          <div className="mt-2 text-[11px] text-ink-3">
            Now {s.currentDrawdownPct < 0 ? <span className="text-loss">{pct(s.currentDrawdownPct)}</span> : <span className="text-profit">at peak ✦</span>} · RF {num(s.recoveryFactor, 1)}
          </div>
        </Card>
        <Card className="p-5" delay={0.3}>
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-ink-3">Trader score</div>
            <InfoTip text="Composite of win rate, profit factor, payoff, recovery, day consistency and plan adherence." />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Ring value={score.score / 100} size={58} stroke={5}>
              <span className="num font-display text-xl">{score.score}</span>
            </Ring>
            <div className="text-[11px] text-ink-3">{score.score >= 75 ? 'Elite' : score.score >= 60 ? 'Strong' : score.score >= 45 ? 'Developing' : 'Rebuilding'}</div>
          </div>
        </Card>
      </div>

      {/* ── Daily P&L + Weak spots */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card className="xl:col-span-8" delay={0.05}>
          <CardHeader title="Daily P&L" subtitle="Last 30 sessions" right={<span className="text-xs text-ink-3">{last30.filter((d) => d.pnl > 0).length} green · {last30.filter((d) => d.pnl < 0).length} red</span>} />
          <div className="px-4 pb-4 pt-3 sm:px-6">
            <PnlBars
              height={300}
              data={last30.map((d) => ({ key: d.date, value: d.pnl, label: dateLong(d.date + 'T12:00'), sub: `${d.trades} trades · ${d.wins}W ${d.losses}L · ${rFmt(d.r, 1)}` }))}
              xLabel={(d, i) => (i % 5 === 2 ? dateShort(d.key + 'T12:00') : null)}
            />
          </div>
        </Card>

        <Card className="flex flex-col xl:col-span-4" delay={0.1}>
          <CardHeader
            icon={<Radar size={15} />}
            title="Weak spots"
            subtitle="Ranked by what they cost you"
            right={
              <Link to="/edge" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-gold">
                Edge report <ArrowUpRight size={13} />
              </Link>
            }
          />
          <div className="flex-1 space-y-2.5 p-4 sm:p-5">
            {leaks.length === 0 && <div className="py-10 text-center text-sm text-ink-3">No significant leaks detected. Beautiful.</div>}
            {leaks.map((l, i) => (
              <Link key={l.id} to={`/edge#${l.id}`} className="group block rounded-2xl border border-line bg-white/[0.015] p-4 transition hover:border-loss/30 hover:bg-loss/[0.03]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-loss/10 font-mono text-[11px] text-loss">{i + 1}</span>
                    <div>
                      <div className="text-[13.5px] font-medium leading-snug group-hover:text-ink">{l.title}</div>
                      <div className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-ink-3">{l.action}</div>
                    </div>
                  </div>
                  <Money value={l.impact} sign compact className="shrink-0 text-[13px] font-semibold text-loss" />
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Calendar + recent trades */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Card className="p-5 sm:p-6 xl:col-span-5" delay={0.05}>
          <MonthCalendar days={days} compact />
        </Card>
        <Card className="xl:col-span-7" delay={0.1}>
          <CardHeader
            title="Recent trades"
            right={
              <Link to="/journal" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-gold">
                Journal <ArrowUpRight size={13} />
              </Link>
            }
          />
          <div className="divide-y divide-line px-2 pb-2 pt-2 sm:px-3">
            {recent.map((t) => {
              const r = rOf(t)
              return (
                <button key={t.id} onClick={() => openTrade(t.id)} className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.03] sm:grid-cols-[auto_1fr_120px_auto]">
                  <div className={cx('grid h-10 w-10 place-items-center rounded-xl border font-mono text-[10px] font-semibold', t.side === 'long' ? 'border-profit/20 bg-profit/5 text-profit' : 'border-loss/20 bg-loss/5 text-loss')}>{t.side === 'long' ? 'L' : 'S'}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{t.symbol}</span>
                      <span className="truncate text-xs text-ink-3">{t.setup}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-4">
                      {dateShort(t.exitTime)} · {time(t.entryTime)} · {t.emotion}
                      {t.mistakes.length > 0 && <span className="text-loss/80"> · {t.mistakes[0]}</span>}
                    </div>
                  </div>
                  <div className="hidden sm:block">{t.path && <TradePath path={t.path} height={34} compact />}</div>
                  <div className="text-right">
                    <Money value={t.pnl} sign colored className="block text-sm font-semibold" />
                    <span className={cx('num text-[11px]', r >= 0 ? 'text-profit/70' : 'text-loss/70')}>{rFmt(r, 1)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </Card>
      </div>

      {/* ── Motivation row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="relative overflow-hidden p-6 sm:p-8 lg:col-span-5" delay={0.05}>
          <Quote size={40} className="absolute right-6 top-6 text-gold/10" />
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold/70">Mindset of the day</div>
          <blockquote className="mt-4 font-display text-[28px] italic leading-[1.15] sm:text-[32px]">“{q.q}”</blockquote>
          <div className="mt-4 text-sm text-ink-3">— {q.a}</div>
        </Card>
        <Card className="lg:col-span-7" delay={0.1}>
          <CardHeader
            icon={<Trophy size={15} />}
            title="Almost there"
            subtitle="Achievements closest to unlocking"
            right={
              <Link to="/achievements" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-gold">
                All <ArrowUpRight size={13} />
              </Link>
            }
          />
          <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-6">
            {nextAch.map((a) => (
              <div key={a.id} className="rounded-2xl border border-line bg-white/[0.015] p-4">
                <Badge tier={a.tier} icon={a.icon} unlocked={false} progress={a.progress} size={54} />
                <div className="mt-3 text-sm font-medium">{a.name}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-ink-3">{a.description}</div>
                <Bar value={a.progress} className="mt-3" height={4} />
                <div className="num mt-1 text-[10px] text-ink-4">{Math.round(a.progress * 100)}%</div>
              </div>
            ))}
            {nextAch.length === 0 && (
              <div className="col-span-3 flex items-center gap-3 text-sm text-ink-2">
                <Sparkles className="text-gold" /> Every achievement unlocked. Legendary.
              </div>
            )}
          </div>
        </Card>
      </div>
      <div className="pt-2 text-center text-[11px] text-ink-4">Data through {dateLong(latest)} · {settings.currency}</div>
    </div>
  )
}
