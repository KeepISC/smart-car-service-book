import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { PlatformAdmin } from './PlatformAdmin'

const mocks = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  search: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  suspend: vi.fn(),
  subscribe: vi.fn(),
  setAdmin: vi.fn(),
  audit: vi.fn(),
  listAdmins: vi.fn(),
  findUsers: vi.fn(),
}))
vi.mock('../services/platformAdministration', () => ({
  isPlatformAdministrator: mocks.isAdmin,
  platformSearchRepairShops: mocks.search,
  platformCreateRepairShop: mocks.create,
  platformUpdateRepairShop: mocks.update,
  platformSetShopSuspension: mocks.suspend,
  platformSetShopSubscription: mocks.subscribe,
  platformSetShopAdministrator: mocks.setAdmin,
  platformListShopAudit: mocks.audit,
  platformListShopAdministrators: mocks.listAdmins,
  platformFindProvisionedUsers: mocks.findUsers,
}))

const shop = (overrides: object = {}) => ({
  id: 's1',
  name: 'Fictional Garage',
  created_at: '2026-01-01T00:00:00Z',
  suspended: false,
  plan_code: 'basic',
  subscription_status: 'active',
  subscription_starts_at: '2026-01-01T00:00:00Z',
  subscription_ends_at: '2030-01-01T00:00:00Z',
  max_active_staff: 5,
  max_connected_vehicles: null,
  max_monthly_records: 100,
  access_status: 'active',
  logo_reference: null,
  primary_color: '#112233',
  secondary_color: null,
  contact_email: 'shop@example.test',
  contact_phone: null,
  contact_address: null,
  contact_website: null,
  ...overrides,
})
const reason = () =>
  fireEvent.change(screen.getByLabelText(/^Reason/), {
    target: { value: 'Fictional audit reason' },
  })
async function openShop(name = 'Fictional Garage') {
  fireEvent.click(await screen.findByRole('button', { name: `Manage ${name}` }))
  await screen.findByRole('heading', { name: `Manage ${name}` })
}
function reasonIn(form: HTMLElement) {
  fireEvent.change(within(form).getByLabelText(/^Reason/), {
    target: { value: 'Fictional audit reason' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isAdmin.mockResolvedValue(true)
  mocks.search.mockResolvedValue({
    items: [
      shop(),
      shop({
        id: 's2',
        name: 'Suspended Motors',
        suspended: true,
        access_status: 'suspended',
        plan_code: 'pro',
      }),
    ],
    total: 2,
    offset: 0,
    limit: 25,
  })
  mocks.listAdmins.mockResolvedValue([
    { firebase_uid: 'admin-uid-1', enabled: true },
  ])
  mocks.findUsers.mockResolvedValue({
    items: [{ firebase_uid: 'candidate-uid-1' }],
    total: 1,
    offset: 0,
    limit: 20,
  })
  mocks.audit.mockResolvedValue([
    {
      id: 'a1',
      occurred_at: '2026-02-01T10:00:00Z',
      actor_id: 'u1',
      executor: 'platform_admin',
      shop_id: 's1',
      action: 'shop_suspended',
      reason: 'Fictional audit reason',
      before_state: { suspended: false },
      after_state: { suspended: true },
    },
  ])
  for (const fn of [
    mocks.create,
    mocks.update,
    mocks.suspend,
    mocks.subscribe,
    mocks.setAdmin,
  ])
    fn.mockResolvedValue(undefined)
})

it('denies non-administrators without requesting any shop data', async () => {
  mocks.isAdmin.mockResolvedValue(false)
  render(<PlatformAdmin />)
  await screen.findByText(/Access denied/)
  expect(mocks.search).not.toHaveBeenCalled()
})

it('shows denial when the server rejects a stale capability', async () => {
  mocks.search.mockRejectedValue({ code: '42501' })
  render(<PlatformAdmin />)
  await screen.findByText(/Access denied/)
})

it('retries a failed access check', async () => {
  mocks.isAdmin.mockRejectedValueOnce(new Error('network'))
  render(<PlatformAdmin />)
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  await screen.findByText('Fictional Garage')
})

it('lists shops with status and expiry, and filters by search and status', async () => {
  render(<PlatformAdmin />)
  await screen.findByText('Fictional Garage')
  expect(screen.getByText('Suspended Motors')).toBeTruthy()
  expect(screen.getAllByText(/Subscription expires/)).toHaveLength(2)
  expect(screen.getByText('2 repair shops found')).toBeTruthy()
  expect(screen.getByText('(2 total)')).toBeTruthy()

  mocks.search.mockResolvedValueOnce({
    items: [
      shop({
        id: 's2',
        name: 'Suspended Motors',
        suspended: true,
        access_status: 'suspended',
        plan_code: 'pro',
      }),
    ],
    total: 1,
    offset: 0,
    limit: 25,
  })
  fireEvent.change(screen.getByLabelText('Status'), {
    target: { value: 'suspended' },
  })
  await waitFor(() =>
    expect(mocks.search).toHaveBeenLastCalledWith('', 'suspended', 0, 25),
  )
  await screen.findByText('Suspended Motors')
  expect(screen.queryByText('Fictional Garage')).toBeNull()

  mocks.search.mockResolvedValueOnce({
    items: [],
    total: 0,
    offset: 0,
    limit: 25,
  })
  fireEvent.change(screen.getByLabelText(/^Search/), {
    target: { value: 'zzz' },
  })
  await waitFor(() =>
    expect(mocks.search).toHaveBeenLastCalledWith('zzz', 'suspended', 0, 25),
  )
  await screen.findByText('No shops match your filters.')
})

it('handles empty and failed lists', async () => {
  mocks.search.mockResolvedValueOnce({
    items: [],
    total: 0,
    offset: 0,
    limit: 25,
  })
  const { unmount } = render(<PlatformAdmin />)
  await screen.findByText('No repair shops have been created.')
  unmount()
  mocks.search.mockRejectedValueOnce(new Error('boom'))
  render(<PlatformAdmin />)
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  await screen.findByText('Fictional Garage')
})

it('paginates with server offsets', async () => {
  mocks.search.mockResolvedValueOnce({
    items: Array.from({ length: 25 }, (_, i) =>
      shop({ id: `p${i}`, name: `Shop ${i}` }),
    ),
    total: 30,
    offset: 0,
    limit: 25,
  })
  render(<PlatformAdmin />)
  await screen.findByText('Shop 0')
  expect(screen.getByText('30 repair shops found')).toBeTruthy()
  expect(screen.getByText('(30 total)')).toBeTruthy()
  expect(mocks.search).toHaveBeenLastCalledWith('', null, 0, 25)

  mocks.search.mockResolvedValueOnce({
    items: Array.from({ length: 5 }, (_, i) =>
      shop({ id: `p${25 + i}`, name: `Shop ${25 + i}` }),
    ),
    total: 30,
    offset: 25,
    limit: 25,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await screen.findByText('Page 2')
  expect(mocks.search).toHaveBeenLastCalledWith('', null, 25, 25)

  mocks.search.mockResolvedValueOnce({
    items: Array.from({ length: 25 }, (_, i) =>
      shop({ id: `p${i}`, name: `Shop ${i}` }),
    ),
    total: 30,
    offset: 0,
    limit: 25,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
  await screen.findByText('Page 1')
  expect(mocks.search).toHaveBeenLastCalledWith('', null, 0, 25)
})

it('creates a shop with an audit reason and reloads the list', async () => {
  render(<PlatformAdmin />)
  await screen.findByText('Fictional Garage')
  fireEvent.click(screen.getByRole('button', { name: 'New shop' }))
  fireEvent.change(screen.getByLabelText('Business name'), {
    target: { value: '  New Fictional Shop ' },
  })
  fireEvent.change(screen.getByLabelText(/^Primary color/), {
    target: { value: '#abcdef' },
  })
  reason()
  fireEvent.click(screen.getByRole('button', { name: 'Create shop' }))
  await screen.findByText('Shop created.')
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      business_name: '  New Fictional Shop ',
      primary_color: '#abcdef',
      logo_reference: null,
    }),
    'Fictional audit reason',
  )
  await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2))
})

it('edits a profile and rejects invalid colors before calling the server', async () => {
  render(<PlatformAdmin />)
  await openShop()
  const form = screen
    .getByRole('button', { name: 'Save profile' })
    .closest('form')!
  fireEvent.change(within(form).getByLabelText(/^Primary color/), {
    target: { value: 'red' },
  })
  reasonIn(form)
  fireEvent.click(within(form).getByRole('button', { name: 'Save profile' }))
  await screen.findByText('Colors must use #RRGGBB format.')
  expect(mocks.update).not.toHaveBeenCalled()
  fireEvent.change(within(form).getByLabelText(/^Primary color/), {
    target: { value: '#00ff00' },
  })
  fireEvent.change(within(form).getByLabelText('Contact phone'), {
    target: { value: '+000' },
  })
  fireEvent.click(within(form).getByRole('button', { name: 'Save profile' }))
  await screen.findByText('Profile saved.')
  expect(mocks.update).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({
      primary_color: '#00ff00',
      contact_phone: '+000',
    }),
    'Fictional audit reason',
  )
})

it('suspends and reactivates shops', async () => {
  render(<PlatformAdmin />)
  await openShop()
  let form = screen
    .getByRole('button', { name: 'Suspend shop' })
    .closest('form')!
  reasonIn(form)
  fireEvent.click(within(form).getByRole('button', { name: 'Suspend shop' }))
  await waitFor(() =>
    expect(mocks.suspend).toHaveBeenCalledWith(
      's1',
      true,
      'Fictional audit reason',
    ),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Manage Fictional Garage' }),
  )
  await openShop('Suspended Motors')
  form = screen
    .getByRole('button', { name: 'Reactivate shop' })
    .closest('form')!
  reasonIn(form)
  fireEvent.click(within(form).getByRole('button', { name: 'Reactivate shop' }))
  await waitFor(() =>
    expect(mocks.suspend).toHaveBeenLastCalledWith(
      's2',
      false,
      'Fictional audit reason',
    ),
  )
})

it('saves subscription dates, status and limits (blank means unlimited)', async () => {
  render(<PlatformAdmin />)
  await openShop()
  fireEvent.change(screen.getByLabelText('Plan code'), {
    target: { value: 'pro' },
  })
  fireEvent.change(screen.getByLabelText('Starts'), {
    target: { value: '2026-03-01T09:00' },
  })
  fireEvent.change(screen.getByLabelText('Ends'), {
    target: { value: '2027-03-01T09:00' },
  })
  fireEvent.change(screen.getByLabelText('Maximum active staff'), {
    target: { value: '' },
  })
  fireEvent.change(screen.getByLabelText('Maximum connected vehicles'), {
    target: { value: '0' },
  })
  const form = screen
    .getByRole('button', { name: 'Save subscription' })
    .closest('form')!
  reasonIn(form)
  fireEvent.click(
    within(form).getByRole('button', { name: 'Save subscription' }),
  )
  await screen.findByText('Subscription saved.')
  const [id, input, why] = mocks.subscribe.mock.calls[0]
  expect(id).toBe('s1')
  expect(why).toBe('Fictional audit reason')
  expect(input).toMatchObject({
    plan_code: 'pro',
    status: 'active',
    limits: {
      max_active_staff: null,
      max_connected_vehicles: 0,
      max_monthly_records: 100,
    },
  })
  expect(input.starts_at).toBe(new Date('2026-03-01T09:00').toISOString())
  expect(input.ends_at).toBe(new Date('2027-03-01T09:00').toISOString())
})

it('assigns and revokes shop administrators without echoing server errors', async () => {
  render(<PlatformAdmin />)
  await openShop()
  fireEvent.change(screen.getByLabelText(/Firebase UID/), {
    target: { value: ' fictional-uid ' },
  })
  const form = screen
    .getByRole('button', { name: 'Assign administrator' })
    .closest('form')!
  reasonIn(form)
  fireEvent.click(
    within(form).getByRole('button', { name: 'Assign administrator' }),
  )
  await screen.findByText('Administrator assigned.')
  expect(mocks.setAdmin).toHaveBeenCalledWith(
    's1',
    'fictional-uid',
    true,
    'Fictional audit reason',
  )
  mocks.setAdmin.mockRejectedValue({
    code: 'P0001',
    message: 'secret internal detail',
  })
  fireEvent.change(screen.getByLabelText(/Firebase UID/), {
    target: { value: 'other-uid' },
  })
  fireEvent.click(screen.getByLabelText('Revoke shop administrator'))
  reasonIn(form)
  fireEvent.click(
    within(form).getByRole('button', { name: 'Revoke administrator' }),
  )
  await screen.findByText(/Unable to complete that action/)
  expect(screen.queryByText(/secret internal detail/)).toBeNull()
})

it('shows audit history and refreshes it after a change', async () => {
  render(<PlatformAdmin />)
  await openShop()
  await screen.findByText('shop suspended')
  expect(mocks.audit).toHaveBeenCalledWith('s1', 0, 20)
  const before = mocks.audit.mock.calls.length
  const form = screen
    .getByRole('button', { name: 'Suspend shop' })
    .closest('form')!
  reasonIn(form)
  fireEvent.click(within(form).getByRole('button', { name: 'Suspend shop' }))
  await waitFor(() =>
    expect(mocks.audit.mock.calls.length).toBeGreaterThan(before),
  )
})

it('reports audit failures and permission denial during a mutation', async () => {
  mocks.audit.mockRejectedValueOnce(new Error('network'))
  render(<PlatformAdmin />)
  await openShop()
  await screen.findByText('Unable to load administrative history.')
  mocks.suspend.mockRejectedValue({ code: '42501' })
  const form = screen
    .getByRole('button', { name: 'Suspend shop' })
    .closest('form')!
  reasonIn(form)
  fireEvent.click(within(form).getByRole('button', { name: 'Suspend shop' }))
  await screen.findByText(/Access denied/)
})

it('displays current shop administrators with active status and handles empty state', async () => {
  mocks.listAdmins.mockResolvedValueOnce([
    { firebase_uid: 'admin-alpha', enabled: true },
    { firebase_uid: 'admin-beta', enabled: false },
  ])
  render(<PlatformAdmin />)
  await openShop()
  await screen.findByText('admin-alpha')
  expect(mocks.listAdmins).toHaveBeenCalledWith('s1')
  expect(screen.getByText('Active user')).toBeTruthy()
  expect(screen.getByText('Provisioning disabled')).toBeTruthy()
  expect(
    screen.getByRole('button', { name: 'Revoke admin-alpha' }),
  ).toBeTruthy()
})

it('handles empty shop administrator list and retry on error', async () => {
  mocks.listAdmins.mockResolvedValueOnce([])
  render(<PlatformAdmin />)
  await openShop()
  await screen.findByText(
    'No administrators are currently assigned to this shop.',
  )

  mocks.listAdmins.mockRejectedValueOnce(new Error('fail'))
  fireEvent.click(
    screen.getByRole('button', { name: 'Manage Fictional Garage' }),
  )
  await openShop()
  await screen.findByText('Unable to load shop administrators.')
  mocks.listAdmins.mockResolvedValueOnce([
    { firebase_uid: 'admin-alpha', enabled: true },
  ])
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('admin-alpha')
})

it('looks up candidate administrators by UID and validates minimum search length', async () => {
  render(<PlatformAdmin />)
  await openShop()

  // Too short (< 3 characters)
  fireEvent.change(screen.getByLabelText(/Search provisioned users by UID/), {
    target: { value: 'ab' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Find UID' }))
  await screen.findByText('Enter at least 3 characters to search.')
  expect(mocks.findUsers).not.toHaveBeenCalled()

  // Valid search
  mocks.findUsers.mockResolvedValueOnce({
    items: [{ firebase_uid: 'cand-uid-123' }],
    total: 1,
    offset: 0,
    limit: 20,
  })
  fireEvent.change(screen.getByLabelText(/Search provisioned users by UID/), {
    target: { value: 'cand-uid' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Find UID' }))
  await screen.findByText(/1 candidate user found:/)
  expect(screen.getByText('cand-uid-123')).toBeTruthy()
  expect(mocks.findUsers).toHaveBeenCalledWith('cand-uid')
})

it('selects candidate administrator from lookup into assignment form and submits', async () => {
  render(<PlatformAdmin />)
  await openShop()

  mocks.findUsers.mockResolvedValueOnce({
    items: [{ firebase_uid: 'cand-uid-123' }],
    total: 1,
    offset: 0,
    limit: 20,
  })
  fireEvent.change(screen.getByLabelText(/Search provisioned users by UID/), {
    target: { value: 'cand-uid' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Find UID' }))
  await screen.findByText('cand-uid-123')

  fireEvent.click(screen.getByRole('button', { name: 'Select cand-uid-123' }))
  expect(screen.getByLabelText(/Firebase UID/)).toHaveProperty(
    'value',
    'cand-uid-123',
  )
  expect(screen.getByLabelText('Assign as shop administrator')).toHaveProperty(
    'checked',
    true,
  )

  const form = screen
    .getByRole('button', { name: 'Assign administrator' })
    .closest('form')!
  reasonIn(form)
  fireEvent.click(
    within(form).getByRole('button', { name: 'Assign administrator' }),
  )
  await screen.findByText('Administrator assigned.')
  expect(mocks.setAdmin).toHaveBeenCalledWith(
    's1',
    'cand-uid-123',
    true,
    'Fictional audit reason',
  )
})

it('selects current administrator to revoke into form and submits', async () => {
  mocks.listAdmins.mockResolvedValue([
    { firebase_uid: 'current-admin-456', enabled: true },
  ])
  render(<PlatformAdmin />)
  await openShop()
  await screen.findByText('current-admin-456')

  fireEvent.click(
    screen.getByRole('button', { name: 'Revoke current-admin-456' }),
  )
  expect(screen.getByLabelText(/Firebase UID/)).toHaveProperty(
    'value',
    'current-admin-456',
  )
  expect(screen.getByLabelText('Revoke shop administrator')).toHaveProperty(
    'checked',
    true,
  )

  const form = screen
    .getByRole('button', { name: 'Revoke administrator' })
    .closest('form')!
  reasonIn(form)
  fireEvent.click(
    within(form).getByRole('button', { name: 'Revoke administrator' }),
  )
  await screen.findByText('Administrator revoked.')
  expect(mocks.setAdmin).toHaveBeenCalledWith(
    's1',
    'current-admin-456',
    false,
    'Fictional audit reason',
  )
})

it('handles candidate lookup empty results, failures and permission denial', async () => {
  render(<PlatformAdmin />)
  await openShop()

  // Empty results
  mocks.findUsers.mockResolvedValueOnce({
    items: [],
    total: 0,
    offset: 0,
    limit: 20,
  })
  fireEvent.change(screen.getByLabelText(/Search provisioned users by UID/), {
    target: { value: 'nomatch' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Find UID' }))
  await screen.findByText('No provisioned users match your search.')

  // Server error
  mocks.findUsers.mockRejectedValueOnce(new Error('lookup failed'))
  fireEvent.click(screen.getByRole('button', { name: 'Find UID' }))
  await screen.findByText('lookup failed')

  // Permission denied (42501)
  mocks.findUsers.mockRejectedValueOnce({ code: '42501' })
  fireEvent.click(screen.getByRole('button', { name: 'Find UID' }))
  await screen.findByText(/Access denied/)
})
