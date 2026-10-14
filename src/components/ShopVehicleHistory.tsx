import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { getRepairShopVehicle } from '../services/repairShops'
import type { ShopVehicle } from '../types/repairShop'
import { summarizeShopVehicle } from './shopVehicleSummary'
import { isServiceHistoryEnabled } from '../config/features'
import { ShopMaintenanceForm } from './ShopMaintenanceForm'
import { ShopReminderAction } from './ShopReminderAction'

type State = 'loading' | 'ready' | 'denied' | 'error'

// Default to sanitized facts; display details only from explicit owner sharing.
// Owner identity and plate/VIN stay excluded. Recheck authorization on every open.
export function ShopVehicleHistory({
  shopId,
  vehicleId,
  reference,
  revision,
  canCreateRecords,
  onClose,
  onDenied,
}: {
  shopId: string
  vehicleId: string
  reference: string
  revision: number
  canCreateRecords: boolean
  onClose: () => void
  onDenied: () => void
}) {
  const [state, setState] = useState<State>('loading')
  const [data, setData] = useState<ShopVehicle | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [recording, setRecording] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let alive = true
    getRepairShopVehicle(shopId, vehicleId)
      .then((result) => {
        if (!alive) return
        setData(result)
        setState('ready')
      })
      .catch((error) => {
        if (!alive) return
        const denied =
          typeof error === 'object' &&
          error &&
          'code' in error &&
          String((error as { code: unknown }).code) === '42501'
        // Drop customer data immediately when access has been withdrawn.
        if (denied) {
          setData(null)
          onDenied()
        }
        setState(denied ? 'denied' : 'error')
      })
    return () => {
      alive = false
    }
  }, [shopId, vehicleId, attempt, onDenied, revision])
  const summary = useMemo(
    () => (data ? summarizeShopVehicle(data) : null),
    [data],
  )

  return (
    <section className="platform-shop" aria-labelledby="history-heading">
      <div className="section-heading">
        <h2 id="history-heading">
          Vehicle {data?.customer_reference || reference}
        </h2>
        <button
          type="button"
          className="button secondary button-small"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      {saved && (
        <p className="service-feedback" role="status">
          Maintenance recorded successfully.
        </p>
      )}
      {state === 'loading' && (
        <p role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
          Loading vehicle history…
        </p>
      )}
      {state === 'denied' && (
        <p className="service-feedback error" role="alert">
          This vehicle is no longer available to the shop. Access may have been
          revoked, ownership may have changed, or the shop is unavailable.
        </p>
      )}
      {state === 'error' && (
        <p className="service-feedback error" role="alert">
          Unable to load this vehicle.{' '}
          <button
            type="button"
            className="button secondary button-small"
            onClick={() => {
              setState('loading')
              setAttempt((value) => value + 1)
            }}
          >
            Try again
          </button>
        </p>
      )}
      {state === 'ready' && data && summary && (
        <>
          <p>
            {data.vehicle.year} {data.vehicle.make} {data.vehicle.model} ·{' '}
            {data.vehicle.engine} · {data.vehicle.mileage.toLocaleString()} km
          </p>
          {canCreateRecords && isServiceHistoryEnabled() ? (
            recording ? (
              <ShopMaintenanceForm
                shopId={shopId}
                data={data}
                onCancel={() => setRecording(false)}
                onSaved={() => {
                  setRecording(false)
                  setSaved(true)
                  setAttempt((value) => value + 1)
                }}
                onAccessLost={() => {
                  setData(null)
                  setRecording(false)
                  setState('denied')
                  onDenied()
                }}
              />
            ) : (
              <button
                type="button"
                className="button"
                onClick={() => {
                  setSaved(false)
                  setRecording(true)
                }}
              >
                Record Maintenance
              </button>
            )
          ) : (
            <p className="muted">
              {canCreateRecords
                ? 'Maintenance recording is not enabled.'
                : 'View only. Recording maintenance requires customer permission.'}
            </p>
          )}
          <h3>Maintenance status</h3>
          {summary.schedules.length === 0 ? (
            <p className="muted">No maintenance schedules.</p>
          ) : (
            <ul className="shop-list">
              {summary.schedules.map((schedule, index) => {
                const source = data.maintenance_schedules[index]
                return (
                  <li key={schedule.id} className="shop-row">
                    <div>
                      <strong>{schedule.label}</strong>{' '}
                      <span className="shop-status">{schedule.status}</span>
                      <p className="muted">
                        Every{' '}
                        {[
                          source.interval_km !== null
                            ? `${source.interval_km.toLocaleString()} km`
                            : null,
                          source.interval_months !== null
                            ? `${source.interval_months} months`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' / ') || 'no interval'}
                        {schedule.nextDate
                          ? ` · next ${schedule.nextDate}`
                          : ''}
                        {schedule.nextMileage !== null
                          ? ` · next ${schedule.nextMileage.toLocaleString()} km`
                          : ''}
                      </p>
                    </div>
                    {(schedule.status === 'Due / overdue' ||
                      schedule.status === 'Due soon') && (
                      <ShopReminderAction
                        shopId={shopId}
                        vehicleId={vehicleId}
                        itemId={schedule.id}
                        label={schedule.label}
                        onDenied={() => {
                          setData(null)
                          setRecording(false)
                          setState('denied')
                          onDenied()
                        }}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <h3>Service history</h3>
          <p className="muted">
            Shows completion facts only. Customer notes, workshop names and
            costs are never shared unless authorized by the vehicle owner.
          </p>
          {data.maintenance_records.length === 0 ? (
            <p className="muted">No service history.</p>
          ) : (
            <ul className="shop-list">
              {data.maintenance_records.map((record) => (
                <li key={record.id} className="shop-row">
                  <div>
                    <strong>{record.service_date}</strong>
                    <p className="muted">
                      {record.mileage.toLocaleString()} km ·{' '}
                      {record.operations.length}{' '}
                      {record.operations.length === 1
                        ? 'operation'
                        : 'operations'}
                      {record.service_type === 'workshop'
                        ? ' · Workshop'
                        : record.service_type === 'diy'
                          ? ' · DIY'
                          : ''}
                      {record.total_cost !== null &&
                      record.total_cost !== undefined
                        ? ` · $${record.total_cost.toFixed(2)}`
                        : ''}
                    </p>
                    {record.workshop_provenance && (
                      <p className="muted">
                        Recorded by {record.workshop_provenance.shop_name} on{' '}
                        {new Date(
                          record.workshop_provenance.recorded_at,
                        ).toLocaleDateString()}
                      </p>
                    )}
                    {!record.workshop_provenance && record.workshop_name && (
                      <p className="muted">Workshop: {record.workshop_name}</p>
                    )}
                    {record.notes && <p>{record.notes}</p>}
                    {record.operations.some(
                      (op) =>
                        Boolean(op.operation_name) ||
                        (op.cost !== null && op.cost !== undefined),
                    ) && (
                      <ul className="shop-operations">
                        {record.operations.map((op, opIndex) => (
                          <li key={opIndex}>
                            {op.operation_name ?? `Operation ${opIndex + 1}`}
                            {op.cost !== null && op.cost !== undefined
                              ? ` · $${op.cost.toFixed(2)}`
                              : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
