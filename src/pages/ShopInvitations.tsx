import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, LoaderCircle } from 'lucide-react'
import {
  cancelRepairShopConnectionInvitation,
  createRepairShopConnectionInvitation,
  listRepairShopConnectionInvitations,
  listRepairShops,
  repairShopConnectionInvitationLink,
} from '../services/repairShops'
import type {
  RepairShop,
  ShopConnectionInvitationStatus,
} from '../types/repairShop'

type Created = { id: string; link: string; expires_at: string }

const statusLabel: Record<ShopConnectionInvitationStatus['status'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

// Invitation tokens are bearer secrets: they live only in this component's
// memory (never storage, logs or the URL query) and are shown exactly once.
export function ShopInvitations() {
  const [shops, setShops] = useState<RepairShop[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [shopId, setShopId] = useState('')
  const [days, setDays] = useState('1')
  const [invitations, setInvitations] = useState<
    ShopConnectionInvitationStatus[]
  >([])
  const [listError, setListError] = useState(false)
  const [listAttempt, setListAttempt] = useState(0)
  const [created, setCreated] = useState<Created | null>(null)
  const [copied, setCopied] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    listRepairShops()
      .then((data) => {
        if (!alive) return
        const admin = data.filter((shop) => shop.role === 'admin')
        setShops(admin)
        setShopId((current) =>
          admin.some((shop) => shop.id === current)
            ? current
            : (admin[0]?.id ?? ''),
        )
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
  }, [attempt])

  useEffect(() => {
    if (!shopId) return
    let alive = true
    listRepairShopConnectionInvitations(shopId)
      .then((data) => {
        if (!alive) return
        setInvitations(data)
        setListError(false)
      })
      .catch(() => {
        if (alive) setListError(true)
      })
    return () => {
      alive = false
    }
  }, [shopId, listAttempt])

  function chooseShop(id: string) {
    // The previous shop's link must not remain visible under another shop.
    setShopId(id)
    setCreated(null)
    setCopied('')
    setMessage('')
    setInvitations([])
  }

  async function create() {
    setBusy('create')
    setMessage('')
    setCopied('')
    try {
      const expires = new Date(Date.now() + Number(days) * 86_400_000 - 60_000)
      const invitation = await createRepairShopConnectionInvitation(
        shopId,
        expires.toISOString(),
      )
      if (!active.current) return
      setCreated({
        id: invitation.id,
        link: repairShopConnectionInvitationLink(
          invitation.token,
          window.location.origin,
        ),
        expires_at: invitation.expires_at,
      })
      setListAttempt((value) => value + 1)
    } catch {
      if (active.current)
        setMessage('Unable to create the invitation. Please try again.')
    } finally {
      if (active.current) setBusy(null)
    }
  }

  async function cancel(invitationId: string) {
    setBusy(invitationId)
    setMessage('')
    try {
      await cancelRepairShopConnectionInvitation(shopId, invitationId)
      if (!active.current) return
      if (created?.id === invitationId) setCreated(null)
      setMessage('The invitation was cancelled and its link no longer works.')
    } catch {
      if (active.current)
        setMessage('Unable to cancel the invitation. Please try again.')
    } finally {
      if (active.current) {
        setBusy(null)
        setListAttempt((value) => value + 1)
      }
    }
  }

  async function copy() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.link)
      setCopied('Link copied.')
    } catch {
      setCopied('Copy failed. Select the link and copy it manually.')
    }
  }

  return (
    <section
      className="panel shop-invitations"
      aria-labelledby="invite-heading"
    >
      <h1 id="invite-heading">Repair shop invitations</h1>
      <p>
        <Link to="/workshop">View shop customers</Link>
      </p>
      <p className="muted">
        Create a single-use link for a customer. They sign in, choose one of
        their vehicles and decide what your shop may do.
      </p>
      {loading ? (
        <p role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
          Loading your shops…
        </p>
      ) : loadError ? (
        <p className="service-feedback error" role="alert">
          Unable to load your shops.{' '}
          <button
            type="button"
            className="button secondary button-small"
            onClick={() => {
              setLoading(true)
              setAttempt((value) => value + 1)
            }}
          >
            Try again
          </button>
        </p>
      ) : shops.length === 0 ? (
        <p className="muted">
          You are not an administrator of any repair shop.
        </p>
      ) : (
        <>
          <div className="shop-request">
            <label htmlFor="invite-shop">Shop</label>
            <select
              id="invite-shop"
              value={shopId}
              disabled={busy !== null}
              onChange={(event) => chooseShop(event.target.value)}
            >
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
            <label htmlFor="invite-days">Link valid for</label>
            <select
              id="invite-days"
              value={days}
              disabled={busy !== null}
              onChange={(event) => setDays(event.target.value)}
            >
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
            </select>
            <button
              type="button"
              className="button"
              onClick={create}
              disabled={busy !== null}
            >
              {busy === 'create' ? 'Creating…' : 'Create invitation link'}
            </button>
          </div>
          {message && (
            <p className="service-feedback" role="status">
              {message}
            </p>
          )}
          {created && (
            <div className="transfer-invite">
              <label htmlFor="shop-invite-link">Invitation link</label>
              <input
                id="shop-invite-link"
                readOnly
                value={created.link}
                onFocus={(event) => event.currentTarget.select()}
              />
              <p className="muted">
                Expires {formatDateTime(created.expires_at)}. Share it
                privately. It works once and is shown only on this screen;
                leaving the page discards it.
              </p>
              <button type="button" className="button" onClick={copy}>
                <Copy size={14} aria-hidden="true" /> Copy link
              </button>
              {copied && (
                <p className="muted" role="status">
                  {copied}
                </p>
              )}
            </div>
          )}
          <h2>Invitations</h2>
          {listError ? (
            <p className="service-feedback error" role="alert">
              Unable to load invitations.{' '}
              <button
                type="button"
                className="button secondary button-small"
                onClick={() => setListAttempt((value) => value + 1)}
              >
                Try again
              </button>
            </p>
          ) : invitations.length === 0 ? (
            <p className="muted">No invitations.</p>
          ) : (
            <ul className="shop-list">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="shop-row">
                  <div>
                    <span
                      className={`shop-status shop-status-${invitation.status}`}
                    >
                      {statusLabel[invitation.status]}
                    </span>
                    <p className="muted">
                      Expires {formatDateTime(invitation.expires_at)}
                    </p>
                  </div>
                  {invitation.status === 'pending' && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy !== null}
                      onClick={() => void cancel(invitation.id)}
                    >
                      Cancel invitation expiring{' '}
                      {formatDateTime(invitation.expires_at)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
