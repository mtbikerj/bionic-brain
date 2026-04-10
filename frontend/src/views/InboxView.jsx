import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getNodes, createNode, updateNode } from '../api'
import NodeCard from '../components/nodes/NodeCard'
import './View.css'

export default function InboxView() {
  const [items, setItems] = useState([])
  const [captureText, setCaptureText] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const load = () => {
    Promise.all([
      getNodes({ is_inbox: true, limit: 100 }),
      getNodes({ type: 'INBOX_ITEM', limit: 100 }),
    ]).then(([inboxNodes, inboxItems]) => {
      const seen = new Set()
      const all = [...inboxNodes, ...inboxItems].filter((n) => {
        if (seen.has(n.id)) return false
        seen.add(n.id)
        return true
      })
      all.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      setItems(all)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleCapture = async (e) => {
    e.preventDefault()
    if (!captureText.trim()) return
    await createNode({
      type: 'INBOX_ITEM',
      label: captureText.trim(),
      properties: { raw_text: captureText.trim(), captured_at: Date.now() },
      is_inbox: true,
    })
    setCaptureText('')
    load()
  }

  const handleConvert = (item) => {
    navigate(`/nodes/${item.id}`)
  }

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Inbox</h1>
      </div>
      <div className="view-content">
        <div className="inbox-capture">
          <form className="inbox-capture-form" onSubmit={handleCapture}>
            <input
              autoFocus
              value={captureText}
              onChange={(e) => setCaptureText(e.target.value)}
              placeholder="Capture anything... (press Enter to save)"
            />
            <button type="submit" className="btn btn-primary" disabled={!captureText.trim()}>
              Save
            </button>
          </form>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div className="spinner" />
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📥</div>
            <p>Inbox is empty. Type above to capture something.</p>
          </div>
        ) : (
          <>
            <div className="inbox-count">{items.length} item{items.length !== 1 ? 's' : ''}</div>
            <div>
              {items.map((item) => (
                <div key={item.id} className="inbox-item">
                  <div className="inbox-item-text">{item.label}</div>
                  <div className="inbox-item-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => handleConvert(item)}>
                      Open / Convert
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
