import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Pencil, CarFront, Bike, Trash2 } from 'lucide-react'
import {
  getVehicle,
  deleteVehicle,
  updateVehicleMileage,
} from '../services/vehicles'
import { MileageConsistencyError } from '../services/dataErrors'
import { ErrorState, Loading } from '../components/States'
import type { Vehicle } from '../types/vehicle'
import { MaintenancePanel } from '../components/MaintenancePanel'
import { MileageHistoryPanel } from '../components/MileageHistoryPanel'
import { TransferOwnershipPanel } from '../components/TransferOwnershipPanel'
import { isServiceHistoryEnabled } from '../config/features'
import { useMaintenanceRefresh } from '../hooks/useMaintenanceRefresh'
const ServiceHistoryPanel = lazy(async () => ({
  default: (await import('../components/ServiceHistoryPanel'))
    .ServiceHistoryPanel,
}))
export function VehicleDetails() {
  const { id } = useParams()
  return <VehicleDetailsView key={id} />
}
function VehicleDetailsView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const maintenanceTab = searchParams.get('tab') === 'maintenance'
  const historyEnabled = isServiceHistoryEnabled()
  const serviceHistoryTab =
    historyEnabled && searchParams.get('tab') === 'history'
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editingMileage, setEditingMileage] = useState(false)
  const [mileageInput, setMileageInput] = useState('')
  const [mileageError, setMileageError] = useState('')
  const [mileageSuccess, setMileageSuccess] = useState('')
  const [savingMileage, setSavingMileage] = useState(false)
  const [mileageHistoryKey, setMileageHistoryKey] = useState(0)
  const [transferOpen, setTransferOpen] = useState(false)
  const { revision, reload } = useMaintenanceRefresh()
  const generation = useRef(0)
  useEffect(() => {
    let alive = true
    const request = ++generation.current
    getVehicle(id!)
      .then((v) => {
        if (alive && request === generation.current) {
          setVehicle(v)
          setError('')
          setMileageHistoryKey((value) => value + 1)
        }
      })
      .catch(() => {
        if (alive && request === generation.current) {
          setVehicle(null)
          setTransferOpen(false)
          setEditingMileage(false)
          setError('This vehicle is unavailable or you do not have access.')
        }
      })
      .finally(() => {
        if (alive && request === generation.current) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id, revision])
  useEffect(() => {
    const conceal = () => {
      generation.current++
      setVehicle(null)
      setTransferOpen(false)
      setConfirm(false)
      setEditingMileage(false)
      setLoading(true)
    }
    window.addEventListener('app:ownership-change', conceal)
    return () => window.removeEventListener('app:ownership-change', conceal)
  }, [])
  async function remove() {
    setBusy(true)
    try {
      await deleteVehicle(id!)
      navigate('/')
    } catch {
      setError('Unable to delete the vehicle. Please try again.')
      setBusy(false)
    }
  }
  function startEditingMileage() {
    if (!vehicle) return
    setMileageInput(String(vehicle.mileage))
    setMileageError('')
    setMileageSuccess('')
    setEditingMileage(true)
  }
  function cancelEditingMileage() {
    setEditingMileage(false)
    setMileageInput('')
    setMileageError('')
  }
  async function handleMileageSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!vehicle || savingMileage) return
    const trimmed = mileageInput.trim()
    if (!trimmed || !/^\d+$/.test(trimmed)) {
      setMileageError('Enter a whole number between 0 and 10,000,000.')
      return
    }
    const nextMileage = Number(trimmed)
    if (
      !Number.isInteger(nextMileage) ||
      nextMileage < 0 ||
      nextMileage > 10000000
    ) {
      setMileageError('Enter a whole number between 0 and 10,000,000.')
      return
    }
    if (nextMileage < vehicle.mileage) {
      setMileageError(
        `Mileage cannot be decreased below the existing recorded ${vehicle.mileage.toLocaleString()} km.`,
      )
      return
    }
    setSavingMileage(true)
    const request = generation.current
    setMileageError('')
    setMileageSuccess('')
    try {
      const updated = await updateVehicleMileage(vehicle, nextMileage)
      if (request !== generation.current) return
      setVehicle(updated)
      setEditingMileage(false)
      setMileageSuccess('Vehicle mileage updated successfully.')
      setMileageHistoryKey((k) => k + 1)
    } catch (err) {
      if (err instanceof MileageConsistencyError) {
        setMileageError(err.message)
      } else if (err instanceof Error) {
        setMileageError(err.message)
      } else {
        setMileageError('Unable to update vehicle mileage. Please try again.')
      }
    } finally {
      setSavingMileage(false)
    }
  }
  if (loading) return <Loading />
  return (
    <>
      <Link className="back-link" to="/">
        <ArrowLeft size={17} />
        Back to garage
      </Link>
      {error && <ErrorState message={error} retry={reload} />}
      {vehicle && (
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {vehicle.type} · {vehicle.year}
              </p>
              <h1>
                {vehicle.make} {vehicle.model}
              </h1>
              <p>{vehicle.engine}</p>
            </div>
            <Link className="button secondary" to={`/vehicles/${id}/edit`}>
              <Pencil size={17} />
              Edit vehicle
            </Link>
          </div>
          <div className="vehicle-tabs" aria-label="Vehicle sections">
            <button
              className={!maintenanceTab && !serviceHistoryTab ? 'active' : ''}
              aria-pressed={!maintenanceTab && !serviceHistoryTab}
              onClick={() => setSearchParams({})}
            >
              Overview
            </button>
            <button
              className={maintenanceTab ? 'active' : ''}
              aria-pressed={maintenanceTab}
              onClick={() => setSearchParams({ tab: 'maintenance' })}
            >
              Maintenance
            </button>
            {historyEnabled && (
              <button
                className={serviceHistoryTab ? 'active' : ''}
                aria-pressed={serviceHistoryTab}
                onClick={() => setSearchParams({ tab: 'history' })}
              >
                Service history
              </button>
            )}
          </div>
          {maintenanceTab ? (
            <MaintenancePanel
              key={`${vehicle.id}:${revision}`}
              vehicle={vehicle}
            />
          ) : serviceHistoryTab ? (
            <Suspense fallback={<Loading />}>
              <ServiceHistoryPanel
                key={`${vehicle.id}:${revision}`}
                vehicle={vehicle}
              />
            </Suspense>
          ) : (
            <>
              <div className="detail-grid">
                <div className="detail-art">
                  {vehicle.type === 'car' ? (
                    <CarFront size={170} strokeWidth={0.8} />
                  ) : (
                    <Bike size={170} strokeWidth={0.8} />
                  )}
                  <span className="pill">Your {vehicle.type}</span>
                </div>
                <section className="panel">
                  <h2>Vehicle overview</h2>
                  {mileageSuccess && (
                    <p className="service-feedback success" role="status">
                      {mileageSuccess}
                    </p>
                  )}
                  <dl>
                    <div
                      className={`mileage-row${editingMileage ? ' editing' : ''}`}
                    >
                      <dt id="current-mileage-label">Current mileage</dt>
                      <dd className="mileage-dd">
                        {editingMileage ? (
                          <form
                            className="mileage-edit-form"
                            onSubmit={handleMileageSubmit}
                            noValidate
                            aria-labelledby="current-mileage-label"
                          >
                            <div className="mileage-edit-controls">
                              <div className="mileage-input-group">
                                <input
                                  id="vehicle-mileage-input"
                                  type="number"
                                  className="mileage-input"
                                  value={mileageInput}
                                  onChange={(e) => {
                                    setMileageInput(e.target.value)
                                    if (mileageError) setMileageError('')
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                      cancelEditingMileage()
                                    }
                                  }}
                                  min={vehicle.mileage}
                                  max={10000000}
                                  step={1}
                                  required
                                  disabled={savingMileage}
                                  aria-label="Current mileage in km"
                                  aria-invalid={Boolean(mileageError)}
                                  aria-describedby={
                                    mileageError
                                      ? 'mileage-input-error'
                                      : undefined
                                  }
                                  autoFocus
                                />
                                <span
                                  className="mileage-unit"
                                  aria-hidden="true"
                                >
                                  km
                                </span>
                              </div>
                              <div className="mileage-edit-actions">
                                <button
                                  type="button"
                                  className="button secondary button-small"
                                  onClick={cancelEditingMileage}
                                  disabled={savingMileage}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="submit"
                                  className="button button-small"
                                  disabled={savingMileage}
                                >
                                  {savingMileage ? 'Saving…' : 'Save'}
                                </button>
                              </div>
                            </div>
                            {mileageError && (
                              <small
                                className="field-error"
                                id="mileage-input-error"
                                role="alert"
                              >
                                {mileageError}
                              </small>
                            )}
                          </form>
                        ) : (
                          <div className="mileage-display">
                            <span className="mileage-value">
                              {vehicle.mileage.toLocaleString()} km
                            </span>
                            <button
                              type="button"
                              className="button secondary button-small mileage-edit-btn"
                              onClick={startEditingMileage}
                              aria-label="Edit current mileage"
                            >
                              <Pencil size={14} aria-hidden="true" />
                              Edit
                            </button>
                          </div>
                        )}
                      </dd>
                    </div>
                    {[
                      ['Year', vehicle.year],
                      ['Engine / version', vehicle.engine],
                      ['License plate', vehicle.license_plate || 'Not added'],
                      ['VIN', vehicle.vin || 'Not added'],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
              <MileageHistoryPanel
                vehicleId={vehicle.id}
                refreshTrigger={mileageHistoryKey}
              />
              {transferOpen ? (
                <TransferOwnershipPanel
                  vehicle={vehicle}
                  onClose={() => setTransferOpen(false)}
                />
              ) : (
                <section className="panel">
                  <h2>Transfer ownership</h2>
                  <p className="muted">
                    Invite another user to take over this vehicle.
                  </p>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setTransferOpen(true)}
                  >
                    Transfer ownership
                  </button>
                </section>
              )}
              <section className="panel danger-zone">
                <h2>Remove vehicle</h2>
                <p className="muted">
                  Permanently remove this vehicle and its maintenance schedule
                  {historyEnabled ? ', including its service history' : ''} from
                  your garage.
                </p>
                {confirm ? (
                  <div role="group" aria-label="Confirm vehicle deletion">
                    <p>
                      Delete {vehicle.make} {vehicle.model}? This also removes
                      its maintenance schedule
                      {historyEnabled ? ' and service history' : ''}. This
                      cannot be undone.
                    </p>
                    <div className="form-actions">
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => setConfirm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="button danger"
                        disabled={busy}
                        onClick={() => void remove()}
                      >
                        {busy ? 'Deleting…' : 'Yes, delete vehicle'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="button secondary danger-text"
                    onClick={() => setConfirm(true)}
                  >
                    <Trash2 size={17} />
                    Delete vehicle
                  </button>
                )}
              </section>
            </>
          )}
        </>
      )}
    </>
  )
}
