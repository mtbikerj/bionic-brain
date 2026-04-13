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

// Parse "!type" shorthand: "Get Key !task" → { label: "Get Key", forcedType: <type obj> }
function parseQueryType(query, types) {
  const match = query.match(/!(\w+)/)
  if (!match) return { label: query, forcedType: null }
  const tag = match[1].toLowerCase()
  const forcedType = types.find((t) => {
    const name = t.name.toLowerCase()
    return name === tag || name.replace(/_/g, '') === tag
  }) || null
  const label = query.replace(/\s*!\w+/g, '').trim()
  return { label, forcedType }
}

function typeLabel(name) {
  return name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, ' ')
}

export default function CommandBar({ drawerOpen }) {
  const navigate   = useNavigate()
  const { setHighlightIds, clearHighlight, typeColors, graphNodes, typeFilter, setTypeFilter, clearTypeFilter } = useAppStore()

  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState(null)   // null = not searched; [] = searched, empty
  const [searching, setSearching] = useState(false)
  const [focused, setFocused]     = useState(false)
  const [types, setTypes]         = useState([])
  const inputRef = useRef(null)

  useEffect(() => { getTypes().then(setTypes).catch(() => {}) }, [])

  const userTypes = types.filter((t) => !SYSTEM_TYPES.has(t.name))
  const { label: searchLabel, forcedType } = parseQueryType(query, userTypes)
  const inferredType = !forcedType ? inferType(searchLabel, userTypes) : null
  const activeType = forcedType || inferredType

  const inferredTypeCount = activeType
    ? graphNodes.filter((n) => n.type === activeType.name).length
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

  // Auto-search as user types (300ms debounce, min 2 chars)
  useEffect(() => {
    const { label: lbl } = parseQueryType(query, userTypes)
    const q = lbl.trim()
    if (!query.trim()) {
      setResults(null)
      clearHighlight()
      return
    }
    if (q.length < 2) return
    const timer = setTimeout(() => runSearch(q), 300)
    return () => clearTimeout(timer)
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => {
    setQuery('')
    setResults(null)
    clearHighlight()
    clearTypeFilter()
    inputRef.current?.blur()
    setFocused(false)
  }

  // Close dropdown without resetting the type filter (used when the user picks "filter by type")
  const dismiss = () => {
    setQuery('')
    setResults(null)
    clearHighlight()
    inputRef.current?.blur()
    setFocused(false)
  }

  const openNode = (node) => {
    navigate(`/nodes/${node.id}`)
    clear()
  }

  const typeColor = (typeName) => typeColors[typeName] || '#6b7280'

  const showDropdown = focused && query.trim().length > 0

  // Whether to show the "what is it?" type chips
  // — while search is pending (results still null, no type inferred)
  // — after search returns empty results
  const showTypeChips = !forcedType && (
    (results === null && !searching && !inferredType && searchLabel.trim().length >= 2) ||
    (results !== null && results.length === 0)
  )

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
            if (e.key === 'Enter' && searchLabel.trim()) runSearch(searchLabel)
          }}
          placeholder="Search or capture… hint: use ! after your text to connect it, e.g. 'Buy groceries !task'  ⌘K"
          className="cmdbar-input"
          autoComplete="off"
          spellCheck={false}
        />

        {/* Forced-type badge (from !type syntax) */}
        {forcedType && (
          <span
            className="cmdbar-forced-badge"
            style={{ background: `color-mix(in srgb, ${typeColor(forcedType.name)} 20%, transparent)`, borderColor: `color-mix(in srgb, ${typeColor(forcedType.name)} 45%, transparent)`, color: typeColor(forcedType.name) }}
          >
            {typeLabel(forcedType.name)}
          </span>
        )}

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

          {/* Inferred type row (auto-matched, no !type override) */}
          {inferredType && results === null && !searching && (
            <div className="cmdbar-inferred-row">
              <span className="cmdbar-type-dot" style={{ background: typeColor(inferredType.name) }} />
              <span className="cmdbar-inferred-label">
                Looks like a <strong>{typeLabel(inferredType.name)}</strong>
              </span>
              <div className="cmdbar-inferred-actions">
                {inferredTypeCount > 0 && (
                  <button
                    className="cmdbar-filter-btn"
                    style={{ '--filter-color': typeColor(inferredType.name) }}
                    onMouseDown={() => { setTypeFilter(inferredType.name); dismiss() }}
                  >
                    <span className="cmdbar-pill-dot" style={{ background: typeColor(inferredType.name) }} />
                    Show all {inferredTypeCount}
                  </button>
                )}
                <button
                  className="cmdbar-add-type"
                  onMouseDown={() => navigate(`/nodes/new?type=${inferredType.name}&label=${encodeURIComponent(searchLabel)}`)}
                >
                  + New {typeLabel(inferredType.name).toLowerCase()}
                </button>
              </div>
            </div>
          )}

          {/* Searching indicator */}
          {searching && (
            <div className="cmdbar-searching-row">
              <span className="spinner cmdbar-spinner" /> Searching…
            </div>
          )}

          {/* Search results */}
          {results !== null && results.length > 0 && (
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
          )}

          {/* Type chips: shown while pending (no type inferred) or after empty results */}
          {showTypeChips && (
            <div className="cmdbar-unknown-section">
              <div className="cmdbar-unknown-header">
                {results !== null && results.length === 0
                  ? <><em>"{searchLabel}"</em> — nothing found. What is it?</>
                  : <><em>"{searchLabel}"</em> — what is it? <span className="cmdbar-hint">type !task, !note…</span></>
                }
              </div>
              <div className="cmdbar-what-chips">
                {userTypes.map((t) => (
                  <button
                    key={t.name}
                    className="cmdbar-what-chip"
                    style={{ '--chip-color': typeColor(t.name) }}
                    onMouseDown={() => navigate(`/nodes/new?type=${t.name}&label=${encodeURIComponent(searchLabel)}`)}
                  >
                    <span className="cmdbar-pill-dot" style={{ background: typeColor(t.name) }} />
                    {typeLabel(t.name)}
                  </button>
                ))}
              </div>
              <div className="cmdbar-unknown-actions">
                <button
                  className="cmdbar-newtype-btn"
                  onMouseDown={() => { navigate(`/types/new?suggest=${encodeURIComponent(searchLabel)}`); clear() }}
                >
                  Define new type →
                </button>
                <button
                  className="cmdbar-inbox-btn"
                  onMouseDown={() => navigate(`/nodes/new?type=INBOX_ITEM&label=${encodeURIComponent(searchLabel)}`)}
                >
                  Capture to inbox
                </button>
              </div>
            </div>
          )}

          {/* Create row — shown after search returns (with or without results) */}
          {results !== null && (
            <div className="cmdbar-create-row">
              {activeType ? (
                <button
                  className="cmdbar-create-btn"
                  onMouseDown={() => navigate(`/nodes/new?type=${activeType.name}&label=${encodeURIComponent(searchLabel)}`)}
                >
                  + New {typeLabel(activeType.name).toLowerCase()} <em>"{searchLabel}"</em>
                </button>
              ) : results.length > 0 && (
                <button
                  className="cmdbar-inbox-btn cmdbar-create-inbox"
                  onMouseDown={() => navigate(`/nodes/new?type=INBOX_ITEM&label=${encodeURIComponent(searchLabel)}`)}
                >
                  Capture <em>"{searchLabel}"</em> to inbox
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
