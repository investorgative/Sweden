import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useAnalytics } from '@/store/analytics'
import { useUI } from '@/store/useUI'
import { Card, CardHeader, Money, Segmented, SectionTitle, StatLine, cx, Pill, Bar } from '@/components/ui/primitives'
import { EquityChart } from '@/components/charts/EquityChart'
import { HBars, PnlBars } from '@/components/charts/Bars'
import { Radar, Histogram, Scatter, HeatGrid, LineChart } from '@/components/charts/More'
import { duration, money, num, pct, rFmt, MONTHS } from '@/lib/format'
import { DAY_KEYS, groupStats, histogram, holdBucket, HOLD_ORDER, HOUR_KEYS, hourBucket, monthlyReturns, rOf, rolling, statOf, toDate, traderScore, WEEKDAYS, type GroupStat } from '@/lib/stats'
import type { Trade } from '@/data/types'

type Tab = 'overview' | 'setups' | 'time' | 'risk' | 'psychology'

export function Analytics() {
  const [tab, setTab] = useState<Tab>('overview')
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Dig deeper" title="Analytics" right={null}>
        Every number behind your edge. Click any bar, cell or dot to drill into the trades behind it.
      </SectionTitle>
      <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
        <Segmented
          layoutId="an-tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Statistics' },
            { value: 'setups', label: 'Setups & symbols' },
            { value: 'time', label: 'Timing' },
            { value: 'risk', label: 'Risk & R' },
            { value: 'psychology', label: 'Psychology' },
          ]}
        />
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
          {tab === 'overview' && <StatsTab />}
          {tab === 'setups' && <SetupsTab />}
          {tab === 'time' && <TimeTab />}
          {tab === 'risk' && <RiskTab />}
          {tab === 'psychology' && <PsychTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function useDrill() {
  const setDrill = useUI((s) => s.setDrill)
  const nav = useNavigate()
  return (label: string, ts: Trade[]) => {
    setDrill({ label, ids: ts.map((t) => t.id) })
    nav('/journal')
  }
}

// ───────────────────────── Statistics
function StatsTab() {
  const { summary: s, curve, trades, startEquity } = useAnalytics()
  const score = traderScore(s)
  const roll = useMemo(() => rolling(trades, 30), [trades])
  const months = useMemo(() => monthlyReturns(trades, startEquity), [trades, startEquity])
  const years = [...new Set(months.map((m) => m.key.slice(0, 4)))]
  const groups: { title: string; rows: [string, React.ReactNode, string?][] }[] = [
    {
      title: 'Performance',
      rows: [
        ['Net P&L', <Money value={s.netPnl} sign colored />],
        ['Gross profit', <Money value={s.grossProfit} className="text-profit" />],
        ['Gross loss', <Money value={-s.grossLoss} className="text-loss" />],
        ['Commissions & fees', <Money value={-s.fees} />],
        ['Return on start equity', pct(s.returnPct, 1, true)],
        ['Avg daily P&L', <Money value={s.avgDailyPnl} sign colored />],
      ],
    },
    {
      title: 'Edge',
      rows: [
        ['Win rate', pct(s.winRate), 'Winning trades ÷ all trades'],
        ['Profit factor', num(s.profitFactor), 'Gross profit ÷ gross loss'],
        ['Expectancy', <span>{rFmt(s.expectancyR)} · <Money value={s.expectancy} sign /></span>, 'Average outcome per trade'],
        ['Payoff ratio', num(s.payoff), 'Average win ÷ average loss'],
        ['SQN', num(s.sqn), 'System Quality Number (Van Tharp): mean R ÷ std R × √min(N,100). >2.5 is good, >3 excellent.'],
        ['Kelly %', pct(s.kelly), 'Theoretical optimal fraction. Most pros risk a fraction of Kelly.'],
      ],
    },
    {
      title: 'Risk',
      rows: [
        ['Max drawdown', <span className="text-loss">{pct(s.maxDrawdownPct)} · <Money value={s.maxDrawdown} /></span>],
        ['Current drawdown', pct(s.currentDrawdownPct)],
        ['Recovery factor', num(s.recoveryFactor), 'Net profit ÷ max drawdown'],
        ['Sharpe (ann.)', num(s.sharpe), 'Annualised mean daily return ÷ std. dev.'],
        ['Sortino (ann.)', num(s.sortino), 'Like Sharpe, but only penalises downside volatility'],
        ['Largest loss', <Money value={s.largestLoss} className="text-loss" />],
      ],
    },
    {
      title: 'Behaviour',
      rows: [
        ['Avg hold — winners', duration(s.avgHoldWin)],
        ['Avg hold — losers', duration(s.avgHoldLoss)],
        ['Max win streak', `${s.maxWinStreak} trades`],
        ['Max loss streak', `${s.maxLossStreak} trades`],
        ['Green days', `${s.greenDays} / ${s.tradingDays} (${pct(s.dayWinRate, 0)})`],
        ['Plan adherence', pct(s.planAdherence)],
      ],
    },
  ]
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-4">
          <CardHeader title="Trader score" subtitle="Six dimensions of a durable edge" />
          <div className="flex flex-col items-center p-5">
            <Radar parts={score.parts.map((p) => ({ key: p.key, value: p.value }))} />
            <div className="mt-2 font-display text-6xl gold-text">{score.score}</div>
            <div className="text-xs text-ink-3">out of 100</div>
          </div>
        </Card>
        <div className="grid gap-6 sm:grid-cols-2 lg:col-span-8">
          {groups.map((g, gi) => (
            <Card key={g.title} delay={gi * 0.05} className="px-5 py-4">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold/70">{g.title}</div>
              <div className="divide-y divide-line">
                {g.rows.map(([l, v, h]) => (
                  <StatLine key={l} label={l} value={v} hint={h} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader title="Equity & underwater curve" subtitle="Hover to inspect any trade" />
        <div className="px-2 pb-3 sm:px-4">
          <EquityChart toggle curve={curve} height={340} baseline={startEquity} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Rolling 30-trade win rate" subtitle="Is your edge stable, improving or decaying?" />
          <div className="p-4">
            <LineChart height={220} yFormat={(v) => pct(v, 0)} refLine={s.winRate} series={[{ key: 'Win rate', color: '#4fdc9c', values: roll.map((r) => ({ x: r.i, y: r.winRate })) }]} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Rolling 30-trade expectancy" subtitle="Average R per trade over the last 30" />
          <div className="p-4">
            <LineChart height={220} yFormat={(v) => rFmt(v, 1)} refLine={0} series={[{ key: 'Expectancy', color: '#e3c48d', values: roll.map((r) => ({ x: r.i, y: r.expectancyR })) }]} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Monthly returns" subtitle="% of equity at the start of each month" />
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[720px] text-center text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-ink-4">
                <th className="pb-2 text-left font-medium">Year</th>
                {MONTHS.map((m) => (
                  <th key={m} className="pb-2 font-medium">
                    {m}
                  </th>
                ))}
                <th className="pb-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const ym = months.filter((m) => m.key.startsWith(y))
                const tot = ym.reduce((a, m) => a * (1 + m.ret), 1) - 1
                return (
                  <tr key={y}>
                    <td className="py-1 pr-2 text-left font-display text-lg text-ink-2">{y}</td>
                    {MONTHS.map((_, mi) => {
                      const m = ym.find((x) => +x.key.slice(5) === mi + 1)
                      const inten = m ? Math.min(1, Math.abs(m.ret) / 0.25) : 0
                      return (
                        <td key={mi} className="p-0.5">
                          <div className="num rounded-lg py-2 font-medium" style={{ background: m ? (m.ret >= 0 ? `rgba(79,220,156,${0.08 + inten * 0.5})` : `rgba(255,107,127,${0.08 + inten * 0.5})`) : 'rgba(255,255,255,.02)', color: m ? '#f4efe6' : '#46443f' }}>
                            {m ? pct(m.ret, 1, true) : '—'}
                          </div>
                        </td>
                      )
                    })}
                    <td className={cx('num px-2 font-semibold', tot >= 0 ? 'text-profit' : 'text-loss')}>{pct(tot, 1, true)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ───────────────────────── Setups & symbols
function SortableTable({ rows, onRow }: { rows: GroupStat[]; onRow: (k: string) => void }) {
  const [sort, setSort] = useState<{ k: keyof GroupStat; dir: 1 | -1 }>({ k: 'pnl', dir: -1 })
  const sorted = [...rows].sort((a, b) => ((a[sort.k] as number) > (b[sort.k] as number) ? 1 : -1) * sort.dir)
  const cols: [keyof GroupStat, string][] = [
    ['count', 'Trades'],
    ['winRate', 'Win %'],
    ['profitFactor', 'PF'],
    ['avgR', 'Avg R'],
    ['totalR', 'Total R'],
    ['pnl', 'Net P&L'],
  ]
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-4">
            <th className="py-3 pl-5 text-left font-medium">Name</th>
            {cols.map(([k, l]) => (
              <th key={k} className="px-3 py-3 text-right font-medium">
                <button onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))} className={cx('inline-flex items-center gap-1 hover:text-ink', sort.k === k && 'text-gold')}>
                  {l}
                  {sort.k === k && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </button>
              </th>
            ))}
            <th className="w-[120px] pr-5" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} onClick={() => onRow(r.key)} className="cursor-pointer border-b border-line/60 transition hover:bg-white/[0.025]">
              <td className="py-3 pl-5 font-medium">{r.key}</td>
              <td className="num px-3 text-right text-ink-2">{r.count}</td>
              <td className="num px-3 text-right text-ink-2">{pct(r.winRate, 0)}</td>
              <td className={cx('num px-3 text-right', r.profitFactor >= 1 ? 'text-ink-2' : 'text-loss')}>{r.profitFactor >= 99 ? '∞' : num(r.profitFactor)}</td>
              <td className={cx('num px-3 text-right', r.avgR >= 0 ? 'text-profit' : 'text-loss')}>{rFmt(r.avgR)}</td>
              <td className={cx('num px-3 text-right', r.totalR >= 0 ? 'text-profit/80' : 'text-loss/80')}>{rFmt(r.totalR, 1)}</td>
              <td className="px-3 text-right">
                <Money value={r.pnl} sign colored className="font-semibold" />
              </td>
              <td className="pr-5">
                <Bar value={r.winRate} height={4} color={r.avgR >= 0 ? 'profit' : 'loss'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SetupsTab() {
  const { trades } = useAnalytics()
  const drill = useDrill()
  const setups = groupStats(trades, (t) => t.setup)
  const symbols = groupStats(trades, (t) => t.symbol).sort((a, b) => b.pnl - a.pnl)
  const sides = groupStats(trades, (t) => t.side)
  const assets = groupStats(trades, (t) => t.assetClass).sort((a, b) => b.pnl - a.pnl)
  const tags = groupStats(trades.filter((t) => t.tags.length), (t) => t.tags).sort((a, b) => b.avgR - a.avgR)
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Playbook performance" subtitle="Sort any column · click a row to open those trades" />
        <div className="pt-3">
          <SortableTable rows={setups} onRow={(k) => drill(`Setup: ${k}`, trades.filter((t) => t.setup === k))} />
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top symbols" subtitle="By net P&L" />
          <div className="p-5">
            <HBars data={symbols.slice(0, 8).map((s) => ({ key: s.key, value: s.pnl, sub: `${s.count} · ${pct(s.winRate, 0)}` }))} onSelect={(k) => drill(`Symbol: ${k}`, trades.filter((t) => t.symbol === k))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Worst symbols" subtitle="Where you give money back" />
          <div className="p-5">
            <HBars data={symbols.slice(-8).reverse().map((s) => ({ key: s.key, value: s.pnl, sub: `${s.count} · ${pct(s.winRate, 0)}` }))} onSelect={(k) => drill(`Symbol: ${k}`, trades.filter((t) => t.symbol === k))} />
          </div>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Long vs short" />
          <div className="grid grid-cols-2 gap-3 p-5">
            {sides.map((s) => (
              <button key={s.key} onClick={() => drill(`Side: ${s.key}`, trades.filter((t) => t.side === s.key))} className="rounded-2xl border border-line bg-white/[0.015] p-4 text-left transition hover:border-line-2">
                <Pill tone={s.key === 'long' ? 'profit' : 'loss'}>{s.key.toUpperCase()}</Pill>
                <Money value={s.pnl} sign colored compact className="mt-3 block font-display text-3xl" />
                <div className="mt-2 space-y-0.5 text-[11px] text-ink-3">
                  <div>
                    {s.count} trades · {pct(s.winRate, 0)} win
                  </div>
                  <div>
                    {rFmt(s.avgR)} avg · PF {num(s.profitFactor)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Asset classes" />
          <div className="p-5">
            <HBars data={assets.map((s) => ({ key: s.key, value: s.pnl, sub: `${s.count}` }))} onSelect={(k) => drill(`Asset: ${k}`, trades.filter((t) => t.assetClass === k))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Tags" subtitle="Average R by tag" />
          <div className="p-5">
            <HBars format={(v) => rFmt(v)} data={tags.slice(0, 8).map((s) => ({ key: `#${s.key}`, value: s.avgR, sub: `${s.count}` }))} onSelect={(k) => drill(`Tag: ${k}`, trades.filter((t) => t.tags.includes(k.slice(1))))} />
          </div>
        </Card>
      </div>
    </div>
  )
}

// ───────────────────────── Timing
function TimeTab() {
  const { trades } = useAnalytics()
  const drill = useDrill()
  const [metric, setMetric] = useState<'r' | 'pnl' | 'wr'>('r')
  const days = DAY_KEYS()
  const hours = HOUR_KEYS()
  const grid = useMemo(() => {
    const m = new Map<string, Trade[]>()
    for (const t of trades) {
      const k = `${WEEKDAYS[toDate(t.entryTime).getDay()]}|${hourBucket(t)}`
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(t)
    }
    return m
  }, [trades])
  const wd = days.map((d) => statOf(d, trades.filter((t) => WEEKDAYS[toDate(t.entryTime).getDay()] === d)))
  const hr = hours.map((h) => statOf(h, trades.filter((t) => hourBucket(t) === h)))
  const hold = HOLD_ORDER.map((h) => statOf(h, trades.filter((t) => holdBucket(t) === h)))
  const val = (g: GroupStat) => (metric === 'r' ? g.avgR : metric === 'pnl' ? g.pnl : g.winRate - 0.5)
  const fmt = (v: number) => (metric === 'r' ? rFmt(v, 2) : metric === 'pnl' ? money(v, { compact: true, sign: true }) : pct(v + 0.5, 0))
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="When you make (and lose) money"
          subtitle="Weekday × entry hour"
          right={<Segmented layoutId="hm-metric" size="sm" value={metric} onChange={setMetric} options={[{ value: 'r', label: 'Avg R' }, { value: 'pnl', label: 'P&L' }, { value: 'wr', label: 'Win %' }]} />}
        />
        <div className="p-5">
          <HeatGrid
            rows={days}
            cols={hours}
            format={fmt}
            cell={(r, c) => {
              const ts = grid.get(`${r}|${c}`)
              if (!ts || ts.length < 3) return null
              const g = statOf('', ts)
              return { value: val(g), count: g.count }
            }}
            onSelect={(r, c) => drill(`${r} ${c}`, grid.get(`${r}|${c}`) ?? [])}
          />
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-3">
        {[
          { title: 'By weekday', data: wd },
          { title: 'By entry hour', data: hr },
          { title: 'By holding time', data: hold },
        ].map((b) => (
          <Card key={b.title}>
            <CardHeader title={b.title} subtitle="Net P&L · hover for details" />
            <div className="p-4">
              <PnlBars
                height={210}
                showAxis={false}
                data={b.data.map((g) => ({ key: g.key, value: g.pnl, sub: `${g.count} trades · ${pct(g.winRate, 0)} win · ${rFmt(g.avgR)}` }))}
                xLabel={(d) => d.key}
                onSelect={(d) => drill(`${b.title.replace('By ', '')}: ${d.key}`, trades.filter((t) => (b.title === 'By weekday' ? WEEKDAYS[toDate(t.entryTime).getDay()] : b.title === 'By entry hour' ? hourBucket(t) : holdBucket(t)) === d.key))}
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ───────────────────────── Risk & R
function RiskTab() {
  const { trades, summary: s } = useAnalytics()
  const openTrade = useUI((u) => u.openTrade)
  const rs = trades.map(rOf)
  const bins = histogram(rs, 0.5, -3, 6)
  const [mode, setMode] = useState<'mae' | 'mfe'>('mfe')
  const pts = trades.map((t) => ({ id: t.id, x: mode === 'mae' ? t.mae : t.mfe, y: rOf(t), win: t.pnl > 0 }))
  const sizes = useMemo(() => {
    const sorted = [...trades].sort((a, b) => a.risk - b.risk)
    const q = Math.ceil(sorted.length / 4)
    return [0, 1, 2, 3].map((i) => statOf(['Smallest 25%', 'Small-mid', 'Mid-large', 'Largest 25%'][i], sorted.slice(i * q, (i + 1) * q)))
  }, [trades])
  const beyond = trades.filter((t) => rOf(t) < -1.1)
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: 'Avg R per trade', v: rFmt(s.expectancyR), c: s.expectancyR >= 0 ? 'text-profit' : 'text-loss' },
          { l: 'Total R', v: rFmt(s.totalR, 1), c: 'text-ink' },
          { l: 'MFE capture', v: pct(s.avgMfeCapture, 0), c: 'text-gold' },
          { l: 'Losses beyond −1R', v: `${beyond.length} (${pct(beyond.length / Math.max(1, s.losses), 0)} of losers)`, c: beyond.length ? 'text-loss' : 'text-profit' },
        ].map((x, i) => (
          <Card key={x.l} className="p-5" delay={i * 0.04}>
            <div className="text-[12px] text-ink-3">{x.l}</div>
            <div className={cx('num mt-2 font-display text-3xl', x.c)}>{x.v}</div>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="R-multiple distribution" subtitle="Healthy systems: losses capped near −1R, a long right tail" />
          <div className="p-5">
            <Histogram bins={bins} height={260} label={(b) => `${b.x0}R to ${b.x1}R`} />
          </div>
        </Card>
        <Card>
          <CardHeader
            title={mode === 'mfe' ? 'MFE vs realised R' : 'MAE vs realised R'}
            subtitle={mode === 'mfe' ? 'Dots far below the diagonal = profit left on the table' : 'Winners with deep MAE = entries too early'}
            right={<Segmented layoutId="sc-mode" size="sm" value={mode} onChange={setMode} options={[{ value: 'mfe', label: 'MFE' }, { value: 'mae', label: 'MAE' }]} />}
          />
          <div className="p-4">
            <Scatter points={pts} height={280} xLabel={mode === 'mfe' ? 'MFE (R)' : 'MAE (R)'} yLabel="Realised (R)" onSelect={openTrade} />
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Does size change your results?" subtitle="Trades bucketed by dollar risk" />
        <div className="grid gap-4 p-5 sm:grid-cols-4">
          {sizes.map((g) => (
            <div key={g.key} className="rounded-2xl border border-line bg-white/[0.015] p-4">
              <div className="text-[11px] text-ink-3">{g.key}</div>
              <div className={cx('num mt-2 font-display text-3xl', g.avgR >= 0 ? 'text-profit' : 'text-loss')}>{rFmt(g.avgR)}</div>
              <div className="mt-1 text-[11px] text-ink-4">
                {pct(g.winRate, 0)} win · <Money value={g.pnl} compact sign />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ───────────────────────── Psychology
function PsychTab() {
  const { trades: allTrades } = useAnalytics()
  const drill = useDrill()
  const trades = allTrades.filter((t) => t.logged !== false)  // psychology: only trades with your own entries
  const emo = groupStats(trades, (t) => t.emotion).sort((a, b) => b.avgR - a.avgR)
  const mistakes = groupStats(trades.filter((t) => t.mistakes.length), (t) => t.mistakes).sort((a, b) => a.pnl - b.pnl)
  const kept = statOf('Plan kept', trades.filter((t) => t.followedPlan))
  const broke = statOf('Rules broken', trades.filter((t) => !t.followedPlan))
  const ratings = [1, 2, 3, 4, 5].map((r) => statOf(`${r}★`, trades.filter((t) => t.rating === r)))
  const afterLoss = useMemo(() => {
    const s = [...allTrades].sort((a, b) => (a.exitTime < b.exitTime ? -1 : 1))
    const after: Trade[] = []
    const afterWin: Trade[] = []
    for (let i = 1; i < s.length; i++) (s[i - 1].pnl < 0 ? after : afterWin).push(s[i])
    return { loss: statOf('After a loss', after), win: statOf('After a win', afterWin) }
  }, [allTrades])
  const unlogged = allTrades.length - trades.length
  return (
    <div className="space-y-6">
      {unlogged > 0 && (
        <div className="rounded-2xl border border-gold/20 bg-gold/[0.05] px-5 py-3 text-[13px] text-ink-2">
          {trades.length} of {allTrades.length} trades have your own entries (emotion, plan, mistakes, rating). The {unlogged} others are left out of
          the psychology stats below - open a trade and press the pencil to log it.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="The discipline dividend" subtitle="Rule-following vs rule-breaking trades" />
          <div className="grid grid-cols-2 gap-4 p-5">
            {[kept, broke].map((g, i) => (
              <button key={g.key} onClick={() => drill(g.key, trades.filter((t) => t.followedPlan === (i === 0)))} className={cx('rounded-2xl border p-5 text-left transition hover:-translate-y-0.5', i === 0 ? 'border-profit/20 bg-profit/[0.04]' : 'border-loss/20 bg-loss/[0.04]')}>
                <div className={cx('text-[11px] font-semibold uppercase tracking-wider', i === 0 ? 'text-profit' : 'text-loss')}>{g.key}</div>
                <div className={cx('num mt-2 font-display text-4xl', g.avgR >= 0 ? 'text-ink' : 'text-loss')}>{rFmt(g.avgR)}</div>
                <div className="mt-1 text-[11px] text-ink-3">per trade · {pct(g.winRate, 0)} win · {g.count} trades</div>
                <Money value={g.pnl} sign colored className="mt-3 block text-lg font-semibold" />
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Momentum of emotions" subtitle="How you trade right after a win vs a loss" />
          <div className="grid grid-cols-2 gap-4 p-5">
            {[afterLoss.win, afterLoss.loss].map((g) => (
              <div key={g.key} className="rounded-2xl border border-line bg-white/[0.015] p-5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{g.key}</div>
                <div className={cx('num mt-2 font-display text-4xl', g.avgR >= 0 ? 'text-ink' : 'text-loss')}>{rFmt(g.avgR)}</div>
                <div className="mt-1 text-[11px] text-ink-3">
                  {pct(g.winRate, 0)} win · {g.count} trades
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Emotional state" subtitle="Average R by pre-trade emotion" />
          <div className="p-5">
            <HBars format={(v) => rFmt(v)} data={emo.map((g) => ({ key: g.key, value: g.avgR, sub: `${g.count}` }))} onSelect={(k) => drill(`Emotion: ${k}`, trades.filter((t) => t.emotion === k))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Cost of mistakes" subtitle="Net P&L of trades tagged with each mistake" />
          <div className="p-5">
            <HBars data={mistakes.map((g) => ({ key: g.key, value: g.pnl, sub: `${g.count}×` }))} onSelect={(k) => drill(`Mistake: ${k}`, trades.filter((t) => t.mistakes.includes(k as never)))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Self-rating vs results" subtitle="Do your execution grades match reality?" />
          <div className="p-4">
            <PnlBars height={220} showAxis={false} format={(v) => rFmt(v)} data={ratings.map((g) => ({ key: g.key, value: g.avgR, sub: `${g.count} trades · ${pct(g.winRate, 0)} win` }))} xLabel={(d) => d.key} />
          </div>
        </Card>
      </div>
    </div>
  )
}
