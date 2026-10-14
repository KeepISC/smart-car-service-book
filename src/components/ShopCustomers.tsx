import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import {
  getRepairShopVehicle,
  listRepairShopAuthorizations,
  resolveVehicleShopRequest,
  reviewOwnerShopRequest,
} from '../services/repairShops'
import { useMaintenanceRefresh } from '../hooks/useMaintenanceRefresh'
import type {
  RepairShop,
  ShopVehicle,
  VehicleShopAuthorization,
} from '../types/repairShop'
import { connectionRef, summarizeShopVehicle } from './shopVehicleSummary'
import { ShopVehicleHistory } from './ShopVehicleHistory'

const pageSize = 10
const concurrency = 4

type Detail =
  | { state: 'loading' }
  | { state: 'ready'; data: ShopVehicle }
  | { state: 'denied' }
  | { state: 'error' }
type ListState = 'loading' | 'ready' | 'denied' | 'error'

function errorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}
function isLapsed(row: VehicleShopAuthorization) {
  return (
    row.status === 'pending' &&
    row.expires_at !== null &&
    Date.parse(row.expires_at) <= Date.now()
  )
}

export function ShopCustomers({ shop }: { shop: RepairShop }) {
  const admin = shop.role === 'admin'
  const { revision, reload } = useMaintenanceRefresh()
  const [attempt, setAttempt] = useState(0)
  const [listState, setListState] = useState<ListState>('loading')
  const [rows, setRows] = useState<VehicleShopAuthorization[]>([])
  const [details, setDetails] = useState<Record<string, Detail>>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let alive = true
    async function run() {
      let list: VehicleShopAuthorization[]
      try {
        list = await listRepairShopAuthorizations(shop.id)
      } catch (error) {
        if (!alive) return
        if (errorCode(error) === '42501') {
          // Never keep customer data after the server denies shop access.
          setRows([])
          setDetails({})
          setSelected(null)
          setListState('denied')
        } else setListState('error')
        return
      }
      if (!alive) return
      setRows(list)
      setListState('ready')
      const approved = list.filter((row) => row.status === 'approved')
      setDetails((previous) =>
        Object.fromEntries(
          approved.map((row) => [
            row.vehicle_id,
            previous[row.vehicle_id] ?? { state: 'loading' },
          ]),
        ),
      )
      const queue = [...approved]
      async function worker() {
        for (let row = queue.shift(); row && alive; row = queue.shift()) {
          const id = row.vehicle_id
          let next: Detail
          try {
            next = {
              state: 'ready',
              data: await getRepairShopVehicle(shop.id, id),
            }
          } catch (error) {
            next = { state: errorCode(error) === '42501' ? 'denied' : 'error' }
          }
          if (alive) setDetails((previous) => ({ ...previous, [id]: next }))
        }
      }
      await Promise.all(Array.from({ length: concurrency }, worker))
    }
    void run()
    return () => {
      alive = false
    }
  }, [shop.id, revision, attempt])

  const approved = rows.filter((row) => row.status === 'approved')
  const pending = rows.filter((row) => row.status === 'pending')
  const entries = useMemo(
    () =>
      rows
        .filter((row) => row.status === 'approved')
        .map((row) => {
          const detail = details[row.vehicle_id] ?? {
            state: 'loading' as const,
          }
          return {
            row,
            detail,
            summary:
              detail.state === 'ready'
                ? summarizeShopVehicle(detail.data)
                : null,
          }
        }),
    [rows, details],
  )
  const term = search.trim().toLowerCase()
  const visible = entries.filter(({ row, detail, summary }) => {
    if (detail.state === 'denied') return false
    if (detail.state !== 'ready' || !summary) return !term && filter === 'all'
    if (filter !== 'all' && summary.overall !== filter) return false
    const { vehicle } = detail.data
    const custRef =
      (detail.state === 'ready' && detail.data.customer_reference) ||
      row.customer_reference ||
      connectionRef(row.id)
    return (
      !term ||
      [
        vehicle.make,
        vehicle.model,
        String(vehicle.year),
        vehicle.engine,
        custRef,
        connectionRef(row.id),
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    )
  })
  const pages = Math.max(1, Math.ceil(visible.length / pageSize))
  const current = Math.min(page, pages - 1)
  const shown = visible.slice(current * pageSize, (current + 1) * pageSize)
  const ended = entries.filter(({ detail }) => detail.state === 'denied').length
  const open = entries.find(({ row }) => row.vehicle_id === selected)
  const reloadList = useCallback(() => setAttempt((value) => value + 1), [])

  async function handleReview(
    row: VehicleShopAuthorization,
    outcome: 'accepted' | 'declined',
  ) {
    setBusy(row.id)
    setMessage('')
    try {
      await reviewOwnerShopRequest(row.vehicle_id, row.id, outcome)
      setMessage(
        outcome === 'accepted'
          ? `Request ${connectionRef(row.id)} was accepted.`
          : 'The request was declined.',
      )
    } catch {
      setMessage('Unable to update the request. It may no longer be available.')
    } finally {
      setBusy(null)
      setAttempt((value) => value + 1)
    }
  }

  async function respond(
    row: VehicleShopAuthorization,
    outcome: 'declined' | 'cancelled',
  ) {
    setBusy(row.id)
    setMessage('')
    try {
      await resolveVehicleShopRequest(row.vehicle_id, row.id, outcome)
      setMessage(
        outcome === 'declined'
          ? 'The request was declined.'
          : 'The request was cancelled.',
      )
    } catch {
      setMessage('Unable to update the request. It may no longer be available.')
    } finally {
      setBusy(null)
      setAttempt((value) => value + 1)
    }
  }

  if (listState === 'loading')
    return (
      <p role="status">
        <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
        Loading customer vehicles…
      </p>
    )
  if (listState === 'denied')
    return (
      <p className="service-feedback error" role="alert">
        Access to this shop is unavailable. The shop may be suspended, its
        subscription may have expired, or your staff access may have ended.
      </p>
    )
  if (listState === 'error')
    return (
      <p className="service-feedback error" role="alert">
        Unable to load customer vehicles.{' '}
        <button
          type="button"
          className="button secondary button-small"
          onClick={() => {
            setListState('loading')
            setAttempt((value) => value + 1)
          }}
        >
          Try again
        </button>
      </p>
    )

  return (
    <>
      <section aria-labelledby="crm-requests">
        <h2 id="crm-requests">Connection requests</h2>
        <p className="muted">
          Customers approve access themselves; a shop cannot approve its own
          requests.
          {admin ? '' : ' Only shop administrators can respond to requests.'}
        </p>
        {message && (
          <p className="service-feedback" role="status">
            {message}
          </p>
        )}
        {pending.length === 0 ? (
          <p className="muted">No pending connection requests.</p>
        ) : (
          <ul className="shop-list">
            {pending.map((row) => {
              const lapsed = isLapsed(row)
              const byOwner = row.initiated_by === 'owner'
              const accepted = Boolean(row.shop_accepted_at)
              return (
                <li key={row.id} className="shop-row">
                  <div>
                    <strong>Request {connectionRef(row.id)}</strong>{' '}
                    <span
                      className={`shop-status shop-status-${lapsed ? 'expired' : accepted ? 'approved' : 'pending'}`}
                    >
                      {lapsed
                        ? 'Expired'
                        : accepted
                          ? 'Shop accepted'
                          : 'Pending'}
                    </span>
                    <p className="muted">
                      {byOwner
                        ? accepted
                          ? 'Accepted by your shop. Waiting for the customer to approve.'
                          : 'Requested by a customer. The vehicle becomes visible only after they approve it.'
                        : 'Requested by your shop. Waiting for the customer to approve.'}
                    </p>
                  </div>
                  {admin && !lapsed && (
                    <div className="shop-actions">
                      {byOwner ? (
                        <>
                          {!accepted && (
                            <button
                              type="button"
                              className="button secondary"
                              disabled={busy !== null}
                              onClick={() => void handleReview(row, 'accepted')}
                            >
                              Accept request {connectionRef(row.id)}
                            </button>
                          )}
                          <button
                            type="button"
                            className="button secondary"
                            disabled={busy !== null}
                            onClick={() => void handleReview(row, 'declined')}
                          >
                            Decline request {connectionRef(row.id)}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy !== null}
                          onClick={() => void respond(row, 'cancelled')}
                        >
                          Cancel request {connectionRef(row.id)}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="crm-vehicles">
        <h2 id="crm-vehicles">Customer vehicles</h2>
        <div className="shop-request">
          <label htmlFor="crm-search">
            Search authorized vehicles by make, model, year, engine or reference
          </label>
          <input
            id="crm-search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(0)
            }}
          />
          <label htmlFor="crm-filter">Maintenance status</label>
          <select
            id="crm-filter"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value)
              setPage(0)
            }}
          >
            <option value="all">All</option>
            <option value="Due / overdue">Due / overdue</option>
            <option value="Due soon">Due soon</option>
            <option value="Up to date">Up to date</option>
            <option value="Unknown">Unknown</option>
          </select>
        </div>
        {ended > 0 && (
          <p className="service-feedback" role="status">
            {ended} {ended === 1 ? 'vehicle is' : 'vehicles are'} no longer
            available because access was revoked or ownership changed.
          </p>
        )}
        {approved.length === 0 ? (
          <p className="muted">
            No customer has authorized a vehicle for this shop yet.
          </p>
        ) : visible.length === 0 ? (
          <p className="muted">No authorized vehicles match your filters.</p>
        ) : (
          <ul className="shop-list">
            {shown.map(({ row, detail, summary }) => {
              const custRef =
                (detail.state === 'ready' && detail.data.customer_reference) ||
                row.customer_reference ||
                connectionRef(row.id)
              return (
                <li key={row.id} className="shop-row">
                  {detail.state === 'ready' && summary ? (
                    <>
                      <div>
                        <strong>
                          {detail.data.vehicle.year} {detail.data.vehicle.make}{' '}
                          {detail.data.vehicle.model}
                        </strong>{' '}
                        <span
                          className={`shop-status shop-status-${summary.overall === 'Due / overdue' ? 'expired' : summary.overall === 'Due soon' ? 'pending' : 'approved'}`}
                        >
                          {summary.overall}
                        </span>
                        <p className="muted">
                          Ref {custRef} ·{' '}
                          {detail.data.vehicle.mileage.toLocaleString()} km ·
                          Last service{' '}
                          {summary.lastServiceDate ?? 'none recorded'}
                        </p>
                        <p className="muted">
                          {summary.overdue} overdue · {summary.dueSoon} due soon
                          ·{' '}
                          {row.can_create_records
                            ? 'May add records'
                            : 'View only'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="button secondary"
                        aria-pressed={selected === row.vehicle_id}
                        onClick={() =>
                          setSelected(
                            selected === row.vehicle_id ? null : row.vehicle_id,
                          )
                        }
                      >
                        View {detail.data.vehicle.make}{' '}
                        {detail.data.vehicle.model} {custRef}
                      </button>
                    </>
                  ) : (
                    <p role={detail.state === 'error' ? 'alert' : 'status'}>
                      Ref {custRef}:{' '}
                      {detail.state === 'error'
                        ? 'Unable to load this vehicle.'
                        : 'Loading vehicle…'}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {visible.length > pageSize && (
          <div className="shop-actions">
            <button
              type="button"
              className="button secondary button-small"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Previous page
            </button>
            <span className="muted">
              Page {current + 1} of {pages}
            </span>
            <button
              type="button"
              className="button secondary button-small"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Next page
            </button>
          </div>
        )}
        <button
          type="button"
          className="button secondary button-small"
          onClick={() => {
            reload()
          }}
        >
          Refresh
        </button>
      </section>

      {open && (
        <ShopVehicleHistory
          key={open.row.vehicle_id}
          revision={revision}
          canCreateRecords={
            open.row.can_create_records &&
            (shop.role === 'admin' || shop.role === 'mechanic') &&
            open.detail.state === 'ready'
          }
          shopId={shop.id}
          vehicleId={open.row.vehicle_id}
          reference={
            (open.detail.state === 'ready' &&
              open.detail.data.customer_reference) ||
            open.row.customer_reference ||
            connectionRef(open.row.id)
          }
          onClose={() => setSelected(null)}
          onDenied={reloadList}
        />
      )}
    </>
  )
}
