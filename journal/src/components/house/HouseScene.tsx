import { motion, useMotionValue, useMotionValueEvent, useSpring, useTransform } from 'framer-motion'
import { useEffect, useId, useMemo, useState, type PointerEvent, type Ref } from 'react'

/**
 * A fully custom, progress-driven SVG scene. Every element maps a slice of
 * `progress` (0 → 1) onto its own construction animation, so scrubbing the
 * equity curve literally builds (or un-builds) the house in real time.
 *
 * `mood` (0 → 1) is the drawdown severity at that point in time: clouds gather,
 * rain falls and the lights dim when you are deep in a drawdown.
 */

export const HOUSE_STAGES = [
  { at: 0, name: 'The plot', desc: 'You bought the land. Every trade is a brick.' },
  { at: 0.05, name: 'Foundation', desc: 'Concrete poured — risk management first.' },
  { at: 0.13, name: 'Timber frame', desc: 'The skeleton rises. Your process takes shape.' },
  { at: 0.3, name: 'Walls & cladding', desc: 'Black-stained timber, board by board.' },
  { at: 0.46, name: 'Roof', desc: 'A roof over your head — protected from the storms.' },
  { at: 0.55, name: 'Glass & doors', desc: 'Floor-to-ceiling windows facing the lake.' },
  { at: 0.63, name: 'Lights on', desc: 'Someone is home. It is starting to feel real.' },
  { at: 0.75, name: 'Deck & garden', desc: 'Pines, a stone path and a deck over the water.' },
  { at: 0.86, name: 'Sauna & jetty', desc: 'A wood-fired sauna and a boat at the jetty.' },
  { at: 1, name: 'Keys in hand', desc: 'Fully funded. Welcome home.' },
] as const

export function stageFor(p: number) {
  let idx = 0
  HOUSE_STAGES.forEach((s, i) => {
    if (p >= s.at) idx = i
  })
  return idx
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a))
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

const GROUND = 330
const LAKE = 348

// deterministic star field
const STARS = Array.from({ length: 70 }, (_, i) => {
  const r = Math.sin(i * 12.9898) * 43758.5453
  const f = r - Math.floor(r)
  const r2 = Math.sin(i * 78.233) * 12345.678
  const f2 = r2 - Math.floor(r2)
  return { x: f * 800, y: f2 * 200, s: 0.4 + ((i * 7) % 10) / 10, d: (i % 7) * 0.6 }
})

function Pine({ x, y, s = 1, color = '#0c1310', grow = 1 }: { x: number; y: number; s?: number; color?: string; grow?: number }) {
  if (grow <= 0) return null
  const g = easeBack(grow)
  return (
    <g transform={`translate(${x},${y}) scale(${s * g})`} style={{ transformBox: 'fill-box' }}>
      <rect x={-1.5} y={-8} width={3} height={8} fill="#140f0b" />
      <path d="M0 -60 L13 -34 L7 -35 L18 -16 L9 -17 L22 0 L-22 0 L-9 -17 L-18 -16 L-7 -35 L-13 -34 Z" fill={color} />
    </g>
  )
}

export function HouseScene({ progress, mood = 0, interactive = true, className, showLabels = false, slice = false, svgRef }: { progress: number; mood?: number; interactive?: boolean; className?: string; showLabels?: boolean; slice?: boolean; svgRef?: Ref<SVGSVGElement> }) {
  const uid = useId().replace(/:/g, '')
  const target = useMotionValue(progress)
  const spring = useSpring(target, { stiffness: 90, damping: 22, mass: 0.8 })
  const moodMv = useMotionValue(mood)
  const moodSpring = useSpring(moodMv, { stiffness: 60, damping: 20 })
  const [p, setP] = useState(progress)
  const [md, setMd] = useState(mood)
  useEffect(() => target.set(progress), [progress, target])
  useEffect(() => moodMv.set(mood), [mood, moodMv])
  useMotionValueEvent(spring, 'change', (v) => setP(v))
  useMotionValueEvent(moodSpring, 'change', (v) => setMd(v))

  // parallax
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const smx = useSpring(mx, { stiffness: 60, damping: 18 })
  const smy = useSpring(my, { stiffness: 60, damping: 18 })
  const farX = useTransform(smx, (v) => v * -6)
  const midX = useTransform(smx, (v) => v * -12)
  const nearX = useTransform(smx, (v) => v * -20)
  const skyY = useTransform(smy, (v) => v * -4)
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!interactive) return
    const r = e.currentTarget.getBoundingClientRect()
    mx.set((e.clientX - r.left) / r.width - 0.5)
    my.set((e.clientY - r.top) / r.height - 0.5)
  }

  // ─── construction phases
  const survey = seg(p, 0, 0.05)
  const found = seg(p, 0.04, 0.13)
  const frame = seg(p, 0.12, 0.3)
  const plates = seg(p, 0.26, 0.31)
  const clad = seg(p, 0.29, 0.47)
  const rafters = seg(p, 0.44, 0.5)
  const roof = seg(p, 0.48, 0.58)
  const glass = seg(p, 0.54, 0.63)
  const lights = seg(p, 0.6, 0.69)
  const garden = seg(p, 0.74, 0.87)
  const deck = seg(p, 0.76, 0.84)
  const sauna = seg(p, 0.85, 0.95)
  const boat = seg(p, 0.9, 0.97)
  const done = p >= 0.995
  const craneOn = p > 0.06 && p < 0.97
  const craneIn = Math.min(seg(p, 0.06, 0.1), 1 - seg(p, 0.93, 0.97))
  const scaffold = Math.min(seg(p, 0.2, 0.26), 1 - seg(p, 0.6, 0.66))
  const lightLevel = lights * (1 - md * 0.55)
  const warmth = (0.35 + 0.65 * clamp(p * 1.1)) * (1 - md)

  const studsMain = useMemo(() => Array.from({ length: 15 }, (_, i) => 272 + i * 14), [])
  const studsAnnex = useMemo(() => Array.from({ length: 8 }, (_, i) => 474 + i * 16), [])
  const boards = useMemo(() => Array.from({ length: 34 }, (_, i) => 270 + i * 6), [])

  // Roof geometry (main gable)
  const apex = { x: 370, y: 164 }
  const eaveL = { x: 258, y: 234 }
  const eaveR = { x: 482, y: 234 }
  const roofDrop = (1 - easeOut(roof)) * -40

  const windowFill = (k: number) => (lightLevel > k ? `url(#lit-${uid})` : `url(#glass-${uid})`)

  const houseBody = (
    <g>
      {/* ── survey stakes & strings */}
      <g opacity={survey * (1 - seg(p, 0.14, 0.2))}>
        {[258, 600].map((x) => (
          <g key={x}>
            <rect x={x - 1.5} y={GROUND - 14} width={3} height={14} fill="#c7a466" />
            <rect x={x - 2.5} y={GROUND - 16} width={5} height={3} fill="#ff6b7f" />
          </g>
        ))}
        <line x1={258} x2={258 + 342 * survey} y1={GROUND - 10} y2={GROUND - 10} stroke="#e3c48d" strokeWidth={0.8} strokeDasharray="3 2" />
      </g>

      {/* ── foundation */}
      <rect x={254} y={GROUND + 12 - 14 * easeOut(found)} width={348} height={14 * easeOut(found)} fill={`url(#concrete-${uid})`} opacity={found > 0 ? 1 : 0} />
      {found > 0 && <rect x={254} y={GROUND + 12 - 14 * easeOut(found)} width={348} height={1.2} fill="#9aa3ad" opacity={0.5} />}

      {/* ── timber frame */}
      <g>
        {studsMain.map((x, i) => {
          const t = seg(frame, i / 24, i / 24 + 0.35)
          if (t <= 0) return null
          const h = 100 * easeOut(t)
          return <rect key={x} x={x - 1.6} y={GROUND - h} width={3.2} height={h} fill="#c9a06a" opacity={1 - clad * 0.9} />
        })}
        {studsAnnex.map((x, i) => {
          const t = seg(frame, 0.35 + i / 20, 0.35 + i / 20 + 0.3)
          if (t <= 0) return null
          const h = 70 * easeOut(t)
          return <rect key={x} x={x - 1.6} y={GROUND - h} width={3.2} height={h} fill="#c9a06a" opacity={1 - clad * 0.9} />
        })}
        {plates > 0 && (
          <g opacity={1 - clad * 0.9}>
            <rect x={268} y={230 - 2} width={204 * plates} height={4} fill="#b88d58" />
            <rect x={472} y={260 - 2} width={118 * plates} height={4} fill="#b88d58" />
            <rect x={268} y={281} width={204 * plates} height={3} fill="#b88d58" opacity={0.8} />
          </g>
        )}
      </g>

      {/* ── cladding (rises board by board) */}
      {clad > 0 && (
        <g>
          <clipPath id={`clad-${uid}`}>
            <rect x={266} y={GROUND - 100 * easeOut(clad)} width={210} height={100 * easeOut(clad) + 1} />
            <rect x={470} y={GROUND - 70 * easeOut(seg(clad, 0.25, 1))} width={122} height={70 * easeOut(seg(clad, 0.25, 1)) + 1} />
          </clipPath>
          <g clipPath={`url(#clad-${uid})`}>
            <rect x={266} y={230} width={208} height={100} fill={`url(#timber-${uid})`} />
            {boards.map((x) => (
              <rect key={x} x={x} y={230} width={0.7} height={100} fill="#000" opacity={0.45} />
            ))}
            <rect x={266} y={230} width={2} height={100} fill="#c9d1dc" opacity={0.25} />
            {/* gable end triangle */}
            <path d={`M266 230 L370 ${apex.y + 8} L474 230 Z`} fill={`url(#timber-${uid})`} opacity={seg(clad, 0.7, 1)} />
            {/* annex in warm oak */}
            <rect x={470} y={260} width={122} height={70} fill={`url(#oak-${uid})`} />
            {Array.from({ length: 20 }, (_, i) => (
              <rect key={i} x={472 + i * 6} y={260} width={0.6} height={70} fill="#3a2812" opacity={0.35} />
            ))}
          </g>
        </g>
      )}

      {/* ── scaffolding */}
      {scaffold > 0 && (
        <g opacity={scaffold * 0.9} stroke="#7d8590" strokeWidth={1.2}>
          {[250, 296, 342, 388, 434, 480].map((x) => (
            <line key={x} x1={x} x2={x} y1={GROUND} y2={GROUND - 120 * scaffold} />
          ))}
          {[300, 270, 240, 214].map((y) => (
            <line key={y} x1={250} x2={480} y1={y} y2={y} opacity={GROUND - 120 * scaffold < y ? 1 : 0} />
          ))}
          {[0, 1, 2, 3, 4].map((i) => (
            <line key={i} x1={250 + i * 46} x2={296 + i * 46} y1={GROUND} y2={GROUND - 30} opacity={0.6} />
          ))}
        </g>
      )}

      {/* ── rafters */}
      {rafters > 0 && roof < 1 && (
        <g stroke="#c9a06a" strokeWidth={2.4} opacity={1 - roof}>
          <line x1={eaveL.x + 8} y1={230} x2={eaveL.x + 8 + (apex.x - eaveL.x - 8) * easeOut(rafters)} y2={230 + (apex.y - 230) * easeOut(rafters)} />
          <line x1={eaveR.x - 8} y1={230} x2={eaveR.x - 8 - (eaveR.x - 8 - apex.x) * easeOut(rafters)} y2={230 + (apex.y - 230) * easeOut(rafters)} />
          <line x1={320} y1={230} x2={320} y2={230 - 36 * easeOut(rafters)} opacity={0.7} />
          <line x1={420} y1={230} x2={420} y2={230 - 36 * easeOut(rafters)} opacity={0.7} />
        </g>
      )}

      {/* ── roof (slides down into place) */}
      {roof > 0 && (
        <g transform={`translate(0,${roofDrop})`} opacity={easeOut(roof)}>
          <path d={`M${eaveL.x} ${eaveL.y} L${apex.x} ${apex.y} L${eaveR.x} ${eaveR.y} L${eaveR.x - 6} ${eaveR.y + 3} L${apex.x} ${apex.y + 9} L${eaveL.x + 6} ${eaveL.y + 3} Z`} fill={`url(#roof-${uid})`} />
          {Array.from({ length: 9 }, (_, i) => {
            const t = (i + 1) / 10
            return (
              <g key={i} opacity={0.35}>
                <line x1={eaveL.x + (apex.x - eaveL.x) * t} y1={eaveL.y + (apex.y - eaveL.y) * t} x2={eaveL.x + (apex.x - eaveL.x) * t + 6} y2={eaveL.y + (apex.y - eaveL.y) * t + 3} stroke="#5b6470" />
              </g>
            )
          })}
          <line x1={eaveL.x} y1={eaveL.y} x2={apex.x} y2={apex.y} stroke="#4a525c" strokeWidth={1} />
          <line x1={apex.x} y1={apex.y} x2={eaveR.x} y2={eaveR.y} stroke="#6b7480" strokeWidth={1} />
          {/* annex flat roof */}
          <rect x={466} y={254} width={132} height={7} fill="#262b32" />
          <rect x={466} y={254} width={132} height={1.2} fill="#4c5560" />
          {/* chimney */}
          <rect x={418} y={176 + (1 - roof) * 20} width={15} height={26} fill="#22262c" />
          <rect x={416} y={174 + (1 - roof) * 20} width={19} height={4} fill="#30353d" />
        </g>
      )}

      {/* ── windows & door */}
      {glass > 0 && (
        <g opacity={easeOut(glass)}>
          {/* tall window */}
          <rect x={286} y={246} width={46} height={66} fill="#0b0d10" />
          <rect x={288} y={248} width={42} height={62} fill={windowFill(0.15)} filter={lightLevel > 0.15 ? `url(#winglow-${uid})` : undefined} />
          <rect x={308.5} y={248} width={1} height={62} fill="#0b0d10" />
          {/* wide window */}
          <rect x={348} y={246} width={104} height={44} fill="#0b0d10" />
          <rect x={350} y={248} width={100} height={40} fill={windowFill(0.35)} filter={lightLevel > 0.35 ? `url(#winglow-${uid})` : undefined} />
          <rect x={399.5} y={248} width={1} height={40} fill="#0b0d10" />
          {/* gable triangle window */}
          <path d="M346 226 L370 192 L394 226 Z" fill={windowFill(0.6)} stroke="#0b0d10" strokeWidth={2} />
          {/* door */}
          <rect x={356} y={296} width={28} height={34} fill="#0b0d10" />
          <rect x={358} y={298} width={24} height={32} fill={`url(#oak-${uid})`} />
          <circle cx={377} cy={315} r={1.2} fill="#e3c48d" />
          {/* small window */}
          <rect x={396} y={298} width={56} height={22} fill="#0b0d10" />
          <rect x={398} y={300} width={52} height={18} fill={windowFill(0.5)} />
          {/* annex glass wall */}
          <rect x={480} y={268} width={100} height={60} fill="#0b0d10" />
          <rect x={482} y={270} width={96} height={58} fill={windowFill(0.25)} filter={lightLevel > 0.25 ? `url(#winglow-${uid})` : undefined} />
          {[506, 530, 554].map((x) => (
            <rect key={x} x={x} y={270} width={1.4} height={58} fill="#0b0d10" />
          ))}
          {/* interior hints once lit */}
          {lightLevel > 0.25 && (
            <g opacity={seg(lightLevel, 0.25, 0.6)}>
              <rect x={492} y={306} width={34} height={8} rx={2} fill="#7a4d24" opacity={0.6} />
              <rect x={494} y={300} width={30} height={7} rx={3} fill="#a26a35" opacity={0.6} />
              <path d="M556 282 q8 -10 16 0 v4 h-16z" fill="#3a2410" opacity={0.5} />
              <rect x={563} y={286} width={2} height={38} fill="#3a2410" opacity={0.5} />
            </g>
          )}
          {/* reflections */}
          <path d="M290 300 L318 248 L326 248 L298 310 Z" fill="#fff" opacity={0.05} />
          <path d="M352 286 L380 248 L392 248 L364 288 Z" fill="#fff" opacity={0.05} />
        </g>
      )}

      {/* ── deck */}
      {deck > 0 && (
        <g>
          <rect x={598} y={GROUND - 4} width={100 * easeOut(deck)} height={6} fill={`url(#oak-${uid})`} />
          {Array.from({ length: 6 }, (_, i) => (
            <rect key={i} x={604 + i * 18} y={GROUND - 22} width={1.6} height={18} fill="#6b4a26" opacity={seg(deck, 0.4 + i * 0.08, 0.6 + i * 0.08)} />
          ))}
          <rect x={600} y={GROUND - 23} width={96 * seg(deck, 0.4, 1)} height={1.8} fill="#8a6440" />
          {/* steps & jetty */}
          <rect x={690} y={GROUND + 2} width={10} height={4} fill="#7a5530" opacity={seg(deck, 0.6, 1)} />
          <rect x={696} y={LAKE - 2} width={70 * seg(deck, 0.6, 1)} height={4} fill={`url(#oak-${uid})`} />
          {[704, 724, 744, 762].map((x, i) => (
            <rect key={x} x={x} y={LAKE + 1} width={2} height={10} fill="#3a2812" opacity={seg(deck, 0.7 + i * 0.05, 0.8 + i * 0.05)} />
          ))}
          {/* string lights */}
          {lights > 0.5 && (
            <g>
              <path d="M600 304 Q 648 318 696 304" fill="none" stroke="#3b3326" strokeWidth={0.6} />
              {Array.from({ length: 9 }, (_, i) => {
                const t = i / 8
                const x = 600 + 96 * t
                const y = 304 + 14 * 4 * t * (1 - t) * 0.5 * 2
                return <circle key={i} cx={x} cy={y + 1.5} r={1.4} fill="#ffd38a" opacity={seg(lights, 0.5 + t * 0.4, 0.6 + t * 0.4) * (1 - md * 0.6)} className="animate-pulse-soft" style={{ animationDelay: `${i * 0.3}s` }} />
              })}
            </g>
          )}
        </g>
      )}

      {/* ── garden: stone path, bushes, lamp */}
      {garden > 0 && (
        <g>
          {[0, 1, 2, 3].map((i) => (
            <ellipse key={i} cx={370 - i * 4} cy={GROUND + 18 + i * 7} rx={9 * seg(garden, i * 0.1, 0.4 + i * 0.1)} ry={2.4} fill="#3a3f46" />
          ))}
          {[262, 452, 590].map((x, i) => {
            const t = easeBack(seg(garden, 0.2 + i * 0.12, 0.5 + i * 0.12))
            return (
              <g key={x} transform={`translate(${x},${GROUND}) scale(${t})`}>
                <ellipse cx={0} cy={-5} rx={12} ry={8} fill="#13251b" />
                <ellipse cx={-5} cy={-8} rx={7} ry={5} fill="#1a3324" />
              </g>
            )
          })}
          {/* garden lamp */}
          <g opacity={seg(garden, 0.6, 1)}>
            <rect x={340} y={GROUND - 4} width={1.6} height={22} fill="#2a2e35" transform={`translate(0,${-14})`} />
            <circle cx={341} cy={GROUND - 19} r={2.6} fill="#ffd38a" opacity={lightLevel} />
            <circle cx={341} cy={GROUND - 19} r={10} fill="#ffd38a" opacity={lightLevel * 0.15} />
          </g>
        </g>
      )}
    </g>
  )

  const saunaGroup = sauna > 0 && (
    <g transform={`translate(0,${(1 - easeOut(sauna)) * 18})`} opacity={easeOut(sauna)}>
      <rect x={150} y={GROUND - 30} width={56} height={30} fill="#7a2620" />
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={152 + i * 6} y={GROUND - 30} width={0.6} height={30} fill="#000" opacity={0.3} />
      ))}
      <path d="M144 304 L178 284 L212 304 Z" fill="#23272d" />
      <rect x={150} y={GROUND - 30} width={56} height={2} fill="#f4efe6" opacity={0.8} />
      <rect x={160} y={GROUND - 22} width={12} height={10} fill={windowFill(0.2)} stroke="#f4efe6" strokeWidth={1.2} />
      <rect x={184} y={GROUND - 24} width={14} height={24} fill="#3a1410" stroke="#f4efe6" strokeWidth={1.2} />
      <rect x={194} y={282} width={6} height={12} fill="#30353d" />
    </g>
  )

  return (
    <svg ref={svgRef} viewBox="0 0 800 460" preserveAspectRatio={slice ? 'xMidYMid slice' : 'xMidYMid meet'} className={className} onPointerMove={onMove} onPointerLeave={() => (mx.set(0), my.set(0))} role="img" aria-label={`Dream house ${Math.round(p * 100)}% built`}>
      <defs>
        <linearGradient id={`sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#05070c" />
          <stop offset="45%" stopColor="#0c1220" />
          <stop offset="78%" stopColor={md > 0.4 ? '#1a1d26' : '#2a2236'} />
          <stop offset="100%" stopColor={md > 0.4 ? '#262a33' : '#5a3b2a'} />
        </linearGradient>
        <radialGradient id={`horizon-${uid}`} cx="0.62" cy="1" r="0.7">
          <stop offset="0%" stopColor="#f2b36b" stopOpacity={0.55 * warmth} />
          <stop offset="60%" stopColor="#e3c48d" stopOpacity={0.08 * warmth} />
          <stop offset="100%" stopColor="#e3c48d" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`moon-${uid}`}>
          <stop offset="0%" stopColor="#fff6e0" stopOpacity="0.9" />
          <stop offset="30%" stopColor="#f4e2bb" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f4e2bb" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`lake-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#141b28" />
          <stop offset="100%" stopColor="#06080d" />
        </linearGradient>
        <linearGradient id={`timber-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b4048" />
          <stop offset="100%" stopColor="#24282e" />
        </linearGradient>
        <linearGradient id={`oak-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c08f58" />
          <stop offset="100%" stopColor="#8a6136" />
        </linearGradient>
        <linearGradient id={`roof-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a414b" />
          <stop offset="100%" stopColor="#1b1f25" />
        </linearGradient>
        <linearGradient id={`concrete-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6b737d" />
          <stop offset="100%" stopColor="#3b4048" />
        </linearGradient>
        <linearGradient id={`glass-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2b3a4f" />
          <stop offset="100%" stopColor="#111823" />
        </linearGradient>
        <linearGradient id={`lit-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe2a8" />
          <stop offset="100%" stopColor="#f0a24c" />
        </linearGradient>
        <filter id={`winglow-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`blur-${uid}`}>
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
        <linearGradient id={`refl-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`reflmask-${uid}`}>
          <rect x={0} y={LAKE} width={800} height={112} fill={`url(#refl-${uid})`} />
        </mask>
        <clipPath id={`frame-${uid}`}>
          <rect width={800} height={460} rx={0} />
        </clipPath>
      </defs>

      <g clipPath={`url(#frame-${uid})`}>
        {/* ── sky */}
        <rect width={800} height={460} fill={`url(#sky-${uid})`} />
        <rect width={800} height={360} fill={`url(#horizon-${uid})`} />
        <motion.g style={{ y: skyY }}>
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="#fff" opacity={(0.25 + 0.5 * (1 - md)) * (s.y < 160 ? 1 : 0.4)} className="animate-pulse-soft" style={{ animationDelay: `${s.d}s` }} />
          ))}
          <circle cx={548} cy={138} r={60} fill={`url(#moon-${uid})`} opacity={1 - md * 0.8} />
          <circle cx={548} cy={138} r={14} fill="#f7ecd2" opacity={1 - md * 0.7} />
          <circle cx={553} cy={134} r={12} fill="#0c1220" opacity={0.18} />
        </motion.g>

        {/* aurora when the house is complete — very Nordic */}
        {done && (
          <motion.path
            d="M0 120 C 150 60, 260 150, 400 90 S 650 60, 800 110 L800 170 C 650 120, 560 170, 400 140 S 160 120, 0 170 Z"
            fill="#4fdc9c"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.08, 0.18, 0.08] }}
            transition={{ duration: 6, repeat: Infinity }}
            style={{ filter: 'blur(14px)' }}
          />
        )}

        {/* ── far mountains */}
        <motion.g style={{ x: farX }}>
          <path d="M-20 300 L60 240 L120 262 L200 205 L280 250 L340 228 L420 268 L520 214 L600 246 L680 210 L760 250 L830 232 L830 320 L-20 320 Z" fill="#0f141d" />
          <path d="M200 205 L215 216 L206 214 L198 220 Z M520 214 L534 224 L522 222 Z M680 210 L694 221 L684 219 Z" fill="#c9d1dc" opacity={0.25} />
        </motion.g>
        {/* ── mid forest line */}
        <motion.g style={{ x: midX }}>
          <path d="M-20 318 Q 100 290 200 306 T 420 300 T 640 296 T 830 304 L830 340 L-20 340 Z" fill="#0b1015" />
          {Array.from({ length: 26 }, (_, i) => (
            <Pine key={i} x={-10 + i * 33 + (i % 3) * 5} y={306 + (i % 2) * 4} s={0.38 + (i % 4) * 0.05} color="#0a0f13" />
          ))}
        </motion.g>

        {/* ── ground plot */}
        <path d={`M0 ${GROUND - 2} Q 200 ${GROUND - 8} 400 ${GROUND - 4} T 800 ${GROUND} L800 ${LAKE} L0 ${LAKE} Z`} fill="#0d1210" />
        <path d={`M0 ${GROUND + 6} Q 400 ${GROUND - 2} 800 ${GROUND + 8} L800 ${LAKE} L0 ${LAKE} Z`} fill="#0a0e0c" />

        {/* ── lake */}
        <rect x={0} y={LAKE} width={800} height={112} fill={`url(#lake-${uid})`} />
        {/* reflection */}
        <g mask={`url(#reflmask-${uid})`} opacity={0.42}>
          <g transform={`translate(0,${LAKE * 2}) scale(1,-1)`} filter={`url(#blur-${uid})`}>
            {houseBody}
            {saunaGroup}
          </g>
        </g>
        {/* moon reflection & ripples */}
        <g opacity={0.5 * (1 - md)}>
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.rect
              key={i}
              x={528 - i * 3}
              y={LAKE + 12 + i * 14}
              width={40 + i * 6}
              height={1.2}
              rx={0.6}
              fill="#f4e2bb"
              animate={{ x: [528 - i * 3, 534 - i * 3, 528 - i * 3], opacity: [0.2, 0.55, 0.2] }}
              transition={{ duration: 3 + i, repeat: Infinity, ease: 'easeInOut' }}
            />
          ))}
        </g>
        {Array.from({ length: 10 }, (_, i) => (
          <motion.rect
            key={i}
            x={40 + i * 76}
            y={LAKE + 20 + (i % 4) * 22}
            height={0.8}
            width={30}
            fill="#8ab4ff"
            opacity={0.12}
            animate={{ x: [40 + i * 76, 60 + i * 76, 40 + i * 76] }}
            transition={{ duration: 6 + (i % 3), repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}

        {/* ── crane */}
        {craneOn && (
          <g opacity={craneIn} transform={`translate(${(1 - craneIn) * 120},0)`}>
            <g stroke="#e3a33a" strokeWidth={1.4} fill="none">
              <line x1={640} y1={GROUND} x2={640} y2={70} />
              <line x1={652} y1={GROUND} x2={652} y2={70} />
              {Array.from({ length: 13 }, (_, i) => (
                <line key={i} x1={640} y1={GROUND - i * 20} x2={652} y2={GROUND - (i + 1) * 20} />
              ))}
            </g>
            <motion.g style={{ originX: '646px', originY: '70px' }} animate={{ rotate: [0, -2.5, 0, 1.5, 0] }} transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}>
              <rect x={430} y={64} width={260} height={6} fill="none" stroke="#e3a33a" strokeWidth={1.2} />
              {Array.from({ length: 22 }, (_, i) => (
                <line key={i} x1={432 + i * 12} y1={70} x2={438 + i * 12} y2={64} stroke="#e3a33a" strokeWidth={0.8} />
              ))}
              <rect x={660} y={70} width={26} height={14} fill="#3a3f46" />
              <rect x={636} y={50} width={20} height={14} fill="#e3a33a" />
              <line x1={646} y1={50} x2={646} y2={34} stroke="#e3a33a" strokeWidth={1.4} />
              <line x1={646} y1={34} x2={440} y2={64} stroke="#e3a33a" strokeWidth={0.7} />
              <line x1={646} y1={34} x2={686} y2={64} stroke="#e3a33a" strokeWidth={0.7} />
              <circle cx={646} cy={33} r={2} fill="#ff6b7f" className="animate-pulse-soft" />
              {/* trolley + hook carrying a beam */}
              <motion.g animate={{ x: [0, -60, 0] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}>
                <rect x={500} y={70} width={10} height={4} fill="#3a3f46" />
                <motion.g animate={{ y: [0, 40, 0] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}>
                  <line x1={505} y1={74} x2={505} y2={140} stroke="#9aa3ad" strokeWidth={0.6} />
                  <path d="M502 140 h6 v3 q0 4 -3 4 q-3 0 -3 -3" fill="none" stroke="#9aa3ad" strokeWidth={1.2} />
                  {p < 0.6 && <rect x={480} y={148} width={50} height={4} fill="#c9a06a" />}
                </motion.g>
              </motion.g>
            </motion.g>
          </g>
        )}

        {/* ── trees near (grow in with garden) */}
        <motion.g style={{ x: nearX }}>
          <Pine x={40} y={GROUND + 4} s={1.15} grow={1} />
          <Pine x={84} y={GROUND + 8} s={0.8} grow={1} />
          <Pine x={232} y={GROUND + 2} s={0.75} grow={seg(garden, 0, 0.5)} color="#0e1a14" />
          <Pine x={770} y={GROUND + 6} s={1.25} grow={1} />
          <Pine x={730} y={GROUND + 2} s={0.85} grow={seg(garden, 0.3, 0.8)} color="#0e1a14" />
        </motion.g>

        {/* ── the house */}
        {houseBody}
        {saunaGroup}

        {/* chimney smoke + sauna smoke */}
        {lights > 0.4 && (
          <g>
            {[0, 1, 2].map((i) => (
              <motion.circle
                key={i}
                cx={425}
                cy={170}
                r={5}
                fill="#cfd5dc"
                initial={{ opacity: 0 }}
                animate={{ cy: [170, 120], cx: [425, 440 + i * 6], r: [4, 14], opacity: [0.28, 0] }}
                transition={{ duration: 5, repeat: Infinity, delay: i * 1.6, ease: 'easeOut' }}
              />
            ))}
          </g>
        )}
        {sauna > 0.9 && (
          <g>
            {[0, 1].map((i) => (
              <motion.circle key={i} cx={197} cy={280} r={3} fill="#cfd5dc" animate={{ cy: [280, 240], r: [3, 10], opacity: [0.25, 0] }} transition={{ duration: 4, repeat: Infinity, delay: i * 2 }} />
            ))}
          </g>
        )}

        {/* ── boat */}
        {boat > 0 && (
          <motion.g initial={false} animate={{ y: [0, 1.5, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} opacity={easeOut(boat)}>
            <g transform={`translate(${(1 - easeOut(boat)) * 80},0)`}>
              <path d={`M706 ${LAKE + 12} h44 l-6 7 h-34 z`} fill="#f4efe6" />
              <path d={`M710 ${LAKE + 12} h36 v-3 h-36 z`} fill="#8a6136" />
              <line x1={728} y1={LAKE + 9} x2={728} y2={LAKE - 24} stroke="#c9d1dc" strokeWidth={1} />
              <path d={`M729 ${LAKE - 22} l14 18 h-14 z`} fill="#e3c48d" opacity={0.85} />
            </g>
          </motion.g>
        )}

        {/* ── storm when in drawdown */}
        {md > 0.05 && (
          <g opacity={md}>
            <rect width={800} height={460} fill="#0a0c10" opacity={0.35} />
            {[0, 1, 2, 3].map((i) => (
              <motion.g key={i} animate={{ x: [0, 30, 0] }} transition={{ duration: 18 + i * 4, repeat: Infinity, ease: 'easeInOut' }}>
                <ellipse cx={120 + i * 200} cy={60 + (i % 2) * 30} rx={150} ry={34} fill="#1b1f27" />
                <ellipse cx={170 + i * 200} cy={46 + (i % 2) * 30} rx={90} ry={28} fill="#232832" />
              </motion.g>
            ))}
            {md > 0.3 &&
              Array.from({ length: 60 }, (_, i) => (
                <motion.line
                  key={i}
                  x1={(i * 53) % 800}
                  x2={((i * 53) % 800) - 6}
                  y1={0}
                  y2={14}
                  stroke="#8ab4ff"
                  strokeOpacity={0.35}
                  strokeWidth={0.8}
                  animate={{ y: [-20, 470] }}
                  transition={{ duration: 0.9 + (i % 5) * 0.15, repeat: Infinity, delay: (i % 10) * 0.09, ease: 'linear' }}
                />
              ))}
            {md > 0.65 && (
              <motion.rect width={800} height={460} fill="#cfe0ff" animate={{ opacity: [0, 0, 0.25, 0, 0.12, 0, 0] }} transition={{ duration: 7, repeat: Infinity, times: [0, 0.6, 0.62, 0.64, 0.66, 0.7, 1] }} />
            )}
          </g>
        )}

        {/* ── completion fireworks */}
        {done && (
          <g>
            {[
              { x: 220, y: 110, c: '#e3c48d', d: 0 },
              { x: 560, y: 90, c: '#4fdc9c', d: 1.1 },
              { x: 410, y: 60, c: '#c4a2ff', d: 2.2 },
            ].map((f, k) => (
              <g key={k}>
                {Array.from({ length: 14 }, (_, i) => {
                  const a = (i / 14) * Math.PI * 2
                  return (
                    <motion.circle
                      key={i}
                      cx={f.x}
                      cy={f.y}
                      r={1.8}
                      fill={f.c}
                      animate={{ cx: [f.x, f.x + Math.cos(a) * 46], cy: [f.y, f.y + Math.sin(a) * 46 + 10], opacity: [0, 1, 0] }}
                      transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 1.6, delay: f.d, ease: 'easeOut' }}
                    />
                  )
                })}
              </g>
            ))}
            {/* flag on the roof */}
            <line x1={370} y1={164} x2={370} y2={136} stroke="#c9d1dc" strokeWidth={1} />
            <motion.path d="M370 137 h18 l-4 5 l4 5 h-18 z" fill="#e3c48d" animate={{ skewY: [0, 4, 0] }} transition={{ duration: 2, repeat: Infinity }} />
          </g>
        )}

        {showLabels && (
          <text x={20} y={440} className="fill-ink-3 text-[11px]">
            {Math.round(p * 100)}% built
          </text>
        )}
      </g>
    </svg>
  )
}
