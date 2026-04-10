import { useEffect, useRef, useCallback, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as d3 from 'd3'
import { getGraph, getTypes, createEdge } from '../api'
import { useAppStore } from '../stores/appStore'
import './GraphView.css'

function formatSliderDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const EXCLUDED_EDGE_TYPES = new Set(['BELONGS_TO', 'HAS_AGENT_RUN'])
const SYSTEM_TYPES        = new Set(['DAY', 'MONTH', 'YEAR'])
const LABEL_ZOOM_THRESHOLD = 0.55

function nodeRadius(d) {
  if (SYSTEM_TYPES.has(d.type)) return 4
  return 6 + Math.min(Math.sqrt(d.connection_count || 0) * 2.5, 14)
}

// ── Graph component ───────────────────────────────────────────────────────────
export default function GraphView({ drawerOpen }) {
  const navigate    = useNavigate()
  const location    = useLocation()

  const {
    graphNodes, graphLinks, graphLoading, graphTruncated,
    setGraphData, setGraphLoading, graphReloadKey,
    typeColors, setTypeColors,
    highlightIds,
    typeFilter,
    activeNodeId,
  } = useAppStore()

  const svgRef          = useRef(null)
  const simulationRef   = useRef(null)
  const zoomRef         = useRef(null)
  const nodeGRef        = useRef(null)       // d3 selection of all node groups
  const linkRef         = useRef(null)       // d3 selection of all link lines
  const nodeDataRef     = useRef([])         // live node array for d3
  const edgePickerCbRef = useRef(null)
  const navigateRef     = useRef(null)
  const [edgePicker, setEdgePicker] = useState(null)
  const [typeDefs, setTypeDefs]     = useState([])

  // ── Archive / temporal state ──────────────────────────────────────────────
  const [showArchived, setShowArchived]     = useState(false)
  const [isTemporalMode, setIsTemporalMode] = useState(false)
  const [asOf, setAsOf]                     = useState(null)   // null = live
  const [sliderValue, setSliderValue]       = useState(() => Date.now())
  const sliderMinRef  = useRef(Date.now() - 365 * 24 * 60 * 60 * 1000) // default: 1yr ago
  const debounceRef   = useRef(null)

  edgePickerCbRef.current = setEdgePicker
  navigateRef.current     = navigate

  // ── Determine focal node from route ──────────────────────────────────────
  const routeMatch = location.pathname.match(/^\/nodes\/([^/]+)$/)
  const focusNodeId = routeMatch && routeMatch[1] !== 'new'
    ? routeMatch[1]
    : (!drawerOpen && activeNodeId ? activeNodeId : null)

  // ── Load graph data ───────────────────────────────────────────────────────
  const loadGraph = useCallback(async () => {
    setGraphLoading(true)
    try {
      const params = { limit: 500 }
      if (asOf) {
        params.as_of = asOf
      } else if (showArchived) {
        params.include_archived = true
      }
      const [data, types] = await Promise.all([getGraph(params), getTypes()])
      const colors = {}
      types.forEach((t) => { colors[t.name] = t.color })
      setTypeColors(colors)
      setTypeDefs(types)
      const nodes = data.nodes || []
      const edges = (data.edges || []).filter((e) => !EXCLUDED_EDGE_TYPES.has(e.type))
      setGraphData(nodes, edges, data.truncated || false)

      // Track earliest created_at for the slider min
      const minTs = nodes.reduce((m, n) => (n.created_at && n.created_at < m ? n.created_at : m), sliderMinRef.current)
      sliderMinRef.current = minTs
    } catch (e) {
      console.error('Graph load:', e)
      setGraphLoading(false)
    }
  }, [setGraphData, setGraphLoading, setTypeColors, asOf, showArchived])

  useEffect(() => { loadGraph() }, [loadGraph, graphReloadKey])

  // ── Build / rebuild D3 simulation ─────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return

    const svgEl = svgRef.current
    const svg = d3.select(svgEl)
    svg.selectAll('*').remove()

    if (graphNodes.length === 0) {
      // Clear stale D3 refs so highlight/filter effects don't touch removed selections
      nodeGRef.current = null
      linkRef.current = null
      nodeDataRef.current = []
      return
    }

    const { width, height } = svgEl.getBoundingClientRect()

    // ── Arrowhead marker ────────────────────────────────────────────────────
    svg.append('defs').append('marker')
      .attr('id', 'arr')
      .attr('viewBox', '-8 -4 8 8')
      .attr('refX', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M -8,-4 L 0,0 L -8,4')
      .attr('fill', 'rgba(255,255,255,0.25)')

    const g = svg.append('g')

    // ── Zoom ────────────────────────────────────────────────────────────────
    const zoom = d3.zoom()
      .scaleExtent([0.05, 6])
      .on('zoom', (ev) => {
        g.attr('transform', ev.transform)
        nodeLabel.style('opacity', ev.transform.k >= LABEL_ZOOM_THRESHOLD ? 1 : 0)
      })
    svg.call(zoom).on('dblclick.zoom', null)
    // Reset any stale zoom state left over from a previous simulation build
    svg.property('__zoom', d3.zoomIdentity)
    zoomRef.current = { zoom, svg, g, width, height }

    // Clone so D3 can mutate positions
    const nodes = graphNodes.map((n) => ({ ...n }))
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    const edges = graphLinks
      .map((e) => ({ ...e, source: nodeMap.get(e.source), target: nodeMap.get(e.target) }))
      .filter((e) => e.source && e.target)
    nodeDataRef.current = nodes

    // ── Force simulation ─────────────────────────────────────────────────────
    // Strong charge + fixed link distance makes sibling nodes spread to equal
    // angles around their hub — "flower petals" equidistant from the center.
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id((d) => d.id).distance(90).strength(0.8))
      .force('charge', d3.forceManyBody().strength(-600).distanceMin(20).distanceMax(500))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.04))
      .force('collide', d3.forceCollide().radius((d) => nodeRadius(d) + 18).strength(0.9))
      .velocityDecay(0.75)
      .alphaDecay(0.025)
    simulationRef.current = sim

    // ── Links ────────────────────────────────────────────────────────────────
    const link = g.append('g').selectAll('line')
      .data(edges).join('line')
      .attr('stroke', 'rgba(255,255,255,0.12)')
      .attr('stroke-width', 1)
      .attr('marker-end', 'url(#arr)')

    // ── Node groups ──────────────────────────────────────────────────────────
    const nodeG = g.append('g').selectAll('g')
      .data(nodes).join('g')
      .attr('class', 'node-grp')

    nodeGRef.current = nodeG
    linkRef.current = link

    // Drag
    const drag = d3.drag()
      .filter((ev) => !ev.shiftKey)
      .on('start', (ev, d) => { if (!ev.active) sim.alphaTarget(0.05).restart(); d.fx = d.x; d.fy = d.y })
      .on('drag',  (ev, d) => { d.fx = ev.x; d.fy = ev.y })
      .on('end',   (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = ev.x; d.fy = ev.y })
    nodeG.call(drag)

    // Circles
    nodeG.append('circle')
      .attr('r', nodeRadius)
      .attr('fill', (d) => {
        if (SYSTEM_TYPES.has(d.type)) return 'rgba(255,255,255,0.08)'
        const base = typeColors[d.type] || '#6b7280'
        return d.archived_at ? base + '55' : base
      })
      .attr('stroke', (d) => d.archived_at ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.2)')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', (d) => d.archived_at ? '3,2' : null)

    // Labels
    const nodeLabel = nodeG.append('text')
      .text((d) => d.label?.length > 24 ? d.label.slice(0, 23) + '…' : d.label)
      .attr('x', (d) => nodeRadius(d) + 5)
      .attr('y', '0.35em')
      .attr('font-size', 11)
      .attr('fill', 'var(--text, #e8e8f0)')
      .attr('pointer-events', 'none')
      .style('opacity', 0)

    // Click → open in drawer
    nodeG.on('click', (ev, d) => {
      if (ev.shiftKey) return
      ev.stopPropagation()
      navigateRef.current(`/nodes/${d.id}`)
    })

    // Double-click → fit view around node
    nodeG.on('dblclick', (ev, d) => {
      ev.stopPropagation()
      const t = d3.zoomIdentity
        .translate(width / 2 - d.x, height / 2 - d.y)
        .scale(1.4)
      svg.transition().duration(500).call(zoom.transform, t)
    })

    svg.on('click', () => { /* no-op */ })

    // ── Shift+drag to create edge ────────────────────────────────────────────
    let shiftSrc = null, shiftLine = null
    nodeG.on('mousedown.s', (ev, d) => {
      if (!ev.shiftKey) return
      ev.stopPropagation()
      sim.stop()
      shiftSrc = d
      shiftLine = g.append('line')
        .attr('x1', d.x).attr('y1', d.y).attr('x2', d.x).attr('y2', d.y)
        .attr('stroke', '#6366f1').attr('stroke-width', 2).attr('stroke-dasharray', '6,3')
        .attr('pointer-events', 'none')
    })
    svg.on('mousemove.s', (ev) => {
      if (!shiftSrc || !shiftLine) return
      const [mx, my] = d3.pointer(ev, g.node())
      shiftLine.attr('x2', mx).attr('y2', my)
    })
    nodeG.on('mouseup.s', (ev, d) => {
      if (!shiftSrc || shiftSrc.id === d.id) return
      const src = shiftSrc, tgt = d
      shiftLine?.remove(); shiftLine = null; shiftSrc = null
      sim.restart()
      edgePickerCbRef.current({ sourceId: src.id, targetId: tgt.id, sourceType: src.type, targetType: tgt.type, x: ev.clientX, y: ev.clientY })
    })
    svg.on('mouseup.s', () => { if (shiftSrc) { shiftLine?.remove(); shiftLine = null; shiftSrc = null; sim.restart() } })

    // ── Tick ─────────────────────────────────────────────────────────────────
    sim.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
        .attr('x2', (d) => {
          const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          return d.target.x - (dx / dist) * nodeRadius(d.target)
        })
        .attr('y2', (d) => {
          const dx = d.target.x - d.source.x, dy = d.target.y - d.source.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          return d.target.y - (dy / dist) * nodeRadius(d.target)
        })
      nodeG.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    return () => { sim.stop(); svg.on('.zoom', null) }
  }, [graphNodes, graphLinks, typeColors])

  // ── Highlight effect: dim non-matching nodes (skipped when typeFilter active) ─
  useEffect(() => {
    if (!nodeGRef.current || typeFilter) return
    nodeGRef.current.select('circle')
      .attr('fill', (d) => {
        if (SYSTEM_TYPES.has(d.type)) return highlightIds
          ? (highlightIds.has(d.id) ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.03)')
          : 'rgba(255,255,255,0.08)'
        const base = typeColors[d.type] || '#6b7280'
        if (!highlightIds) return base
        return highlightIds.has(d.id) ? base : 'rgba(255,255,255,0.04)'
      })
      .attr('stroke-opacity', (d) => {
        if (!highlightIds) return 0.2
        return highlightIds.has(d.id) ? 0.8 : 0.03
      })
  }, [highlightIds, typeColors, typeFilter])

  // ── Type filter effect: hide/show nodes+edges, zoom to fit visible ────────
  useEffect(() => {
    if (!nodeGRef.current || !linkRef.current) return

    if (!typeFilter) {
      // Restore all nodes and edges to full visibility
      nodeGRef.current.style('display', null)
      linkRef.current.style('display', null)
      // Restore circle colors
      nodeGRef.current.select('circle')
        .attr('fill', (d) => {
          if (SYSTEM_TYPES.has(d.type)) return 'rgba(255,255,255,0.08)'
          return typeColors[d.type] || '#6b7280'
        })
        .attr('stroke-opacity', 0.2)
      return
    }

    // Build visible ID set: matching type + their direct neighbors
    const typeNodeIds = new Set(graphNodes.filter((n) => n.type === typeFilter).map((n) => n.id))
    const neighborIds = new Set()
    graphLinks.forEach((e) => {
      const srcId = typeof e.source === 'object' ? e.source.id : e.source
      const tgtId = typeof e.target === 'object' ? e.target.id : e.target
      if (typeNodeIds.has(srcId)) neighborIds.add(tgtId)
      if (typeNodeIds.has(tgtId)) neighborIds.add(srcId)
    })
    const visibleIds = new Set([...typeNodeIds, ...neighborIds])

    // Hide non-visible nodes and edges
    nodeGRef.current.style('display', (d) => visibleIds.has(d.id) ? null : 'none')
    linkRef.current.style('display', (d) => {
      const srcId = typeof d.source === 'object' ? d.source.id : d.source
      const tgtId = typeof d.target === 'object' ? d.target.id : d.target
      return visibleIds.has(srcId) && visibleIds.has(tgtId) ? null : 'none'
    })

    // Color: type nodes full color, neighbors slightly dimmed
    nodeGRef.current.select('circle')
      .attr('fill', (d) => {
        if (!visibleIds.has(d.id)) return 'rgba(255,255,255,0.04)'
        if (SYSTEM_TYPES.has(d.type)) return 'rgba(255,255,255,0.35)'
        const base = typeColors[d.type] || '#6b7280'
        return typeNodeIds.has(d.id) ? base : base + '99'
      })
      .attr('stroke-opacity', (d) => typeNodeIds.has(d.id) ? 0.9 : 0.35)

    // Zoom to fit visible nodes after sim has had time to place them
    const fitToVisible = () => {
      if (!zoomRef.current) return
      const visibleNodes = nodeDataRef.current.filter((n) => visibleIds.has(n.id) && n.x != null)
      if (visibleNodes.length === 0) return
      const xs = visibleNodes.map((n) => n.x)
      const ys = visibleNodes.map((n) => n.y)
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      const minY = Math.min(...ys), maxY = Math.max(...ys)
      const { zoom, svg, width, height } = zoomRef.current
      const pad = 80
      const rangeX = maxX - minX || 1
      const rangeY = maxY - minY || 1
      const scale = Math.min((width - pad * 2) / rangeX, (height - pad * 2) / rangeY, 3)
      const midX = (minX + maxX) / 2
      const midY = (minY + maxY) / 2
      const t = d3.zoomIdentity
        .translate(width / 2 - midX * scale, height / 2 - midY * scale)
        .scale(scale)
      svg.transition().duration(600).call(zoom.transform, t)
    }

    // Give the simulation 400ms to lay out nodes before zooming
    const timer = setTimeout(fitToVisible, 400)
    return () => clearTimeout(timer)
  }, [typeFilter, graphNodes, graphLinks, typeColors])

  // ── Focus / zoom to a specific node ───────────────────────────────────────
  useEffect(() => {
    if (!focusNodeId || !zoomRef.current) return
    const node = nodeDataRef.current.find((n) => n.id === focusNodeId)
    if (!node || node.x == null) return

    const { zoom, svg, width, height } = zoomRef.current
    const scale = 1.6
    const t = d3.zoomIdentity
      .translate(width / 2 - node.x * scale, height / 2 - node.y * scale)
      .scale(scale)
    svg.transition().duration(500).call(zoom.transform, t)
  }, [focusNodeId])

  // ── Temporal slider handlers ──────────────────────────────────────────────
  const handleSliderChange = (e) => {
    const val = Number(e.target.value)
    setSliderValue(val)
    clearTimeout(debounceRef.current)
    // If within 30 seconds of now, snap back to live
    if (val >= Date.now() - 30_000) {
      setAsOf(null)
      return
    }
    debounceRef.current = setTimeout(() => setAsOf(val), 250)
  }

  const enterTemporalMode = () => {
    setIsTemporalMode(true)
    const now = Date.now()
    setSliderValue(now)
    setAsOf(null)
  }

  const exitTemporalMode = () => {
    clearTimeout(debounceRef.current)
    setIsTemporalMode(false)
    setAsOf(null)
    setSliderValue(Date.now())
  }

  // ── Edge create ────────────────────────────────────────────────────────────
  const handleEdgeCreate = async (edgeType) => {
    if (!edgePicker) return
    try {
      await createEdge({ from_id: edgePicker.sourceId, to_id: edgePicker.targetId, type: edgeType })
      setEdgePicker(null)
      loadGraph()
    } catch (e) { alert(e.message) }
  }

  return (
    <div className="graph-view">
      {graphLoading && graphNodes.length === 0 && (
        <div className="graph-loading-state"><div className="spinner" /><span>Loading graph…</span></div>
      )}
      {!graphLoading && graphNodes.length === 0 && (
        <div className="graph-empty-state">
          <div className="graph-empty-icon">◉</div>
          <p>Your knowledge graph is empty.</p>
          <p className="graph-empty-sub">Search above to capture your first node.</p>
        </div>
      )}

      <svg ref={svgRef} className="graph-svg" />

      {graphTruncated && (
        <div className="graph-badge graph-truncated">500 node limit — search to filter</div>
      )}

      {/* ── Archive / Temporal toolbar ── */}
      <div className="graph-toolbar">
        {isTemporalMode ? (
          <>
            <button className="btn btn-ghost btn-sm graph-toolbar-btn" onClick={exitTemporalMode}>
              Live
            </button>
            <span className="graph-toolbar-date">
              {asOf ? formatSliderDate(asOf) : 'Now'}
            </span>
            <input
              type="range"
              className="graph-time-slider"
              min={sliderMinRef.current}
              max={Date.now()}
              step={3_600_000}
              value={sliderValue}
              onChange={handleSliderChange}
            />
          </>
        ) : (
          <>
            <label className="graph-toolbar-check">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
            <button className="btn btn-ghost btn-sm graph-toolbar-btn" onClick={enterTemporalMode}>
              History
            </button>
          </>
        )}
      </div>

      <div className="graph-hint-bar">
        {isTemporalMode
          ? `Viewing ${asOf ? formatSliderDate(asOf) : 'live'} — drag slider to travel`
          : 'Click to open · Shift+drag to link · Scroll to zoom'}
      </div>

      {edgePicker && (
        <EdgeTypePicker
          {...edgePicker}
          typeDefs={typeDefs}
          onConfirm={handleEdgeCreate}
          onCancel={() => setEdgePicker(null)}
        />
      )}
    </div>
  )
}

// ── Edge type picker (unchanged from original) ────────────────────────────────
const COMMON_EDGE_TYPES = ['RELATED_TO', 'REFERENCES', 'PART_OF', 'ASSIGNED_TO', 'DEPENDS_ON', 'OWNED_BY', 'RESULTED_IN', 'CONTAINS']

function EdgeTypePicker({ x, y, sourceType, targetType, typeDefs, onConfirm, onCancel }) {
  const [custom, setCustom] = useState('')
  const style = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 280),
    top: Math.min(y, window.innerHeight - 360),
    zIndex: 9999,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    padding: 12,
    minWidth: 260,
  }
  const srcDef   = typeDefs?.find((t) => t.name === sourceType)
  const suggested = (srcDef?.edge_types || []).filter((et) => !et.target_type || et.target_type === targetType)
  const tgtDef   = typeDefs?.find((t) => t.name === targetType)
  const inverseSuggested = (tgtDef?.edge_types || [])
    .filter((et) => (!et.target_type || et.target_type === sourceType) && et.inverse)
    .map((et) => ({ name: et.inverse, _originalName: et.name, _isInverse: true }))

  return (
    <div className="edge-picker" style={style}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{sourceType} → {targetType}</div>
      {suggested.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Suggested</div>
          <div className="edge-picker-options" style={{ marginBottom: 8 }}>
            {suggested.map((et) => <button key={et.name} className="btn btn-primary btn-sm" onClick={() => onConfirm(et.name)}>{et.name}</button>)}
            {inverseSuggested.map((et) => <button key={`inv-${et.name}`} className="btn btn-ghost btn-sm" onClick={() => onConfirm(et._originalName)} title={`${targetType} ${et._originalName} ${sourceType}`}>← {et.name}</button>)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Other</div>
        </>
      )}
      <div className="edge-picker-options">
        {COMMON_EDGE_TYPES.filter((t) => !suggested.some((s) => s.name === t))
          .map((t) => <button key={t} className="btn btn-ghost btn-sm" onClick={() => onConfirm(t)}>{t}</button>)}
      </div>
      <div className="edge-picker-custom">
        <input
          autoFocus={suggested.length === 0}
          value={custom}
          onChange={(e) => setCustom(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
          onKeyDown={(e) => { if (e.key === 'Enter' && custom) onConfirm(custom) }}
          placeholder="CUSTOM_TYPE"
        />
        <button className="btn btn-primary btn-sm" onClick={() => custom && onConfirm(custom)} disabled={!custom}>Connect</button>
      </div>
      <button className="btn btn-ghost btn-sm" style={{ marginTop: 6, width: '100%' }} onClick={onCancel}>Cancel</button>
    </div>
  )
}
