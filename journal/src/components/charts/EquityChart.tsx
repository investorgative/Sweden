import { useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { scaleLinear, scaleTime } from 'd3-scale'
import { area, line, curveMonotoneX } from 'd3-shape'
import { bisector } from 'd3-array'
import type { EquityPoint } from '@/data/types'
import { useMeasure } from './useMeasure'
import { dateLong, money, MONTHS, pct } from '@/lib/format'
import { Segmented, usePrivacy } from '@/components/ui/primitives'
import { useUI } from '@/store/useUI'

export interface EquityChartProps {
  curve: EquityPoint[]
  height?: number
  /** Called with the scrubbed index (null when released) */
  onScrub?: (i: number | null) => void
  milestones?: { amount: number; label: string }[]
  baseline?: number
  showDrawdown?: boolean
  ghost?: EquityPoint[] | null
  ghostLabel?: string
  /** keeps the cursor parked on this index (e.g. when parent scrubber is used) */
  activeIndex?: number | null
  stickyScrub?: boolean
}

const bis = bisector<EquityPoint, number>((d) => d.t).center

/** The equity chart with an Equity / Profit switch (profit = the result since the start of the curve, from 0). */
export function EquityChart(props: EquityChartProps & { toggle?: boolean }) {
  const { toggle = false, ...rest } = props
  const mode = useUI((s) => s.curveMode)
  const setMode = useUI((s) => s.setCurveMode)
  const profit = toggle && mode === 'profit'
  const shift = props.baseline ?? props.curve[0]?.equity ?? 0
  const curve = useMemo(() => (profit ? props.curve.map((p) => ({ ...p, equity: p.equity - shift, peak: p.peak - shift })) : props.curve), [profit, props.curve, shift])
  const ghost = useMemo(() => (profit && props.ghost ? props.ghost.map((p) => ({ ...p, equity: p.equity - shift, peak: p.peak - shift })) : props.ghost), [profit, props.ghost, shift])
  if (!toggle) return <EquityChartBase {...rest} />
  return (
    <div>
      <div className="flex justify-end px-2 pb-1">
        <Segmented
          layoutId={`curve-${props.height ?? 0}`}
          size="sm"
          options={[
            { value: 'equity', label: 'Equity' },
            { value: 'profit', label: 'Profit' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      <EquityChartBase {...rest} curve={curve} ghost={ghost} baseline={profit ? 0 : props.baseline} />
    </div>
  )
}

function EquityChartBase({ curve, height = 340, onScrub, milestones = [], baseline, showDrawdown = true, ghost, ghostLabel = 'What-if', activeIndex, stickyScrub }: EquityChartProps) {
  const [ref, { width }] = useMeasure<HTMLDivElement>()
  const id = useId().replace(/:/g, '')
  const privacy = usePrivacy()
  const [hover, setHover] = useState<number | null>(null)
  const dragging = useRef(false)
  const idx = stickyScrub ? (activeIndex ?? null) : (hover ?? activeIndex ?? null)

  const m = { top: 18, right: 64, bottom: 28, left: 8 }
  const ddH = showDrawdown ? Math.round(height * 0.2) : 0
  const gap = showDrawdown ? 18 : 0
  const innerW = Math.max(10, width - m.left - m.right)
  const mainH = height - m.top - m.bottom - ddH - gap

  const { x, y, yDD, pathLine, pathArea, ghostLine, ddArea, ticksY, ticksX, base } = useMemo(() => {
    const pts = curve.length ? curve : [{ t: Date.now(), equity: 0, drawdownPct: 0 } as EquityPoint]
    const all = ghost ? [...pts, ...ghost] : pts
    const t0 = pts[0].t
    const t1 = pts[pts.length - 1].t
    const x = scaleTime().domain([t0, t1 === t0 ? t0 + 1 : t1]).range([0, innerW])
    let lo = Math.min(...all.map((p) => p.equity))
    let hi = Math.max(...all.map((p) => p.equity))
    const base = baseline ?? pts[0].equity
    lo = Math.min(lo, base)
    const pad = (hi - lo) * 0.08 || 100
    const y = scaleLinear().domain([lo - pad, hi + pad]).range([mainH, 0]).nice(5)
    const minDD = Math.min(-0.02, ...pts.map((p) => p.drawdownPct))
    const yDD = scaleLinear().domain([minDD * 1.1, 0]).range([ddH, 0])
    const l = line<EquityPoint>().x((d) => x(d.t)).y((d) => y(d.equity)).curve(curveMonotoneX)
    const a = area<EquityPoint>().x((d) => x(d.t)).y0(mainH).y1((d) => y(d.equity)).curve(curveMonotoneX)
    const dd = area<EquityPoint>().x((d) => x(d.t)).y0(0).y1((d) => yDD(d.drawdownPct)).curve(curveMonotoneX)
    const months: Date[] = []
    const s = new Date(t0)
    s.setDate(1)
    s.setMonth(s.getMonth() + 1)
    for (let d = new Date(s); d.getTime() <= t1; d.setMonth(d.getMonth() + 1)) months.push(new Date(d))
    const every = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(innerW / 90))))
    return {
      x,
      y,
      yDD,
      base,
      pathLine: l(pts) ?? '',
      pathArea: a(pts) ?? '',
      ghostLine: ghost ? l(ghost) ?? '' : '',
      ddArea: dd(pts) ?? '',
      ticksY: y.ticks(5),
      ticksX: months.filter((_, i) => i % every === 0),
    }
  }, [curve, ghost, innerW, mainH, ddH, baseline])

  // milestone crossing points
  const flags = useMemo(() => {
    return milestones
      .map((ms) => {
        const target = base + ms.amount
        const p = curve.find((c) => c.equity >= target)
        return { ...ms, target, point: p }
      })
      .filter((f) => y(f.target) >= -4 && y(f.target) <= mainH)
      .filter((f, i, arr) => i === arr.length - 1 || Math.abs(y(f.target) - y(arr[i + 1].target)) > 16)
  }, [milestones, curve, base, y, mainH])

  const handle = (e: RPointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect()
    const px = e.clientX - r.left
    const t = x.invert(Math.max(0, Math.min(innerW, px))).getTime()
    const i = bis(curve, t)
    setHover(i)
    onScrub?.(i)
  }
  const leave = () => {
    dragging.current = false
    if (stickyScrub) return
    setHover(null)
    onScrub?.(null)
  }

  const p = idx != null ? curve[idx] : null
  const cx = p ? x(p.t) : innerW
  const cy = p ? y(p.equity) : 0
  const tooltipLeft = p ? Math.min(Math.max(cx + m.left - 100, 0), Math.max(0, width - 210)) : 0

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="overflow-visible">
          <defs>
            <linearGradient id={`ga-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e3c48d" stopOpacity="0.32" />
              <stop offset="55%" stopColor="#e3c48d" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#e3c48d" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`gl-${id}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#9c7a45" />
              <stop offset="50%" stopColor="#e3c48d" />
              <stop offset="100%" stopColor="#f7e6c1" />
            </linearGradient>
            <linearGradient id={`gd-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ff6b7f" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#ff6b7f" stopOpacity="0.45" />
            </linearGradient>
            <clipPath id={`clip-${id}`}>
              <motion.rect x={-4} y={-20} height={mainH + 40} initial={false} animate={{ width: cx + 4 }} transition={{ type: 'spring', stiffness: 600, damping: 50 }} />
            </clipPath>
            <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g transform={`translate(${m.left},${m.top})`}>
            {/* grid */}
            {ticksY.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x1={0} x2={innerW} stroke="rgba(255,255,255,.045)" />
                <text x={innerW + 12} dy="0.32em" className="fill-ink-3 text-[10px] num" style={{ filter: privacy ? 'blur(4px)' : undefined }}>
                  {money(t, { compact: true })}
                </text>
              </g>
            ))}
            {/* baseline */}
            <line x1={0} x2={innerW} y1={y(base)} y2={y(base)} stroke="rgba(255,255,255,.18)" strokeDasharray="2 4" />

            {/* milestones */}
            {flags.map((f) => (
              <g key={f.amount}>
                <line x1={0} x2={innerW} y1={y(f.target)} y2={y(f.target)} stroke="rgba(227,196,141,.18)" strokeDasharray="1 5" />
                <text x={4} y={y(f.target) - 5} className="fill-gold/60 text-[9.5px] font-medium tracking-wider uppercase">
                  {f.label}
                </text>
                {f.point && (
                  <g transform={`translate(${x(f.point.t)},${y(f.target)})`}>
                    <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 1.2, type: 'spring' }}>
                      <circle r={9} fill="#0b0d10" stroke="#e3c48d" strokeOpacity={0.5} />
                      <path d="M-2.5 3.5V-4l5 1.8-5 1.8" fill="#e3c48d" stroke="#e3c48d" strokeWidth={0.8} strokeLinejoin="round" />
                    </motion.g>
                  </g>
                )}
              </g>
            ))}

            {/* ghost (what-if) */}
            {ghostLine && (
              <motion.path d={ghostLine} fill="none" stroke="#8ab4ff" strokeWidth={1.6} strokeDasharray="4 4" initial={{ opacity: 0 }} animate={{ opacity: 0.85 }} />
            )}

            {/* area & line: dimmed full + bright clipped part up to the cursor */}
            <motion.path d={pathArea} fill={`url(#ga-${id})`} initial={{ opacity: 0 }} animate={{ opacity: p ? 0.35 : 1 }} transition={{ duration: 0.6 }} />
            <motion.path
              d={pathLine}
              fill="none"
              stroke={`url(#gl-${id})`}
              strokeWidth={2.2}
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1, opacity: p ? 0.35 : 1 }}
              transition={{ pathLength: { duration: 1.8, ease: [0.16, 1, 0.3, 1] }, opacity: { duration: 0.3 } }}
            />
            {p && (
              <g clipPath={`url(#clip-${id})`}>
                <path d={pathArea} fill={`url(#ga-${id})`} />
                <path d={pathLine} fill="none" stroke={`url(#gl-${id})`} strokeWidth={2.4} filter={`url(#glow-${id})`} />
              </g>
            )}

            {/* x axis */}
            {ticksX.map((d) => (
              <text key={d.getTime()} x={x(d)} y={mainH + (showDrawdown ? ddH + gap : 0) + 20} textAnchor="middle" className="fill-ink-3 text-[10px]">
                {MONTHS[d.getMonth()]}
                {d.getMonth() === 0 ? ` ’${String(d.getFullYear()).slice(2)}` : ''}
              </text>
            ))}

            {/* drawdown / underwater */}
            {showDrawdown && (
              <g transform={`translate(0,${mainH + gap})`}>
                <line x1={0} x2={innerW} stroke="rgba(255,255,255,.06)" />
                <motion.path d={ddArea} fill={`url(#gd-${id})`} stroke="#ff6b7f" strokeOpacity={0.5} strokeWidth={1} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }} />
                <text x={innerW + 12} y={ddH} className="fill-ink-3 text-[10px] num">
                  {pct(yDD.domain()[0], 0)}
                </text>
                <text x={innerW + 12} y={8} className="fill-ink-3 text-[10px]">
                  DD
                </text>
              </g>
            )}

            {/* cursor */}
            {p && (
              <g>
                <line x1={cx} x2={cx} y1={0} y2={mainH + (showDrawdown ? ddH + gap : 0)} stroke="rgba(227,196,141,.45)" strokeDasharray="3 3" />
                <circle cx={cx} cy={cy} r={11} fill="rgba(227,196,141,.15)" />
                <circle cx={cx} cy={cy} r={4.5} fill="#f4e2bb" stroke="#0b0d10" strokeWidth={2} />
                {showDrawdown && <circle cx={cx} cy={mainH + gap + yDD(p.drawdownPct)} r={3} fill="#ff6b7f" />}
              </g>
            )}

            <rect
              width={innerW}
              height={height - m.top - m.bottom}
              fill="transparent"
              style={{ cursor: 'crosshair', touchAction: 'pan-y' }}
              onPointerDown={(e) => {
                dragging.current = true
                ;(e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId)
                handle(e)
              }}
              onPointerMove={handle}
              onPointerUp={() => (dragging.current = false)}
              onPointerLeave={leave}
            />
          </g>
        </svg>
      )}

      <AnimatePresence>
        {p && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute top-0 z-10 w-[200px] rounded-2xl border border-line-2 bg-bg-2/95 p-3 shadow-2xl backdrop-blur"
            style={{ left: tooltipLeft, top: Math.max(0, cy - 110 + m.top) }}
          >
            <div className="text-[10px] uppercase tracking-wider text-ink-3">{dateLong(p.t)}</div>
            <div className={`num mt-1 text-lg font-semibold ${privacy ? 'privacy-blur' : ''}`}>{money(p.equity)}</div>
            <div className="mt-1.5 flex items-center justify-between text-[11px]">
              <span className="text-ink-3">Since start</span>
              <span className={`num ${p.equity - base >= 0 ? 'text-profit' : 'text-loss'} ${privacy ? 'privacy-blur' : ''}`}>{money(p.equity - base, { sign: true })}</span>
            </div>
            {p.tradeId && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-3">This trade</span>
                <span className={`num ${p.pnl >= 0 ? 'text-profit' : 'text-loss'} ${privacy ? 'privacy-blur' : ''}`}>{money(p.pnl, { sign: true })}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-ink-3">Drawdown</span>
              <span className={`num ${p.drawdownPct < 0 ? 'text-loss' : 'text-ink-2'}`}>{p.drawdownPct < 0 ? pct(p.drawdownPct) : 'At peak ✦'}</span>
            </div>
            {ghost && <div className="mt-1.5 border-t border-line pt-1.5 text-[10px] text-info">Dashed: {ghostLabel}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
