import { create } from 'zustand'
import * as api from '../api'

export const useNodeStore = create((set, get) => ({
  nodes: {},       // id → node
  types: [],
  loading: false,
  error: null,

  fetchTypes: async () => {
    const types = await api.getTypes()
    set({ types })
    return types
  },

  fetchNode: async (id) => {
    const node = await api.getNode(id)
    set((s) => ({ nodes: { ...s.nodes, [id]: node } }))
    return node
  },

  createNode: async (data) => {
    const node = await api.createNode(data)
    set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }))
    return node
  },

  updateNode: async (id, data) => {
    const node = await api.updateNode(id, data)
    set((s) => ({ nodes: { ...s.nodes, [id]: node } }))
    return node
  },

  deleteNode: async (id) => {
    await api.deleteNode(id)
    set((s) => {
      const nodes = { ...s.nodes }
      delete nodes[id]
      return { nodes }
    })
  },
}))
