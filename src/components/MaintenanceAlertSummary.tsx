import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  LoaderCircle,
} from 'lucide-react'
import type { Vehicle } from '../types/vehicle'
import type { MaintenanceAlertSummary as MaintenanceAlertSummaryType } from '../types/maintenance'
import { loadGarageMaintenanceSummary } from '../services/maintenance'
import { useLocalDate } from '../hooks/useLocalDate'

export function MaintenanceAlertSummary({
  vehicles,
  vehiclesLoading = false,
  vehiclesError = '',
  today: propToday,
}: {
  vehicles: Vehicle[]
  vehiclesLoading?: boolean
  vehiclesError?: string
  today?: string
}) {
  const localToday = useLocalDate()
  const today = propToday ?? localToday
  const [summary, setSummary] = useState<MaintenanceAlertSummaryType | null>(
    null,
  )
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!vehicles.length) {
      setSummary({ overdue: 0, dueSoon: 0 })
      setError('')
      return
    }
    setRetrying(true)
    setError('')
    try {
      const data = await loadGarageMaintenanceSummary(vehicles, today)
      setSummary(data)
    } catch {
      setError(
        'We couldn’t load maintenance alerts. Check your connection and try again.',
      )
    } finally {
      setRetrying(false)
    }
  }, [vehicles, today])

  useEffect(() => {
    if (vehiclesLoading || vehiclesError) return
    if (!vehicles.length) {
      return
    }
    let alive = true
    loadGarageMaintenanceSummary(vehicles, today)
      .then((data) => {
        if (alive) setSummary(data)
      })
      .catch(() => {
        if (alive) {
          setError(
            'We couldn’t load maintenance alerts. Check your connection and try again.',
          )
        }
      })
    return () => {
      alive = false
    }
  }, [vehicles, vehiclesLoading, vehiclesError, today])

  const loading =
    vehiclesLoading ||
    retrying ||
    (Boolean(vehicles.length) && summary === null && !error)

  if (vehiclesError) {
    return (
      <section
        className="maintenance-alerts-card"
        aria-label="Maintenance alerts"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">MAINTENANCE OVERVIEW</span>
            <h2>Alert summary</h2>
          </div>
        </div>
        <div className="notice" role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <div>
            <p>Unable to load vehicles for maintenance alert calculation.</p>
          </div>
        </div>
      </section>
    )
  }

  if (loading) {
    return (
      <section
        className="maintenance-alerts-card"
        aria-label="Maintenance alerts"
        aria-busy="true"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">MAINTENANCE OVERVIEW</span>
            <h2>Alert summary</h2>
          </div>
        </div>
        <div className="maintenance-alerts-loading" role="status">
          <LoaderCircle className="animate-spin" size={20} aria-hidden="true" />
          <p>Loading maintenance alerts…</p>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section
        className="maintenance-alerts-card"
        aria-label="Maintenance alerts"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">MAINTENANCE OVERVIEW</span>
            <h2>Alert summary</h2>
          </div>
        </div>
        <div className="notice" role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <div>
            <p>{error}</p>
            <button
              type="button"
              className="text-link"
              onClick={() => void load()}
            >
              Try again
            </button>
          </div>
        </div>
      </section>
    )
  }

  const overdueCount = summary?.overdue ?? 0
  const dueSoonCount = summary?.dueSoon ?? 0
  const hasOverdue = overdueCount > 0
  const hasDueSoon = dueSoonCount > 0

  if (!vehicles.length) {
    return (
      <section
        className="maintenance-alerts-card"
        aria-label="Maintenance alerts"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">MAINTENANCE OVERVIEW</span>
            <h2>Alert summary</h2>
          </div>
        </div>
        <div className="maintenance-alert-counters">
          <div
            className="alert-stat overdue"
            aria-label="Overdue maintenance operations"
          >
            <span>
              Overdue
              <AlertCircle size={18} aria-hidden="true" />
            </span>
            <strong>00</strong>
            <small>0 operations overdue</small>
          </div>
          <div
            className="alert-stat soon"
            aria-label="Maintenance operations due soon"
          >
            <span>
              Due soon
              <Clock size={18} aria-hidden="true" />
            </span>
            <strong>00</strong>
            <small>0 operations due soon</small>
          </div>
        </div>
        <p className="muted alert-empty-note">
          No vehicles in your garage yet. Add a vehicle to track maintenance
          alerts.
        </p>
      </section>
    )
  }

  return (
    <section
      className="maintenance-alerts-card"
      aria-label="Maintenance alerts"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">MAINTENANCE OVERVIEW</span>
          <h2>Alert summary</h2>
        </div>
      </div>
      <div className="maintenance-alert-counters">
        <div
          className={`alert-stat overdue ${hasOverdue ? 'has-alerts' : ''}`}
          aria-label="Overdue maintenance operations"
        >
          <span>
            Overdue
            <AlertCircle size={18} aria-hidden="true" />
          </span>
          <strong>{overdueCount.toString().padStart(2, '0')}</strong>
          <small>
            {overdueCount === 1
              ? '1 operation overdue'
              : `${overdueCount} operations overdue`}
          </small>
        </div>
        <div
          className={`alert-stat soon ${hasDueSoon ? 'has-alerts' : ''}`}
          aria-label="Maintenance operations due soon"
        >
          <span>
            Due soon
            <Clock size={18} aria-hidden="true" />
          </span>
          <strong>{dueSoonCount.toString().padStart(2, '0')}</strong>
          <small>
            {dueSoonCount === 1
              ? '1 operation due soon'
              : `${dueSoonCount} operations due soon`}
          </small>
        </div>
      </div>
      {!hasOverdue && !hasDueSoon ? (
        <div className="maintenance-alerts-status up-to-date" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          <span>
            All scheduled maintenance across your vehicles is up to date.
          </span>
        </div>
      ) : (
        <div
          className={`maintenance-alerts-status ${hasOverdue ? 'overdue' : 'attention'}`}
          role="status"
        >
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            {hasOverdue && hasDueSoon
              ? `${overdueCount} overdue and ${dueSoonCount} due soon operations require attention.`
              : hasOverdue
                ? `${overdueCount} maintenance ${overdueCount === 1 ? 'operation is' : 'operations are'} overdue.`
                : `${dueSoonCount} maintenance ${dueSoonCount === 1 ? 'operation is' : 'operations are'} due soon.`}
          </span>
        </div>
      )}
    </section>
  )
}
