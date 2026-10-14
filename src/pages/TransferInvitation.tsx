import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import {
  acceptVehicleTransfer,
  declineVehicleTransfer,
  previewVehicleTransfer,
} from '../services/vehicleTransfers'
import type { VehicleTransferPreview } from '../types/vehicleTransfer'
import {
  readRecipientTransferToken,
  clearRecipientTransferToken,
} from '../services/transferSession'

type View =
  | 'loading'
  | 'ready'
  | 'invalid'
  | 'unavailable'
  | 'expired'
  | 'declined'
  | 'error'

function errorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

// Session storage survives a same-tab reload; the fragment is removed from
// history. Completion clears the secret and no persistent storage is used.
export function TransferInvitation() {
  const location = useLocation()
  // A new link must replace the token and discard pending work from the old flow.
  return <TransferInvitationView key={location.key} />
}

function TransferInvitationView() {
  const navigate = useNavigate()
  const [token] = useState(readRecipientTransferToken)
  const [view, setView] = useState<View>(token ? 'loading' : 'invalid')
  const [preview, setPreview] = useState<VehicleTransferPreview | null>(null)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
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
    previewVehicleTransfer(token)
      .then((data) => {
        if (!alive) return
        setPreview(data)
        if (Date.parse(data.expires_at) <= Date.now())
          clearRecipientTransferToken(token)
        setView(Date.parse(data.expires_at) <= Date.now() ? 'expired' : 'ready')
      })
      .catch((error) => {
        if (alive) {
          if (errorCode(error) === '42501') clearRecipientTransferToken(token)
          setView(errorCode(error) === '42501' ? 'unavailable' : 'error')
        }
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
      () => {
        clearRecipientTransferToken(token)
        setView('expired')
      },
      Math.max(0, Math.min(wait, 2 ** 31 - 1)),
    )
    return () => window.clearTimeout(timer)
  }, [view, preview, token])

  async function accept() {
    setBusy('accept')
    setMessage('')
    try {
      const vehicleId = await acceptVehicleTransfer(token)
      clearRecipientTransferToken(token)
      if (!active.current) return
      // The service refreshes vehicle lists; the new owner opens the vehicle.
      navigate(`/vehicles/${vehicleId}`, { replace: true })
    } catch (error) {
      if (!active.current) return
      const code = errorCode(error)
      if (code === '42501') {
        clearRecipientTransferToken(token)
        setView('unavailable')
      } else
        setMessage(
          code === '40001'
            ? 'Another change happened at the same time. Please try again.'
            : 'Unable to accept the vehicle. Please try again.',
        )
      setBusy(null)
    }
  }
  async function decline() {
    setBusy('decline')
    setMessage('')
    try {
      await declineVehicleTransfer(token)
      clearRecipientTransferToken(token)
      if (!active.current) return
      setView('declined')
    } catch (error) {
      if (!active.current) return
      if (errorCode(error) === '42501') {
        clearRecipientTransferToken(token)
        setView('unavailable')
      } else setMessage('Unable to decline the invitation. Please try again.')
    } finally {
      if (active.current) setBusy(null)
    }
  }

  const vehicle = preview?.vehicle
  return (
    <main className="panel transfer-recipient" aria-labelledby="invite-heading">
      <h1 id="invite-heading">Vehicle transfer invitation</h1>
      {view === 'loading' && (
        <p role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
          Checking invitation…
        </p>
      )}
      {view === 'invalid' && (
        <p className="service-feedback error" role="alert">
          This invitation link is invalid or incomplete. Ask the sender for a
          new link.
        </p>
      )}
      {view === 'unavailable' && (
        <p className="service-feedback error" role="alert">
          This invitation is no longer available. It may have expired, been
          revoked, already been used, or was created by your own account. Ask
          the sender for a new link if needed.
        </p>
      )}
      {view === 'expired' && (
        <p className="service-feedback error" role="alert">
          This invitation has expired. Ask the sender for a new link.
        </p>
      )}
      {view === 'declined' && (
        <p className="service-feedback" role="status">
          You declined the invitation. Ownership was not changed.
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
      {view === 'ready' && vehicle && preview && (
        <>
          <h2>
            {vehicle.year} {vehicle.make} {vehicle.model}
          </h2>
          <p>
            {vehicle.type === 'car' ? 'Car' : 'Motorcycle'} · {vehicle.engine} ·{' '}
            {vehicle.mileage.toLocaleString()} km
          </p>
          <p className="muted">
            Invitation expires {new Date(preview.expires_at).toLocaleString()}.
          </p>
          <h3>Maintenance schedules</h3>
          {preview.maintenance_schedules?.length ? (
            <ul>
              {preview.maintenance_schedules.map((schedule) => (
                <li key={schedule.id}>
                  Maintenance schedule:{' '}
                  {schedule.interval_km !== null
                    ? `${schedule.interval_km.toLocaleString()} km`
                    : ''}
                  {schedule.interval_km !== null &&
                  schedule.interval_months !== null
                    ? ' / '
                    : ''}
                  {schedule.interval_months !== null
                    ? `${schedule.interval_months} months`
                    : ''}
                  {!schedule.enabled ? ' (disabled)' : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No maintenance schedules.</p>
          )}
          <h3>Transferable maintenance records</h3>
          <p className="muted">
            This preview shows completion facts only. Names, notes, workshop
            details and costs are omitted.
          </p>
          {preview.maintenance_records?.length ? (
            <ul>
              {preview.maintenance_records.map((record) => (
                <li key={record.id}>
                  {record.service_date} · {record.mileage.toLocaleString()} km ·{' '}
                  {record.operations.length} operations
                  {record.private_on_transfer
                    ? ' · Private details excluded'
                    : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No maintenance records.</p>
          )}
          <p className="service-feedback" role="note">
            Accepting makes you the owner and the previous owner immediately
            loses access. You receive the maintenance schedule, mileage history
            and shared service history. Records the previous owner marked
            private arrive without their details. Nothing changes unless you
            accept.
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
              disabled={busy !== null}
            >
              {busy === 'accept' ? 'Accepting…' : 'Accept vehicle'}
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
