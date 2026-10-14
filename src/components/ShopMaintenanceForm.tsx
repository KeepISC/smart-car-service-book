import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createRepairShopServiceVisit } from '../services/repairShops'
import { dateOnly } from '../services/maintenanceLogic'
import { validateServiceVisit } from '../services/serviceHistoryLogic'
import type { ShopServiceVisitInput, ShopVehicle } from '../types/repairShop'

export function ShopMaintenanceForm({
  shopId,
  data,
  onSaved,
  onCancel,
  onAccessLost,
}: {
  shopId: string
  data: ShopVehicle
  onSaved: () => void
  onCancel: () => void
  onAccessLost: () => void
}) {
  const [serviceDate, setServiceDate] = useState(dateOnly)
  const [mileage, setMileage] = useState(String(data.vehicle.mileage))
  const [notes, setNotes] = useState('')
  const [totalCost, setTotalCost] = useState('')
  const [operations, setOperations] = useState([
    { id: 0, name: '', schedule: '', cost: '' },
  ])
  const nextId = useRef(1)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const pending = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  function update(
    id: number,
    field: 'name' | 'schedule' | 'cost',
    value: string,
  ) {
    setOperations((current) =>
      current.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const cost = (value: string) => (value.trim() ? Number(value) : null)
    const input: ShopServiceVisitInput = {
      service_date: serviceDate,
      mileage: mileage.trim() ? Number(mileage) : NaN,
      notes: notes.trim() || null,
      total_cost: cost(totalCost),
      operations: operations.map((row) => ({
        maintenance_item_id: row.schedule || null,
        operation_name: row.name.trim(),
        cost: cost(row.cost),
      })),
    }
    // Reuse personal history's field rules, while sending only the shop API's
    // append-only payload. Workshop identity and authorization are server-derived.
    const validation = validateServiceVisit(
      {
        ...input,
        service_type: 'workshop',
        workshop_name: null,
        operations: input.operations.map((row) => ({
          ...row,
          next_interval_km: null,
          next_interval_months: null,
        })),
      },
      data.vehicle.mileage,
      dateOnly(),
    )
    const linked = operations.map((row) => row.schedule).filter(Boolean)
    if (new Set(linked).size !== linked.length)
      validation.push('Select each maintenance schedule only once.')
    if (
      linked.some(
        (id) => !data.maintenance_schedules.some((row) => row.id === id),
      )
    )
      validation.push(
        'Select a maintenance schedule belonging to this vehicle.',
      )
    setErrors(validation)
    if (validation.length) return
    pending.current = true
    setSaving(true)
    try {
      await createRepairShopServiceVisit(shopId, data.vehicle.id, input)
      if (active.current) onSaved()
    } catch (error) {
      if (!active.current) return
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String(error.code)
          : ''
      if (code === '42501') {
        onAccessLost()
      } else {
        setErrors([
          code === '40001'
            ? 'The record was not saved because vehicle or shop access changed. Refresh the vehicle before trying again.'
            : code === '23514' || code === '22023'
              ? 'The record was not saved. Check the date, mileage, operations and costs. The shop may also have reached its record limit.'
              : 'Unable to confirm the save. Refresh the vehicle history before trying again to avoid a duplicate record.',
        ])
      }
    } finally {
      pending.current = false
      if (active.current) setSaving(false)
    }
  }

  return (
    <form
      className="service-form shop-maintenance-form"
      onSubmit={submit}
      noValidate
      aria-labelledby="record-maintenance-heading"
      aria-busy={saving}
    >
      <h3 id="record-maintenance-heading">Record Maintenance</h3>
      <p className="muted">
        Records cannot be edited or deleted by the shop. The vehicle owner must
        update the odometer first if needed.
      </p>
      {errors.length > 0 && (
        <div className="service-feedback error" role="alert">
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      <fieldset disabled={saving}>
        <legend>Service details</legend>
        <div className="form-grid">
          <label>
            Service date
            <input
              type="date"
              required
              min="0001-01-01"
              max={dateOnly()}
              value={serviceDate}
              onChange={(event) => setServiceDate(event.target.value)}
            />
          </label>
          <label>
            Mileage (km)
            <input
              type="number"
              required
              min="0"
              max={data.vehicle.mileage}
              step="1"
              value={mileage}
              onChange={(event) => setMileage(event.target.value)}
            />
          </label>
          <label>
            Total cost (optional)
            <input
              type="number"
              min="0"
              max="999999999.99"
              step="0.01"
              value={totalCost}
              onChange={(event) => setTotalCost(event.target.value)}
            />
          </label>
          <label>
            Workshop notes (optional)
            <textarea
              maxLength={4000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <fieldset disabled={saving}>
        <legend>Operations performed</legend>
        {operations.map((row, index) => (
          <fieldset key={row.id}>
            <legend>Operation {index + 1}</legend>
            <div className="form-grid">
              <label>
                Operation {index + 1} name
                <input
                  required
                  maxLength={120}
                  value={row.name}
                  onChange={(event) =>
                    update(row.id, 'name', event.target.value)
                  }
                />
              </label>
              <label>
                Operation {index + 1} schedule
                <select
                  value={row.schedule}
                  onChange={(event) =>
                    update(row.id, 'schedule', event.target.value)
                  }
                >
                  <option value="">Unlinked operation</option>
                  {data.maintenance_schedules.map((schedule, position) => (
                    <option key={schedule.id} value={schedule.id}>
                      Schedule {position + 1} (
                      {[
                        schedule.interval_km === null
                          ? null
                          : `${schedule.interval_km} km`,
                        schedule.interval_months === null
                          ? null
                          : `${schedule.interval_months} months`,
                      ]
                        .filter(Boolean)
                        .join(' / ') || 'no interval'}
                      )
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Operation {index + 1} cost (optional)
                <input
                  type="number"
                  min="0"
                  max="999999999.99"
                  step="0.01"
                  value={row.cost}
                  onChange={(event) =>
                    update(row.id, 'cost', event.target.value)
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="button secondary button-small"
              disabled={operations.length === 1}
              onClick={() =>
                setOperations((current) =>
                  current.filter((item) => item.id !== row.id),
                )
              }
            >
              Remove operation {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="button secondary button-small"
          disabled={operations.length >= 50}
          onClick={() => {
            const id = nextId.current++
            setOperations((current) => [
              ...current,
              { id, name: '', schedule: '', cost: '' },
            ])
          }}
        >
          Add operation
        </button>
      </fieldset>
      <div className="shop-actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Saving maintenance…' : 'Save maintenance'}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel recording
        </button>
      </div>
    </form>
  )
}
