import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CarFront, Bike, Check } from 'lucide-react'
import { getVehicle, saveVehicle } from '../services/vehicles'
import { validateVehicle } from '../services/validation'
import { authService } from '../services/auth'
import { ErrorState, Loading } from '../components/States'
import type { VehicleInput } from '../types/vehicle'
import { MileageConsistencyError } from '../services/dataErrors'
import { useMaintenanceRefresh } from '../hooks/useMaintenanceRefresh'
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
  const needsDraft = useRef(true)
  const generation = useRef(0)
  const { revision, reload } = useMaintenanceRefresh(Boolean(id))
  useEffect(() => {
    let alive = true
    const request = ++generation.current
    active.current = true
    if (id)
      getVehicle(id)
        .then((v) => {
          if (alive && request === generation.current) {
            // Revalidate ownership without overwriting an open edit draft.
            if (needsDraft.current) setValue(v)
            needsDraft.current = false
            setLoadFailed(false)
            setError('')
          }
        })
        .catch(() => {
          if (alive && request === generation.current) {
            setLoadFailed(true)
            setError('This vehicle is unavailable or you do not have access.')
          }
        })
        .finally(() => {
          if (alive && request === generation.current) setLoading(false)
        })
    return () => {
      alive = false
      active.current = false
    }
  }, [id, revision])
  useEffect(() => {
    const conceal = () => {
      if (!id) return
      generation.current++
      needsDraft.current = true
      setValue(initial)
      setLoadFailed(true)
      setError('Checking vehicle access…')
    }
    window.addEventListener('app:ownership-change', conceal)
    return () => window.removeEventListener('app:ownership-change', conceal)
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
    const request = generation.current
    setError('')
    try {
      const saved = await saveVehicle(normalized, id)
      if (active.current && request === generation.current)
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
  if (loadFailed)
    return (
      <>
        <Link className="back-link" to="/">
          Back to garage
        </Link>
        <ErrorState message={error} retry={reload} />
      </>
    )
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
      {error && (
        <ErrorState message={error} retry={loadFailed ? reload : undefined} />
      )}
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
