import { useState } from 'react'
import { createCustomAgent, updateCustomAgent } from '../../api'

const ALL_TYPES = [
  'TASK', 'NOTE', 'PERSON', 'FILE', 'URL', 'LOCATION',
  'INBOX_ITEM', 'AGENT_RUN',
]

const PLACEHOLDER_HINTS = [
  { var: '{{node.label}}', desc: 'Item title/name' },
  { var: '{{node.type}}', desc: 'Category (e.g. TASK)' },
  { var: '{{node.body}}', desc: 'Rich text body' },
  { var: '{{node.properties.X}}', desc: 'Any field value (replace X)' },
  { var: '{{related}}', desc: 'List of related items' },
]

export default function AgentCreatePanel({ existing, onSaved, onCancel }) {
  const [name, setName] = useState(existing?.name || '')
  const [label, setLabel] = useState(existing?.label || '')
  const [icon, setIcon] = useState(existing?.icon || '🤖')
  const [description, setDescription] = useState(existing?.description || '')
  const [suitableFor, setSuitableFor] = useState(existing?.suitable_for || ['*'])
  const [promptTemplate, setPromptTemplate] = useState(existing?.prompt_template || '')
  const [outputFormat, setOutputFormat] = useState(existing?.output_format || 'text')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showHints, setShowHints] = useState(false)

  const isAny = suitableFor.includes('*')

  const toggleType = (type) => {
    if (isAny) {
      setSuitableFor([type])
    } else if (suitableFor.includes(type)) {
      const next = suitableFor.filter((t) => t !== type)
      setSuitableFor(next.length === 0 ? ['*'] : next)
    } else {
      setSuitableFor([...suitableFor, type])
    }
  }

  const handleSave = async () => {
    if (!label.trim()) { setError('Display name is required.'); return }
    if (!promptTemplate.trim()) { setError('Prompt template is required.'); return }
    setSaving(true)
    setError(null)
    try {
      const data = {
        name: name || label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
        label: label.trim(),
        icon,
        description,
        suitable_for: suitableFor,
        prompt_template: promptTemplate,
        output_format: outputFormat,
      }
      if (existing) {
        await updateCustomAgent(existing.name, data)
      } else {
        await createCustomAgent(data)
      }
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="create-panel">
      <div className="create-panel-header">
        <h2>{existing ? 'Edit agent' : 'New agent'}</h2>
        {onCancel && <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
      </div>

      <div className="create-form">
        {error && (
          <div style={{ color: 'var(--red)', fontSize: 13, padding: '8px 0' }}>{error}</div>
        )}

        <div className="form-row">
          <label>Icon & name</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              style={{ maxWidth: 56, textAlign: 'center', fontSize: 18 }}
              maxLength={2}
              placeholder="🤖"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My Agent"
              style={{ flex: 1 }}
            />
          </div>
        </div>

        <div className="form-row">
          <label>Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this agent do?"
          />
        </div>

        <div className="form-row">
          <label>Applies to</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className={`btn btn-sm ${isAny ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setSuitableFor(['*'])}
            >
              Any item
            </button>
            {ALL_TYPES.map((t) => (
              <button
                key={t}
                className={`btn btn-sm ${!isAny && suitableFor.includes(t) ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => toggleType(t)}
              >
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row">
          <label>
            Prompt template
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 8, fontSize: 11 }}
              onClick={() => setShowHints((s) => !s)}
            >
              {showHints ? 'Hide' : 'Show'} variables
            </button>
          </label>
          {showHints && (
            <div style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '10px 12px', fontSize: 12, marginBottom: 8,
            }}>
              {PLACEHOLDER_HINTS.map((h) => (
                <div key={h.var} style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
                  <code style={{ color: 'var(--accent)', minWidth: 220 }}>{h.var}</code>
                  <span style={{ color: 'var(--text-muted)' }}>{h.desc}</span>
                </div>
              ))}
            </div>
          )}
          <textarea
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            placeholder={`Summarise the following item for me:\n\nTitle: {{node.label}}\nType: {{node.type}}\nContent: {{node.body}}\n\nRelated items:\n{{related}}`}
            rows={10}
            style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
          />
        </div>

        <div className="form-row">
          <label>Output format</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {['text', 'json'].map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${outputFormat === f ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setOutputFormat(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            Text: the agent's response is shown as-is. JSON: parsed and displayed as structured data.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {onCancel && <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Create agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
