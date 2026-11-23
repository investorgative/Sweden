import { motion } from 'framer-motion'
import { scaleLinear } from 'd3-scale'
import { line, area, curveCatmullRom } from 'd3-shape'
import { useId } from 'react'
import { useMeasure } from './useMeasure'

export function TradePath({ path, target, height = 180, compact }: { path: number[]; target?: number; height?: number; compact?: boolean }) {
  const [ref, { width }] = useMeasure<HTMLDivElement>()
  const id = useId().replace(/:/g, '')
  const final = path[path.length - 1] ?? 0
  const lo = Math.min(-1.15, ...path)
  const hi = Math.max(target ?? 1, ...path) + 0.25
  const m = compact ? { l: 0, r: 0, t: 4, b: 4 } : { l: 8, r: 46, t: 12, b: 12 }
  const w = Math.max(10, width - m.l - m.r)
  const h = height - m.t - m.b
  const x = scaleLinear().domain([0, path.length - 1]).range([0, w])
  const y = scaleLinear().domain([lo, hi]).range([h, 0])
  const color = final >= 0 ? '#4fdc9c' : '#ff6b7f'
  const d = line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(curveCatmullRom)(path) ?? ''
  const a = area<number>().x((_, i) => x(i)).y0(y(0)).y1((v) => y(v)).curve(curveCatmullRom)(path) ?? ''
  const iMin = path.indexOf(Math.min(...path))
  const iMax = path.indexOf(Math.max(...path))
  const levels = [
    { v: 0, label: 'Entry', c: 'rgba(255,255,255,.35)' },
    { v: -1, label: 'Stop', c: 'rgba(255,107,127,.5)' },
    ...(target ? [{ v: target, label: 'Target', c: 'rgba(79,220,156,.5)' }] : []),
  ]
  return (
    <div ref={ref} style={{ height }} className="w-full">
      {width > 0 && (
        <svg width={width} height={height}>
          <defs>
            <linearGradient id={`tp-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={final >= 0 ? 0.3 : 0} />
              <stop offset="1" stopColor={color} stopOpacity={final >= 0 ? 0 : 0.3} />
            </linearGradient>
          </defs>
          <g transform={`translate(${m.l},${m.t})`}>
            {!compact &&
              levels.map((l) => (
                <g key={l.label}>
                  <line x1={0} x2={w} y1={y(l.v)} y2={y(l.v)} stroke={l.c} strokeDasharray="3 4" />
                  <text x={w + 6} y={y(l.v)} dy="0.32em" className="fill-ink-3 text-[10px]">
                    {l.label}
                  </text>
                </g>
              ))}
            <motion.path d={a} fill={`url(#tp-${id})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} />
            <motion.path d={d} fill="none" stroke={color} strokeWidth={compact ? 1.4 : 2} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
            {!compact && (
              <>
                <circle cx={x(iMin)} cy={y(path[iMin])} r={3.5} fill="#ff6b7f" />
                <text x={x(iMin)} y={y(path[iMin]) + 14} textAnchor="middle" className="fill-loss text-[9.5px]">
                  MAE {path[iMin].toFixed(2)}R
                </text>
                <circle cx={x(iMax)} cy={y(path[iMax])} r={3.5} fill="#4fdc9c" />
                <text x={x(iMax)} y={y(path[iMax]) - 8} textAnchor="middle" className="fill-profit text-[9.5px]">
                  MFE +{path[iMax].toFixed(2)}R
                </text>
                <circle cx={x(path.length - 1)} cy={y(final)} r={4} fill={color} stroke="#0b0d10" strokeWidth={2} />
              </>
            )}
          </g>
        </svg>
      )}
    </div>
  )
}
