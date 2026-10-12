import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Pencil, CarFront, Bike, Trash2 } from 'lucide-react'
import { getVehicle, deleteVehicle } from '../services/vehicles'
import { ErrorState, Loading } from '../components/States'
import type { Vehicle } from '../types/vehicle'
import { MaintenancePanel } from '../components/MaintenancePanel'
export function VehicleDetails() {
  const { id } = useParams()
  return <VehicleDetailsView key={id} />
}
function VehicleDetailsView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const maintenanceTab = searchParams.get('tab') === 'maintenance'
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    getVehicle(id!)
      .then((v) => {
        if (alive) setVehicle(v)
      })
      .catch(() => {
        if (alive)
          setError('This vehicle is unavailable or you do not have access.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id])
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
  if (loading) return <Loading />
  return (
    <>
      <Link className="back-link" to="/">
        <ArrowLeft size={17} />
        Back to garage
      </Link>
      {error && <ErrorState message={error} />}
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
              className={!maintenanceTab ? 'active' : ''}
              aria-pressed={!maintenanceTab}
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
          </div>
          {maintenanceTab ? (
            <MaintenancePanel key={vehicle.id} vehicle={vehicle} />
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
                  <dl>
                    {[
                      [
                        'Current mileage',
                        `${vehicle.mileage.toLocaleString()} km`,
                      ],
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
              <section className="panel danger-zone">
                <h2>Remove vehicle</h2>
                <p className="muted">
                  Permanently remove this vehicle from your garage.
                </p>
                {confirm ? (
                  <div role="group" aria-label="Confirm vehicle deletion">
                    <p>
                      Delete {vehicle.make} {vehicle.model}? This cannot be
                      undone.
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
