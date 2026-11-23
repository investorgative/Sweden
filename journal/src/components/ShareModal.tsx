import { useEffect, useState } from 'react'
import { Check, Copy, Download, Link2, Share2 } from 'lucide-react'
import { Modal, Button } from './ui/primitives'
import { renderShareCard, shareOrDownload, download, copyImage, type ShareCardInput } from '@/lib/share'
import { useSettings } from '@/store/useJournal'

export function ShareModal({ open, onClose, input, slug }: { open: boolean; onClose: () => void; input: Omit<ShareCardInput, 'handle' | 'name'> | null; slug: string }) {
  const settings = useSettings()
  const [url, setUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !input) return
    let alive = true
    setUrl(null)
    setDone(null)
    renderShareCard({ ...input, handle: settings.handle, name: settings.traderName }).then((b) => {
      if (!alive) return
      setBlob(b)
      setUrl(URL.createObjectURL(b))
    })
    return () => {
      alive = false
    }
  }, [open, input, settings.handle, settings.traderName])

  const link = `${location.origin}/journal/`
  const flash = (s: string) => {
    setDone(s)
    setTimeout(() => setDone(null), 1800)
  }

  return (
    <Modal open={open} onClose={onClose} width={720} title="Share">
      <div className="space-y-5 p-6">
        <div className="overflow-hidden rounded-2xl border border-line bg-bg-0" style={{ aspectRatio: '1200/630' }}>
          {url ? <img src={url} alt="Share card preview" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-sm text-ink-3">Rendering card…</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="gold" disabled={!blob} onClick={() => blob && shareOrDownload(blob, `aurum-${slug}.png`, `${input?.title} — via Aurum`).then((r) => flash(r))}>
            <Share2 size={15} /> Share
          </Button>
          <Button variant="outline" disabled={!blob} onClick={() => blob && (download(blob, `aurum-${slug}.png`), flash('downloaded'))}>
            <Download size={15} /> Download PNG
          </Button>
          <Button variant="outline" disabled={!blob} onClick={() => blob && copyImage(blob).then((ok) => flash(ok ? 'image copied' : 'copy not supported'))}>
            <Copy size={15} /> Copy image
          </Button>
          <Button variant="outline" onClick={() => navigator.clipboard?.writeText(link).then(() => flash('link copied'))}>
            <Link2 size={15} /> Copy link
          </Button>
          {done && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-profit">
              <Check size={14} /> {done}
            </span>
          )}
        </div>
        <p className="text-[11px] text-ink-4">Profile links are a placeholder until a backend is connected. Amounts follow your privacy setting — hide them before sharing if you prefer percentages.</p>
      </div>
    </Modal>
  )
}
