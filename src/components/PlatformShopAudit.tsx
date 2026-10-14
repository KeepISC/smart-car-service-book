import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { platformListShopAudit } from '../services/platformAdministration'
import type { PlatformShopAudit as Audit } from '../types/platformAdministration'
import { describeError, errorCode, formatDateTime } from './platformFormUtils'

const size = 20

// Audit rows contain shop configuration only; customer data is never included.
export function PlatformShopAudit({
  shopId,
  refreshKey,
}: {
  shopId: string
  refreshKey: number
}) {
  const [rows, setRows] = useState<Audit[]>([])
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    platformListShopAudit(shopId, offset, size)
      .then((data) => {
        if (!alive) return
        setRows(data)
        setError('')
      })
      .catch((failure) => {
        if (alive)
          setError(
            errorCode(failure) === '42501'
              ? describeError(failure)
              : 'Unable to load administrative history.',
          )
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [shopId, offset, attempt, refreshKey])

  return (
    <section aria-labelledby="audit-heading">
      <h3 id="audit-heading">Administrative history</h3>
      {loading ? (
        <p role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
          Loading history…
        </p>
      ) : error ? (
        <p className="service-feedback error" role="alert">
          {error}{' '}
          <button
            type="button"
            className="button secondary button-small"
            onClick={() => {
              setLoading(true)
              setAttempt((value) => value + 1)
            }}
          >
            Try again
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p className="muted">
          {offset ? 'No further history.' : 'No administrative history.'}
        </p>
      ) : (
        <ul className="shop-list">
          {rows.map((row) => (
            <li key={row.id} className="shop-row">
              <div>
                <strong>{row.action.replaceAll('_', ' ')}</strong>
                <p className="muted">
                  {formatDateTime(row.occurred_at)} · {row.executor}
                </p>
                <p>{row.reason}</p>
                {(row.before_state || row.after_state) && (
                  <details>
                    <summary>Changes</summary>
                    <pre className="audit-state">
                      {JSON.stringify(
                        { before: row.before_state, after: row.after_state },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="shop-actions">
        <button
          type="button"
          className="button secondary button-small"
          disabled={offset === 0 || loading}
          onClick={() => {
            setLoading(true)
            setOffset((value) => Math.max(0, value - size))
          }}
        >
          Newer
        </button>
        <button
          type="button"
          className="button secondary button-small"
          disabled={rows.length < size || loading}
          onClick={() => {
            setLoading(true)
            setOffset((value) => value + size)
          }}
        >
          Older
        </button>
      </div>
    </section>
  )
}
