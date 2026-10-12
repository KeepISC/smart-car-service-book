import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CarFront, Bike, Check } from 'lucide-react'
import { getVehicle, saveVehicle } from '../services/vehicles'
import { validateVehicle } from '../services/validation'
import { authService } from '../services/auth'
import { ErrorState, Loading } from '../components/States'
import type { VehicleInput } from '../types/vehicle'
import { MileageConsistencyError } from '../services/dataErrors'
const initial: VehicleInput = {
  type: 'car',
  make: '',
  model: '',
  year: new Date().getFullYear(),
  engine: '',
  mileage: 0,
  license_plate: null,
  vin: null,
}
export function VehicleForm() {
  const { id } = useParams()
  // A route change discards all draft/loading/error state before the new fetch begins.
  return <VehicleFormView key={id ?? 'new'} />
}
function VehicleFormView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [value, setValue] = useState(initial)
  const [loading, setLoading] = useState(Boolean(id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const active = useRef(true)
  useEffect(() => {
    let alive = true
    active.current = true
    if (id)
      getVehicle(id)
        .then((v) => {
          if (alive) setValue(v)
        })
        .catch(() => {
          if (alive) {
            setLoadFailed(true)
            setError('This vehicle is unavailable or you do not have access.')
          }
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    return () => {
      alive = false
      active.current = false
    }
  }, [id])
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || busy || loadFailed) return
    const normalized = {
      ...value,
      make: value.make.trim(),
      model: value.model.trim(),
      engine: value.engine.trim(),
      license_plate: value.license_plate?.trim().toUpperCase() || null,
      vin: value.vin?.trim().toUpperCase() || null,
    }
    const validation = validateVehicle(normalized)
    setErrors(validation)
    if (Object.keys(validation).length) return
    setBusy(true)
    setError('')
    try {
      const saved = await saveVehicle(normalized, id)
      if (active.current)
        navigate(`/vehicles/${saved.id}${id ? '' : '?tab=maintenance'}`)
    } catch (failure) {
      if (!active.current) return
      if (failure instanceof MileageConsistencyError) {
        setErrors({ mileage: failure.message })
        return
      }
      setError(
        'Unable to save your vehicle. Check your connection and try again.',
      )
    } finally {
      if (active.current) setBusy(false)
    }
  }
  if (loading) return <Loading />
  return (
    <>
      <Link to={id ? `/vehicles/${id}` : '/'} className="back-link">
        <ArrowLeft size={17} />
        Back to {id ? 'vehicle' : 'garage'}
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">GARAGE ESSENTIALS</p>
          <h1>
            {id ? 'Edit vehicle' : 'Add a vehicle'}
            <span className="blue-dot">.</span>
          </h1>
          <p>Start with the details that make it yours.</p>
        </div>
      </div>
      {error && <ErrorState message={error} />}
      {!authService.available && (
        <div className="notice">
          Connect Supabase to save vehicles. You can explore the form below.
        </div>
      )}
      <form className="panel vehicle-form" onSubmit={submit}>
        <h2>Vehicle details</h2>
        <p className="muted">
          Fields are required unless marked optional. Mileage is in kilometers.
        </p>
        <fieldset>
          <legend>Vehicle type</legend>
          <div className="type-options">
            {(['car', 'motorcycle'] as const).map((type) => (
              <label
                className={`type-option ${value.type === type ? 'selected' : ''}`}
                key={type}
              >
                <input
                  type="radio"
                  name="type"
                  value={type}
                  checked={value.type === type}
                  onChange={() => setValue({ ...value, type })}
                />
                {type === 'car' ? <CarFront /> : <Bike />}
                {type === 'car' ? 'Car' : 'Motorcycle'}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-grid">
          {(
            [
              { key: 'make', label: 'Make', placeholder: 'e.g. Toyota' },
              { key: 'model', label: 'Model', placeholder: 'e.g. Corolla' },
              { key: 'year', label: 'Year', number: true },
              {
                key: 'engine',
                label: 'Engine / version',
                placeholder: 'e.g. 1.8 Hybrid',
              },
              { key: 'mileage', label: 'Current mileage (km)', number: true },
              {
                key: 'license_plate',
                label: 'License plate (optional)',
                placeholder: 'e.g. DEMO-01',
              },
              {
                key: 'vin',
                label: 'VIN (optional)',
                placeholder: '17-character vehicle identification number',
              },
            ] as const
          ).map((field) => (
            <label key={field.key}>
              <span id={`${field.key}-label`}>{field.label}</span>
              <input
                aria-labelledby={`${field.key}-label`}
                type={'number' in field ? 'number' : 'text'}
                value={value[field.key] ?? ''}
                placeholder={
                  'placeholder' in field ? field.placeholder : undefined
                }
                required={field.key !== 'license_plate' && field.key !== 'vin'}
                min={field.key === 'year' ? 1886 : 0}
                max={
                  field.key === 'year'
                    ? new Date().getFullYear() + 1
                    : field.key === 'mileage'
                      ? 10000000
                      : undefined
                }
                maxLength={
                  field.key === 'vin'
                    ? 17
                    : field.key === 'license_plate'
                      ? 20
                      : 100
                }
                step={1}
                aria-invalid={Boolean(errors[field.key])}
                aria-describedby={
                  errors[field.key] ? `${field.key}-error` : undefined
                }
                onChange={(e) =>
                  setValue({
                    ...value,
                    [field.key]:
                      'number' in field
                        ? Number(e.target.value)
                        : e.target.value,
                  })
                }
              />
              {errors[field.key] && (
                <small className="field-error" id={`${field.key}-error`}>
                  {errors[field.key]}
                </small>
              )}
            </label>
          ))}
        </div>
        <div className="form-actions">
          <Link className="button secondary" to={id ? `/vehicles/${id}` : '/'}>
            Cancel
          </Link>
          <button
            className="button"
            disabled={busy || !authService.available || loadFailed}
          >
            <Check size={18} />
            {busy ? 'Saving…' : 'Save vehicle'}
          </button>
        </div>
      </form>
    </>
  )
}
