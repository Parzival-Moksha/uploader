// Panels during play (the Wizard console, the Joystick, brushes, Anorak Pro, Hermes…) on the kit's "panel" layer
// (src/lib/ui-kit/layers.ts): a click brings one to the front of the panels, never above Mindcraft, the spell book,
// the main menu or a dialog. Before 2026-11-23 a click gave 9990 + n with no ceiling.
import { getLayersVersion, raiseLayer, subscribeLayers, zFor } from '@/lib/ui-kit/layers'

export interface PanelZSlice {
  /** The layer order's version: a change re-runs the selectors that read getPanelZIndex. */
  _panelZLayers: number
  _panelZCounter: number
  _panelZMap: Record<string, number>
  bringPanelToFront: (panelName: string) => void
  getPanelZIndex: (panelName: string, defaultZ: number) => number
}

interface PanelZState {
  _panelZLayers: number
  _panelZCounter: number
  _panelZMap: Record<string, number>
}

type PanelZSet<TState extends PanelZState> = (
  partial: Partial<TState> | ((state: TState) => Partial<TState>),
) => void

interface CreatePanelZSliceDeps<TState extends PanelZState> {
  set: PanelZSet<TState>
  get: () => TState
}

/** The z-index of a panel: the panel layer, plus its place among the panels clicked (defaultZ is no longer used). */
export function resolvePanelZIndex(panelName: string): number {
  return zFor(panelName, 'panel')
}

export function createPanelZSlice<TState extends PanelZState>({
  set,
  get,
}: CreatePanelZSliceDeps<TState>): PanelZSlice {
  // Another overlay opened, closed or was clicked: the panels read their z again (they would keep a stale one).
  subscribeLayers(() => set({ _panelZLayers: getLayersVersion() } as Partial<TState>))
  return {
    _panelZLayers: 0,
    _panelZCounter: 0,
    _panelZMap: {},

    bringPanelToFront: (panelName) => {
      const next = get()._panelZCounter + 1
      set({
        _panelZCounter: next,
        _panelZMap: { ...get()._panelZMap, [panelName]: next },
      } as Partial<TState>)
      raiseLayer(panelName, 'panel')
    },

    getPanelZIndex: (panelName) => {
      return resolvePanelZIndex(panelName)
    },
  }
}
