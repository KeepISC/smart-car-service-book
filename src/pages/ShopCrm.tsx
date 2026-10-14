import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { listRepairShops } from '../services/repairShops'
import type { RepairShop } from '../types/repairShop'
import { ShopCustomers } from '../components/ShopCustomers'

type State = 'loading' | 'ready' | 'denied' | 'error'

function errorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code: unknown }).code)
    : ''
}

// Staff roles come from the server's membership list; every customer RPC
// rechecks staff status, shop entitlement and owner approval independently.
export function ShopCrm() {
  const [state, setState] = useState<State>('loading')
  const [shops, setShops] = useState<RepairShop[]>([])
  const [shopId, setShopId] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    listRepairShops()
      .then((data) => {
        if (!alive) return
        setShops(data)
        setShopId((current) =>
          data.some((shop) => shop.id === current)
            ? current
            : (data[0]?.id ?? ''),
        )
        setState('ready')
      })
      .catch((error) => {
        if (alive) setState(errorCode(error) === '42501' ? 'denied' : 'error')
      })
    return () => {
      alive = false
    }
  }, [attempt])

  const shop = shops.find((candidate) => candidate.id === shopId)
  return (
    <section className="panel shop-crm" aria-labelledby="crm-heading">
      <h1 id="crm-heading">Repair shop customers</h1>
      {state === 'loading' && (
        <p role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
          Loading your shops…
        </p>
      )}
      {state === 'denied' && (
        <p className="service-feedback error" role="alert">
          Access denied. Repair shop access is not available for your account.
        </p>
      )}
      {state === 'error' && (
        <p className="service-feedback error" role="alert">
          Unable to load your shops.{' '}
          <button
            type="button"
            className="button secondary button-small"
            onClick={() => {
              setState('loading')
              setAttempt((value) => value + 1)
            }}
          >
            Try again
          </button>
        </p>
      )}
      {state === 'ready' && shops.length === 0 && (
        <p className="muted">
          You are not an active staff member of any repair shop.
        </p>
      )}
      {state === 'ready' && shop && (
        <>
          <div className="shop-request">
            <label htmlFor="crm-shop">Shop</label>
            <select
              id="crm-shop"
              value={shop.id}
              onChange={(event) => setShopId(event.target.value)}
            >
              {shops.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} ({candidate.role})
                </option>
              ))}
            </select>
          </div>
          {shop.role === 'admin' && (
            <p>
              <Link to="/shops">Invite a customer</Link>
            </p>
          )}
          <ShopCustomers key={shop.id} shop={shop} />
        </>
      )}
    </section>
  )
}
