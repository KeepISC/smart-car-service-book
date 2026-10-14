import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import {
  approveVehicleShopAuthorization,
  listVehicleShopAuthorizations,
  requestVehicleShopAuthorization,
  resolveVehicleShopRequest,
  revokeVehicleShopAuthorization,
  searchAvailableRepairShops,
  setVehicleShopDataSharing,
} from '../services/repairShops'
import { isServiceHistoryEnabled } from '../config/features'
import { loadServiceHistory } from '../services/serviceHistory'
import type {
  RepairShopDirectoryPage,
  VehicleShopAuthorization,
} from '../types/repairShop'
import type { ServiceVisit } from '../types/serviceHistory'
import type { Vehicle } from '../types/vehicle'

type Props = { vehicle: Vehicle }

const dirLimit = 10

// Pending requests expire without a scheduler, so the effective state is derived.
function effectiveStatus(row: VehicleShopAuthorization, now = Date.now()) {
  return row.status === 'pending' &&
    row.expires_at !== null &&
    Date.parse(row.expires_at) <= now
    ? 'expired'
    : row.status
}

const labels: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  revoked: 'Revoked',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

function permissions(row: VehicleShopAuthorization) {
  if (row.status !== 'approved') return 'No access'
  return row.can_create_records
    ? 'View vehicle and add maintenance records'
    : 'View vehicle only'
}

export function RepairShopConnections({ vehicle }: Props) {
  const [rows, setRows] = useState<VehicleShopAuthorization[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // Searchable shop discovery
  const [dirSearch, setDirSearch] = useState('')
  const [dirOffset, setDirOffset] = useState(0)
  const [dirPage, setDirPage] = useState<RepairShopDirectoryPage | null>(null)
  const [dirLoading, setDirLoading] = useState(true)
  const [dirError, setDirError] = useState(false)
  const [dirAttempt, setDirAttempt] = useState(0)

  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [allowRecords, setAllowRecords] = useState<Record<string, boolean>>({})
  const [confirming, setConfirming] = useState<string | null>(null)

  // Data sharing editor for approved connections
  const [sharingAuthId, setSharingAuthId] = useState<string | null>(null)
  const [draftRef, setDraftRef] = useState('')
  const [draftOps, setDraftOps] = useState(false)
  const [draftVisits, setDraftVisits] = useState<string[]>([])
  const [vehicleVisits, setVehicleVisits] = useState<ServiceVisit[] | null>(
    null,
  )
  const [visitsLoading, setVisitsLoading] = useState(false)
  const [visitsError, setVisitsError] = useState(false)
  const [sharingError, setSharingError] = useState('')

  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    listVehicleShopAuthorizations(vehicle.id)
      .then((data) => {
        if (!alive) return
        setRows(data)
        setLoadError(false)
      })
      .catch(() => {
        if (alive) setLoadError(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [vehicle.id, attempt])

  useEffect(() => {
    let alive = true
    searchAvailableRepairShops(vehicle.id, dirSearch, dirOffset, dirLimit)
      .then((data) => {
        if (!alive) return
        setDirPage(data)
        setDirError(false)
      })
      .catch(() => {
        if (alive) setDirError(true)
      })
      .finally(() => {
        if (alive) setDirLoading(false)
      })
    return () => {
      alive = false
    }
  }, [vehicle.id, dirSearch, dirOffset, dirAttempt])

  const refresh = useCallback(() => setAttempt((value) => value + 1), [])

  async function run(
    key: string,
    action: () => Promise<unknown>,
    done: string,
  ) {
    setBusy(key)
    setMessage('')
    try {
      await action()
      if (!active.current) return
      setConfirming(null)
      setMessage(done)
      refresh()
    } catch (error) {
      if (!active.current) return
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String((error as { code: unknown }).code)
          : ''
      setMessage(
        code === '40001'
          ? 'Another change happened at the same time. Please try again.'
          : 'Unable to complete that action. It may no longer be available.',
      )
      refresh()
    } finally {
      if (active.current) setBusy(null)
    }
  }

  function findExisting(shopId: string) {
    return rows.find(
      (row) =>
        row.shop_id === shopId &&
        ['pending', 'approved'].includes(effectiveStatus(row)),
    )
  }

  function openSharing(row: VehicleShopAuthorization) {
    if (sharingAuthId === row.id) {
      setSharingAuthId(null)
      return
    }
    setSharingAuthId(row.id)
    setDraftRef(row.customer_reference ?? '')
    setDraftOps(row.share_operation_names ?? false)
    setDraftVisits(row.shared_visit_ids ?? [])
    setSharingError('')
    if (vehicleVisits === null && isServiceHistoryEnabled()) loadVisits()
  }

  function loadVisits() {
    setVisitsLoading(true)
    setVisitsError(false)
    loadServiceHistory(vehicle.id)
      .then((visits) => {
        if (active.current) setVehicleVisits(visits)
      })
      .catch(() => {
        if (active.current) setVisitsError(true)
      })
      .finally(() => {
        if (active.current) setVisitsLoading(false)
      })
  }

  async function handleSaveSharing(row: VehicleShopAuthorization) {
    const trimmed = draftRef.trim()
    if (trimmed.length > 80) {
      setSharingError('Customer reference must be 80 characters or fewer.')
      return
    }
    setBusy('sharing-' + row.id)
    setSharingError('')
    try {
      await setVehicleShopDataSharing(vehicle.id, row.id, {
        customer_reference: trimmed || null,
        share_operation_names: draftOps,
        shared_visit_ids: draftVisits,
      })
      if (!active.current) return
      setMessage(`Data sharing preferences saved for ${row.shop_name}.`)
      setSharingAuthId(null)
      refresh()
    } catch (error) {
      if (!active.current) return
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String((error as { code: unknown }).code)
          : ''
      setSharingError(
        code === '40001'
          ? 'Another change happened at the same time. Please try again.'
          : 'Unable to save data sharing preferences. Please check your selections.',
      )
    } finally {
      if (active.current) setBusy(null)
    }
  }

  return (
    <section className="panel shop-connections" aria-labelledby="shops-heading">
      <h2 id="shops-heading">Repair shops</h2>
      <p className="muted">
        A shop can see this vehicle only after you approve it. You choose
        whether it may also add maintenance records, and you can revoke access
        at any time.
      </p>

      <section
        className="shop-discovery"
        aria-labelledby="shop-discovery-heading"
      >
        <h3 id="shop-discovery-heading">Find a repair shop</h3>
        <p className="muted">
          Search registered repair shops to request a connection.
        </p>
        <div className="shop-request">
          <label htmlFor="shop-search">Search repair shops</label>
          <input
            id="shop-search"
            type="search"
            value={dirSearch}
            placeholder="Search by name or address…"
            onChange={(event) => {
              setDirSearch(event.target.value)
              setDirOffset(0)
              setDirLoading(true)
            }}
          />
        </div>
        {dirLoading ? (
          <p role="status">
            <LoaderCircle
              className="animate-spin"
              size={16}
              aria-hidden="true"
            />{' '}
            Loading available repair shops…
          </p>
        ) : dirError ? (
          <p className="service-feedback error" role="alert">
            Unable to search repair shops.{' '}
            <button
              type="button"
              className="button secondary button-small"
              onClick={() => {
                setDirLoading(true)
                setDirAttempt((v) => v + 1)
              }}
            >
              Try again
            </button>
          </p>
        ) : !dirPage || dirPage.items.length === 0 ? (
          <p className="muted">No available repair shops found.</p>
        ) : (
          <>
            <ul className="shop-list">
              {dirPage.items.map((shop) => {
                const existing = findExisting(shop.id)
                const isApproved = existing?.status === 'approved'
                const isPending =
                  existing && effectiveStatus(existing) === 'pending'
                return (
                  <li key={shop.id} className="shop-row">
                    <div>
                      <strong>{shop.name}</strong>
                      {shop.contact_address && (
                        <p className="muted">{shop.contact_address}</p>
                      )}
                      {(shop.contact_phone || shop.contact_website) && (
                        <p className="muted">
                          {[shop.contact_phone, shop.contact_website]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                    {isApproved ? (
                      <span className="shop-status shop-status-approved">
                        Connected
                      </span>
                    ) : isPending ? (
                      <span className="shop-status shop-status-pending">
                        Request pending
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="button button-small"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            'request-' + shop.id,
                            async () => {
                              await requestVehicleShopAuthorization(
                                vehicle.id,
                                shop.id,
                              )
                              setDirAttempt((v) => v + 1)
                            },
                            'Connection requested. The shop must accept it before it can see this vehicle.',
                          )
                        }
                      >
                        {busy === 'request-' + shop.id
                          ? 'Requesting…'
                          : 'Request connection'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {dirPage.total > dirLimit && (
              <div className="shop-actions">
                <button
                  type="button"
                  className="button secondary button-small"
                  disabled={dirOffset === 0}
                  onClick={() => {
                    setDirOffset(Math.max(0, dirOffset - dirLimit))
                    setDirLoading(true)
                  }}
                >
                  Previous page
                </button>
                <span className="muted">
                  Page {Math.floor(dirOffset / dirLimit) + 1} of{' '}
                  {Math.max(1, Math.ceil(dirPage.total / dirLimit))}
                </span>
                <button
                  type="button"
                  className="button secondary button-small"
                  disabled={dirOffset + dirLimit >= dirPage.total}
                  onClick={() => {
                    setDirOffset(dirOffset + dirLimit)
                    setDirLoading(true)
                  }}
                >
                  Next page
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {message && (
        <p className="service-feedback" role="status">
          {message}
        </p>
      )}

      <h3>Connections</h3>
      {loading ? (
        <p role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
          Loading repair shops…
        </p>
      ) : loadError ? (
        <p className="service-feedback error" role="alert">
          Unable to load repair shops.{' '}
          <button
            type="button"
            className="button secondary button-small"
            onClick={() => {
              setLoading(true)
              refresh()
            }}
          >
            Try again
          </button>
        </p>
      ) : rows.length === 0 ? (
        <p className="muted">No repair shop connections.</p>
      ) : (
        <ul className="shop-list">
          {rows.map((row) => {
            const status = effectiveStatus(row)
            const open = status === 'pending'
            const approved = status === 'approved'
            const disabled = busy !== null
            const isOwner = row.initiated_by === 'owner'
            const shopAccepted = Boolean(row.shop_accepted_at)
            const canOwnerApprove = open && (!isOwner || shopAccepted)
            return (
              <li key={row.id} className="shop-row">
                <div>
                  <strong>{row.shop_name}</strong>{' '}
                  <span className={`shop-status shop-status-${status}`}>
                    {labels[status]}
                  </span>
                  <p className="muted">
                    {open
                      ? isOwner
                        ? shopAccepted
                          ? 'The shop accepted your request. Approve to grant access.'
                          : 'Waiting for the shop to accept your request.'
                        : 'The shop asked to connect. Approve to grant access.'
                      : permissions(row)}
                  </p>
                  {approved && (
                    <p className="muted">
                      Customer ref: {row.customer_reference || 'Default'} ·
                      Schedule names:{' '}
                      {row.share_operation_names ? 'Shared' : 'Hidden'} · Shared
                      visits: {row.shared_visit_ids?.length ?? 0}
                    </p>
                  )}
                </div>
                {canOwnerApprove && (
                  <div className="shop-actions">
                    <label className="transfer-private">
                      <input
                        type="checkbox"
                        checked={allowRecords[row.id] ?? false}
                        onChange={(event) =>
                          setAllowRecords((value) => ({
                            ...value,
                            [row.id]: event.target.checked,
                          }))
                        }
                      />
                      Also allow adding maintenance records
                    </label>
                    <button
                      type="button"
                      className="button"
                      disabled={disabled}
                      onClick={() =>
                        void run(
                          row.id,
                          () =>
                            approveVehicleShopAuthorization(
                              vehicle.id,
                              row.id,
                              allowRecords[row.id] ?? false,
                            ),
                          `${row.shop_name} was approved.`,
                        )
                      }
                    >
                      Approve {row.shop_name}
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={disabled}
                      onClick={() =>
                        void run(
                          row.id,
                          () =>
                            resolveVehicleShopRequest(
                              vehicle.id,
                              row.id,
                              isOwner ? 'cancelled' : 'declined',
                            ),
                          isOwner
                            ? 'The request was cancelled.'
                            : `${row.shop_name} was declined.`,
                        )
                      }
                    >
                      {isOwner ? 'Cancel request' : `Decline ${row.shop_name}`}
                    </button>
                  </div>
                )}
                {open && isOwner && !shopAccepted && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={disabled}
                    onClick={() =>
                      void run(
                        row.id,
                        () =>
                          resolveVehicleShopRequest(
                            vehicle.id,
                            row.id,
                            'cancelled',
                          ),
                        'The request was cancelled.',
                      )
                    }
                  >
                    Cancel request to {row.shop_name}
                  </button>
                )}
                {approved && (
                  <div className="shop-actions">
                    <button
                      type="button"
                      className="button secondary button-small"
                      aria-expanded={sharingAuthId === row.id}
                      onClick={() => openSharing(row)}
                    >
                      {sharingAuthId === row.id
                        ? 'Close sharing'
                        : 'Configure data sharing'}
                    </button>
                    {confirming === row.id ? (
                      <div role="group">
                        <p>
                          Revoke access for {row.shop_name}? Data it already
                          downloaded cannot be recalled.
                        </p>
                        <button
                          type="button"
                          className="button"
                          disabled={disabled}
                          onClick={() =>
                            void run(
                              row.id,
                              () =>
                                revokeVehicleShopAuthorization(
                                  vehicle.id,
                                  row.id,
                                ),
                              `Access for ${row.shop_name} was revoked.`,
                            )
                          }
                        >
                          Confirm revoke
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => setConfirming(null)}
                        >
                          Keep access
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="button secondary button-small"
                        disabled={disabled}
                        onClick={() => setConfirming(row.id)}
                      >
                        Revoke {row.shop_name}
                      </button>
                    )}
                  </div>
                )}
                {approved && sharingAuthId === row.id && (
                  <div
                    className="shop-data-sharing"
                    aria-labelledby={`sharing-heading-${row.id}`}
                  >
                    <h4 id={`sharing-heading-${row.id}`}>
                      Data sharing for {row.shop_name}
                    </h4>
                    <p className="muted">
                      Control what vehicle details this shop can see. By
                      default, only essential completion facts and generic
                      schedules are shared.
                    </p>
                    {sharingError && (
                      <p className="service-feedback error" role="alert">
                        {sharingError}
                      </p>
                    )}
                    <label htmlFor={`cust-ref-${row.id}`}>
                      Customer reference (optional, max 80 characters)
                    </label>
                    <input
                      id={`cust-ref-${row.id}`}
                      type="text"
                      maxLength={80}
                      value={draftRef}
                      onChange={(e) => setDraftRef(e.target.value)}
                      placeholder="e.g. Work Van 01"
                    />
                    <label className="transfer-private">
                      <input
                        type="checkbox"
                        checked={draftOps}
                        onChange={(e) => setDraftOps(e.target.checked)}
                      />
                      Share maintenance schedule and operation names
                    </label>
                    {isServiceHistoryEnabled() && (
                      <div className="shared-visits-list">
                        <h5>Shared service history visits</h5>
                        <p className="muted">
                          Select which visits include full details (notes,
                          costs, workshop names). Unselected visits remain
                          completion facts only.
                        </p>
                        {visitsLoading ? (
                          <p role="status">Loading visits…</p>
                        ) : visitsError ? (
                          <p className="service-feedback error" role="alert">
                            Unable to load service visits.{' '}
                            <button
                              type="button"
                              className="button secondary button-small"
                              onClick={loadVisits}
                            >
                              Retry service visits
                            </button>
                          </p>
                        ) : !vehicleVisits ||
                          vehicleVisits.filter((v) => !v.private_on_transfer)
                            .length === 0 ? (
                          <p className="muted">
                            No shareable service visits recorded.
                          </p>
                        ) : (
                          vehicleVisits
                            .filter((v) => !v.private_on_transfer)
                            .map((visit) => {
                              const checked = draftVisits.includes(visit.id)
                              return (
                                <label
                                  key={visit.id}
                                  className="transfer-private"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      setDraftVisits(
                                        e.target.checked
                                          ? [...draftVisits, visit.id]
                                          : draftVisits.filter(
                                              (id) => id !== visit.id,
                                            ),
                                      )
                                    }}
                                  />
                                  {visit.service_date} ·{' '}
                                  {visit.mileage.toLocaleString()} km
                                  {visit.workshop_name
                                    ? ` · ${visit.workshop_name}`
                                    : ''}
                                </label>
                              )
                            })
                        )}
                      </div>
                    )}
                    <div className="shop-actions">
                      <button
                        type="button"
                        className="button button-small"
                        disabled={disabled || visitsLoading || visitsError}
                        onClick={() => void handleSaveSharing(row)}
                      >
                        {busy === 'sharing-' + row.id
                          ? 'Saving…'
                          : 'Save sharing preferences'}
                      </button>
                      <button
                        type="button"
                        className="button secondary button-small"
                        onClick={() => setSharingAuthId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
