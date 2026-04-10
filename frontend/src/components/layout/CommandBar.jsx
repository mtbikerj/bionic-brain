import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { search as apiSearch, getTypes } from '../../api'
import { useAppStore } from '../../stores/appStore'
import './CommandBar.css'

const SYSTEM_TYPES = new Set(['DAY', 'MONTH', 'YEAR', 'DATETIME', 'SCHEMA_VERSION', 'AGENT_RUN', 'ROUTING_RULE', 'INBOX_ITEM'])

function candidatesFor(query) {
  const q = query.toLowerCase().trim()
  const IRREGULARS = { people: 'person', persons: 'person', criteria: 'criterion', indices: 'index', media: 'medium' }
  return [
    q,
    IRREGULARS[q],
    q.replace(/ies$/, 'y'),   // activities → activity
    q.replace(/ves$/, 'f'),   // leaves → leaf
    q.replace(/ses$/, 's'),   // buses → bus
    q.replace(/es$/, ''),     // boxes → box
    q.replace(/s$/, ''),      // tasks → task, notes → note
  ].filter(Boolean)
}

function inferType(query, types) {
  if (!query.trim()) return null
  const candidates = candidatesFor(query)
  return types.find((t) => {
    const name = t.name.toLowerCase()
    const nameSpaced = name.replace(/_/g, ' ')
    return candidates.some((c) => c === name || c === nameSpaced)
  }) || null
}

function typeLabel(name) {
  return name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, ' ')
}

export default function CommandBar({ drawerOpen }) {
  const navigate   = useNavigate()
  const { setHighlightIds, clearHighlight, typeColors, graphNodes, typeFilter, setTypeFilter, clearTypeFilter } = useAppStore()

  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState(null)   // null = not yet searched
  const [searching, setSearching] = useState(false)
  const [focused, setFocused]     = useState(false)
  const [types, setTypes]         = useState([])
  const inputRef = useRef(null)

  useEffect(() => { getTypes().then(setTypes).catch(() => {}) }, [])

  const userTypes = types.filter((t) => !SYSTEM_TYPES.has(t.name))
  const inferredType = inferType(query, userTypes)

  // Count nodes of inferred type from graph data
  const inferredTypeCount = inferredType
    ? graphNodes.filter((n) => n.type === inferredType.name).length
    : 0

  const runSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults(null); clearHighlight(); return }
    setSearching(true)
    try {
      const data = await apiSearch({ q: q.trim() })
      const res  = data.results || []
      setResults(res)
      setHighlightIds(res.map((n) => n.id))
    } catch {
      setResults([])
      clearHighlight()
    } finally {
      setSearching(false)
    }
  }, [setHighlightIds, clearHighlight])

  const clear = () => {
    setQuery('')
    setResults(null)
    clearHighlight()
    clearTypeFilter()
    inputRef.current?.blur()
    setFocused(false)
  }

  const openNode = (node) => {
    navigate(`/nodes/${node.id}`)
    clear()
  }

  const typeColor = (typeName) => typeColors[typeName] || '#6b7280'

  const showDropdown = focused && query.trim().length > 0

  return (
    <div className={`cmdbar-wrap ${drawerOpen ? 'drawer-open' : ''}`}>
      <div className={`cmdbar ${focused ? 'focused' : ''}`}>
        <span className="cmdbar-search-icon">
          {searching ? <span className="spinner cmdbar-spinner" /> : '⌕'}
        </span>

        <input
          id="command-bar-input"
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setResults(null) }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 180)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') clear()
            if (e.key === 'Enter' && query.trim()) runSearch(query)
          }}
          placeholder="Search or ask anything…  ⌘K"
          className="cmdbar-input"
          autoComplete="off"
          spellCheck={false}
        />

        {query && (
          <button className="cmdbar-clear" onClick={clear} title="Clear">✕</button>
        )}

        {/* Type filter pills — shown when idle and not focused-with-query */}
        {!query && !focused && userTypes.length > 0 && (
          <div className="cmdbar-type-pills">
            {userTypes.slice(0, 6).map((t) => {
              const isActive = typeFilter === t.name
              return (
                <button
                  key={t.name}
                  className={`cmdbar-type-pill${isActive ? ' active' : ''}`}
                  style={{ '--pill-color': typeColor(t.name) }}
                  onClick={() => isActive ? clearTypeFilter() : setTypeFilter(t.name)}
                >
                  <span className="cmdbar-pill-dot" style={{ background: typeColor(t.name) }} />
                  {typeLabel(t.name)}
                  <span className="cmdbar-pill-count">{t.node_count || 0}</span>
                  {isActive && <span className="cmdbar-pill-close">✕</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="cmdbar-dropdown">

          {/* State B: type matched */}
          {inferredType && results === null && (
            <div className="cmdbar-inferred-row">
              <span className="cmdbar-type-dot" style={{ background: typeColor(inferredType.name) }} />
              <span className="cmdbar-inferred-label">
                Looks like a <strong>{typeLabel(inferredType.name)}</strong>
              </span>
              {inferredTypeCount > 0 && (
                <span className="cmdbar-type-count">{inferredTypeCount}</span>
              )}
              <div className="cmdbar-inferred-actions">
                <button
                  className="cmdbar-add-type"
                  onMouseDown={() => navigate(`/nodes/new?type=${inferredType.name}&label=${encodeURIComponent(query)}`)}
                >
                  Add a new {typeLabel(inferredType.name).toLowerCase()}
                </button>
                <button
                  className="cmdbar-search-btn"
                  onMouseDown={() => runSearch(query)}
                >
                  Search →
                </button>
              </div>
            </div>
          )}

          {/* State C: no type match, no results yet */}
          {!inferredType && results === null && (
            <div className="cmdbar-unknown-section">
              <div className="cmdbar-unknown-header">
                <em>"{query}"</em> — Looks like something new. What is it?
              </div>
              <div className="cmdbar-what-chips">
                {userTypes.map((t) => (
                  <button
                    key={t.name}
                    className="cmdbar-what-chip"
                    style={{ '--chip-color': typeColor(t.name) }}
                    onMouseDown={() => navigate(`/nodes/new?type=${t.name}&label=${encodeURIComponent(query)}`)}
                  >
                    <span className="cmdbar-pill-dot" style={{ background: typeColor(t.name) }} />
                    {typeLabel(t.name)}
                  </button>
                ))}
              </div>
              <div className="cmdbar-unknown-actions">
                <button
                  className="cmdbar-newtype-btn"
                  onMouseDown={() => { navigate(`/types/new?suggest=${encodeURIComponent(query)}`); clear() }}
                >
                  Define new type →
                </button>
                <button
                  className="cmdbar-inbox-btn"
                  onMouseDown={() => navigate(`/nodes/new?type=INBOX_ITEM&label=${encodeURIComponent(query)}`)}
                >
                  Capture to inbox
                </button>
                <button
                  className="cmdbar-search-btn"
                  onMouseDown={() => runSearch(query)}
                >
                  Search →
                </button>
              </div>
            </div>
          )}

          {/* Search results (after explicit search) */}
          {results !== null && (
            <>
              {results.length > 0 ? (
                <div className="cmdbar-results">
                  {results.slice(0, 12).map((node) => (
                    <button
                      key={node.id}
                      className="cmdbar-result"
                      onMouseDown={() => openNode(node)}
                    >
                      <span className="cmdbar-result-dot" style={{ background: typeColor(node.type) }} />
                      <span className="cmdbar-result-label">{node.label}</span>
                      <span className="cmdbar-result-type">{typeLabel(node.type)}</span>
                    </button>
                  ))}
                  {results.length > 12 && (
                    <div className="cmdbar-more">+{results.length - 12} more</div>
                  )}
                </div>
              ) : (
                <div className="cmdbar-empty">Nothing found for <em>"{query}"</em></div>
              )}

              <div className="cmdbar-create-row">
                {inferredType ? (
                  <button
                    className="cmdbar-create-btn"
                    onMouseDown={() => navigate(`/nodes/new?type=${inferredType.name}&label=${encodeURIComponent(query)}`)}
                  >
                    Add a new {typeLabel(inferredType.name).toLowerCase()} <em>"{query}"</em>
                  </button>
                ) : (
                  <button
                    className="cmdbar-create-btn"
                    onMouseDown={() => navigate(`/nodes/new?type=INBOX_ITEM&label=${encodeURIComponent(query)}`)}
                  >
                    Capture <em>"{query}"</em> to inbox
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
