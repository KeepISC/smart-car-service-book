import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import {
  acceptRepairShopConnectionInvitation,
  declineRepairShopConnectionInvitation,
  previewRepairShopConnectionInvitation,
} from '../services/repairShops'
import { useVehicles } from '../hooks/useVehicles'
import type { ShopConnectionPreview } from '../types/repairShop'

type View =
  | 'loading'
  | 'ready'
  | 'invalid'
  | 'unavailable'
  | 'expired'
  | 'declined'
  | 'error'

const fragmentPrefix = '#shop-connection='

function errorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

// The bearer token is read from the URL fragment into memory only. It is never
// written to storage or logs, and the fragment is removed from the address bar.
function readToken() {
  const hash = window.location.hash
  const token = hash.startsWith(fragmentPrefix)
    ? hash.slice(fragmentPrefix.length)
    : ''
  return /^[0-9a-f]{64}$/.test(token) ? token : ''
}

export function ShopConnection() {
  const location = useLocation()
  // A newly opened link replaces any state from the previous one.
  return <ShopConnectionView key={location.key} />
}

function ShopConnectionView() {
  const navigate = useNavigate()
  const [token] = useState(readToken)
  const [view, setView] = useState<View>(token ? 'loading' : 'invalid')
  const [preview, setPreview] = useState<ShopConnectionPreview | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [vehicleId, setVehicleId] = useState('')
  const [canCreate, setCanCreate] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [message, setMessage] = useState('')
  const {
    vehicles,
    loading: vehiclesLoading,
    error: vehiclesError,
  } = useVehicles()
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    if (window.location.hash)
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      )
  }, [])

  useEffect(() => {
    if (!token) return
    let alive = true
    previewRepairShopConnectionInvitation(token)
      .then((data) => {
        if (!alive) return
        setPreview(data)
        setView(Date.parse(data.expires_at) <= Date.now() ? 'expired' : 'ready')
      })
      .catch((error) => {
        if (alive)
          setView(errorCode(error) === '42501' ? 'unavailable' : 'error')
      })
    return () => {
      alive = false
    }
  }, [token, attempt])

  // The database enforces expiry; this keeps the visible state accurate.
  useEffect(() => {
    if (view !== 'ready' || !preview) return
    const wait = Date.parse(preview.expires_at) - Date.now()
    const timer = window.setTimeout(
      () => setView('expired'),
      Math.max(0, Math.min(wait, 2 ** 31 - 1)),
    )
    return () => window.clearTimeout(timer)
  }, [view, preview])

  async function accept() {
    if (!vehicleId) return
    setBusy('accept')
    setMessage('')
    try {
      await acceptRepairShopConnectionInvitation(token, vehicleId, canCreate)
      if (!active.current) return
      navigate(`/vehicles/${vehicleId}`, { replace: true })
    } catch (error) {
      if (!active.current) return
      const code = errorCode(error)
      if (code === '42501') setView('unavailable')
      else
        setMessage(
          code === '40001'
            ? 'Another change happened at the same time. Please try again.'
            : 'Unable to approve access. Please try again.',
        )
      setBusy(null)
    }
  }

  async function decline() {
    setBusy('decline')
    setMessage('')
    try {
      await declineRepairShopConnectionInvitation(token)
      if (!active.current) return
      setView('declined')
    } catch (error) {
      if (!active.current) return
      if (errorCode(error) === '42501') setView('unavailable')
      else setMessage('Unable to decline the invitation. Please try again.')
    } finally {
      if (active.current) setBusy(null)
    }
  }

  return (
    <main className="panel" aria-labelledby="shop-connection-heading">
      <h1 id="shop-connection-heading">Connect a repair shop</h1>
      {view === 'loading' && (
        <p role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
          Checking the invitation…
        </p>
      )}
      {view === 'invalid' && (
        <p className="service-feedback error" role="alert">
          This invitation link is not valid. Ask the shop for a new link.
        </p>
      )}
      {view === 'unavailable' && (
        <p className="service-feedback error" role="alert">
          This invitation is no longer available. It may have been cancelled,
          already used or declined, or it may have expired. Ask the shop for a
          new link if needed.
        </p>
      )}
      {view === 'expired' && (
        <p className="service-feedback error" role="alert">
          This invitation has expired. Ask the shop for a new link.
        </p>
      )}
      {view === 'declined' && (
        <p className="service-feedback" role="status">
          You declined the invitation. The shop has no access to your vehicles.
        </p>
      )}
      {view === 'error' && (
        <p className="service-feedback error" role="alert">
          Unable to check the invitation.{' '}
          <button
            type="button"
            className="button secondary button-small"
            onClick={() => {
              setView('loading')
              setAttempt((value) => value + 1)
            }}
          >
            Try again
          </button>
        </p>
      )}
      {view === 'ready' && preview && (
        <>
          <h2>{preview.shop.name}</h2>
          <p className="muted">
            Invitation expires {new Date(preview.expires_at).toLocaleString()}.
          </p>
          <p className="service-feedback" role="note">
            Approving lets this shop view the selected vehicle&apos;s details
            and maintenance schedule. Nothing is shared unless you approve, and
            you can revoke access later from the vehicle page.
          </p>
          {vehiclesLoading ? (
            <p role="status">Loading your vehicles…</p>
          ) : vehiclesError ? (
            <p className="service-feedback error" role="alert">
              {vehiclesError}
            </p>
          ) : vehicles.length === 0 ? (
            <p className="muted">
              You have no vehicles to connect.{' '}
              <Link to="/vehicles/new">Add a vehicle</Link>
            </p>
          ) : (
            <fieldset className="shop-vehicles">
              <legend>Choose the vehicle to connect</legend>
              {vehicles.map((vehicle) => (
                <label key={vehicle.id} className="transfer-private">
                  <input
                    type="radio"
                    name="shop-vehicle"
                    value={vehicle.id}
                    checked={vehicleId === vehicle.id}
                    onChange={() => setVehicleId(vehicle.id)}
                  />
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </label>
              ))}
            </fieldset>
          )}
          <label className="transfer-private">
            <input
              type="checkbox"
              checked={canCreate}
              onChange={(event) => setCanCreate(event.target.checked)}
            />
            Also allow this shop to add maintenance records
          </label>
          <p className="muted">
            Access: {canCreate ? 'view vehicle and add records' : 'view only'}
          </p>
          {message && (
            <p className="service-feedback error" role="alert">
              {message}
            </p>
          )}
          <div className="mileage-edit-actions">
            <button
              type="button"
              className="button"
              onClick={accept}
              disabled={busy !== null || !vehicleId}
            >
              {busy === 'accept' ? 'Approving…' : 'Approve access'}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={decline}
              disabled={busy !== null}
            >
              {busy === 'decline' ? 'Declining…' : 'Decline'}
            </button>
          </div>
        </>
      )}
      {view !== 'loading' && view !== 'ready' && (
        <Link className="button secondary" to="/">
          Go to Garage
        </Link>
      )}
    </main>
  )
}
