import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  LoaderCircle,
} from 'lucide-react'
import type { Vehicle } from '../types/vehicle'
import type { MaintenanceAlertSummary as MaintenanceAlertSummaryType } from '../types/maintenance'
import { loadGarageMaintenanceSummary } from '../services/maintenance'
import { useLocalDate } from '../hooks/useLocalDate'

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

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
      setSummary({ overdue: 0, dueSoon: 0, alerts: [] })
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
      {Boolean(summary?.alerts?.length) && (
        <div className="maintenance-alerts-detail">
          <h3 className="maintenance-alerts-detail-heading">
            Operations requiring attention
          </h3>
          <div
            className="maintenance-alerts-list"
            role="list"
            aria-label="Maintenance alert operations"
          >
            {summary!.alerts!.map((alert) => {
              const isOverdue = alert.status === 'Due / overdue'
              const dueInfo = [
                alert.dueDate ? dateLabel(alert.dueDate) : '',
                alert.dueMileage !== null
                  ? `${alert.dueMileage.toLocaleString()} km`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')

              let deltaLabel: string
              if (isOverdue) {
                const overdueParts: string[] = []
                if (alert.kmRemaining !== null && alert.kmRemaining <= 0) {
                  overdueParts.push(
                    `${Math.abs(alert.kmRemaining).toLocaleString()} km overdue`,
                  )
                }
                if (alert.daysRemaining !== null && alert.daysRemaining <= 0) {
                  overdueParts.push(
                    alert.daysRemaining === 0
                      ? 'Due today'
                      : `${Math.abs(alert.daysRemaining)} ${Math.abs(alert.daysRemaining) === 1 ? 'day' : 'days'} overdue`,
                  )
                }
                deltaLabel =
                  overdueParts.length > 0 ? overdueParts.join(' · ') : 'Overdue'
              } else {
                const soonParts: string[] = []
                if (
                  alert.kmRemaining !== null &&
                  alert.kmRemaining > 0 &&
                  alert.kmRemaining <= 1000
                ) {
                  soonParts.push(
                    `Due in ${alert.kmRemaining.toLocaleString()} km`,
                  )
                }
                if (
                  alert.daysRemaining !== null &&
                  alert.daysRemaining > 0 &&
                  alert.daysRemaining <= 30
                ) {
                  soonParts.push(
                    `Due in ${alert.daysRemaining} ${alert.daysRemaining === 1 ? 'day' : 'days'}`,
                  )
                }
                deltaLabel =
                  soonParts.length > 0 ? soonParts.join(' · ') : 'Due soon'
              }

              return (
                <Link
                  key={`${alert.vehicleId}-${alert.id}`}
                  to={`/vehicles/${alert.vehicleId}?tab=maintenance`}
                  className={`alert-item-card ${isOverdue ? 'overdue' : 'soon'}`}
                  role="listitem"
                  aria-label={`View ${alert.operationName} for ${alert.vehicleName}`}
                >
                  <div className="alert-item-main">
                    <div className="alert-item-header">
                      <span className="alert-item-vehicle">
                        {alert.vehicleName}
                      </span>
                      <span
                        className={`maintenance-status ${isOverdue ? 'due' : 'soon'}`}
                      >
                        {alert.status}
                      </span>
                    </div>
                    <h4 className="alert-item-operation">
                      {alert.operationName}
                    </h4>
                    <div className="alert-item-meta">
                      {dueInfo && (
                        <span className="alert-due-target">{dueInfo}</span>
                      )}
                      {dueInfo && deltaLabel && (
                        <span className="bullet">·</span>
                      )}
                      {deltaLabel && (
                        <span className="alert-due-delta">{deltaLabel}</span>
                      )}
                    </div>
                  </div>
                  <div className="alert-item-action">
                    <span className="view-schedule-text">View schedule</span>
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
