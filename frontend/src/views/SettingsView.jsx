import { useEffect, useState } from 'react'
import { getSettings, updateSettings } from '../api'
import { useAppStore } from '../stores/appStore'

const ANTHROPIC_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
]

const OPENAI_MODELS = [
  'gpt-5-mini',
  'gpt-4o-mini',
  'gpt-5-nano',
  'gtp-5.4-nano'
]

const THEME_OPTIONS = [
  { value: 'system', label: 'System default' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

export default function SettingsView() {
  const [env, setEnv] = useState(null)
  const [dirty, setDirty] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [replacingKey, setReplacingKey] = useState(false)
  const [replacingOpenAiKey, setReplacingOpenAiKey] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('bb_theme') || 'system')
  const setAiEnabled = useAppStore((s) => s.setAiEnabled)

  useEffect(() => {
    getSettings().then(setEnv).catch((e) => setError(e.message))
  }, [])

  const set = (key, value) => {
    setDirty((d) => ({ ...d, [key]: value }))
    setEnv((e) => ({ ...e, [key]: value }))
    setSaved(false)
  }

  const handleThemeChange = (val) => {
    setTheme(val)
    localStorage.setItem('bb_theme', val)
    // Dispatch so App.jsx picks it up immediately
    window.dispatchEvent(new CustomEvent('bb-theme-change', { detail: val }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const updates = Object.entries(dirty).map(([key, value]) => ({ key, value: String(value) }))
      if (updates.length > 0) await updateSettings(updates)
      setDirty({})
      setSaved(true)
      if ('AI_ENABLED' in dirty) {
        setAiEnabled(dirty.AI_ENABLED === true || dirty.AI_ENABLED === 'true')
      }
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const val = (key, fallback = '') => (env ? (env[key] ?? fallback) : fallback)
  const hasDirty = Object.keys(dirty).length > 0

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Settings</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>Saved ✓</span>}
          {error && <span style={{ color: 'var(--red)', fontSize: 13 }}>{error}</span>}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !hasDirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className="view-content" style={{ maxWidth: 640 }}>
        {!env ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>
        ) : (
          <>
            {/* AI */}
            <section className="settings-section">
              <div className="settings-section-title">AI</div>

              <div className="settings-row">
                <label>Enable AI features</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={val('AI_ENABLED', 'true') !== 'false'}
                    onChange={(e) => set('AI_ENABLED', e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {val('AI_ENABLED', 'true') !== 'false' ? 'On' : 'Off — all AI features hidden'}
                  </span>
                </label>
              </div>

              {val('AI_ENABLED', 'true') !== 'false' && (
                <>
                  <div className="settings-row">
                    <label>AI Provider</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {['anthropic', 'openai'].map((p) => (
                        <button
                          key={p}
                          className={`btn btn-sm ${val('AI_PROVIDER', 'anthropic') === p ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => {
                            set('AI_PROVIDER', p)
                            // Reset model to a sensible default for the new provider
                            const defaultModel = p === 'openai' ? 'gpt-4o' : 'claude-opus-4-6'
                            set('AI_MODEL', defaultModel)
                          }}
                        >
                          {p === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {val('AI_PROVIDER', 'anthropic') === 'anthropic' ? (
                    <>
                      <div className="settings-row">
                        <label>Anthropic API Key</label>
                        {env?.ANTHROPIC_API_KEY_SET && !replacingKey ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ color: 'var(--green)', fontSize: 13 }}>Configured ✓</span>
                            <button className="btn btn-ghost btn-sm" onClick={() => setReplacingKey(true)}>Replace</button>
                          </div>
                        ) : (
                          <input
                            type="password"
                            value={val('ANTHROPIC_API_KEY', '')}
                            onChange={(e) => set('ANTHROPIC_API_KEY', e.target.value)}
                            placeholder="sk-ant-…"
                            autoFocus={replacingKey}
                          />
                        )}
                        <p className="settings-hint">Leave blank if using Claude Code (set CLAUDE_CODE_ENABLED below).</p>
                      </div>

                      <div className="settings-row">
                        <label>Claude Model</label>
                        <select value={val('AI_MODEL', 'claude-opus-4-6')} onChange={(e) => set('AI_MODEL', e.target.value)}>
                          {ANTHROPIC_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>

                      <div className="settings-row">
                        <label>Use Claude Code</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <input
                            type="checkbox"
                            id="cc-enabled"
                            style={{ width: 'auto' }}
                            checked={val('CLAUDE_CODE_ENABLED', 'false') === 'true'}
                            onChange={(e) => set('CLAUDE_CODE_ENABLED', e.target.checked ? 'true' : 'false')}
                          />
                          <label htmlFor="cc-enabled" style={{ marginBottom: 0, fontWeight: 400 }}>
                            Route AI calls through the Claude Code CLI
                          </label>
                        </div>
                      </div>

                      {val('CLAUDE_CODE_ENABLED', 'false') === 'true' && (
                        <div className="settings-row">
                          <label>Claude Code Skills Path</label>
                          <input
                            type="text"
                            value={val('CLAUDE_CODE_SKILLS_PATH')}
                            onChange={(e) => set('CLAUDE_CODE_SKILLS_PATH', e.target.value)}
                            placeholder="/path/to/skills"
                          />
                          <p className="settings-hint">Directory containing .md skill files (optional).</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="settings-row">
                        <label>OpenAI API Key</label>
                        {env?.OPENAI_API_KEY_SET && !replacingOpenAiKey ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ color: 'var(--green)', fontSize: 13 }}>Configured ✓</span>
                            <button className="btn btn-ghost btn-sm" onClick={() => setReplacingOpenAiKey(true)}>Replace</button>
                          </div>
                        ) : (
                          <input
                            type="password"
                            value={val('OPENAI_API_KEY', '')}
                            onChange={(e) => set('OPENAI_API_KEY', e.target.value)}
                            placeholder="sk-…"
                            autoFocus={replacingOpenAiKey}
                          />
                        )}
                      </div>

                      <div className="settings-row">
                        <label>OpenAI Model</label>
                        <select value={val('AI_MODEL', 'gpt-4o')} onChange={(e) => set('AI_MODEL', e.target.value)}>
                          {OPENAI_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                </>
              )}
            </section>

            {/* Limits */}
            {val('AI_ENABLED', 'true') !== 'false' && (
              <section className="settings-section">
                <div className="settings-section-title">Limits</div>

                <div className="settings-row">
                  <label>Max tokens per request</label>
                  <input
                    type="number"
                    value={val('AI_MAX_TOKENS_PER_REQUEST', '4000')}
                    onChange={(e) => set('AI_MAX_TOKENS_PER_REQUEST', e.target.value)}
                    min={256} max={32000}
                  />
                </div>

                <div className="settings-row">
                  <label>Monthly spend warning (USD)</label>
                  <input
                    type="number"
                    value={val('AI_MONTHLY_WARNING_THRESHOLD_USD', '10')}
                    onChange={(e) => set('AI_MONTHLY_WARNING_THRESHOLD_USD', e.target.value)}
                    min={0} step={1}
                  />
                </div>
              </section>
            )}

            {/* Appearance */}
            <section className="settings-section">
              <div className="settings-section-title">Appearance</div>

              <div className="settings-row">
                <label>Theme</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {THEME_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`btn ${theme === opt.value ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                      onClick={() => handleThemeChange(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Application */}
            <section className="settings-section">
              <div className="settings-section-title">Application</div>

              <div className="settings-row">
                <label>Backend port</label>
                <input
                  type="number"
                  value={val('APP_PORT', '8000')}
                  onChange={(e) => set('APP_PORT', e.target.value)}
                  style={{ maxWidth: 120 }}
                />
                <p className="settings-hint">Requires restart to take effect.</p>
              </div>
            </section>

            {/* Data */}
            <section className="settings-section">
              <div className="settings-section-title">Data</div>
              <div className="settings-row">
                <label>Backup</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a
                    href="/api/backup/export"
                    download="bionic-brain-backup.zip"
                    className="btn btn-ghost btn-sm"
                  >
                    Export backup
                  </a>
                  <RestoreButton />
                </div>
                <p className="settings-hint">Export saves all items, connections, and content. Restore merges without deleting existing data.</p>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function RestoreButton() {
  const [status, setStatus] = useState(null)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('Restoring…')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/backup/import', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Restore failed')
      setStatus(`Restored: ${data.nodes_imported} items, ${data.edges_imported} connections`)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
    e.target.value = ''
  }

  return (
    <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
      {status || 'Restore from backup'}
      <input type="file" accept=".zip" style={{ display: 'none' }} onChange={handleFile} />
    </label>
  )
}
