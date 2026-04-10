import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { search as apiSearch, nlSearch as apiNlSearch, getTypes, getSavedSearches, saveSearch, deleteSavedSearch } from '../api'
import NodeCard from '../components/nodes/NodeCard'
import './SearchView.css'
import './View.css'

const HISTORY_KEY = 'bb_search_history'
const MAX_HISTORY = 10

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}
function persistHistory(h) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h))
}

export default function SearchView() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('text') // 'text' | 'nl'
  const [filters, setFilters] = useState({ type: '', date_from: '', date_to: '' })
  const [showFilters, setShowFilters] = useState(false)
  const [results, setResults] = useState(null) // null = not yet searched
  const [nlMeta, setNlMeta] = useState(null)   // { cypher, explanation }
  const [showCypher, setShowCypher] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState(loadHistory)
  const [showHistory, setShowHistory] = useState(false)
  const [savedSearches, setSavedSearches] = useState([])
  const [savingLabel, setSavingLabel] = useState('')
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [types, setTypes] = useState([])
  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { getTypes().then(setTypes).catch(() => {}) }, [])

  const loadSaved = useCallback(async () => {
    try { setSavedSearches(await getSavedSearches()) } catch (e) { void e }
  }, [])
  useEffect(() => { loadSaved() }, [loadSaved])

  const addToHistory = useCallback((q, m) => {
    setHistory((prev) => {
      const next = [{ q, mode: m, at: Date.now() }, ...prev.filter((h) => h.q !== q)].slice(0, MAX_HISTORY)
      persistHistory(next)
      return next
    })
  }, [])

  const runTextSearch = useCallback(async (q, f) => {
    if (!q.trim()) { setResults(null); return }
    setLoading(true)
    setNlMeta(null)
    setError(null)
    try {
      const params = { q: q.trim() }
      if (f.type) params.type = f.type
      if (f.date_from) params.date_from = f.date_from
      if (f.date_to) params.date_to = f.date_to
      const data = await apiSearch(params)
      setResults(data.results || [])
      addToHistory(q.trim(), 'text')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [addToHistory])

  // Debounced text search
  useEffect(() => {
    if (mode !== 'text') return
    if (!query.trim()) { setResults(null); setError(null); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runTextSearch(query, filters), 250)
    return () => clearTimeout(debounceRef.current)
  }, [query, filters, mode, runTextSearch])

  const runNlSearch = async () => {
    if (!query.trim() || loading) return
    setLoading(true)
    setError(null)
    setShowCypher(false)
    try {
      const data = await apiNlSearch(query.trim())
      setResults(data.results || [])
      setNlMeta({ cypher: data.cypher, explanation: data.explanation })
      addToHistory(query.trim(), 'nl')
    } catch (err) {
      setError(err.message)
      setResults(null)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && mode === 'nl') runNlSearch()
    if (e.key === 'Escape') { setShowHistory(false); inputRef.current?.blur() }
  }

  const applyHistoryItem = (item) => {
    setQuery(item.q)
    setMode(item.mode)
    setShowHistory(false)
  }

  const handleSaveSearch = async () => {
    if (!savingLabel.trim() || !results) return
    try {
      await saveSearch({
        label: savingLabel.trim(),
        query: query.trim(),
        mode,
        cypher: nlMeta?.cypher || '',
        filters,
      })
      setSavingLabel('')
      setShowSaveForm(false)
      loadSaved()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleDeleteSaved = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Delete this saved search?')) return
    try {
      await deleteSavedSearch(id)
      loadSaved()
    } catch (err) {
      alert(err.message)
    }
  }

  const runSavedSearch = (s) => {
    setQuery(s.query)
    setMode(s.mode)
    if (s.filters) setFilters({ type: s.filters.type || '', date_from: s.filters.date_from || '', date_to: s.filters.date_to || '' })
    setShowHistory(false)
  }

  // Group results by type
  const grouped = results
    ? Object.entries(
        results.reduce((acc, n) => { (acc[n.type] = acc[n.type] || []).push(n); return acc }, {})
      ).sort(([a], [b]) => a.localeCompare(b))
    : null

  const hasActiveFilter = filters.type || filters.date_from || filters.date_to
  const userTypes = types.filter((t) => !t.is_builtin)

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Search</h1>
        <div className="search-mode-toggle">
          <button
            className={`btn btn-sm ${mode === 'text' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setMode('text'); setNlMeta(null) }}
          >Text</button>
          <button
            className={`btn btn-sm ${mode === 'nl' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMode('nl')}
          >Ask AI</button>
        </div>
      </div>

      <div className="view-content">
        {/* Search input */}
        <div className="search-input-wrap">
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => !query && setShowHistory(true)}
              onBlur={() => setTimeout(() => setShowHistory(false), 150)}
              onKeyDown={handleKeyDown}
              placeholder={mode === 'nl' ? 'Ask a question… (e.g. "tasks added this week")' : 'Search anything…'}
              style={{ fontSize: 15, padding: '10px 14px', width: '100%' }}
            />
            {showHistory && history.length > 0 && (
              <div className="search-history-dropdown">
                <div className="search-history-label">Recent</div>
                {history.map((h, i) => (
                  <div key={i} className="search-history-item" onMouseDown={() => applyHistoryItem(h)}>
                    <span className="search-history-mode">{h.mode === 'nl' ? '✨' : '🔍'}</span>
                    <span>{h.q}</span>
                  </div>
                ))}
                <div
                  className="search-history-item search-history-clear"
                  onMouseDown={() => { setHistory([]); persistHistory([]); setShowHistory(false) }}
                >
                  Clear history
                </div>
              </div>
            )}
          </div>
          {mode === 'nl' && (
            <button className="btn btn-primary" onClick={runNlSearch} disabled={loading || !query.trim()}>
              {loading ? <span className="spinner" /> : 'Search'}
            </button>
          )}
          <button
            className={`btn btn-ghost btn-sm ${hasActiveFilter ? 'filter-active' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
            title="Filters"
          >
            ⚙ {hasActiveFilter && '●'}
          </button>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="search-filters">
            <div className="search-filter-row">
              <label>Type</label>
              <select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
                <option value="">All types</option>
                {types.filter((t) => !['DAY','MONTH','YEAR','SCHEMA_VERSION'].includes(t.name)).map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name.charAt(0) + t.name.slice(1).toLowerCase().replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <label>From</label>
              <input type="date" value={filters.date_from} onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))} />
              <label>To</label>
              <input type="date" value={filters.date_to} onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))} />
              {hasActiveFilter && (
                <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ type: '', date_from: '', date_to: '' })}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
            <div className="spinner" />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="form-error" style={{ margin: '16px 0' }}>{error}</div>
        )}

        {/* NL explanation + Cypher */}
        {!loading && nlMeta && (
          <div className="nl-meta">
            <div className="nl-explanation">{nlMeta.explanation}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowCypher((v) => !v)}>
              {showCypher ? 'Hide query' : 'View query'}
            </button>
            {showCypher && (
              <pre className="nl-cypher">{nlMeta.cypher}</pre>
            )}
          </div>
        )}

        {/* Results */}
        {!loading && results !== null && (
          <>
            <div className="search-results-header">
              <span className="search-results-count">
                {results.length === 0
                  ? 'No results found.'
                  : `${results.length} result${results.length !== 1 ? 's' : ''}`}
              </span>
              {results.length > 0 && !showSaveForm && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowSaveForm(true)}>
                  Save search
                </button>
              )}
            </div>

            {showSaveForm && (
              <div className="save-search-form">
                <input
                  autoFocus
                  value={savingLabel}
                  onChange={(e) => setSavingLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveSearch()}
                  placeholder="Name this search…"
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary btn-sm" onClick={handleSaveSearch} disabled={!savingLabel.trim()}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setShowSaveForm(false); setSavingLabel('') }}>Cancel</button>
              </div>
            )}

            {results.length > 0 && grouped ? (
              grouped.length === 1 ? (
                <div className="node-list">
                  {results.map((n) => <NodeCard key={n.id} node={n} />)}
                </div>
              ) : (
                grouped.map(([type, nodes]) => (
                  <div key={type} className="search-group">
                    <div className="search-group-title">
                      {type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ')}
                      <span className="search-group-count">{nodes.length}</span>
                    </div>
                    <div className="node-list">
                      {nodes.map((n) => <NodeCard key={n.id} node={n} />)}
                    </div>
                  </div>
                ))
              )
            ) : results.length === 0 ? (
              <ZeroResultSuggestions
                query={query}
                filters={filters}
                mode={mode}
                userTypes={userTypes}
                onClearFilter={() => setFilters({ type: '', date_from: '', date_to: '' })}
                onSwitchNl={() => setMode('nl')}
                onTypeClick={(name) => navigate(`/types/${name}`)}
              />
            ) : null}
          </>
        )}

        {/* Empty state with saved searches */}
        {!loading && results === null && (
          <div>
            {savedSearches.length > 0 && (
              <div className="saved-searches-section">
                <div className="saved-searches-title">Saved searches</div>
                {savedSearches.map((s) => (
                  <div key={s.id} className="saved-search-item" onClick={() => runSavedSearch(s)}>
                    <span className="saved-search-mode">{s.mode === 'nl' ? '✨' : '🔍'}</span>
                    <span className="saved-search-label">{s.label}</span>
                    <span className="saved-search-query">{s.query}</span>
                    <button
                      className="btn btn-ghost btn-sm saved-search-delete"
                      onClick={(e) => handleDeleteSaved(s.id, e)}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <p>
                {mode === 'nl'
                  ? 'Ask a question in plain English — e.g. "coins added this month" or "tasks due this week"'
                  : 'Start typing to search nodes, notes, tasks, and more.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ZeroResultSuggestions({ query, filters, mode, userTypes, onClearFilter, onSwitchNl, onTypeClick }) {
  return (
    <div className="zero-results">
      {filters.type && (
        <div className="zero-hint">
          Filtered to <strong>{filters.type}</strong> —{' '}
          <button className="btn-link" onClick={onClearFilter}>search all types</button>
        </div>
      )}
      {mode === 'text' && (
        <div className="zero-hint">
          Try{' '}
          <button className="btn-link" onClick={onSwitchNl}>Ask AI</button>
          {' '}for natural language search: <em>"{query}"</em>
        </div>
      )}
      {userTypes.length > 0 && (
        <div className="zero-browse">
          <div className="zero-browse-title">Browse by type</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {userTypes.map((t) => (
              <button key={t.name} className="chip" onClick={() => onTypeClick(t.name)}>
                {t.name.charAt(0) + t.name.slice(1).toLowerCase().replace(/_/g, ' ')}
                <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>{t.node_count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
