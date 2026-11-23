import { create } from 'zustand'

interface UIState {
  openTradeId: string | null
  editTradeId: string | null
  openTrade: (id: string | null) => void
  editTrade: (id: string | null) => void
  /** ids passed from Edge Report / charts into the Journal as a drill-down filter */
  drill: { label: string; ids: string[] } | null
  setDrill: (d: { label: string; ids: string[] } | null) => void
  /** equity charts: account equity or the profit since the start (remembered in this browser) */
  curveMode: 'equity' | 'profit'
  setCurveMode: (m: 'equity' | 'profit') => void
}

const savedMode = (() => {
  try {
    return localStorage.getItem('swedenJournalCurve') === 'profit' ? 'profit' : 'equity'
  } catch {
    return 'equity'
  }
})()

export const useUI = create<UIState>((set) => ({
  openTradeId: null,
  editTradeId: null,
  openTrade: (id) => set({ openTradeId: id }),
  editTrade: (id) => set({ editTradeId: id }),
  drill: null,
  setDrill: (drill) => set({ drill }),
  curveMode: savedMode,
  setCurveMode: (curveMode) => {
    try {
      localStorage.setItem('swedenJournalCurve', curveMode)
    } catch {
      /* ignore */
    }
    set({ curveMode })
  },
}))
