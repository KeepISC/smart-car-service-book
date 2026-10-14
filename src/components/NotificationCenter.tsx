import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Clock,
  LoaderCircle,
  X,
} from 'lucide-react'
import type { MaintenanceAlertSummary as MaintenanceAlertSummaryType } from '../types/maintenance'
import { loadGarageMaintenanceSummary } from '../services/maintenance'
import { listVehicles } from '../services/vehicles'
import { useLocalDate } from '../hooks/useLocalDate'
import { useMaintenanceRefresh } from '../hooks/useMaintenanceRefresh'
import { useShopReminders } from '../hooks/useShopReminders'
import { ShopReminderNotifications } from './ShopReminderNotifications'

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function NotificationCenter({
  today: propToday,
  initialOpen = false,
  onNavigate,
  summary: propSummary,
  loading: propLoading,
  error: propError,
  onReload: propReload,
}: {
  today?: string
  initialOpen?: boolean
  onNavigate?: () => void
  summary?: MaintenanceAlertSummaryType | null
  loading?: boolean
  error?: string
  onReload?: () => void
} = {}) {
  const localToday = useLocalDate()
  const today = propToday ?? localToday
  const location = useLocation()

  const [internalSummary, setInternalSummary] =
    useState<MaintenanceAlertSummaryType | null>(null)
  const [internalLoading, setInternalLoading] = useState(
    propSummary === undefined && propLoading === undefined,
  )
  const [internalError, setInternalError] = useState('')
  const [isOpen, setIsOpen] = useState(initialOpen)

  const bellButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const summary = propSummary !== undefined ? propSummary : internalSummary
  const loading = propLoading !== undefined ? propLoading : internalLoading
  const error = propError !== undefined ? propError : internalError

  const controlled =
    propSummary !== undefined ||
    propError !== undefined ||
    propLoading !== undefined
  const { revision, reload } = useMaintenanceRefresh(!controlled)
  const load = propReload ?? reload
  const shopReminders = useShopReminders(
    !controlled,
    revision,
    location.pathname + location.search,
  )

  // Load on mount and route changes (e.g. after adding/editing/deleting a vehicle)
  useEffect(() => {
    if (controlled) return
    let alive = true
    const conceal = () => {
      alive = false
      setInternalSummary(null)
      setInternalLoading(true)
    }
    window.addEventListener('app:ownership-change', conceal)
    const vehiclePromise = Promise.resolve().then(() => {
      if (!alive) return []
      setInternalLoading(true)
      setInternalError('')
      return listVehicles()
    })
    vehiclePromise
      .then(async (vehicles) => {
        if (!alive) return
        if (!vehicles.length) {
          setInternalSummary({ overdue: 0, dueSoon: 0, alerts: [] })
          setInternalLoading(false)
          return
        }
        const data = await loadGarageMaintenanceSummary(vehicles, today)
        if (alive) {
          setInternalSummary(data)
          setInternalLoading(false)
        }
      })
      .catch(() => {
        if (alive) {
          setInternalError('Unable to load maintenance alerts.')
          setInternalLoading(false)
        }
      })
    return () => {
      alive = false
      window.removeEventListener('app:ownership-change', conceal)
    }
  }, [location.pathname, location.search, controlled, revision, today])

  // Keyboard navigation & Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        bellButtonRef.current?.focus()
      }
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !bellButtonRef.current?.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isOpen])

  const alerts = summary?.alerts ?? []
  const count =
    alerts.length + shopReminders.reminders.filter((row) => !row.read_at).length

  const handleToggle = () => {
    setIsOpen((prev) => !prev)
  }

  const handleClose = () => {
    setIsOpen(false)
    bellButtonRef.current?.focus()
  }

  const handleItemClick = () => {
    setIsOpen(false)
    onNavigate?.()
  }

  return (
    <div className="notification-center">
      <button
        ref={bellButtonRef}
        type="button"
        className={`notification-bell-button ${isOpen ? 'active' : ''}`}
        aria-label={
          count > 0
            ? `Notifications (${count} items require attention)`
            : 'Notifications'
        }
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls="notification-panel"
        onClick={handleToggle}
      >
        <Bell size={20} aria-hidden="true" />
        {count > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="notification-panel"
          ref={panelRef}
          className="notification-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Maintenance notifications"
        >
          <div className="notification-panel-header">
            <div>
              <h3>Notifications</h3>
              <span className="notification-panel-subtitle">
                {count === 1
                  ? '1 operation requires attention'
                  : `${count} operations require attention`}
              </span>
            </div>
            <button
              type="button"
              className="notification-close-btn"
              aria-label="Close notifications"
              onClick={handleClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="notification-panel-body">
            {!controlled && (
              <ShopReminderNotifications
                {...shopReminders}
                reload={reload}
                onNavigate={handleItemClick}
              />
            )}
            {loading ? (
              <div className="notification-status-state" role="status">
                <LoaderCircle
                  className="animate-spin"
                  size={20}
                  aria-hidden="true"
                />
                <p>Loading notifications…</p>
              </div>
            ) : error ? (
              <div className="notification-status-state error" role="alert">
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
            ) : alerts.length === 0 ? (
              <div className="notification-empty" role="status">
                <CheckCircle2 size={24} aria-hidden="true" />
                <div>
                  <strong>All maintenance is up to date</strong>
                  <p>
                    No overdue or upcoming maintenance operations across your
                    vehicles.
                  </p>
                </div>
              </div>
            ) : (
              <ul
                className="notification-list"
                role="list"
                aria-label="Maintenance alerts"
              >
                {alerts.map((alert) => {
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
                    if (
                      alert.daysRemaining !== null &&
                      alert.daysRemaining <= 0
                    ) {
                      overdueParts.push(
                        alert.daysRemaining === 0
                          ? 'Due today'
                          : `${Math.abs(alert.daysRemaining)} ${Math.abs(alert.daysRemaining) === 1 ? 'day' : 'days'} overdue`,
                      )
                    }
                    deltaLabel =
                      overdueParts.length > 0
                        ? overdueParts.join(' · ')
                        : 'Overdue'
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
                    <li key={`${alert.vehicleId}-${alert.id}`}>
                      <Link
                        to={`/vehicles/${alert.vehicleId}?tab=maintenance`}
                        onClick={handleItemClick}
                        className={`notification-item ${isOverdue ? 'overdue' : 'soon'}`}
                        aria-label={`View ${alert.operationName} for ${alert.vehicleName}`}
                      >
                        <div
                          className="notification-item-indicator"
                          aria-hidden="true"
                        >
                          {isOverdue ? (
                            <AlertCircle size={16} />
                          ) : (
                            <Clock size={16} />
                          )}
                        </div>
                        <div className="notification-item-content">
                          <div className="notification-item-header">
                            <span className="notification-item-vehicle">
                              {alert.vehicleName}
                            </span>
                            <span
                              className={`maintenance-status ${isOverdue ? 'due' : 'soon'}`}
                            >
                              {alert.status}
                            </span>
                          </div>
                          <h4 className="notification-item-title">
                            {alert.operationName}
                          </h4>
                          <div className="notification-item-meta">
                            {dueInfo && <span>{dueInfo}</span>}
                            {dueInfo && deltaLabel && (
                              <span className="bullet">·</span>
                            )}
                            {deltaLabel && (
                              <span className="notification-delta">
                                {deltaLabel}
                              </span>
                            )}
                          </div>
                        </div>
                        <ArrowUpRight
                          className="notification-item-arrow"
                          size={16}
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
