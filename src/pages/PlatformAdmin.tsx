import { useCallback, useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import {
  isPlatformAdministrator,
  platformCreateRepairShop,
  platformFindProvisionedUsers,
  platformListShopAdministrators,
  platformSearchRepairShops,
  platformSetShopAdministrator,
  platformSetShopSubscription,
  platformSetShopSuspension,
  platformUpdateRepairShop,
} from '../services/platformAdministration'
import type {
  PlatformRepairShop,
  PlatformShopAdministrator,
  ProvisionedAdministratorCandidate,
} from '../types/platformAdministration'
import {
  AdministratorForm,
  ProfileForm,
  SubscriptionForm,
  SuspensionForm,
} from '../components/PlatformShopForms'
import { PlatformShopAudit } from '../components/PlatformShopAudit'
import {
  accessLabels,
  describeError,
  errorCode,
  formatDateTime,
} from '../components/platformFormUtils'

type Gate = 'checking' | 'denied' | 'error' | 'ready'
const size = 25

// The capability check only decides what to render. The server authorizes
// every RPC again, and this page never receives customer vehicle or history data.
export function PlatformAdmin() {
  const [gate, setGate] = useState<Gate>('checking')
  const [gateAttempt, setGateAttempt] = useState(0)
  const denied = useCallback(() => setGate('denied'), [])
  useEffect(() => {
    let alive = true
    isPlatformAdministrator()
      .then((result) => {
        if (alive) setGate(result ? 'ready' : 'denied')
      })
      .catch((error) => {
        if (alive) setGate(errorCode(error) === '42501' ? 'denied' : 'error')
      })
    return () => {
      alive = false
    }
  }, [gateAttempt])

  return (
    <section
      className="panel platform-admin"
      aria-labelledby="platform-heading"
    >
      <h1 id="platform-heading">Platform administration</h1>
      {gate === 'checking' && (
        <p role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
          Checking access…
        </p>
      )}
      {gate === 'denied' && (
        <p className="service-feedback error" role="alert">
          Access denied. This area is only available to platform administrators.
        </p>
      )}
      {gate === 'error' && (
        <p className="service-feedback error" role="alert">
          Unable to verify your access.{' '}
          <button
            type="button"
            className="button secondary button-small"
            onClick={() => {
              setGate('checking')
              setGateAttempt((value) => value + 1)
            }}
          >
            Try again
          </button>
        </p>
      )}
      {gate === 'ready' && <Dashboard onDenied={denied} />}
    </section>
  )
}

function Dashboard({ onDenied }: { onDenied: () => void }) {
  const [shops, setShops] = useState<PlatformRepairShop[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [auditKey, setAuditKey] = useState(0)

  useEffect(() => {
    let alive = true
    const activeStatus =
      status === 'all' ? null : (status as PlatformRepairShop['access_status'])
    platformSearchRepairShops(search, activeStatus, offset, size)
      .then((data) => {
        if (!alive) return
        setShops(data.items)
        setTotal(data.total)
        setError('')
      })
      .catch((failure) => {
        if (!alive) return
        if (errorCode(failure) === '42501') onDenied()
        else setError('Unable to load repair shops.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [search, status, offset, attempt, onDenied])

  const refresh = useCallback(() => {
    setAttempt((value) => value + 1)
    setAuditKey((value) => value + 1)
  }, [])
  // A successful change reloads the list and audit trail from the server.
  const mutate = useCallback(
    async <T,>(action: () => Promise<T>) => {
      try {
        return await action()
      } catch (failure) {
        if (errorCode(failure) === '42501') onDenied()
        throw failure
      } finally {
        refresh()
      }
    },
    [onDenied, refresh],
  )

  const selected = shops.find((shop) => shop.id === selectedId) ?? null

  return (
    <>
      <div className="shop-actions">
        <button
          type="button"
          className="button"
          aria-expanded={creating}
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? 'Close new shop form' : 'New shop'}
        </button>
      </div>
      {creating && (
        <section aria-labelledby="new-shop-heading">
          <h2 id="new-shop-heading">Create shop</h2>
          <ProfileForm
            idPrefix="new"
            submitLabel="Create shop"
            onSubmit={(profile, reason) =>
              mutate(() => platformCreateRepairShop(profile, reason))
            }
          />
        </section>
      )}
      <h2>Repair shops</h2>
      <div className="shop-request">
        <label htmlFor="shop-search">Search shops by name, plan or ID</label>
        <input
          id="shop-search"
          type="search"
          maxLength={128}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setOffset(0)
            setLoading(true)
          }}
        />
        <label htmlFor="shop-status">Status</label>
        <select
          id="shop-status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value)
            setOffset(0)
            setLoading(true)
          }}
        >
          <option value="all">All statuses</option>
          {Object.entries(accessLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
          Loading shops…
        </p>
      ) : error ? (
        <p className="service-feedback error" role="alert">
          {error}{' '}
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
          {search.trim() || status !== 'all'
            ? 'No shops match your filters.'
            : offset
              ? 'No further shops.'
              : 'No repair shops have been created.'}
        </p>
      ) : (
        <>
          <p className="muted">
            {total} {total === 1 ? 'repair shop' : 'repair shops'} found
          </p>
          <ul className="shop-list">
            {shops.map((shop) => (
              <li key={shop.id} className="shop-row">
                <div>
                  <strong>{shop.name}</strong>{' '}
                  <span
                    className={`shop-status shop-status-${shop.access_status}`}
                  >
                    {accessLabels[shop.access_status]}
                  </span>
                  <p className="muted">
                    Plan {shop.plan_code} · Subscription expires{' '}
                    {formatDateTime(shop.subscription_ends_at)}
                  </p>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  aria-pressed={selectedId === shop.id}
                  onClick={() =>
                    setSelectedId(selectedId === shop.id ? null : shop.id)
                  }
                >
                  Manage {shop.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="shop-actions">
        <button
          type="button"
          className="button secondary button-small"
          disabled={offset === 0 || loading}
          onClick={() => {
            setLoading(true)
            setOffset((value) => Math.max(0, value - size))
          }}
        >
          Previous page
        </button>
        <span className="muted">Page {offset / size + 1}</span>
        <span className="muted">({total} total)</span>
        <button
          type="button"
          className="button secondary button-small"
          disabled={offset + size >= total || loading}
          onClick={() => {
            setLoading(true)
            setOffset((value) => value + size)
          }}
        >
          Next page
        </button>
      </div>
      {selected && (
        <section
          key={selected.id}
          className="platform-shop"
          aria-labelledby="manage-heading"
        >
          <h2 id="manage-heading">Manage {selected.name}</h2>
          <h3>Profile</h3>
          <ProfileForm
            idPrefix="edit"
            shop={selected}
            submitLabel="Save profile"
            onSubmit={(profile, reason) =>
              mutate(() =>
                platformUpdateRepairShop(selected.id, profile, reason),
              )
            }
          />
          <h3>Access</h3>
          <SuspensionForm
            shop={selected}
            onSubmit={(suspended, reason) =>
              mutate(() =>
                platformSetShopSuspension(selected.id, suspended, reason),
              )
            }
          />
          <h3>Subscription</h3>
          <SubscriptionForm
            shop={selected}
            onSubmit={(subscription, reason) =>
              mutate(() =>
                platformSetShopSubscription(selected.id, subscription, reason),
              )
            }
          />
          <ShopAdministrators
            shopId={selected.id}
            refreshKey={auditKey}
            onDenied={onDenied}
            onMutate={mutate}
          />
          <PlatformShopAudit shopId={selected.id} refreshKey={auditKey} />
        </section>
      )}
    </>
  )
}

function ShopAdministrators({
  shopId,
  refreshKey,
  onDenied,
  onMutate,
}: {
  shopId: string
  refreshKey: number
  onDenied: () => void
  onMutate: <T>(action: () => Promise<T>) => Promise<T>
}) {
  const [admins, setAdmins] = useState<PlatformShopAdministrator[]>([])
  const [loadingAdmins, setLoadingAdmins] = useState(true)
  const [adminError, setAdminError] = useState('')
  const [adminAttempt, setAdminAttempt] = useState(0)

  const [lookupQuery, setLookupQuery] = useState('')
  const [lookupCandidates, setLookupCandidates] = useState<
    ProvisionedAdministratorCandidate[]
  >([])
  const [lookupTotal, setLookupTotal] = useState(0)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [lookupSearched, setLookupSearched] = useState(false)

  const [selectedUid, setSelectedUid] = useState('')
  const [selectedEnabled, setSelectedEnabled] = useState(true)
  const [formKey, setFormKey] = useState(0)

  useEffect(() => {
    let alive = true
    platformListShopAdministrators(shopId)
      .then((data) => {
        if (!alive) return
        setAdmins(data)
        setAdminError('')
      })
      .catch((failure) => {
        if (!alive) return
        if (errorCode(failure) === '42501') onDenied()
        else setAdminError('Unable to load shop administrators.')
      })
      .finally(() => {
        if (alive) setLoadingAdmins(false)
      })
    return () => {
      alive = false
    }
  }, [shopId, adminAttempt, refreshKey, onDenied])

  async function handleLookup(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = lookupQuery.trim()
    if (trimmed.length < 3) {
      setLookupError('Enter at least 3 characters to search.')
      return
    }
    setLookupLoading(true)
    setLookupError('')
    setLookupSearched(true)
    try {
      const page = await platformFindProvisionedUsers(trimmed)
      setLookupCandidates(page.items)
      setLookupTotal(page.total)
    } catch (failure) {
      if (errorCode(failure) === '42501') onDenied()
      else setLookupError(describeError(failure))
    } finally {
      setLookupLoading(false)
    }
  }

  return (
    <section aria-labelledby="shop-admins-heading">
      <h3 id="shop-admins-heading">Shop administrators</h3>
      <p className="muted">
        Administrators are recognized Firebase identities assigned to manage
        this repair shop.
      </p>
      <h4>Current administrators</h4>
      {loadingAdmins ? (
        <p role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
          Loading administrators…
        </p>
      ) : adminError ? (
        <p className="service-feedback error" role="alert">
          {adminError}{' '}
          <button
            type="button"
            className="button secondary button-small"
            onClick={() => {
              setLoadingAdmins(true)
              setAdminAttempt((v) => v + 1)
            }}
          >
            Try again
          </button>
        </p>
      ) : admins.length === 0 ? (
        <p className="muted">
          No administrators are currently assigned to this shop.
        </p>
      ) : (
        <ul className="shop-list" aria-label="Current shop administrators">
          {admins.map((admin) => (
            <li key={admin.firebase_uid} className="shop-row">
              <div>
                <strong>{admin.firebase_uid}</strong>{' '}
                <span
                  className={`shop-status shop-status-${admin.enabled ? 'active' : 'disabled'}`}
                >
                  {admin.enabled ? 'Active user' : 'Provisioning disabled'}
                </span>
              </div>
              <button
                type="button"
                className="button secondary button-small"
                aria-label={`Revoke ${admin.firebase_uid}`}
                onClick={() => {
                  setSelectedUid(admin.firebase_uid)
                  setSelectedEnabled(false)
                  setFormKey((k) => k + 1)
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <h4>Look up candidate administrator</h4>
      <form className="shop-request" onSubmit={handleLookup}>
        <label htmlFor="lookup-uid">Search provisioned users by UID</label>
        <div className="shop-actions">
          <input
            id="lookup-uid"
            type="search"
            maxLength={128}
            placeholder="Enter at least 3 characters"
            value={lookupQuery}
            onChange={(event) => setLookupQuery(event.target.value)}
          />
          <button
            type="submit"
            className="button secondary button-small"
            disabled={lookupLoading}
          >
            {lookupLoading ? 'Searching…' : 'Find UID'}
          </button>
        </div>
        {lookupError && (
          <p className="service-feedback error" role="alert">
            {lookupError}
          </p>
        )}
      </form>
      {lookupLoading && (
        <p role="status">
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />{' '}
          Searching users…
        </p>
      )}
      {!lookupLoading &&
        lookupSearched &&
        lookupCandidates.length === 0 &&
        !lookupError && (
          <p className="muted">No provisioned users match your search.</p>
        )}
      {!lookupLoading && lookupCandidates.length > 0 && (
        <div>
          <p className="muted">
            {lookupTotal} candidate {lookupTotal === 1 ? 'user' : 'users'}{' '}
            found:
          </p>
          <ul className="shop-list" aria-label="Candidate users">
            {lookupCandidates.map((candidate) => (
              <li key={candidate.firebase_uid} className="shop-row">
                <div>
                  <strong>{candidate.firebase_uid}</strong>
                </div>
                <button
                  type="button"
                  className="button secondary button-small"
                  aria-label={`Select ${candidate.firebase_uid}`}
                  onClick={() => {
                    setSelectedUid(candidate.firebase_uid)
                    setSelectedEnabled(true)
                    setFormKey((k) => k + 1)
                  }}
                >
                  Select for assignment
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h4>Assign or revoke administrator</h4>
      <AdministratorForm
        key={formKey}
        initialUid={selectedUid}
        initialEnabled={selectedEnabled}
        onSubmit={async (uid, enabled, reason) => {
          await onMutate(() =>
            platformSetShopAdministrator(shopId, uid, enabled, reason),
          )
          setSelectedUid('')
          setAdminAttempt((v) => v + 1)
        }}
      />
    </section>
  )
}
