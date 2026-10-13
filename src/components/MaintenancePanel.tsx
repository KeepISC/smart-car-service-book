import { useEffect, useState } from 'react'
import { Plus, Wrench } from 'lucide-react'
import type { Vehicle } from '../types/vehicle'
import type {
  MaintenanceInput,
  MaintenanceItem,
  MaintenanceTemplate,
} from '../types/maintenance'
import {
  loadMaintenance,
  removeMaintenance,
  saveMaintenance,
} from '../services/maintenance'
import {
  calculateMaintenance,
  starterSchedule,
  validateMaintenance,
} from '../services/maintenanceLogic'
import { ErrorState, Loading } from './States'
import { useLocalDate } from '../hooks/useLocalDate'
import {
  MileageConsistencyError,
  MaintenanceCompletionConflictError,
} from '../services/dataErrors'
import { isServiceHistoryEnabled } from '../config/features'
import { LegacyMaintenanceCompletionFields } from './LegacyMaintenanceCompletionFields'

const blank: MaintenanceInput = {
  name: '',
  interval_km: null,
  interval_months: null,
  enabled: true,
  history_status: 'unknown',
  last_completed_date: null,
  last_completed_mileage: null,
}
function Fields({
  value,
  change,
  mileage,
  today,
}: {
  value: MaintenanceInput
  change: (value: MaintenanceInput) => void
  mileage: number
  today: string
}) {
  return (
    <div className="form-grid">
      <label>
        Operation name
        <input
          required
          maxLength={120}
          value={value.name}
          onChange={(e) => change({ ...value, name: e.target.value })}
        />
      </label>
      {(['interval_km', 'interval_months'] as const).map((field) => (
        <label key={field}>
          Interval ({field === 'interval_km' ? 'km' : 'months'}, optional)
          <input
            type="number"
            min={1}
            max={field === 'interval_km' ? 10000000 : 1200}
            step={1}
            value={value[field] ?? ''}
            onChange={(e) =>
              change({
                ...value,
                [field]: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        </label>
      ))}
      {isServiceHistoryEnabled() ? (
        <p className="muted maintenance-history-note">
          Record completed work in Service history so maintenance due dates stay
          synchronized with your visits.
        </p>
      ) : (
        <LegacyMaintenanceCompletionFields
          value={value}
          change={change}
          mileage={mileage}
          today={today}
        />
      )}
      <label className="maintenance-checkbox">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => change({ ...value, enabled: e.target.checked })}
        />
        Enable this operation
      </label>
    </div>
  )
}
function dateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
export function MaintenancePanel({ vehicle }: { vehicle: Vehicle }) {
  const today = useLocalDate()
  const [items, setItems] = useState<MaintenanceItem[]>([])
  const [templates, setTemplates] = useState<MaintenanceTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<MaintenanceInput[] | null>(null)
  const [source, setSource] = useState('')
  const [editId, setEditId] = useState<string | undefined>()
  const [deleting, setDeleting] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadMaintenance(vehicle)
      .then((data) => {
        if (alive) {
          setItems(data.items)
          setTemplates(data.templates)
        }
      })
      .catch(() => {
        if (alive)
          setLoadError(
            'Maintenance is unavailable. Confirm the maintenance migration has been applied, then retry.',
          )
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [vehicle])
  async function reload() {
    setLoading(true)
    setLoadError('')
    try {
      const data = await loadMaintenance(vehicle)
      setItems(data.items)
      setTemplates(data.templates)
    } catch {
      setLoadError(
        'Unable to load maintenance. Check your connection and database setup.',
      )
    } finally {
      setLoading(false)
    }
  }
  function review(
    values: MaintenanceInput[],
    description: string,
    id?: string,
  ) {
    setDrafts(values)
    setSource(description)
    setEditId(id)
    setError('')
  }
  async function save(values: MaintenanceInput[], id?: string) {
    const errors = values.flatMap((item) =>
      validateMaintenance(item, vehicle.mileage, today).map(
        (message) => `${item.name || 'Operation'}: ${message}`,
      ),
    )
    if (errors.length) {
      setError(errors.join(' '))
      return
    }
    if (!values.length) {
      setDrafts(null)
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveMaintenance(vehicle, values, id)
      setDrafts(null)
      // The returned schedule row contains the legacy baseline, not the
      // completion and interval overrides derived from service history.
      await reload()
    } catch (failure) {
      setError(
        failure instanceof MileageConsistencyError ||
          failure instanceof MaintenanceCompletionConflictError
          ? failure.message
          : 'Unable to save maintenance. Check your connection and permissions, then try again.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function remove(id: string) {
    setBusy(true)
    setError('')
    try {
      await removeMaintenance(vehicle.id, id)
      setItems((previous) => previous.filter((item) => item.id !== id))
      setDeleting(null)
    } catch {
      setError('Unable to remove this operation. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  if (loading) return <Loading />
  if (loadError)
    return <ErrorState message={loadError} retry={() => void reload()} />
  return (
    <section aria-label="Vehicle maintenance">
      <div className="section-heading">
        <div>
          <h2>Maintenance schedule</h2>
          <p className="muted">
            Current mileage: {vehicle.mileage.toLocaleString()} km. Due soon
            within 1,000 km or 30 days.
          </p>
        </div>
        <button
          className="button"
          disabled={busy || drafts !== null}
          onClick={() =>
            review(
              [{ ...blank }],
              'Enter intervals from your vehicle documentation.',
            )
          }
        >
          <Plus size={17} />
          Add operation
        </button>
      </div>
      <div className="notice">
        <Wrench size={20} />
        <p>
          Confirm intervals against official vehicle documentation. Starter
          values are illustrative examples, not verified manufacturer
          specifications.
        </p>
      </div>
      {error && <ErrorState message={error} />}
      {!items.length && drafts === null && (
        <section className="panel">
          <h2>Build your schedule</h2>
          <p className="muted">
            Review and edit intervals before saving. Previous maintenance stays
            unknown until you enter a known completion.
          </p>
          {templates.length ? (
            templates.map((template) => (
              <div className="template-choice" key={template.id}>
                <h3>{template.name}</h3>
                <p className="muted">
                  {template.source_notes}{' '}
                  <a
                    className="text-link"
                    href={template.source_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source: {template.source_name}
                  </a>
                </p>
                <button
                  className="button secondary"
                  onClick={() =>
                    review(
                      template.maintenance_template_items.map((item) => ({
                        ...blank,
                        name: item.name,
                        interval_km: item.interval_km,
                        interval_months: item.interval_months,
                      })),
                      `Verified template source: ${template.source_name}. Review edits before saving.`,
                    )
                  }
                >
                  Review verified template
                </button>
              </div>
            ))
          ) : (
            <p className="muted">
              No verified template matches this vehicle’s make, model, year and
              engine.
            </p>
          )}
          <div className="schedule-choices">
            <button
              className="button"
              onClick={() =>
                review(
                  starterSchedule.map((item) => ({ ...item })),
                  'Unverified illustrative starter values — confirm every interval before saving.',
                )
              }
            >
              Review editable starter schedule
            </button>
            <button
              className="button secondary"
              onClick={() =>
                review(
                  [{ ...blank }],
                  'Custom blank schedule — add operations and intervals from your documentation.',
                )
              }
            >
              Start a blank schedule
            </button>
          </div>
        </section>
      )}
      {drafts !== null && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault()
            void save(drafts, editId)
          }}
        >
          <h2>{editId ? 'Edit maintenance' : 'Review your schedule'}</h2>
          <p className="muted">
            {source} At least one interval is required. Known history needs a
            date and/or mileage.
          </p>
          <fieldset disabled={busy} className="schedule-draft">
            {drafts.map((draft, index) => (
              <div className="draft-operation" key={index}>
                <h3>Operation {index + 1}</h3>
                <Fields
                  value={draft}
                  mileage={vehicle.mileage}
                  today={today}
                  change={(value) =>
                    setDrafts(
                      drafts.map((item, i) => (i === index ? value : item)),
                    )
                  }
                />
                {!editId && (
                  <button
                    type="button"
                    className="text-link danger-text"
                    onClick={() =>
                      setDrafts(drafts.filter((_, i) => i !== index))
                    }
                  >
                    Remove operation {index + 1}
                  </button>
                )}
              </div>
            ))}
            {!editId && (
              <button
                type="button"
                className="button secondary"
                onClick={() => setDrafts([...drafts, { ...blank }])}
              >
                Add operation
              </button>
            )}
          </fieldset>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setDrafts(null)
                setError('')
              }}
            >
              Cancel
            </button>
            <button className="button" disabled={busy}>
              {busy
                ? 'Saving…'
                : drafts.length
                  ? 'Save reviewed schedule'
                  : 'Keep schedule blank'}
            </button>
          </div>
        </form>
      )}
      <div className="maintenance-list">
        {items.map((item) => {
          const result = calculateMaintenance(item, vehicle.mileage, today)
          const tone =
            result.status === 'Due / overdue'
              ? 'due'
              : result.status === 'Due soon'
                ? 'soon'
                : result.status === 'Up to date'
                  ? 'current'
                  : 'unknown'
          const interval = [
            item.interval_km !== null
              ? `${item.interval_km.toLocaleString()} km`
              : '',
            item.interval_months !== null
              ? `${item.interval_months} months`
              : '',
          ]
            .filter(Boolean)
            .join(' / ')
          const last =
            item.history_status === 'known'
              ? [
                  item.last_completed_date
                    ? dateLabel(item.last_completed_date)
                    : '',
                  item.last_completed_mileage !== null
                    ? `${item.last_completed_mileage.toLocaleString()} km`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : item.history_status === 'not_applicable'
                ? 'Not applicable'
                : 'Unknown'
          const next =
            [
              result.nextDate ? dateLabel(result.nextDate) : '',
              result.nextMileage !== null
                ? `${result.nextMileage.toLocaleString()} km`
                : '',
            ]
              .filter(Boolean)
              .join(' · ') || 'Unknown'
          return (
            <article className="panel maintenance-card" key={item.id}>
              <div className="section-heading">
                <h3>{item.name}</h3>
                <span className={`maintenance-status ${tone}`}>
                  {result.status}
                </span>
              </div>
              <dl>
                {[
                  ['Interval', interval],
                  ['Last completed', last],
                  ['Next expected', next],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {result.partialHistory && (
                <p className="muted">
                  One interval has no known completion baseline; that limit is
                  unknown.
                </p>
              )}
              <div className="maintenance-actions">
                <button
                  className="button secondary"
                  disabled={busy || drafts !== null}
                  onClick={() =>
                    review(
                      [{ ...item }],
                      'Review intervals and the most recent known completion.',
                      item.id,
                    )
                  }
                  aria-label={`Edit ${item.name}`}
                >
                  Edit
                </button>
                <button
                  className="button secondary"
                  disabled={busy || drafts !== null}
                  onClick={() =>
                    void save([{ ...item, enabled: !item.enabled }], item.id)
                  }
                >
                  {item.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  className="button secondary danger-text"
                  disabled={busy || drafts !== null}
                  onClick={() => setDeleting(item.id)}
                  aria-label={`Remove ${item.name}`}
                >
                  Remove
                </button>
              </div>
              {deleting === item.id && (
                <div className="notice">
                  <div>
                    <p>Remove {item.name} from this schedule?</p>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setDeleting(null)}
                    >
                      Cancel
                    </button>{' '}
                    <button
                      className="button danger"
                      disabled={busy}
                      onClick={() => void remove(item.id)}
                    >
                      Confirm removal
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
