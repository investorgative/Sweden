import { motion } from 'framer-motion'
import { scaleLinear, scaleBand } from 'd3-scale'
import { line, curveMonotoneX, area } from 'd3-shape'
import { useId, useState } from 'react'
import { useMeasure } from './useMeasure'
import { cx } from '@/components/ui/primitives'

// ───────────────────────── Radar
export function Radar({ parts, size = 260 }: { parts: { key: string; value: number; raw?: string }[]; size?: number }) {
  const id = useId().replace(/:/g, '')
  const c = size / 2
  const R = size / 2 - 42
  const n = parts.length
  const pt = (i: number, v: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return [c + Math.cos(a) * R * v, c + Math.sin(a) * R * v]
  }
  const poly = parts.map((p, i) => pt(i, Math.max(0.04, p.value)).join(',')).join(' ')
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-[320px]">
      <defs>
        <radialGradient id={`rg-${id}`}>
          <stop offset="0" stopColor="#e3c48d" stopOpacity="0.45" />
          <stop offset="1" stopColor="#e3c48d" stopOpacity="0.12" />
        </radialGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon key={r} points={parts.map((_, i) => pt(i, r).join(',')).join(' ')} fill="none" stroke="rgba(255,255,255,.07)" />
      ))}
      {parts.map((_, i) => {
        const [x, y] = pt(i, 1)
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="rgba(255,255,255,.06)" />
      })}
      <motion.polygon points={poly} fill={`url(#rg-${id})`} stroke="#e3c48d" strokeWidth={1.6} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} style={{ transformOrigin: `${c}px ${c}px` }} />
      {parts.map((p, i) => {
        const [x, y] = pt(i, Math.max(0.04, p.value))
        const [lx, ly] = pt(i, 1.22)
        return (
          <g key={p.key}>
            <circle cx={x} cy={y} r={3} fill="#f4e2bb" />
            <text x={lx} y={ly} textAnchor="middle" dy="0.32em" className="fill-ink-3 text-[10px]">
              {p.key}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ───────────────────────── Histogram (R distribution)
export function Histogram({ bins, height = 220, label }: { bins: { x0: number; x1: number; count: number }[]; height?: number; label?: (b: { x0: number; x1: number }) => string }) {
  const [ref, { width }] = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const m = { t: 10, r: 8, b: 24, l: 8 }
  const w = Math.max(10, width - m.l - m.r)
  const h = height - m.t - m.b
  const x = scaleBand<number>().domain(bins.map((_, i) => i)).range([0, w]).padding(0.12)
  const y = scaleLinear().domain([0, Math.max(1, ...bins.map((b) => b.count))]).range([h, 0])
  const total = bins.reduce((s, b) => s + b.count, 0)
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          <g transform={`translate(${m.l},${m.t})`}>
            {bins.map((b, i) => {
              const pos = b.x0 >= 0
              return (
                <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <motion.rect
                    x={x(i)}
                    width={x.bandwidth()}
                    rx={3}
                    fill={pos ? '#4fdc9c' : '#ff6b7f'}
                    opacity={hover == null || hover === i ? 0.85 : 0.35}
                    initial={{ y: h, height: 0 }}
                    animate={{ y: y(b.count), height: h - y(b.count) }}
                    transition={{ duration: 0.8, delay: i * 0.02, ease: [0.16, 1, 0.3, 1] }}
                  />
                  {i % 2 === 0 && (
                    <text x={x(i)! + x.bandwidth() / 2} y={h + 16} textAnchor="middle" className="num fill-ink-4 text-[9.5px]">
                      {b.x0}
                    </text>
                  )}
                </g>
              )
            })}
            <line x1={x(bins.findIndex((b) => b.x0 >= 0))! - 2} x2={x(bins.findIndex((b) => b.x0 >= 0))! - 2} y1={0} y2={h} stroke="rgba(255,255,255,.25)" strokeDasharray="2 3" />
          </g>
        </svg>
      )}
      {hover != null && (
        <div className="pointer-events-none absolute right-2 top-0 rounded-xl border border-line-2 bg-bg-2/95 px-3 py-2 text-xs shadow-xl">
          <div className="text-ink-3">{label ? label(bins[hover]) : `${bins[hover].x0} to ${bins[hover].x1}`}</div>
          <div className="num font-semibold">
            {bins[hover].count} trades · {((bins[hover].count / total) * 100).toFixed(1)}%
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── Scatter (MAE vs MFE / final R)
export function Scatter({ points, height = 300, xLabel, yLabel, onSelect }: { points: { id: string; x: number; y: number; win: boolean }[]; height?: number; xLabel: string; yLabel: string; onSelect?: (id: string) => void }) {
  const [ref, { width }] = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const m = { t: 10, r: 12, b: 34, l: 40 }
  const w = Math.max(10, width - m.l - m.r)
  const h = height - m.t - m.b
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = scaleLinear().domain([Math.min(-0.1, ...xs), Math.max(0.1, ...xs)]).range([0, w]).nice()
  const y = scaleLinear().domain([Math.min(-0.1, ...ys), Math.max(0.1, ...ys)]).range([h, 0]).nice()
  const hp = points.find((p) => p.id === hover)
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          <g transform={`translate(${m.l},${m.t})`}>
            {y.ticks(5).map((t) => (
              <g key={t}>
                <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.04)'} />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="num fill-ink-4 text-[10px]">
                  {t}
                </text>
              </g>
            ))}
            {x.ticks(6).map((t) => (
              <g key={t}>
                <line y1={0} y2={h} x1={x(t)} x2={x(t)} stroke={t === 0 ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.04)'} />
                <text y={h + 16} x={x(t)} textAnchor="middle" className="num fill-ink-4 text-[10px]">
                  {t}
                </text>
              </g>
            ))}
            {/* y = x reference */}
            <line x1={x(Math.max(x.domain()[0], y.domain()[0]))} y1={y(Math.max(x.domain()[0], y.domain()[0]))} x2={x(Math.min(x.domain()[1], y.domain()[1]))} y2={y(Math.min(x.domain()[1], y.domain()[1]))} stroke="rgba(227,196,141,.25)" strokeDasharray="4 4" />
            {points.map((p, i) => (
              <motion.circle
                key={p.id}
                cx={x(p.x)}
                cy={y(p.y)}
                r={hover === p.id ? 6 : 3.2}
                fill={p.win ? '#4fdc9c' : '#ff6b7f'}
                fillOpacity={0.55}
                stroke={p.win ? '#4fdc9c' : '#ff6b7f'}
                strokeOpacity={0.9}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(1, i * 0.0015) }}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(p.id)}
                style={{ cursor: 'pointer' }}
              />
            ))}
            <text x={w / 2} y={h + 30} textAnchor="middle" className="fill-ink-3 text-[10.5px]">
              {xLabel}
            </text>
            <text transform={`translate(-30,${h / 2}) rotate(-90)`} textAnchor="middle" className="fill-ink-3 text-[10.5px]">
              {yLabel}
            </text>
          </g>
        </svg>
      )}
      {hp && (
        <div className="pointer-events-none absolute right-3 top-2 rounded-xl border border-line-2 bg-bg-2/95 px-3 py-2 text-xs shadow-xl">
          <div className="font-mono text-ink-3">{hp.id}</div>
          <div className="num">
            {xLabel.split(' ')[0]} {hp.x.toFixed(2)} · {yLabel.split(' ')[0]} {hp.y.toFixed(2)}
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── Heat grid (weekday × hour)
export function HeatGrid({ rows, cols, cell, format, onSelect }: { rows: string[]; cols: string[]; cell: (r: string, c: string) => { value: number; count: number } | null; format: (v: number) => string; onSelect?: (r: string, c: string) => void }) {
  const [hover, setHover] = useState<{ r: string; c: string } | null>(null)
  const vals = rows.flatMap((r) => cols.map((c) => cell(r, c)?.value ?? 0))
  const max = Math.max(0.01, ...vals.map(Math.abs))
  const hv = hover ? cell(hover.r, hover.c) : null
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[520px] gap-1.5" style={{ gridTemplateColumns: `48px repeat(${cols.length}, minmax(0,1fr))` }}>
          <div />
          {cols.map((c) => (
            <div key={c} className="pb-1 text-center text-[10px] text-ink-4">
              {c}
            </div>
          ))}
          {rows.map((r) => (
            <div key={r} className="contents">
              <div className="flex items-center text-[11px] text-ink-3">{r}</div>
              {cols.map((c) => {
                const v = cell(r, c)
                const inten = v ? 0.1 + 0.75 * Math.min(1, Math.abs(v.value) / max) ** 0.75 : 0
                return (
                  <motion.button
                    key={c}
                    whileHover={{ scale: 1.08 }}
                    onMouseEnter={() => setHover({ r, c })}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => v && onSelect?.(r, c)}
                    className={cx('num grid aspect-[1.6] place-items-center rounded-lg text-[10px] font-medium', !v && 'bg-white/[0.02] text-ink-4')}
                    style={v ? { background: v.value >= 0 ? `rgba(79,220,156,${inten})` : `rgba(255,107,127,${inten})`, color: inten > 0.45 ? '#0b0d10' : '#f4efe6' } : undefined}
                  >
                    {v ? format(v.value) : '·'}
                  </motion.button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 h-4 text-[11px] text-ink-3">
        {hover && hv ? (
          <>
            {hover.r} · {hover.c} — <span className={hv.value >= 0 ? 'text-profit' : 'text-loss'}>{format(hv.value)}</span> over {hv.count} trades
          </>
        ) : (
          'Hover a cell for details'
        )}
      </div>
    </div>
  )
}

// ───────────────────────── Multi-line chart (rolling metrics)
export function LineChart({ series, height = 240, yFormat, refLine }: { series: { key: string; color: string; values: { x: number; y: number }[]; dashed?: boolean }[]; height?: number; yFormat: (v: number) => string; refLine?: number }) {
  const [ref, { width }] = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const m = { t: 12, r: 52, b: 12, l: 4 }
  const w = Math.max(10, width - m.l - m.r)
  const h = height - m.t - m.b
  const all = series.flatMap((s) => s.values)
  if (!all.length) return <div style={{ height }} />
  const x = scaleLinear().domain([Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x))]).range([0, w])
  const y = scaleLinear().domain([Math.min(...all.map((p) => p.y), refLine ?? Infinity), Math.max(...all.map((p) => p.y), refLine ?? -Infinity)]).range([h, 0]).nice(4)
  const s0 = series[0]
  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height}>
          <g transform={`translate(${m.l},${m.t})`}>
            {y.ticks(4).map((t) => (
              <g key={t}>
                <line x1={0} x2={w} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,.04)" />
                <text x={w + 10} y={y(t)} dy="0.32em" className="num fill-ink-4 text-[10px]">
                  {yFormat(t)}
                </text>
              </g>
            ))}
            {refLine != null && <line x1={0} x2={w} y1={y(refLine)} y2={y(refLine)} stroke="rgba(255,255,255,.25)" strokeDasharray="3 4" />}
            {series.map((s, si) => {
              const d = line<{ x: number; y: number }>().x((p) => x(p.x)).y((p) => y(p.y)).curve(curveMonotoneX)(s.values) ?? ''
              const a = area<{ x: number; y: number }>().x((p) => x(p.x)).y0(h).y1((p) => y(p.y)).curve(curveMonotoneX)(s.values) ?? ''
              return (
                <g key={s.key}>
                  {si === 0 && <path d={a} fill={s.color} opacity={0.06} />}
                  <motion.path d={d} fill="none" stroke={s.color} strokeWidth={1.8} strokeDasharray={s.dashed ? '4 4' : undefined} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }} />
                </g>
              )
            })}
            {hover != null && s0.values[hover] && (
              <g>
                <line x1={x(s0.values[hover].x)} x2={x(s0.values[hover].x)} y1={0} y2={h} stroke="rgba(227,196,141,.4)" strokeDasharray="3 3" />
                {series.map((s) => s.values[hover] && <circle key={s.key} cx={x(s.values[hover].x)} cy={y(s.values[hover].y)} r={3.5} fill={s.color} />)}
              </g>
            )}
            <rect
              width={w}
              height={h}
              fill="transparent"
              onMouseMove={(e) => {
                const r = (e.currentTarget as SVGRectElement).getBoundingClientRect()
                const xv = x.invert(e.clientX - r.left)
                let best = 0
                s0.values.forEach((p, i) => {
                  if (Math.abs(p.x - xv) < Math.abs(s0.values[best].x - xv)) best = i
                })
                setHover(best)
              }}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        </svg>
      )}
      {hover != null && (
        <div className="pointer-events-none absolute left-2 top-0 rounded-xl border border-line-2 bg-bg-2/95 px-3 py-2 text-xs shadow-xl">
          <div className="text-ink-4">Trade #{s0.values[hover]?.x + 1}</div>
          {series.map((s) => (
            <div key={s.key} className="num flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.key}: {s.values[hover] ? yFormat(s.values[hover].y) : '—'}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
