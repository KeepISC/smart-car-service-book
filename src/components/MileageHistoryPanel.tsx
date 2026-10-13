import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react'
import { loadVehicleMileageHistory } from '../services/vehicles'
import { ErrorState } from './States'
import type { VehicleMileageHistory } from '../types/vehicle'

export interface MileageHistoryPanelProps {
  vehicleId: string
  refreshTrigger?: number
  pageSize?: number
}

function formatHistoryDate(value: string) {
  if (!value) return ''
  const date = value.includes('T')
    ? new Date(value)
    : new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatSource(source: string) {
  if (!source) return 'Manual'
  if (source === 'manual') return 'Manual'
  return source.charAt(0).toUpperCase() + source.slice(1)
}

export function MileageHistoryPanel({
  vehicleId,
  refreshTrigger,
  pageSize = 5,
}: MileageHistoryPanelProps) {
  const [history, setHistory] = useState<VehicleMileageHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.resolve()
      .then(() => {
        if (!alive) return []
        setLoading(true)
        setError('')
        return loadVehicleMileageHistory(vehicleId)
      })
      .then((data) => {
        if (alive) {
          setHistory(data)
          setPage(1)
        }
      })
      .catch(() => {
        if (alive) {
          setError('Unable to load mileage history. Please try again.')
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [vehicleId, refreshTrigger, retry])

  const totalPages = Math.max(1, Math.ceil(history.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const startIndex = (safePage - 1) * pageSize
  const currentEntries = history.slice(startIndex, startIndex + pageSize)

  return (
    <section
      className="panel mileage-history-section"
      aria-label="Mileage history"
    >
      <div className="section-heading">
        <div>
          <h2>Mileage history</h2>
          <p className="muted">
            Recorded odometer updates and mileage changes.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mileage-history-loading" role="status">
          <LoaderCircle className="animate-spin" size={20} aria-hidden="true" />
          <p>Loading mileage history…</p>
        </div>
      ) : error ? (
        <ErrorState
          message={error}
          retry={() => setRetry((value) => value + 1)}
        />
      ) : history.length === 0 ? (
        <div className="mileage-history-empty" role="status">
          <p className="muted">No mileage history recorded yet.</p>
        </div>
      ) : (
        <>
          <div className="mileage-history-table-wrap">
            <table
              className="mileage-history-table"
              aria-label="Mileage history records"
            >
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Mileage</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {currentEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <time
                        dateTime={entry.recorded_at}
                        title={entry.recorded_at}
                      >
                        {formatHistoryDate(entry.recorded_at)}
                      </time>
                    </td>
                    <td className="mileage-value-cell">
                      {entry.mileage.toLocaleString()} km
                    </td>
                    <td>
                      <span className="mileage-source-badge">
                        {formatSource(entry.source)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav
            className="mileage-pagination"
            aria-label="Mileage history pagination"
          >
            <span className="mileage-pagination-info" aria-live="polite">
              Page {safePage} of {totalPages}
            </span>
            <div className="mileage-pagination-controls">
              <button
                type="button"
                className="button secondary button-small"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} aria-hidden="true" />
                Previous
              </button>
              <button
                type="button"
                className="button secondary button-small"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                Next
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </nav>
        </>
      )}
    </section>
  )
}
