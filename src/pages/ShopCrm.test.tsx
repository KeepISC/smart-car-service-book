import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ShopCrm } from './ShopCrm'
import { summarizeShopVehicle } from '../components/shopVehicleSummary'
import type { ShopVehicle } from '../types/repairShop'
import { notifyMaintenanceChange } from '../services/maintenanceChanges'

const mocks = vi.hoisted(() => ({
  shops: vi.fn(),
  list: vi.fn(),
  vehicle: vi.fn(),
  resolve: vi.fn(),
  create: vi.fn(),
  enabled: true,
  sendReminder: vi.fn(),
  review: vi.fn(),
}))
vi.mock('../services/shopReminders', () => ({
  sendShopMaintenanceReminder: mocks.sendReminder,
}))
vi.mock('../config/features', () => ({
  isServiceHistoryEnabled: () => mocks.enabled,
}))
vi.mock('../services/repairShops', () => ({
  listRepairShops: mocks.shops,
  listRepairShopAuthorizations: mocks.list,
  getRepairShopVehicle: mocks.vehicle,
  resolveVehicleShopRequest: mocks.resolve,
  createRepairShopServiceVisit: mocks.create,
  reviewOwnerShopRequest: mocks.review,
}))

const auth = (id: string, vehicle: string, overrides: object = {}) => ({
  id,
  shop_id: 's1',
  shop_name: 'Fictional Garage',
  vehicle_id: vehicle,
  ownership_epoch: 1,
  initiated_by: 'owner',
  status: 'approved',
  expires_at: null,
  can_create_records: false,
  ...overrides,
})
const shopVehicle = (
  id: string,
  make: string,
  mileage: number,
  intervalKm: number,
  lastKm: number,
  lastDate = '2026-01-10',
): ShopVehicle => ({
  vehicle: {
    id,
    type: 'car',
    make,
    model: 'Audit',
    year: 2020,
    engine: '2.0',
    mileage,
  },
  maintenance_schedules: [
    {
      id: `m-${id}`,
      interval_km: intervalKm,
      interval_months: null,
      enabled: true,
      history_status: 'known',
      last_completed_date: lastDate,
      last_completed_mileage: lastKm,
    },
  ],
  maintenance_records: [
    {
      id: `r-${id}`,
      service_date: lastDate,
      mileage: lastKm,
      operations: [
        {
          maintenance_item_id: `m-${id}`,
          next_interval_km: null,
          next_interval_months: null,
        },
      ],
    },
  ],
})
const vehicles: Record<string, ShopVehicle> = {
  v1: shopVehicle('v1', 'Alpha', 50000, 10000, 45000),
  v2: shopVehicle('v2', 'Bravo', 58000, 10000, 49000),
  v3: shopVehicle('v3', 'Charlie', 42000, 10000, 40000),
}
const renderPage = () =>
  render(
    <MemoryRouter>
      <ShopCrm />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled = true
  mocks.sendReminder.mockReset()
  mocks.sendReminder.mockResolvedValue('reminder')
  mocks.create.mockReset()
  mocks.create.mockResolvedValue('new-workshop-record')
  mocks.shops.mockResolvedValue([
    { id: 's1', name: 'Fictional Garage', role: 'admin' },
  ])
  mocks.list.mockResolvedValue([
    auth('aaaaaaaa-1', 'v1'),
    auth('bbbbbbbb-2', 'v2', { can_create_records: true }),
    auth('cccccccc-3', 'v3'),
  ])
  mocks.vehicle.mockImplementation((_shop: string, id: string) =>
    Promise.resolve(vehicles[id]),
  )
  mocks.resolve.mockResolvedValue(undefined)
  mocks.review.mockResolvedValue(undefined)
})

it('shows only authorized vehicles with reference, mileage, status and last service', async () => {
  renderPage()
  await screen.findByText('2020 Alpha Audit')
  expect(screen.getByText('2020 Bravo Audit')).toBeTruthy()
  expect(screen.getByText(/50,000 km/)).toBeTruthy()
  expect(screen.getAllByText(/Last service 2026-01-10/).length).toBe(3)
  expect(screen.getAllByText(/Ref AAAAAAAA/).length).toBeGreaterThan(0)
  // Bravo is within the existing 1,000 km due-soon threshold.
  const alpha = within(screen.getByText('2020 Alpha Audit').closest('li')!)
  const bravo = within(screen.getByText('2020 Bravo Audit').closest('li')!)
  expect(alpha.getByText('Up to date')).toBeTruthy()
  expect(bravo.getByText('Due soon')).toBeTruthy()
  expect(screen.getByText(/May add records/)).toBeTruthy()
  expect(mocks.list).toHaveBeenCalledWith('s1')
  // Only vehicles returned by the authorization list are ever requested.
  expect(mocks.vehicle.mock.calls.map((call) => call[1]).sort()).toEqual([
    'v1',
    'v2',
    'v3',
  ])
})

it('searches and filters only the authorized vehicles', async () => {
  renderPage()
  await screen.findByText('2020 Alpha Audit')
  fireEvent.change(screen.getByLabelText(/^Search authorized/), {
    target: { value: 'bravo' },
  })
  expect(screen.queryByText('2020 Alpha Audit')).toBeNull()
  expect(screen.getByText('2020 Bravo Audit')).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/^Search authorized/), {
    target: { value: 'cccccccc' },
  })
  expect(screen.getByText('2020 Charlie Audit')).toBeTruthy()
  fireEvent.change(screen.getByLabelText(/^Search authorized/), {
    target: { value: '' },
  })
  fireEvent.change(screen.getByLabelText('Maintenance status'), {
    target: { value: 'Due soon' },
  })
  expect(screen.queryByText('2020 Alpha Audit')).toBeNull()
  fireEvent.change(screen.getByLabelText('Maintenance status'), {
    target: { value: 'Due / overdue' },
  })
  await screen.findByText(/No authorized vehicles match/)
})

it('opens sanitized history with a fresh authorization check', async () => {
  renderPage()
  await screen.findByText('2020 Alpha Audit')
  const callsBefore = mocks.vehicle.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: /^View Alpha Audit/ }))
  await screen.findByRole('heading', { name: 'Vehicle AAAAAAAA' })
  await waitFor(() =>
    expect(mocks.vehicle.mock.calls.length).toBeGreaterThan(callsBefore),
  )
  await screen.findByText(/1 operation$/)
  expect(screen.getByText(/never shared/)).toBeTruthy()
  expect(screen.getByText('Schedule 1')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('heading', { name: 'Vehicle AAAAAAAA' })).toBeNull()
})

it('removes customer data when access is revoked while a vehicle is open', async () => {
  renderPage()
  await screen.findByText('2020 Alpha Audit')
  mocks.vehicle.mockRejectedValue({ code: '42501' })
  fireEvent.click(screen.getByRole('button', { name: /^View Alpha Audit/ }))
  await screen.findByText(/no longer available to the shop/)
  expect(screen.queryByText('Schedule 1')).toBeNull()
})

it('refreshes an open history and drops it when authorization is withdrawn', async () => {
  renderPage()
  await screen.findByText('2020 Alpha Audit')
  fireEvent.click(screen.getByRole('button', { name: /^View Alpha Audit/ }))
  await screen.findByText('Schedule 1')
  mocks.vehicle.mockRejectedValue({ code: '42501' })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText(/no longer available to the shop/)
  expect(screen.queryByText('Schedule 1')).toBeNull()
  await waitFor(() => expect(screen.queryByText('2020 Alpha Audit')).toBeNull())
})

it('clears the previous shop selection and history when switching shops', async () => {
  mocks.shops.mockResolvedValue([
    { id: 's1', name: 'Fictional Garage', role: 'admin' },
    { id: 's2', name: 'Second Garage', role: 'mechanic' },
  ])
  mocks.list.mockImplementation((id: string) =>
    Promise.resolve(id === 's1' ? [auth('aaaaaaaa-1', 'v1')] : []),
  )
  renderPage()
  await screen.findByText('2020 Alpha Audit')
  expect(
    screen.getByRole('link', { name: 'Invite a customer' }),
  ).toHaveAttribute('href', '/shops')
  fireEvent.click(screen.getByRole('button', { name: /^View Alpha Audit/ }))
  await screen.findByText('Schedule 1')
  fireEvent.change(screen.getByLabelText('Shop'), { target: { value: 's2' } })
  await screen.findByText(/No customer has authorized a vehicle/)
  expect(mocks.list).toHaveBeenLastCalledWith('s2')
  expect(screen.queryByText('2020 Alpha Audit')).toBeNull()
  expect(screen.queryByText('Schedule 1')).toBeNull()
  expect(screen.queryByRole('link', { name: 'Invite a customer' })).toBeNull()
})

it('hides vehicles whose access ended and says so', async () => {
  mocks.vehicle.mockImplementation((_shop: string, id: string) =>
    id === 'v2'
      ? Promise.reject({ code: '42501' })
      : Promise.resolve(vehicles[id]),
  )
  renderPage()
  await screen.findByText('2020 Alpha Audit')
  await screen.findByText(/1 vehicle is no longer available/)
  expect(screen.queryByText('2020 Bravo Audit')).toBeNull()
})

it('lets admins accept and decline owner requests and cancel shop requests', async () => {
  mocks.list.mockResolvedValue([
    auth('dddddddd-4', 'v4', {
      status: 'pending',
      expires_at: '2999-01-01T00:00:00Z',
    }),
    auth('eeeeeeee-5', 'v5', {
      status: 'pending',
      initiated_by: 'shop',
      expires_at: '2999-01-01T00:00:00Z',
    }),
    auth('ffffffff-6', 'v6', {
      status: 'pending',
      expires_at: '2000-01-01T00:00:00Z',
    }),
  ])
  renderPage()
  await screen.findByText('Request DDDDDDDD')
  expect(screen.getByText('Expired')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /FFFFFFFF/ })).toBeNull()

  // Admin can accept owner-initiated request
  fireEvent.click(
    screen.getByRole('button', { name: 'Accept request DDDDDDDD' }),
  )
  await screen.findByText('Request DDDDDDDD was accepted.')
  expect(mocks.review).toHaveBeenCalledWith('v4', 'dddddddd-4', 'accepted')

  // Admin can decline owner-initiated request
  fireEvent.click(
    screen.getByRole('button', { name: 'Decline request DDDDDDDD' }),
  )
  await screen.findByText('The request was declined.')
  expect(mocks.review).toHaveBeenCalledWith('v4', 'dddddddd-4', 'declined')

  // Admin can cancel shop-initiated request
  fireEvent.click(
    screen.getByRole('button', { name: 'Cancel request EEEEEEEE' }),
  )
  await waitFor(() =>
    expect(mocks.resolve).toHaveBeenLastCalledWith(
      'v5',
      'eeeeeeee-5',
      'cancelled',
    ),
  )
  expect(mocks.vehicle).not.toHaveBeenCalled()
})

it('shows Shop accepted badge and lets admins decline after acceptance', async () => {
  mocks.list.mockResolvedValue([
    auth('dddddddd-4', 'v4', {
      status: 'pending',
      shop_accepted_at: '2026-03-01T12:00:00Z',
      expires_at: '2999-01-01T00:00:00Z',
    }),
  ])
  renderPage()
  await screen.findByText('Request DDDDDDDD')
  expect(screen.getByText('Shop accepted')).toBeTruthy()
  expect(
    screen.getByText(
      /Accepted by your shop. Waiting for the customer to approve/,
    ),
  ).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Accept request/ })).toBeNull()

  fireEvent.click(
    screen.getByRole('button', { name: 'Decline request DDDDDDDD' }),
  )
  await screen.findByText('The request was declined.')
  expect(mocks.review).toHaveBeenCalledWith('v4', 'dddddddd-4', 'declined')
})

it('displays authorized customer references, maintenance operation names, notes, costs and workshop provenance', async () => {
  const enrichedVehicle: ShopVehicle = {
    customer_reference: 'Fleet Car 01',
    vehicle: {
      id: 'v1',
      type: 'car',
      make: 'Alpha',
      model: 'Audit',
      year: 2020,
      engine: '2.0',
      mileage: 50000,
    },
    maintenance_schedules: [
      {
        id: 'm-v1',
        name: 'Oil Service',
        interval_km: 10000,
        interval_months: null,
        enabled: true,
        history_status: 'known',
        last_completed_date: '2026-01-10',
        last_completed_mileage: 45000,
      },
    ],
    maintenance_records: [
      {
        id: 'r-shared',
        service_date: '2026-01-10',
        mileage: 45000,
        service_type: 'workshop',
        total_cost: 150,
        notes: 'Full synthetic oil and filter change',
        workshop_provenance: {
          shop_id: 's1',
          shop_name: 'Fictional Garage',
          recorded_at: '2026-01-10T14:30:00Z',
        },
        operations: [
          {
            maintenance_item_id: 'm-v1',
            operation_name: 'Synthetic Engine Oil',
            cost: 95.5,
            next_interval_km: null,
            next_interval_months: null,
          },
        ],
      },
      {
        id: 'r-unshared',
        service_date: '2025-06-01',
        mileage: 35000,
        operations: [
          {
            maintenance_item_id: 'm-v1',
            next_interval_km: null,
            next_interval_months: null,
          },
        ],
      },
    ],
  }

  mocks.vehicle.mockImplementation((_shop: string, id: string) =>
    Promise.resolve(id === 'v1' ? enrichedVehicle : vehicles[id]),
  )

  renderPage()
  await screen.findByText(/Ref Fleet Car 01/)

  // Can search by customer reference
  fireEvent.change(screen.getByLabelText(/^Search authorized/), {
    target: { value: 'Fleet Car' },
  })
  expect(screen.getByText('2020 Alpha Audit')).toBeTruthy()

  // Open details
  fireEvent.click(screen.getByRole('button', { name: /^View Alpha Audit/ }))
  await screen.findByRole('heading', { name: 'Vehicle Fleet Car 01' })

  // Operation/schedule name authorized
  expect(screen.getByText('Oil Service')).toBeTruthy()

  // Authorized visit displays details and workshop provenance
  expect(screen.getByText(/· Workshop · \$150.00/)).toBeTruthy()
  expect(screen.getByText(/Recorded by Fictional Garage on/)).toBeTruthy()
  expect(screen.getByText('Full synthetic oil and filter change')).toBeTruthy()
  expect(screen.getByText(/Synthetic Engine Oil · \$95.50/)).toBeTruthy()

  // Unshared visit displays only completion facts
  expect(screen.getByText('2025-06-01')).toBeTruthy()
  expect(screen.getByText(/35,000 km · 1 operation$/)).toBeTruthy()
})

it('gives mechanics read-only access to requests', async () => {
  mocks.shops.mockResolvedValue([
    { id: 's1', name: 'Fictional Garage', role: 'mechanic' },
  ])
  mocks.list.mockResolvedValue([
    auth('dddddddd-4', 'v4', {
      status: 'pending',
      expires_at: '2999-01-01T00:00:00Z',
    }),
  ])
  renderPage()
  await screen.findByText('Request DDDDDDDD')
  expect(screen.getByText(/Only shop administrators can respond/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /request DDDDDDDD/ })).toBeNull()
  expect(screen.queryByText('Invite a customer')).toBeNull()
})

it('shows empty states', async () => {
  mocks.list.mockResolvedValue([])
  renderPage()
  await screen.findByText(/No customer has authorized a vehicle/)
  expect(screen.getByText('No pending connection requests.')).toBeTruthy()
})

it('explains suspended, expired or revoked shop access and clears data', async () => {
  mocks.list.mockRejectedValue({ code: '42501' })
  renderPage()
  await screen.findByText(/subscription may have expired/)
  expect(screen.queryByText(/Customer vehicles/)).toBeNull()
})

it('handles users without shops, shop failures and list failures', async () => {
  mocks.shops.mockResolvedValueOnce([])
  const first = renderPage()
  await screen.findByText(/not an active staff member/)
  first.unmount()
  mocks.shops.mockRejectedValueOnce(new Error('network'))
  const second = renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  await screen.findByText('2020 Alpha Audit')
  second.unmount()
  mocks.list.mockRejectedValueOnce(new Error('network'))
  renderPage()
  const alert = await screen.findByText(/Unable to load customer vehicles/)
  fireEvent.click(
    within(alert.closest('p')!).getByRole('button', { name: 'Try again' }),
  )
  await screen.findByText('2020 Alpha Audit')
})

it('reuses the existing maintenance calculations for a sanitized vehicle', () => {
  const summary = summarizeShopVehicle(vehicles.v2, '2026-02-01')
  expect(summary.overall).toBe('Due soon')
  expect(summary.schedules[0]).toMatchObject({
    status: 'Due soon',
    nextMileage: 59000,
  })
  expect(summary.lastServiceDate).toBe('2026-01-10')
  const overdue = summarizeShopVehicle(
    { ...vehicles.v2, vehicle: { ...vehicles.v2.vehicle, mileage: 60000 } },
    '2026-02-01',
  )
  expect(overdue.overall).toBe('Due / overdue')
  const none = summarizeShopVehicle(
    { ...vehicles.v2, maintenance_schedules: [], maintenance_records: [] },
    '2026-02-01',
  )
  expect(none).toMatchObject({ overall: 'Unknown', lastServiceDate: null })
})

async function openRecording() {
  renderPage()
  fireEvent.click(
    await screen.findByRole('button', { name: /^View Bravo Audit/ }),
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Record Maintenance' }),
  )
  fireEvent.change(screen.getByLabelText('Operation 1 name'), {
    target: { value: 'Oil and filter' },
  })
}

it('offers reminders only for due operations, including approved view-only vehicles', async () => {
  mocks.list.mockResolvedValue([
    auth('aaaaaaaa-1', 'v1'),
    auth('bbbbbbbb-2', 'v2'),
  ])
  renderPage()
  fireEvent.click(
    await screen.findByRole('button', { name: /^View Alpha Audit/ }),
  )
  await screen.findByText('Schedule 1')
  expect(
    screen.queryByRole('button', { name: 'Send reminder for Schedule 1' }),
  ).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: /^View Bravo Audit/ }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Send reminder for Schedule 1' }),
  )
  await screen.findByText('Reminder sent to the vehicle owner.')
  expect(mocks.sendReminder).toHaveBeenCalledExactlyOnceWith('s1', 'v2', 'm-v2')
})

it('clears open vehicle details when reminder authorization is lost', async () => {
  mocks.sendReminder.mockRejectedValue({ code: '42501' })
  renderPage()
  fireEvent.click(
    await screen.findByRole('button', { name: /^View Bravo Audit/ }),
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Send reminder for Schedule 1' }),
  )
  await screen.findByText(/no longer available to the shop/)
  expect(screen.queryByText('Schedule 1')).toBeNull()
})

it.each(['admin', 'mechanic'])(
  'records workshop maintenance as %s and refreshes completion history',
  async (role) => {
    mocks.shops.mockResolvedValue([
      { id: 's1', name: 'Fictional Garage', role },
    ])
    const refresh = vi.fn()
    window.addEventListener('app:maintenance-change', refresh)
    mocks.create.mockImplementation(async () => {
      const updated: ShopVehicle = {
        ...vehicles.v2,
        maintenance_records: [
          {
            id: 'new-workshop-record',
            service_date: '2026-02-10',
            mileage: 58000,
            operations: [
              {
                maintenance_item_id: 'm-v2',
                next_interval_km: null,
                next_interval_months: null,
              },
              {
                maintenance_item_id: null,
                next_interval_km: null,
                next_interval_months: null,
              },
            ],
          },
          ...vehicles.v2.maintenance_records,
        ],
      }
      mocks.vehicle.mockImplementation((_shop: string, id: string) =>
        Promise.resolve(id === 'v2' ? updated : vehicles[id]),
      )
      // The existing service emits this only after the RPC confirms success.
      notifyMaintenanceChange()
      return 'new-workshop-record'
    })
    try {
      await openRecording()
      fireEvent.change(screen.getByLabelText('Service date'), {
        target: { value: '2026-02-10' },
      })
      fireEvent.change(screen.getByLabelText('Workshop notes (optional)'), {
        target: { value: ' Workshop work completed ' },
      })
      fireEvent.change(screen.getByLabelText('Total cost (optional)'), {
        target: { value: '120.50' },
      })
      fireEvent.change(screen.getByLabelText('Operation 1 cost (optional)'), {
        target: { value: '100' },
      })
      fireEvent.change(screen.getByLabelText('Operation 1 schedule'), {
        target: { value: 'm-v2' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add operation' }))
      fireEvent.change(screen.getByLabelText('Operation 2 name'), {
        target: { value: 'Inspection' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save maintenance' }))
      await screen.findByText('Maintenance recorded successfully.')
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith('s1', 'v2', {
        service_date: '2026-02-10',
        mileage: 58000,
        notes: 'Workshop work completed',
        total_cost: 120.5,
        operations: [
          {
            maintenance_item_id: 'm-v2',
            operation_name: 'Oil and filter',
            cost: 100,
          },
          {
            maintenance_item_id: null,
            operation_name: 'Inspection',
            cost: null,
          },
        ],
      })
      await screen.findByText('2026-02-10')
      await screen.findByText(/Last service 2026-02-10/)
      expect(screen.getByText(/2 operations/)).toBeTruthy()
      expect(refresh).toHaveBeenCalledOnce()
      expect(screen.queryByRole('button', { name: /Edit|Delete/ })).toBeNull()
    } finally {
      window.removeEventListener('app:maintenance-change', refresh)
    }
  },
)

it.each(['view-only', 'feature-disabled'])(
  'does not offer recording for %s access',
  async (mode) => {
    mocks.enabled = mode !== 'feature-disabled'
    if (mode === 'view-only')
      mocks.list.mockResolvedValue([auth('bbbbbbbb-2', 'v2')])
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: /^View Bravo Audit/ }),
    )
    await screen.findByText('Schedule 1')
    expect(
      screen.queryByRole('button', { name: 'Record Maintenance' }),
    ).toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
  },
)

it('validates required fields, dates, mileage, costs and duplicate schedule links', async () => {
  await openRecording()
  fireEvent.change(screen.getByLabelText('Operation 1 name'), {
    target: { value: ' ' },
  })
  fireEvent.change(screen.getByLabelText('Mileage (km)'), {
    target: { value: '' },
  })
  fireEvent.change(screen.getByLabelText('Service date'), {
    target: { value: '2999-01-01' },
  })
  fireEvent.change(screen.getByLabelText('Total cost (optional)'), {
    target: { value: '1.123' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save maintenance' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Operation 1 must contain',
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Odometer must be between zero and current vehicle mileage.',
  )
  expect(screen.getByRole('alert')).toHaveTextContent('on or before today')
  expect(screen.getByRole('alert')).toHaveTextContent('at most two decimals')
  fireEvent.change(screen.getByLabelText('Mileage (km)'), {
    target: { value: '58001' },
  })
  fireEvent.change(screen.getByLabelText('Operation 1 schedule'), {
    target: { value: 'm-v2' },
  })
  fireEvent.change(screen.getByLabelText('Operation 1 cost (optional)'), {
    target: { value: '-1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add operation' }))
  fireEvent.change(screen.getByLabelText('Operation 2 schedule'), {
    target: { value: 'm-v2' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save maintenance' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Select each maintenance schedule only once.',
  )
  expect(screen.getByRole('alert')).toHaveTextContent('Operation 1 cost')
  expect(mocks.create).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Remove operation 2' }))
  expect(screen.queryByLabelText('Operation 2 name')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel recording' }))
  expect(screen.queryByRole('button', { name: 'Save maintenance' })).toBeNull()
})

it('prevents duplicate submissions while saving', async () => {
  let finish!: (value: string) => void
  mocks.create.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve
    }),
  )
  await openRecording()
  fireEvent.click(screen.getByRole('button', { name: 'Save maintenance' }))
  expect(
    screen.getByRole('button', { name: 'Saving maintenance…' }),
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Cancel recording' }),
  ).toBeDisabled()
  fireEvent.submit(screen.getByRole('form', { name: 'Record Maintenance' }))
  expect(mocks.create).toHaveBeenCalledOnce()
  finish('new-workshop-record')
  await screen.findByText('Maintenance recorded successfully.')
})

it('closes the form when refreshed authorization becomes view only', async () => {
  await openRecording()
  mocks.list.mockResolvedValue([auth('bbbbbbbb-2', 'v2')])
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText(/View only. Recording maintenance requires/)
  expect(screen.queryByRole('button', { name: 'Save maintenance' })).toBeNull()
  expect(mocks.create).not.toHaveBeenCalled()
})

it('drops the form and history when the shop becomes unavailable during recording', async () => {
  await openRecording()
  mocks.list.mockRejectedValue({ code: '42501' })
  mocks.vehicle.mockRejectedValue({ code: '42501' })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText(/subscription may have expired/)
  expect(screen.queryByRole('button', { name: 'Save maintenance' })).toBeNull()
  expect(screen.queryByText('Schedule 1')).toBeNull()
  expect(mocks.create).not.toHaveBeenCalled()
})

it.each(['42501', '40001', '23514', 'network'])(
  'handles save failure %s without reporting success or retrying',
  async (code) => {
    mocks.create.mockRejectedValue({ code })
    await openRecording()
    fireEvent.click(screen.getByRole('button', { name: 'Save maintenance' }))
    if (code === '42501') {
      await screen.findByText(/no longer available to the shop/)
      expect(screen.queryByText('Schedule 1')).toBeNull()
      expect(
        screen.queryByRole('button', { name: 'Save maintenance' }),
      ).toBeNull()
    } else {
      await screen.findByRole('alert')
      expect(screen.getByLabelText('Operation 1 name')).toHaveValue(
        'Oil and filter',
      )
      expect(
        screen.getByRole('button', { name: 'Save maintenance' }),
      ).toBeEnabled()
    }
    expect(screen.queryByText('Maintenance recorded successfully.')).toBeNull()
    expect(mocks.create).toHaveBeenCalledOnce()
  },
)
