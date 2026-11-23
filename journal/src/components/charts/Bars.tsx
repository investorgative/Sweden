import { motion } from 'framer-motion'
import { scaleBand, scaleLinear } from 'd3-scale'
import { useState, type ReactNode } from 'react'
import { useMeasure } from './useMeasure'
import { money } from '@/lib/format'
import { usePrivacy } from '@/components/ui/primitives'

export interface BarDatum {
  key: string
  value: number
  label?: string
  sub?: ReactNode
}

/** Vertical +/- bars (daily P&L, monthly returns…) with hover tooltip. */
export function PnlBars({ data, height = 220, format = (v: number) => money(v, { sign: true }), xLabel, onSelect, showAxis = true }: { data: BarDatum[]; height?: number; format?: (v: number) => string; xLabel?: (d: BarDatum, i: number) => string | null; onSelect?: (d: BarDatum) => void; showAxis?: boolean }) {
  const [ref, { width }] = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const privacy = usePrivacy()
  const m = { t: 10, r: showAxis ? 56 : 0, b: xLabel ? 22 : 6, l: 0 }
  const w = Math.max(10, width - m.l - m.r)
  const h = height - m.t - m.b
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)))
  const lo = Math.min(0, ...data.map((d) => d.value))
  const hi = Math.max(0, ...data.map((d) => d.value))
  const y = scaleLinear().domain([lo || -max * 0.1, hi || max * 0.1]).range([h, 0]).nice(4)
  const x = scaleBand<string>().domain(data.map((d) => d.key)).range([0, w]).padding(data.length > 60 ? 0.2 : 0.28)
  const bw = x.bandwidth()
  const hd = hover != null ? data[hover] : null

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          <defs>
            <linearGradient id="bar-pos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#6ff0b5" />
              <stop offset="1" stopColor="#2a9e6c" />
            </linearGradient>
            <linearGradient id="bar-neg" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#ff8a9a" />
              <stop offset="1" stopColor="#b8384c" />
            </linearGradient>
          </defs>
          <g transform={`translate(${m.l},${m.t})`}>
            {showAxis &&
              y.ticks(4).map((t) => (
                <g key={t}>
                  <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.04)'} />
                  <text x={w + 10} y={y(t)} dy="0.32em" className="num fill-ink-3 text-[10px]" style={{ filter: privacy ? 'blur(4px)' : undefined }}>
                    {format(t)}
                  </text>
                </g>
              ))}
            {data.map((d, i) => {
              const y0 = y(0)
              const y1 = y(d.value)
              const top = Math.min(y0, y1)
              const bh = Math.max(1, Math.abs(y1 - y0))
              return (
                <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onSelect?.(d)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
                  <rect x={x(d.key)! - 1} y={0} width={bw + 2} height={h} fill="transparent" />
                  <motion.rect
                    x={x(d.key)}
                    width={bw}
                    rx={Math.min(3, bw / 2)}
                    fill={d.value >= 0 ? 'url(#bar-pos)' : 'url(#bar-neg)'}
                    opacity={hover == null || hover === i ? 1 : 0.35}
                    initial={{ y: y0, height: 0 }}
                    animate={{ y: top, height: bh }}
                    transition={{ duration: 0.8, delay: Math.min(0.6, i * 0.008), ease: [0.16, 1, 0.3, 1] }}
                  />
                  {xLabel && xLabel(d, i) && (
                    <text x={x(d.key)! + bw / 2} y={h + 16} textAnchor="middle" className="fill-ink-3 text-[10px]">
                      {xLabel(d, i)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>
      )}
      {hd && (
        <div
          className="pointer-events-none absolute z-10 rounded-xl border border-line-2 bg-bg-2/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
          style={{ left: Math.min(Math.max(0, (x(hd.key) ?? 0) + bw / 2 - 70), width - 150), top: 0 }}
        >
          <div className="text-ink-3">{hd.label ?? hd.key}</div>
          <div className={`num text-sm font-semibold ${hd.value >= 0 ? 'text-profit' : 'text-loss'} ${privacy ? 'privacy-blur' : ''}`}>{format(hd.value)}</div>
          {hd.sub && <div className="mt-0.5 text-[11px] text-ink-3">{hd.sub}</div>}
        </div>
      )}
    </div>
  )
}

/** Horizontal ranked bars, e.g. P&L by setup */
export function HBars({ data, format = (v: number) => money(v, { sign: true, compact: true }), onSelect, valueLabel }: { data: { key: string; value: number; sub?: string }[]; format?: (v: number) => string; onSelect?: (k: string) => void; valueLabel?: string }) {
  const privacy = usePrivacy()
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)))
  const hasNeg = data.some((d) => d.value < 0)
  return (
    <div className="space-y-2.5">
      {valueLabel && <div className="text-right text-[10px] uppercase tracking-wider text-ink-4">{valueLabel}</div>}
      {data.map((d, i) => {
        const frac = Math.abs(d.value) / max
        return (
          <button key={d.key} onClick={() => onSelect?.(d.key)} className="group block w-full text-left">
            <div className="mb-1 flex items-center justify-between gap-3 text-[12.5px]">
              <span className="truncate text-ink-2 group-hover:text-ink">{d.key}</span>
              <span className="flex items-center gap-2">
                {d.sub && <span className="text-[11px] text-ink-4">{d.sub}</span>}
                <span className={`num font-medium ${d.value >= 0 ? 'text-profit' : 'text-loss'} ${privacy ? 'privacy-blur' : ''}`}>{format(d.value)}</span>
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.04]">
              {hasNeg && <div className="absolute left-1/2 top-0 h-full w-px bg-white/10" />}
              <motion.div
                className={`absolute top-0 h-full rounded-full ${d.value >= 0 ? 'bg-gradient-to-r from-profit-2 to-profit' : 'bg-gradient-to-l from-loss-2 to-loss'}`}
                style={hasNeg ? (d.value >= 0 ? { left: '50%' } : { right: '50%' }) : { left: 0 }}
                initial={{ width: 0 }}
                animate={{ width: `${frac * (hasNeg ? 50 : 100)}%` }}
                transition={{ duration: 1, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}
