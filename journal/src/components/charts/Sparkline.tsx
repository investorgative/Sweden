import { line, area, curveMonotoneX } from 'd3-shape'
import { scaleLinear } from 'd3-scale'
import { useId } from 'react'

export function Sparkline({ values, width = 120, height = 36, color }: { values: number[]; width?: number; height?: number; color?: string }) {
  const id = useId().replace(/:/g, '')
  if (values.length < 2) return <svg width={width} height={height} />
  const x = scaleLinear().domain([0, values.length - 1]).range([1, width - 1])
  const y = scaleLinear().domain([Math.min(...values), Math.max(...values)]).range([height - 2, 2])
  const c = color ?? (values[values.length - 1] >= values[0] ? '#4fdc9c' : '#ff6b7f')
  const d = line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(curveMonotoneX)(values) ?? ''
  const a = area<number>().x((_, i) => x(i)).y0(height).y1((v) => y(v)).curve(curveMonotoneX)(values) ?? ''
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity="0.25" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={a} fill={`url(#sp-${id})`} />
      <path d={d} fill="none" stroke={c} strokeWidth={1.5} />
    </svg>
  )
}
