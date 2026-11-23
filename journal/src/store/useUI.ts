import { create } from 'zustand'

interface UIState {
  openTradeId: string | null
  editTradeId: string | null
  openTrade: (id: string | null) => void
  editTrade: (id: string | null) => void
  /** ids passed from Edge Report / charts into the Journal as a drill-down filter */
  drill: { label: string; ids: string[] } | null
  setDrill: (d: { label: string; ids: string[] } | null) => void
}

export const useUI = create<UIState>((set) => ({
  openTradeId: null,
  editTradeId: null,
  openTrade: (id) => set({ openTradeId: id }),
  editTrade: (id) => set({ editTradeId: id }),
  drill: null,
  setDrill: (drill) => set({ drill }),
}))
