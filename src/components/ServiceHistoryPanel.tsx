import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, Wrench } from 'lucide-react'
import {
  deleteServiceVisit,
  loadServiceHistory,
  saveServiceVisit,
} from '../services/serviceHistory'
import { loadMaintenance } from '../services/maintenance'
import { validateServiceVisit } from '../services/serviceHistoryLogic'
import { useLocalDate } from '../hooks/useLocalDate'
import { ErrorState, Loading } from './States'
import type { MaintenanceItem } from '../types/maintenance'
import type {
  ServiceOperationInput,
  ServiceVisit,
  ServiceVisitInput,
  ServiceType,
} from '../types/serviceHistory'
import type { Vehicle } from '../types/vehicle'
import { isServiceHistoryEnabled } from '../config/features'

type DraftOperation = ServiceOperationInput & { key: string }
type DraftVisit = Omit<ServiceVisitInput, 'mileage' | 'operations'> & {
  mileage: number | ''
  operations: DraftOperation[]
}

function emptyOperation(item: MaintenanceItem): DraftOperation {
  return {
    key: item.id,
    maintenance_item_id: item.id,
    operation_name: item.name,
    cost: null,
    next_interval_km: null,
    next_interval_months: null,
  }
}

function newVisit(vehicle: Vehicle, today: string): DraftVisit {
  return {
    service_date: today,
    mileage: vehicle.mileage,
    service_type: 'diy',
    workshop_name: null,
    total_cost: null,
    notes: null,
    operations: [],
  }
}

function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function costLabel(value: number | null) {
  return value === null ? 'Not recorded' : value.toFixed(2)
}

export function ServiceHistoryPanel({ vehicle }: { vehicle: Vehicle }) {
  if (!isServiceHistoryEnabled()) return null
  return <EnabledServiceHistoryPanel vehicle={vehicle} />
}

function EnabledServiceHistoryPanel({ vehicle }: { vehicle: Vehicle }) {
  const today = useLocalDate()
  const [visits, setVisits] = useState<ServiceVisit[]>([])
  const [maintenanceItems, setMaintenanceItems] = useState<MaintenanceItem[]>(
    [],
  )
  const [draft, setDraft] = useState<DraftVisit | null>(null)
  const [editId, setEditId] = useState<string | undefined>()
  const [deleting, setDeleting] = useState<ServiceVisit | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  const fetchHistory = useCallback(
    () =>
      Promise.all([loadServiceHistory(vehicle.id), loadMaintenance(vehicle)]),
    [vehicle],
  )

  useEffect(() => {
    let alive = true
    fetchHistory()
      .then(([history, maintenance]) => {
        if (alive) {
          setVisits(history)
          setMaintenanceItems(maintenance.items)
        }
      })
      .catch(() => {
        if (alive)
          setLoadError('Unable to load service history. Please try again.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [fetchHistory])

  async function reload() {
    setLoading(true)
    setLoadError('')
    try {
      const [history, maintenance] = await fetchHistory()
      setVisits(history)
      setMaintenanceItems(maintenance.items)
    } catch {
      setLoadError('Unable to load service history. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function beginAdd() {
    setDraft(newVisit(vehicle, today))
    setEditId(undefined)
    setError('')
    setSuccess('')
  }

  function beginEdit(visit: ServiceVisit) {
    setDraft({
      service_date: visit.service_date,
      mileage: visit.mileage,
      service_type: visit.service_type,
      workshop_name: visit.workshop_name,
      total_cost: visit.total_cost,
      notes: visit.notes,
      operations: visit.operations.map((operation) => ({
        maintenance_item_id: operation.maintenance_item_id,
        operation_name: operation.operation_name,
        cost: operation.cost,
        next_interval_km: operation.next_interval_km,
        next_interval_months: operation.next_interval_months,
        key: operation.maintenance_item_id
          ? `schedule-${operation.maintenance_item_id}`
          : `custom-${operation.id}`,
      })),
    })
    setEditId(visit.id)
    setError('')
    setSuccess('')
  }

  function updateDraft(values: Partial<DraftVisit>) {
    setDraft((current) => (current ? { ...current, ...values } : current))
  }

  function updateOperation(key: string, values: Partial<DraftOperation>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            operations: current.operations.map((operation) =>
              operation.key === key ? { ...operation, ...values } : operation,
            ),
          }
        : current,
    )
  }

  function toggleSchedule(item: MaintenanceItem, checked: boolean) {
    setDraft((current) => {
      if (!current) return current
      return {
        ...current,
        operations: checked
          ? [...current.operations, emptyOperation(item)]
          : current.operations.filter(
              (operation) => operation.maintenance_item_id !== item.id,
            ),
      }
    })
  }

  function addCustomOperation() {
    setDraft((current) =>
      current
        ? {
            ...current,
            operations: [
              ...current.operations,
              {
                key: `custom-${Date.now()}-${current.operations.length}`,
                maintenance_item_id: null,
                operation_name: '',
                cost: null,
                next_interval_km: null,
                next_interval_months: null,
              },
            ],
          }
        : current,
    )
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    const input: ServiceVisitInput = {
      ...draft,
      mileage: draft.mileage === '' ? Number.NaN : draft.mileage,
      workshop_name:
        draft.service_type === 'workshop'
          ? draft.workshop_name?.trim() || null
          : null,
      notes: draft.notes?.trim() || null,
      operations: draft.operations.map((operation) => ({
        maintenance_item_id: operation.maintenance_item_id,
        operation_name: operation.operation_name,
        cost: operation.cost,
        next_interval_km: operation.next_interval_km,
        next_interval_months: operation.next_interval_months,
      })),
    }
    const validationErrors = validateServiceVisit(input, vehicle.mileage, today)
    if (validationErrors.length) {
      setError(validationErrors.join(' '))
      setSuccess('')
      return
    }

    setBusy(true)
    setError('')
    setSuccess('')
    try {
      await saveServiceVisit(vehicle, input, editId)
      setDraft(null)
      setEditId(undefined)
      setSuccess(editId ? 'Service visit updated.' : 'Service visit saved.')
      await reload()
    } catch {
      setError(
        'Unable to save this service visit. Check the date, odometer, and permissions, then try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function removeVisit() {
    if (!deleting) return
    setBusy(true)
    setError('')
    try {
      await deleteServiceVisit(vehicle.id, deleting.id)
      setVisits((current) =>
        current.filter((visit) => visit.id !== deleting.id),
      )
      setDeleting(null)
      setSuccess('Service visit deleted.')
    } catch {
      setError('Unable to delete this service visit. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading />
  if (loadError)
    return <ErrorState message={loadError} retry={() => void reload()} />

  return (
    <section className="service-history" aria-label="Service history">
      <div className="section-heading">
        <div>
          <h2>Service history</h2>
          <p className="muted">
            Record workshop visits and DIY maintenance. Current odometer:{' '}
            {vehicle.mileage.toLocaleString()} km.
          </p>
        </div>
        <button
          className="button"
          disabled={busy || draft !== null}
          onClick={beginAdd}
        >
          <Plus size={17} />
          Add service visit
        </button>
      </div>
      {error && (
        <p className="service-feedback error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="service-feedback success" role="status">
          {success}
        </p>
      )}

      {draft && (
        <form
          className="panel service-form"
          onSubmit={(event) => void save(event)}
        >
          <h3>{editId ? 'Edit service visit' : 'Add service visit'}</h3>
          <fieldset disabled={busy}>
            <legend>Visit details</legend>
            <div className="form-grid">
              <label>
                Service date
                <input
                  type="date"
                  required
                  max={today}
                  value={draft.service_date}
                  onChange={(event) =>
                    updateDraft({ service_date: event.target.value })
                  }
                />
              </label>
              <label>
                Odometer (km)
                <input
                  type="number"
                  required
                  min={0}
                  max={vehicle.mileage}
                  step={1}
                  value={draft.mileage}
                  onChange={(event) =>
                    updateDraft({
                      mileage:
                        event.target.value === ''
                          ? ''
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <fieldset className="service-type-options">
              <legend>Service type</legend>
              {(['diy', 'workshop'] as const).map((type: ServiceType) => (
                <label className="type-option" key={type}>
                  <input
                    type="radio"
                    name="service-type"
                    checked={draft.service_type === type}
                    onChange={() =>
                      updateDraft({
                        service_type: type,
                        workshop_name:
                          type === 'workshop' ? draft.workshop_name : null,
                      })
                    }
                  />
                  {type === 'diy' ? 'DIY' : 'Workshop'}
                </label>
              ))}
            </fieldset>
            {draft.service_type === 'workshop' && (
              <label>
                Workshop name (optional)
                <input
                  maxLength={120}
                  value={draft.workshop_name ?? ''}
                  onChange={(event) =>
                    updateDraft({ workshop_name: event.target.value || null })
                  }
                />
              </label>
            )}
            <label>
              Total cost (optional)
              <input
                type="number"
                min={0}
                max={999999999.99}
                step="0.01"
                value={draft.total_cost ?? ''}
                onChange={(event) =>
                  updateDraft({
                    total_cost:
                      event.target.value === ''
                        ? null
                        : Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Notes (optional)
              <textarea
                maxLength={4000}
                rows={3}
                value={draft.notes ?? ''}
                onChange={(event) =>
                  updateDraft({ notes: event.target.value || null })
                }
              />
            </label>
          </fieldset>

          <fieldset disabled={busy}>
            <legend>Completed operations</legend>
            {maintenanceItems.length ? (
              <div className="service-schedule-choices">
                {maintenanceItems.map((item) => (
                  <label className="maintenance-checkbox" key={item.id}>
                    <input
                      type="checkbox"
                      checked={draft.operations.some(
                        (operation) =>
                          operation.maintenance_item_id === item.id,
                      )}
                      onChange={(event) =>
                        toggleSchedule(item, event.target.checked)
                      }
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted">
                No scheduled operations yet. Add a custom operation below.
              </p>
            )}
            {draft.operations.map((operation, index) => (
              <div className="service-operation-draft" key={operation.key}>
                <div className="section-heading">
                  <h3>Operation {index + 1}</h3>
                  <button
                    type="button"
                    className="text-link danger-text"
                    aria-label={`Remove operation ${index + 1}`}
                    onClick={() =>
                      updateDraft({
                        operations: draft.operations.filter(
                          (entry) => entry.key !== operation.key,
                        ),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
                <div className="form-grid">
                  <label>
                    Operation name
                    <input
                      required
                      maxLength={120}
                      value={operation.operation_name}
                      onChange={(event) =>
                        updateOperation(operation.key, {
                          operation_name: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Operation cost (optional)
                    <input
                      type="number"
                      min={0}
                      max={999999999.99}
                      step="0.01"
                      value={operation.cost ?? ''}
                      onChange={(event) =>
                        updateOperation(operation.key, {
                          cost:
                            event.target.value === ''
                              ? null
                              : Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  {operation.maintenance_item_id !== null && (
                    <>
                      <label>
                        Next interval override (km, optional)
                        <input
                          type="number"
                          min={1}
                          max={10000000}
                          step={1}
                          value={operation.next_interval_km ?? ''}
                          onChange={(event) =>
                            updateOperation(operation.key, {
                              next_interval_km:
                                event.target.value === ''
                                  ? null
                                  : Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Next interval override (months, optional)
                        <input
                          type="number"
                          min={1}
                          max={1200}
                          step={1}
                          value={operation.next_interval_months ?? ''}
                          onChange={(event) =>
                            updateOperation(operation.key, {
                              next_interval_months:
                                event.target.value === ''
                                  ? null
                                  : Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>
            ))}
            <button
              className="button secondary"
              type="button"
              onClick={addCustomOperation}
            >
              <Plus size={16} />
              Add custom operation
            </button>
          </fieldset>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setDraft(null)
                setError('')
              }}
            >
              Cancel
            </button>
            <button className="button" disabled={busy}>
              {busy
                ? 'Saving…'
                : editId
                  ? 'Save changes'
                  : 'Save service visit'}
            </button>
          </div>
        </form>
      )}

      {deleting && (
        <section
          className="panel service-delete-confirm"
          role="group"
          aria-label="Confirm service visit deletion"
        >
          <h3>Delete service visit?</h3>
          <p className="muted">
            This removes the visit and its operations. Linked maintenance due
            dates will be recalculated.
          </p>
          <div className="form-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void removeVisit()}
            >
              {busy ? 'Deleting…' : 'Delete visit'}
            </button>
          </div>
        </section>
      )}

      {visits.length === 0 ? (
        <section className="panel service-empty">
          <Wrench size={28} />
          <h3>No service history yet</h3>
          <p>
            Add your first workshop visit or DIY maintenance to keep a record.
          </p>
        </section>
      ) : (
        <div className="service-timeline">
          {visits.map((visit) => (
            <article className="panel service-visit" key={visit.id}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{dateLabel(visit.service_date)}</p>
                  <h3>
                    {visit.service_type === 'diy'
                      ? 'DIY maintenance'
                      : 'Workshop visit'}
                  </h3>
                  {visit.workshop_name && <p>{visit.workshop_name}</p>}
                </div>
                <span className="service-mileage">
                  {visit.mileage.toLocaleString()} km
                </span>
              </div>
              <ul className="service-operation-list">
                {visit.operations.map((operation) => (
                  <li key={operation.id}>
                    <span>{operation.operation_name}</span>
                    <span>{costLabel(operation.cost)}</span>
                  </li>
                ))}
              </ul>
              <dl className="service-cost-details">
                <div>
                  <dt>Total cost</dt>
                  <dd>{costLabel(visit.total_cost)}</dd>
                </div>
              </dl>
              {visit.notes && <p className="service-notes">{visit.notes}</p>}
              <div className="maintenance-actions">
                <button
                  className="button secondary button-small"
                  disabled={busy || draft !== null}
                  onClick={() => beginEdit(visit)}
                >
                  <Pencil size={15} />
                  Edit
                </button>
                <button
                  className="button secondary button-small danger-text"
                  disabled={busy || draft !== null}
                  onClick={() => setDeleting(visit)}
                >
                  <Trash2 size={15} />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
