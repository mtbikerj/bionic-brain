const BASE = '/api'

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = err.detail
    const msg = typeof detail === 'string' ? detail : Array.isArray(detail)
      ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
      : res.statusText
    throw new Error(msg)
  }
  if (res.status === 204) return null
  return res.json()
}

// Nodes
export const getNodes = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return req('GET', `/nodes${qs ? '?' + qs : ''}`)
}
export const getNode = (id) => req('GET', `/nodes/${id}`)
export const createNode = (data) => req('POST', '/nodes', data)
export const updateNode = (id, data) => req('PATCH', `/nodes/${id}`, data)
export const deleteNode = (id) => req('DELETE', `/nodes/${id}`)
export const getNodeBody = (id) => req('GET', `/nodes/${id}/body`)
export const setNodeBody = (id, content) => req('PUT', `/nodes/${id}/body`, { content })
export const getNodeRelationships = (id) => req('GET', `/nodes/${id}/relationships`)

// Edges
export const createEdge = (data) => req('POST', '/edges', data)
export const deleteEdge = (id) => req('DELETE', `/edges/${id}`)

// Types
export const getTypes = () => req('GET', '/types')
export const getType = (name) => req('GET', `/types/${name}`)
export const createType = (data) => req('POST', '/types', data)
export const updateType = (name, data) => req('PATCH', `/types/${name}`, data)
export const deleteType = (name) => req('DELETE', `/types/${name}`)
export const migrateType = (name, data) => req('POST', `/types/${name}/migrate`, data)

// Labels
export const getLabels = () => req('GET', '/nodes/labels')

// AI — type suggestion
export const suggestType = (conversation) => req('POST', '/ai/suggest-type', { conversation })

// AI — agents
export const getAgents = (nodeType) => req('GET', `/ai/agents${nodeType ? '?node_type=' + nodeType : ''}`)
export const routeTask = (taskId) => req('POST', '/ai/route-task', { task_id: taskId })
export const runAgent = (taskId, agentName) => req('POST', '/ai/run-agent', { task_id: taskId, agent_name: agentName })
export const respondToAgent = (runId, reply) => req('POST', `/ai/run-agent/${runId}/respond`, { reply })
export const retryAgent = (runId) => req('POST', `/ai/run-agent/${runId}/retry`)
export const getLatestRun = (taskId) => req('GET', `/ai/run-agent/latest?task_id=${taskId}`)
export const getActiveTasks = () => req('GET', '/ai/active-tasks')

// AI — routing rules
export const getRoutingRules = () => req('GET', '/ai/routing-rules')
export const createRoutingRule = (data) => req('POST', '/ai/routing-rules', data)
export const deleteRoutingRule = (id) => req('DELETE', `/ai/routing-rules/${id}`)

// Search
export const search = (params = {}) => {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v))).toString()
  return req('GET', `/search${qs ? '?' + qs : ''}`)
}
export const nlSearch = (query) => req('POST', '/search/nl', { query })
export const getTodayItems = () => req('GET', '/search/today')
export const getSavedSearches = () => req('GET', '/search/saved')
export const saveSearch = (data) => req('POST', '/search/saved', data)
export const deleteSavedSearch = (id) => req('DELETE', `/search/saved/${id}`)

// Graph
export const getGraph = (params = {}) => {
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))).toString()
  return req('GET', `/graph${qs ? '?' + qs : ''}`)
}

// Settings
export const getSettings = () => req('GET', '/settings')
export const updateSettings = (updates) => req('PUT', '/settings', updates)

// Type history
export const getTypeHistory = (name) => req('GET', `/types/${name}/history`)

// Custom agents
export const getCustomAgents = () => req('GET', '/agents')
export const createCustomAgent = (data) => req('POST', '/agents', data)
export const updateCustomAgent = (name, data) => req('PATCH', `/agents/${name}`, data)
export const deleteCustomAgent = (name) => req('DELETE', `/agents/${name}`)
