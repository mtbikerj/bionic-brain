import { useEffect, useState } from 'react'
import { getTodayItems } from '../api'
import NodeCard from '../components/nodes/NodeCard'
import './View.css'

export default function TodayView() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTodayItems()
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="view-loading"><div className="spinner" /></div>

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Today</h1>
      </div>
      <div className="view-content">
        {data?.day ? (
          <>
            <div className="today-day-header">📅 {data.day.label}</div>

            {data.due_today?.length > 0 && (
              <div className="today-section">
                <div className="section-title">Due Today</div>
                <div className="node-list">
                  {data.due_today.map((n) => <NodeCard key={n.id} node={n} />)}
                </div>
              </div>
            )}

            {data.completed_today?.length > 0 && (
              <div className="today-section">
                <div className="section-title">Completed Today</div>
                <div className="node-list">
                  {data.completed_today.map((n) => <NodeCard key={n.id} node={n} />)}
                </div>
              </div>
            )}

            {data.created_today?.length > 0 && (
              <div className="today-section">
                <div className="section-title">Created Today</div>
                <div className="node-list">
                  {data.created_today.map((n) => <NodeCard key={n.id} node={n} />)}
                </div>
              </div>
            )}

            {!data.due_today?.length && !data.created_today?.length && (
              <div className="empty-state">
                <div className="empty-icon">🌤️</div>
                <p>Nothing linked to today yet.</p>
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            <p>Today's node will appear once you create your first item.</p>
          </div>
        )}
      </div>
    </div>
  )
}
