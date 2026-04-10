import { create } from 'zustand'

/**
 * Global app state — graph data, search highlights, type colors.
 * Lives here so CommandBar and GraphView stay in sync without prop-drilling.
 */
export const useAppStore = create((set) => ({
  // Type colors: { TYPE_NAME: '#hexcolor' }
  typeColors: {},
  setTypeColors: (colors) => set({ typeColors: colors }),

  // Graph raw data (loaded once, reloaded on demand)
  graphNodes: [],
  graphLinks: [],
  graphLoading: true,
  graphTruncated: false,
  setGraphData: (nodes, links, truncated) =>
    set({ graphNodes: nodes, graphLinks: links, graphLoading: false, graphTruncated: truncated }),
  setGraphLoading: (v) => set({ graphLoading: v }),

  // Reload trigger — increment to force a graph refresh
  graphReloadKey: 0,
  triggerGraphReload: () => set((s) => ({ graphReloadKey: s.graphReloadKey + 1 })),

  // Search highlight — null means "no filter", Set means "show only these"
  highlightIds: null,
  setHighlightIds: (ids) => set({ highlightIds: ids ? new Set(ids) : null }),
  clearHighlight: () => set({ highlightIds: null }),

  // Type filter — clicking a pill shows only that type + direct neighbors, hides all else
  typeFilter: null,
  setTypeFilter: (typeName) => set({ typeFilter: typeName }),
  clearTypeFilter: () => set({ typeFilter: null }),

  // Which node is currently selected (shown in drawer / focused in graph)
  activeNodeId: null,
  setActiveNodeId: (id) => set({ activeNodeId: id }),
}))
