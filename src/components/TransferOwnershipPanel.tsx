import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, LoaderCircle } from 'lucide-react'
import { isServiceHistoryEnabled } from '../config/features'
import {
  loadServiceHistory,
  setServiceVisitTransferPrivacy,
} from '../services/serviceHistory'
import {
  createVehicleTransfer,
  revokeVehicleTransfer,
  getVehicleTransferStatus,
} from '../services/vehicleTransfers'
import type { ServiceVisit } from '../types/serviceHistory'
import type { Vehicle } from '../types/vehicle'
import type { VehicleTransferInvitation } from '../types/vehicleTransfer'
import {
  readSenderTransfer,
  saveSenderTransfer,
} from '../services/transferSession'
import { refreshOwnershipViews } from '../services/ownershipChanges'

type Props = { vehicle: Vehicle; onClose: () => void }
type InviteState =
  'none' | 'pending' | 'expired' | 'revoked' | 'accepted' | 'declined'

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function TransferOwnershipPanel({ vehicle, onClose }: Props) {
  const historyEnabled = isServiceHistoryEnabled()
  const [visits, setVisits] = useState<ServiceVisit[]>([])
  const [historyLoading, setHistoryLoading] = useState(historyEnabled)
  const [historyError, setHistoryError] = useState('')
  const [reload, setReload] = useState(0)
  const [privacyBusy, setPrivacyBusy] = useState<string | null>(null)
  const [privacyError, setPrivacyError] = useState('')
  const [invite, setInvite] = useState<VehicleTransferInvitation | null>(() =>
    readSenderTransfer(vehicle.id),
  )
  const [state, setState] = useState<InviteState>(invite ? 'pending' : 'none')
  const [statusAttempt, setStatusAttempt] = useState(0)
  const [checking, setChecking] = useState(Boolean(invite))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    if (!historyEnabled) return
    let alive = true
    loadServiceHistory(vehicle.id)
      .then((rows) => {
        if (alive) {
          setVisits(rows)
          setHistoryError('')
        }
      })
      .catch(() => {
        if (alive) setHistoryError('Unable to load service history.')
      })
      .finally(() => {
        if (alive) setHistoryLoading(false)
      })
    return () => {
      alive = false
    }
  }, [vehicle.id, historyEnabled, reload])

  // Expiry is enforced by the database; this only updates what the sender sees.
  useEffect(() => {
    if (!invite || state !== 'pending') return
    const wait = Date.parse(invite.expires_at) - Date.now()
    const timer = window.setTimeout(
      () => {
        saveSenderTransfer(vehicle.id, null)
        setInvite(null)
        setState('expired')
      },
      Math.max(0, Math.min(wait, 2 ** 31 - 1)),
    )
    return () => window.clearTimeout(timer)
  }, [invite, state, vehicle.id])

  useEffect(() => {
    if (!invite || state !== 'pending') return
    let alive = true
    let request = 0
    async function check() {
      const current = ++request
      try {
        const status = await getVehicleTransferStatus(vehicle.id, invite!.id)
        if (!alive || current !== request) return
        setError('')
        if (status !== 'pending') {
          saveSenderTransfer(vehicle.id, null)
          setInvite(null)
          setState(status)
          if (status === 'accepted') refreshOwnershipViews()
        }
        setChecking(false)
      } catch (failure) {
        if (alive && current === request) {
          if (
            typeof failure === 'object' &&
            failure &&
            'code' in failure &&
            failure.code === '42501'
          ) {
            saveSenderTransfer(vehicle.id, null)
            setInvite(null)
            setState('none')
            setChecking(false)
            setError('This invitation is no longer available.')
            return
          }
          setError('Unable to check invitation status. Please try again.')
          setChecking(true)
        }
      }
    }
    const resume = () => {
      if (document.visibilityState === 'visible') void check()
    }
    void check()
    const timer = window.setInterval(resume, 5000)
    window.addEventListener('focus', resume)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('focus', resume)
    }
  }, [invite, state, statusAttempt, vehicle.id])

  const setPrivacy = useCallback(
    async (visit: ServiceVisit, value: boolean) => {
      setPrivacyBusy(visit.id)
      setPrivacyError('')
      try {
        await setServiceVisitTransferPrivacy(vehicle.id, visit.id, value)
        setVisits((rows) =>
          rows.map((row) =>
            row.id === visit.id ? { ...row, private_on_transfer: value } : row,
          ),
        )
      } catch {
        setPrivacyError('Unable to update privacy. Please try again.')
      } finally {
        setPrivacyBusy(null)
      }
    },
    [vehicle.id],
  )

  async function create() {
    setBusy(true)
    setError('')
    setCopied('')
    try {
      const created = await createVehicleTransfer(vehicle.id)
      if (!active.current) return
      saveSenderTransfer(vehicle.id, created)
      setInvite(created)
      setState('pending')
    } catch {
      setError('Unable to create the invitation. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  async function revoke() {
    if (!invite) return
    setBusy(true)
    setError('')
    try {
      await revokeVehicleTransfer(vehicle.id, invite.id)
      if (!active.current) return
      saveSenderTransfer(vehicle.id, null)
      setInvite(null)
      setState('revoked')
    } catch {
      setError('Unable to revoke the invitation. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    if (!invite || checking) return
    try {
      await navigator.clipboard.writeText(link(invite.token))
      setCopied('Link copied.')
    } catch {
      setCopied('Copy failed. Select the link and copy it manually.')
    }
  }
  // The fragment keeps the token out of HTTP navigation and referrer headers.
  function link(token: string) {
    return `${window.location.origin}/transfer#${token}`
  }
  const shared = visits.filter((visit) => !visit.private_on_transfer)

  return (
    <section
      className="panel transfer-panel"
      aria-labelledby="transfer-heading"
    >
      <div className="section-heading">
        <h2 id="transfer-heading">Transfer ownership</h2>
        <button
          type="button"
          className="button secondary button-small"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <p className="service-feedback" role="note">
        Ownership changes only after the recipient accepts the invitation. When
        they accept, you lose access to this vehicle immediately and cannot
        recover it unless the new owner sends it back.
      </p>

      <h3>Vehicle</h3>
      <p>
        {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.engine} ·{' '}
        {vehicle.mileage.toLocaleString()} km
      </p>

      {historyEnabled && (
        <>
          <h3>Service history</h3>
          <p className="muted">
            Private visits are not shared: the recipient sees only a redacted
            record without notes, workshop, cost or operation names. Completion
            facts remain available for maintenance calculations.
          </p>
          {historyLoading ? (
            <p role="status">
              <LoaderCircle
                className="animate-spin"
                size={16}
                aria-hidden="true"
              />{' '}
              Loading service history…
            </p>
          ) : historyError ? (
            <p className="service-feedback error" role="alert">
              {historyError}{' '}
              <button
                type="button"
                className="button secondary button-small"
                onClick={() => {
                  setHistoryLoading(true)
                  setReload((value) => value + 1)
                }}
              >
                Try again
              </button>
            </p>
          ) : visits.length === 0 ? (
            <p className="muted">No service history to transfer.</p>
          ) : (
            <ul className="transfer-visits">
              {visits.map((visit) => {
                const isPrivate = Boolean(visit.private_on_transfer)
                return (
                  <li key={visit.id} className="transfer-visit">
                    <div>
                      <strong>{formatDate(visit.service_date)}</strong>
                      {isPrivate ? (
                        <p className="muted">Private visit — not shared</p>
                      ) : (
                        <p className="muted">
                          {visit.mileage.toLocaleString()} km ·{' '}
                          {visit.operations
                            .map((operation) => operation.operation_name)
                            .join(', ') || 'No operations'}
                        </p>
                      )}
                    </div>
                    <label className="transfer-private">
                      <input
                        type="checkbox"
                        checked={isPrivate}
                        disabled={privacyBusy !== null || busy || checking}
                        onChange={(event) =>
                          setPrivacy(visit, event.target.checked)
                        }
                      />
                      Keep private
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {privacyError && (
            <p className="service-feedback error" role="alert">
              {privacyError}
            </p>
          )}
          {!historyLoading && !historyError && visits.length > 0 && (
            <p className="muted" role="status">
              {shared.length} of {visits.length} visits will be shared.
            </p>
          )}
        </>
      )}

      <h3>Invitation</h3>
      {error && (
        <p className="service-feedback error" role="alert">
          {error}
        </p>
      )}
      {state === 'expired' && (
        <p className="service-feedback error" role="status">
          This invitation has expired. Create a new one.
        </p>
      )}
      {state === 'revoked' && (
        <p className="service-feedback" role="status">
          The invitation was revoked and its link no longer works.
        </p>
      )}
      {state === 'accepted' && (
        <p role="status">
          The recipient accepted. You no longer have access to this vehicle.
        </p>
      )}
      {state === 'declined' && (
        <p role="status">The recipient declined. Ownership was not changed.</p>
      )}
      {invite && state === 'pending' && (
        <div className="transfer-invite">
          {!checking && (
            <>
              <label htmlFor="transfer-link">Invitation link</label>
              <input
                id="transfer-link"
                readOnly
                value={link(invite.token)}
                onFocus={(event) => event.currentTarget.select()}
              />
            </>
          )}
          <p className="muted">
            Expires {formatDateTime(invite.expires_at)}. Share it privately; it
            stays available in this tab until the invitation is resolved.
          </p>
          <div className="mileage-edit-actions">
            <button
              type="button"
              className="button"
              onClick={copy}
              disabled={checking}
            >
              <Copy size={14} aria-hidden="true" /> Copy link
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={revoke}
              disabled={busy || checking}
            >
              {busy ? 'Revoking…' : 'Revoke invitation'}
            </button>
          </div>
          {checking && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setStatusAttempt((value) => value + 1)}
            >
              Check invitation status
            </button>
          )}
          {copied && (
            <p className="muted" role="status">
              {copied}
            </p>
          )}
        </div>
      )}
      {state !== 'pending' && state !== 'accepted' && (
        <button
          type="button"
          className="button"
          onClick={create}
          disabled={
            busy ||
            historyLoading ||
            Boolean(historyError) ||
            privacyBusy !== null
          }
        >
          {busy ? 'Creating…' : 'Create invitation'}
        </button>
      )}
    </section>
  )
}
