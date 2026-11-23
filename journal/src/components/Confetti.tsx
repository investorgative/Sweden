import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/** Lightweight canvas confetti in the Aurum palette. Fire with `burst` key changes. */
export function Confetti({ burst }: { burst: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!burst) return
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = innerWidth * dpr
    c.height = innerHeight * dpr
    ctx.scale(dpr, dpr)
    const colors = ['#f7e5bf', '#e3c48d', '#c7a466', '#4fdc9c', '#c4a2ff', '#ffffff']
    const parts = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 14 - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: 4 + Math.random() * 6,
      h: 6 + Math.random() * 8,
      c: colors[Math.floor(Math.random() * colors.length)],
      life: 0,
    }))
    let raf = 0
    const tick = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight)
      let alive = 0
      for (const p of parts) {
        p.life++
        p.vy += 0.32
        p.vx *= 0.985
        p.x += p.vx
        p.y += p.vy
        p.r += p.vr
        const a = Math.max(0, 1 - p.life / 150)
        if (a <= 0 || p.y > innerHeight + 20) continue
        alive++
        ctx.save()
        ctx.globalAlpha = a
        ctx.translate(p.x, p.y)
        ctx.rotate(p.r)
        ctx.fillStyle = p.c
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 8)))
        ctx.restore()
      }
      if (alive) raf = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, innerWidth, innerHeight)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [burst])
  return createPortal(<canvas ref={ref} className="pointer-events-none fixed inset-0 z-[100] h-full w-full" />, document.body)
}
