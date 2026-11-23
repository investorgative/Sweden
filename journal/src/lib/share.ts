/**
 * Share-card renderer: composes a 1200×630 PNG (OpenGraph size) on a canvas.
 * Optionally embeds a live SVG (the house, a badge) by serialising it.
 */

export interface ShareCardInput {
  eyebrow: string
  title: string
  subtitle?: string
  stats?: { label: string; value: string; tone?: 'profit' | 'loss' | 'gold' }[]
  svg?: SVGSVGElement | null
  accent?: string
  handle: string
  name: string
}

async function svgToImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const vb = svg.viewBox.baseVal
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(vb?.width || svg.clientWidth))
  clone.setAttribute('height', String(vb?.height || svg.clientHeight))
  // inline computed colors for elements styled through CSS classes
  const src = svg.querySelectorAll('*')
  const dst = clone.querySelectorAll('*')
  src.forEach((el, i) => {
    const cs = getComputedStyle(el)
    const d = dst[i] as SVGElement
    if (cs.color && el.closest('svg') === svg) d.style.color = cs.color
    if (el instanceof SVGTextElement) {
      d.style.fill = cs.fill
      d.style.fontSize = cs.fontSize
      d.style.fontFamily = cs.fontFamily
    }
  })
  const xml = new XMLSerializer().serializeToString(clone)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = rej
    img.src = url
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  await document.fonts?.ready
  const W = 1200
  const H = 630
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const accent = input.accent ?? '#e3c48d'

  // background
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0b0d10')
  bg.addColorStop(1, '#060708')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(180, 0, 10, 180, 0, 700)
  glow.addColorStop(0, 'rgba(227,196,141,0.18)')
  glow.addColorStop(1, 'rgba(227,196,141,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  const hasArt = !!input.svg
  const textW = hasArt ? 560 : 1040

  // art panel
  if (input.svg) {
    try {
      const img = await svgToImage(input.svg)
      const ax = 640
      const ay = 60
      const aw = 500
      const ah = 510
      ctx.save()
      roundRect(ctx, ax, ay, aw, ah, 28)
      ctx.clip()
      ctx.fillStyle = '#0b0d10'
      ctx.fillRect(ax, ay, aw, ah)
      const ratio = img.width / img.height
      let dw = aw
      let dh = aw / ratio
      if (dh < ah) {
        dh = ah
        dw = ah * ratio
      }
      ctx.drawImage(img, ax + (aw - dw) / 2, ay + (ah - dh) / 2, dw, dh)
      ctx.restore()
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'
      ctx.lineWidth = 2
      roundRect(ctx, ax, ay, aw, ah, 28)
      ctx.stroke()
    } catch {
      /* art is optional */
    }
  }

  // logo
  ctx.strokeStyle = accent
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(64, 102)
  ctx.lineTo(82, 70)
  ctx.lineTo(100, 102)
  ctx.stroke()
  ctx.fillStyle = '#f4efe6'
  ctx.font = '400 34px "Instrument Serif", serif'
  ctx.fillText('Aurum', 114, 98)

  // eyebrow
  ctx.fillStyle = accent
  ctx.font = '600 18px "Inter Variable", sans-serif'
  ctx.letterSpacing = '4px'
  ctx.fillText(input.eyebrow.toUpperCase(), 64, 190)
  ctx.letterSpacing = '0px'

  // title (wrap)
  ctx.fillStyle = '#f4efe6'
  ctx.font = '400 76px "Instrument Serif", serif'
  const words = input.title.split(' ')
  let line = ''
  let y = 270
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > textW && line) {
      ctx.fillText(line, 64, y)
      line = w
      y += 78
    } else line = test
  }
  ctx.fillText(line, 64, y)

  if (input.subtitle) {
    ctx.fillStyle = '#a8a49b'
    ctx.font = '400 24px "Inter Variable", sans-serif'
    ctx.fillText(input.subtitle, 64, y + 52)
  }

  // stats
  if (input.stats?.length) {
    let x = 64
    const sy = 470
    for (const s of input.stats.slice(0, 3)) {
      ctx.fillStyle = '#6f6c66'
      ctx.font = '500 16px "Inter Variable", sans-serif'
      ctx.fillText(s.label.toUpperCase(), x, sy)
      ctx.fillStyle = s.tone === 'profit' ? '#4fdc9c' : s.tone === 'loss' ? '#ff6b7f' : s.tone === 'gold' ? accent : '#f4efe6'
      ctx.font = '600 38px "Inter Variable", sans-serif'
      ctx.fillText(s.value, x, sy + 46)
      x += Math.max(170, ctx.measureText(s.value).width + 50)
    }
  }

  // footer
  ctx.fillStyle = '#6f6c66'
  ctx.font = '500 18px "Inter Variable", sans-serif'
  ctx.fillText(`${input.name} · @${input.handle}`, 64, 586)

  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'))
}

export async function shareOrDownload(blob: Blob, filename: string, text: string) {
  const file = new File([blob], filename, { type: 'image/png' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], text })
      return 'shared'
    } catch {
      /* user cancelled */
    }
  }
  download(blob, filename)
  return 'downloaded'
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export async function copyImage(blob: Blob) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}
