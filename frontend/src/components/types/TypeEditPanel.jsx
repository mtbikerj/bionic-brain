import { useState, useEffect } from 'react'
import { updateType, migrateType, getTypes } from '../../api'

const FIELD_TYPES = [
  'short_text', 'long_text', 'number', 'currency', 'date', 'datetime',
  'boolean', 'choice_single', 'choice_multi', 'relationship', 'file', 'url',
]

const COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#f59e0b', '#10b981', '#14b8a6', '#06b6d4', '#3b82f6',
  '#64748b', '#6b7280',
]

export default function TypeEditPanel({ typeDef, onSaved, onCancel }) {
  const [fields, setFields] = useState(typeDef.fields.map((f) => ({ ...f })))
  const [color, setColor] = useState(typeDef.color)
  const [extendsVal, setExtendsVal] = useState(typeDef.extends || '')
  const [edgeTypes, setEdgeTypes] = useState((typeDef.edge_types || []).map((e) => ({ ...e })))
  const [availableTypes, setAvailableTypes] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [migration, setMigration] = useState(null) // { newVersion, nodeCount, addedFields, removedFields }

  useEffect(() => {
    getTypes().then((ts) => setAvailableTypes(ts)).catch(() => {})
  }, [])

  const setField = (i, key, val) =>
    setFields((fs) => fs.map((f, idx) => idx === i ? { ...f, [key]: val } : f))

  const addField = () =>
    setFields((fs) => [...fs, { name: '', type: 'short_text', required: false, options: null, default: null, target_type: null }])

  const removeField = (i) => setFields((fs) => fs.filter((_, idx) => idx !== i))

  const setEdgeType = (i, key, val) =>
    setEdgeTypes((es) => es.map((e, idx) => idx === i ? { ...e, [key]: val } : e))

  const addEdgeType = () =>
    setEdgeTypes((es) => [...es, { name: '', inverse: '', target_type: '', properties: [] }])

  const removeEdgeType = (i) => setEdgeTypes((es) => es.filter((_, idx) => idx !== i))

  const handleSave = async () => {
    const invalid = fields.find((f) => !f.name.trim())
    if (invalid) { setError('All fields must have a name.'); return }
    const invalidEdge = edgeTypes.find((e) => !e.name.trim())
    if (invalidEdge) { setError('All relationship types must have a name.'); return }

    setSaving(true)
    setError(null)
    try {
      const cleanedFields = fields.map((f) => ({
        name: f.name.trim().toLowerCase().replace(/\s+/g, '_'),
        type: f.type,
        required: f.required || false,
        options: ['choice_single', 'choice_multi'].includes(f.type) ? (f.options || []) : null,
        default: f.default ?? null,
        target_type: f.type === 'relationship' ? (f.target_type || null) : null,
      }))
      const cleanedEdgeTypes = edgeTypes.map((e) => ({
        name: e.name.trim().toUpperCase().replace(/\s+/g, '_'),
        inverse: e.inverse?.trim() || null,
        target_type: e.target_type?.trim().toUpperCase() || null,
        properties: [],
      }))

      const patch = { fields: cleanedFields, color, edge_types: cleanedEdgeTypes }
      if (extendsVal !== (typeDef.extends || '')) {
        patch.extends = extendsVal || null
      }
      const result = await updateType(typeDef.name, patch)

      // Check if field schema changed and there are nodes to migrate
      const oldNames = new Set(typeDef.fields.map((f) => f.name))
      const newNames = new Set(cleanedFields.map((f) => f.name))
      const addedFields = cleanedFields.filter((f) => !oldNames.has(f.name))
      const removedFields = typeDef.fields.filter((f) => !newNames.has(f.name))

      if ((addedFields.length > 0 || removedFields.length > 0) && typeDef.node_count > 0) {
        setMigration({
          newVersion: result.version,
          nodeCount: typeDef.node_count,
          addedFields,
          removedFields,
        })
      } else {
        onSaved()
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleMigrate = async (action, defaults) => {
    await migrateType(typeDef.name, { action, new_version: migration.newVersion, defaults })
    setMigration(null)
    onSaved()
  }

  if (migration) {
    return (
      <MigrationDialog
        typeName={typeDef.name}
        state={migration}
        onApply={handleMigrate}
        onSkip={() => { setMigration(null); onSaved() }}
      />
    )
  }

  return (
    <div className="create-panel">
      <div className="create-panel-header">
        <h2>Edit {typeDef.name.charAt(0) + typeDef.name.slice(1).toLowerCase().replace(/_/g, ' ')}</h2>
        {onCancel && <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
      </div>

      {typeDef.is_builtin && (
        <div style={{ margin: '0 0 16px', padding: '10px 14px', borderRadius: 6, background: 'var(--bg-hover, rgba(255,255,255,0.05))', fontSize: 12, color: 'var(--text-muted)' }}>
          Built-in category — you can add custom fields and relationship types. Core system behaviour is unaffected.
        </div>
      )}

      <div className="create-form">
        {/* Color picker */}
        <div className="form-row">
          <label>Color</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                style={{
                  width: 24, height: 24, borderRadius: '50%', background: c, border: 'none',
                  cursor: 'pointer', outline: color === c ? '2px solid white' : 'none',
                  boxShadow: color === c ? `0 0 0 3px ${c}` : 'none',
                }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Custom color"
            />
          </div>
        </div>

        {/* Extends */}
        <div className="form-row" style={{ marginTop: 12 }}>
          <label>Extends <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>(optional, one level only)</span></label>
          <select value={extendsVal} onChange={(e) => setExtendsVal(e.target.value)}>
            <option value="">— none —</option>
            {availableTypes
              .filter((t) => t.name !== typeDef.name && !t.extends)
              .map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name.charAt(0) + t.name.slice(1).toLowerCase().replace(/_/g, ' ')}
                </option>
              ))}
          </select>
        </div>

        {/* Fields */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <label style={{ fontWeight: 500 }}>Fields</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addField}>+ Add field</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fields.map((field, i) => (
              <FieldRow
                key={i}
                field={field}
                availableTypes={availableTypes}
                onChange={(k, v) => setField(i, k, v)}
                onRemove={() => removeField(i)}
              />
            ))}
            {fields.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No fields defined.</div>
            )}
          </div>
        </div>

        {/* Connections */}
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <label style={{ fontWeight: 500 }}>Connections</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addEdgeType}>+ Add connection</button>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10 }}>
            Define how a {typeDef.name.charAt(0) + typeDef.name.slice(1).toLowerCase().replace(/_/g, ' ')} can link to other items.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {edgeTypes.map((et, i) => (
              <EdgeTypeRow
                key={i}
                edgeType={et}
                typeName={typeDef.name.charAt(0) + typeDef.name.slice(1).toLowerCase().replace(/_/g, ' ')}
                availableTypes={availableTypes}
                onChange={(k, v) => setEdgeType(i, k, v)}
                onRemove={() => removeEdgeType(i)}
              />
            ))}
            {edgeTypes.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No connections defined.</div>
            )}
          </div>
        </div>

        {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}

        <div className="form-actions" style={{ marginTop: 20 }}>
          {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save changes'}
          </button>
        </div>

        {typeDef.node_count > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            Saving will bump the schema to v{typeDef.version + 1}.
            {typeDef.node_count} existing node{typeDef.node_count !== 1 ? 's' : ''} will need migration.
          </div>
        )}
      </div>
    </div>
  )
}

function FieldRow({ field, availableTypes = [], onChange, onRemove }) {
  const showOptions = ['choice_single', 'choice_multi'].includes(field.type)
  const showTargetType = field.type === 'relationship'

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6,
      background: 'var(--surface)', borderRadius: 'var(--radius-sm)',
      padding: '8px 10px', border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input
          value={field.name}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder="field_name"
          style={{ width: 140 }}
        />
        <select value={field.type} onChange={(e) => onChange('type', e.target.value)} style={{ width: 130 }}>
          {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {showOptions && (
          <input
            value={(field.options || []).join(', ')}
            onChange={(e) => onChange('options', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            placeholder="option1, option2, ..."
            style={{ width: 200 }}
          />
        )}
        {showTargetType && (
          <select
            value={field.target_type || ''}
            onChange={(e) => onChange('target_type', e.target.value)}
            style={{ width: 160 }}
          >
            <option value="">— any type —</option>
            {availableTypes.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name.charAt(0) + t.name.slice(1).toLowerCase().replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        )}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={field.required || false}
          onChange={(e) => onChange('required', e.target.checked)}
          style={{ width: 'auto' }}
        />
        Required
      </label>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} style={{ color: 'var(--danger, #ef4444)' }}>
        ✕
      </button>
    </div>
  )
}

function EdgeTypeRow({ edgeType, typeName, availableTypes, onChange, onRemove }) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 'var(--radius-sm)',
      padding: '10px 12px', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>A</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{typeName}</span>
      <input
        value={edgeType.name}
        onChange={(e) => onChange('name', e.target.value)}
        placeholder="e.g. is graded by"
        style={{ width: 160 }}
      />
      <select
        value={edgeType.target_type || ''}
        onChange={(e) => onChange('target_type', e.target.value)}
        style={{ width: 140 }}
      >
        <option value="">any item type</option>
        {availableTypes.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name.charAt(0) + t.name.slice(1).toLowerCase().replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>reverse:</span>
      <input
        value={edgeType.inverse || ''}
        onChange={(e) => onChange('inverse', e.target.value)}
        placeholder="e.g. grades (optional)"
        style={{ width: 160 }}
      />
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} style={{ color: 'var(--danger, #ef4444)', marginLeft: 'auto' }}>
        ✕
      </button>
    </div>
  )
}

function MigrationDialog({ typeName, state, onApply, onSkip }) {
  const { newVersion, nodeCount, addedFields, removedFields } = state
  const [action, setAction] = useState('upgrade')
  const [defaults, setDefaults] = useState({})
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState(null)

  const displayName = typeName.charAt(0) + typeName.slice(1).toLowerCase().replace(/_/g, ' ')

  const handleApply = async () => {
    setApplying(true)
    setError(null)
    try {
      await onApply(action, action === 'upgrade' ? defaults : {})
    } catch (err) {
      setError(err.message)
      setApplying(false)
    }
  }

  return (
    <div className="create-panel">
      <div className="create-panel-header">
        <h2>Migrate existing nodes</h2>
      </div>
      <div className="create-form">
        <p style={{ marginBottom: 16, color: 'var(--text-muted)', fontSize: 14 }}>
          You've updated <strong>{displayName}</strong> (v{newVersion - 1} → v{newVersion}).
          You have <strong>{nodeCount}</strong> existing node{nodeCount !== 1 ? 's' : ''} on the old version.
        </p>

        {addedFields.length > 0 && (
          <div style={{ marginBottom: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--success, #10b981)', fontWeight: 500 }}>New fields: </span>
            {addedFields.map((f) => `${f.name} (${f.type})`).join(', ')}
          </div>
        )}
        {removedFields.length > 0 && (
          <div style={{ marginBottom: 16, fontSize: 13 }}>
            <span style={{ color: 'var(--danger, #ef4444)', fontWeight: 500 }}>Removed fields: </span>
            {removedFields.map((f) => f.name).join(', ')}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 14 }}>
            <input
              type="radio"
              checked={action === 'leave'}
              onChange={() => setAction('leave')}
              style={{ width: 'auto', marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 500 }}>Leave on v{newVersion - 1}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>They'll still work fine. Migrate later manually.</div>
            </div>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 14 }}>
            <input
              type="radio"
              checked={action === 'upgrade'}
              onChange={() => setAction('upgrade')}
              style={{ width: 'auto', marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 500 }}>Upgrade all to v{newVersion}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>New fields will be blank unless you set defaults below.</div>
            </div>
          </label>
        </div>

        {action === 'upgrade' && addedFields.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Defaults for new fields (optional)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {addedFields.map((f) => (
                <div key={f.name} className="form-row" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: 12 }}>{f.name} <span style={{ color: 'var(--text-muted)' }}>({f.type})</span></label>
                  <input
                    value={defaults[f.name] || ''}
                    onChange={(e) => setDefaults((d) => ({ ...d, [f.name]: e.target.value }))}
                    placeholder={`Leave blank for empty`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

        <div className="form-actions">
          <button className="btn btn-ghost" onClick={onSkip} disabled={applying}>Skip</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={applying}>
            {applying ? <span className="spinner" /> : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
