import { useId, useState } from 'react'
import type {
  PlatformRepairShop,
  ShopBrandingInput,
  ShopSubscriptionInput,
} from '../types/platformAdministration'
import {
  describeError,
  fromLocalInput,
  toLocalInput,
} from './platformFormUtils'

const hex = /^#[0-9a-fA-F]{6}$/

// Every platform mutation needs an audit reason; the server re-validates it.
function ReasonField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <>
      <label htmlFor={id}>Reason (recorded in the audit log)</label>
      <textarea
        id={id}
        value={value}
        maxLength={1000}
        required
        rows={2}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  )
}

function useSubmit(action: () => Promise<unknown>, done: string) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
      setMessage(done)
    } catch (failure) {
      setError(describeError(failure))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, message, submit }
}

function Feedback({ error, message }: { error: string; message: string }) {
  return (
    <>
      {error && (
        <p className="service-feedback error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="service-feedback" role="status">
          {message}
        </p>
      )}
    </>
  )
}

const blank = (value: string) => (value.trim() ? value.trim() : null)

type ProfileProps = {
  shop?: PlatformRepairShop
  submitLabel: string
  onSubmit: (profile: ShopBrandingInput, reason: string) => Promise<unknown>
  idPrefix: string
}

export function ProfileForm({
  shop,
  submitLabel,
  onSubmit,
  idPrefix,
}: ProfileProps) {
  const [name, setName] = useState(shop?.name ?? '')
  const [logo, setLogo] = useState(shop?.logo_reference ?? '')
  const [primary, setPrimary] = useState(shop?.primary_color ?? '')
  const [secondary, setSecondary] = useState(shop?.secondary_color ?? '')
  const [email, setEmail] = useState(shop?.contact_email ?? '')
  const [phone, setPhone] = useState(shop?.contact_phone ?? '')
  const [address, setAddress] = useState(shop?.contact_address ?? '')
  const [website, setWebsite] = useState(shop?.contact_website ?? '')
  const [reason, setReason] = useState('')
  const colorsValid =
    (!primary || hex.test(primary)) && (!secondary || hex.test(secondary))
  const { busy, error, message, submit } = useSubmit(
    async () => {
      if (!colorsValid) throw new Error('Colors must use #RRGGBB format.')
      await onSubmit(
        {
          business_name: name,
          logo_reference: blank(logo),
          primary_color: blank(primary),
          secondary_color: blank(secondary),
          contact_email: blank(email),
          contact_phone: blank(phone),
          contact_address: blank(address),
          contact_website: blank(website),
        },
        reason,
      )
      if (!shop) {
        setName('')
        setReason('')
      }
    },
    shop ? 'Profile saved.' : 'Shop created.',
  )
  const field = (
    key: string,
    label: string,
    value: string,
    set: (value: string) => void,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <>
      <label htmlFor={`${idPrefix}-${key}`}>{label}</label>
      <input
        id={`${idPrefix}-${key}`}
        value={value}
        onChange={(event) => set(event.target.value)}
        autoComplete="off"
        {...extra}
      />
    </>
  )
  return (
    <form className="shop-request" onSubmit={submit}>
      {field('name', 'Business name', name, setName, {
        required: true,
        maxLength: 120,
      })}
      {field('logo', 'Logo reference (asset identifier)', logo, setLogo)}
      {field('primary', 'Primary color (#RRGGBB)', primary, setPrimary, {
        placeholder: '#1d4ed8',
        'aria-invalid': Boolean(primary) && !hex.test(primary),
      })}
      {field(
        'secondary',
        'Secondary color (#RRGGBB)',
        secondary,
        setSecondary,
        {
          placeholder: '#0f172a',
          'aria-invalid': Boolean(secondary) && !hex.test(secondary),
        },
      )}
      {field('email', 'Contact email', email, setEmail, { type: 'email' })}
      {field('phone', 'Contact phone', phone, setPhone, { type: 'tel' })}
      {field('address', 'Contact address', address, setAddress)}
      {field('website', 'Website (https)', website, setWebsite, {
        type: 'url',
        placeholder: 'https://',
      })}
      <ReasonField value={reason} onChange={setReason} />
      <Feedback error={error} message={message} />
      <button type="submit" className="button" disabled={busy}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

export function SubscriptionForm({
  shop,
  onSubmit,
}: {
  shop: PlatformRepairShop
  onSubmit: (
    subscription: ShopSubscriptionInput,
    reason: string,
  ) => Promise<unknown>
}) {
  const [plan, setPlan] = useState(shop.plan_code)
  const [status, setStatus] = useState<ShopSubscriptionInput['status']>(
    shop.subscription_status,
  )
  const [start, setStart] = useState(toLocalInput(shop.subscription_starts_at))
  const [end, setEnd] = useState(toLocalInput(shop.subscription_ends_at))
  const [staff, setStaff] = useState(limitText(shop.max_active_staff))
  const [vehicles, setVehicles] = useState(
    limitText(shop.max_connected_vehicles),
  )
  const [records, setRecords] = useState(limitText(shop.max_monthly_records))
  const [reason, setReason] = useState('')
  const { busy, error, message, submit } = useSubmit(
    () =>
      onSubmit(
        {
          plan_code: plan.trim(),
          status,
          starts_at: fromLocalInput(start),
          ends_at: fromLocalInput(end),
          limits: {
            max_active_staff: parseLimit(staff),
            max_connected_vehicles: parseLimit(vehicles),
            max_monthly_records: parseLimit(records),
          },
        },
        reason,
      ),
    'Subscription saved.',
  )
  const number = (
    id: string,
    label: string,
    value: string,
    set: (value: string) => void,
  ) => (
    <>
      <label htmlFor={`sub-${id}`}>{label}</label>
      <input
        id={`sub-${id}`}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        placeholder="Unlimited"
        value={value}
        onChange={(event) => set(event.target.value)}
      />
    </>
  )
  return (
    <form className="shop-request" onSubmit={submit}>
      <label htmlFor="sub-plan">Plan code</label>
      <input
        id="sub-plan"
        value={plan}
        onChange={(event) => setPlan(event.target.value)}
        autoComplete="off"
        required
      />
      <label htmlFor="sub-status">Subscription status</label>
      <select
        id="sub-status"
        value={status}
        onChange={(event) =>
          setStatus(event.target.value as ShopSubscriptionInput['status'])
        }
      >
        <option value="pending">Pending</option>
        <option value="active">Active</option>
        <option value="disabled">Disabled</option>
      </select>
      <label htmlFor="sub-start">Starts</label>
      <input
        id="sub-start"
        type="datetime-local"
        value={start}
        onChange={(event) => setStart(event.target.value)}
      />
      <label htmlFor="sub-end">Ends</label>
      <input
        id="sub-end"
        type="datetime-local"
        value={end}
        onChange={(event) => setEnd(event.target.value)}
      />
      {number('staff', 'Maximum active staff', staff, setStaff)}
      {number('vehicles', 'Maximum connected vehicles', vehicles, setVehicles)}
      {number('records', 'Maximum records per month', records, setRecords)}
      <p className="muted">
        Leave a limit empty for unlimited; 0 blocks new allocation.
      </p>
      <ReasonField value={reason} onChange={setReason} />
      <Feedback error={error} message={message} />
      <button type="submit" className="button" disabled={busy}>
        {busy ? 'Saving…' : 'Save subscription'}
      </button>
    </form>
  )
}

function limitText(value: number | null) {
  return value === null ? '' : String(value)
}
function parseLimit(value: string) {
  return value.trim() === '' ? null : Number(value)
}

export function SuspensionForm({
  shop,
  onSubmit,
}: {
  shop: PlatformRepairShop
  onSubmit: (suspended: boolean, reason: string) => Promise<unknown>
}) {
  const [reason, setReason] = useState('')
  const next = !shop.suspended
  const { busy, error, message, submit } = useSubmit(
    async () => {
      await onSubmit(next, reason)
      setReason('')
    },
    next ? 'Shop suspended.' : 'Shop reactivated.',
  )
  return (
    <form className="shop-request" onSubmit={submit}>
      <p className="muted">
        {shop.suspended
          ? 'This shop is suspended. Reactivating does not extend an expired subscription.'
          : 'Suspending immediately blocks shop access, independent of the subscription.'}
      </p>
      <ReasonField value={reason} onChange={setReason} />
      <Feedback error={error} message={message} />
      <button type="submit" className="button" disabled={busy}>
        {shop.suspended ? 'Reactivate shop' : 'Suspend shop'}
      </button>
    </form>
  )
}

export function AdministratorForm({
  onSubmit,
  initialUid = '',
  initialEnabled = true,
}: {
  onSubmit: (uid: string, enabled: boolean, reason: string) => Promise<unknown>
  initialUid?: string
  initialEnabled?: boolean
}) {
  const [uid, setUid] = useState(initialUid)
  const [reason, setReason] = useState('')
  const [enabled, setEnabled] = useState(initialEnabled)
  const { busy, error, message, submit } = useSubmit(
    async () => {
      await onSubmit(uid.trim(), enabled, reason)
      setUid('')
      setReason('')
    },
    enabled ? 'Administrator assigned.' : 'Administrator revoked.',
  )
  return (
    <form className="shop-request" onSubmit={submit}>
      <label htmlFor="admin-uid">Firebase UID of an existing user</label>
      <input
        id="admin-uid"
        value={uid}
        onChange={(event) => setUid(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        maxLength={128}
        required
      />
      <fieldset className="shop-vehicles">
        <legend>Action</legend>
        <label className="transfer-private">
          <input
            type="radio"
            name="admin-action"
            checked={enabled}
            onChange={() => setEnabled(true)}
          />
          Assign as shop administrator
        </label>
        <label className="transfer-private">
          <input
            type="radio"
            name="admin-action"
            checked={!enabled}
            onChange={() => setEnabled(false)}
          />
          Revoke shop administrator
        </label>
      </fieldset>
      <ReasonField value={reason} onChange={setReason} />
      <Feedback error={error} message={message} />
      <button type="submit" className="button" disabled={busy}>
        {enabled ? 'Assign administrator' : 'Revoke administrator'}
      </button>
    </form>
  )
}
