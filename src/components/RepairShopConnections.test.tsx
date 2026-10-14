import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { RepairShopConnections } from './RepairShopConnections'
import type { Vehicle } from '../types/vehicle'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  request: vi.fn(),
  approve: vi.fn(),
  revoke: vi.fn(),
  resolve: vi.fn(),
  search: vi.fn(),
  setSharing: vi.fn(),
  loadHistory: vi.fn(),
  historyEnabled: true,
}))

vi.mock('../services/repairShops', () => ({
  listVehicleShopAuthorizations: mocks.list,
  requestVehicleShopAuthorization: mocks.request,
  approveVehicleShopAuthorization: mocks.approve,
  revokeVehicleShopAuthorization: mocks.revoke,
  resolveVehicleShopRequest: mocks.resolve,
  searchAvailableRepairShops: mocks.search,
  setVehicleShopDataSharing: mocks.setSharing,
}))

vi.mock('../services/serviceHistory', () => ({
  loadServiceHistory: mocks.loadHistory,
}))

vi.mock('../config/features', () => ({
  isServiceHistoryEnabled: () => mocks.historyEnabled,
}))

const vehicle = { id: 'v1' } as Vehicle
const shopId = '11111111-1111-4111-8111-111111111111'
const secondShopId = '22222222-2222-4222-8222-222222222222'

const row = (overrides: object = {}) => ({
  id: 'a1',
  shop_id: shopId,
  shop_name: 'Fictional Garage',
  vehicle_id: 'v1',
  ownership_epoch: 1,
  initiated_by: 'shop',
  status: 'pending',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  can_create_records: false,
  shop_accepted_at: null,
  share_operation_names: false,
  customer_reference: null,
  shared_visit_ids: [],
  ...overrides,
})

const directoryPage = (
  items = [
    {
      id: shopId,
      name: 'Fictional Garage',
      contact_address: '123 Main St',
      contact_phone: '555-0100',
      contact_website: 'https://garage.example',
    },
    {
      id: secondShopId,
      name: 'Downtown Motors',
      contact_address: '456 Center Ave',
      contact_phone: null,
      contact_website: null,
    },
  ],
  total = items.length,
  offset = 0,
  limit = 10,
) => ({
  items,
  total,
  offset,
  limit,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.historyEnabled = true
  mocks.list.mockResolvedValue([])
  mocks.search.mockResolvedValue(directoryPage())
  mocks.request.mockResolvedValue('a2')
  mocks.approve.mockResolvedValue(undefined)
  mocks.revoke.mockResolvedValue(undefined)
  mocks.resolve.mockResolvedValue(undefined)
  mocks.setSharing.mockResolvedValue(undefined)
  mocks.loadHistory.mockResolvedValue([
    {
      id: 'vis-1',
      service_date: '2026-02-01',
      mileage: 45000,
      private_on_transfer: false,
      workshop_name: 'Fictional Garage',
    },
    {
      id: 'vis-private',
      service_date: '2026-01-01',
      mileage: 40000,
      private_on_transfer: true,
      workshop_name: 'Private Workshop',
    },
  ])
})

it('searches available repair shops and requests a connection', async () => {
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('No repair shop connections.')
  expect(await screen.findByText('Downtown Motors')).toBeTruthy()
  expect(screen.getByText('123 Main St')).toBeTruthy()
  expect(screen.getByText(/555-0100 · https:\/\/garage.example/)).toBeTruthy()

  fireEvent.change(screen.getByLabelText('Search repair shops'), {
    target: { value: 'downtown' },
  })
  await waitFor(() => {
    expect(mocks.search).toHaveBeenCalledWith('v1', 'downtown', 0, 10)
  })

  const requestButtons = screen.getAllByRole('button', {
    name: 'Request connection',
  })
  fireEvent.click(requestButtons[1]) // Downtown Motors
  await screen.findByText(/Connection requested/)
  expect(mocks.request).toHaveBeenCalledWith('v1', secondShopId)
})

it('shows connected and pending badges in directory for existing shops', async () => {
  mocks.list.mockResolvedValue([
    row({ shop_id: shopId, status: 'approved' }),
    row({ id: 'a2', shop_id: secondShopId, status: 'pending' }),
  ])
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('Approved')
  expect(screen.getByText('Connected')).toBeTruthy()
  expect(screen.getByText('Request pending')).toBeTruthy()
  expect(
    screen.queryByRole('button', { name: 'Request connection' }),
  ).toBeNull()
})

it('handles directory empty and error states with retry', async () => {
  mocks.search.mockResolvedValueOnce(directoryPage([], 0))
  const { unmount } = render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('No available repair shops found.')
  unmount()

  mocks.search.mockRejectedValueOnce(new Error('network'))
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('Unable to search repair shops.')
  mocks.search.mockResolvedValueOnce(directoryPage())
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('Downtown Motors')
})

it('supports directory pagination when total exceeds limit', async () => {
  mocks.search.mockResolvedValue(directoryPage(undefined, 25, 0, 10))
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('Page 1 of 3')
  const next = screen.getByRole('button', { name: 'Next page' })
  const prev = screen.getByRole('button', { name: 'Previous page' })
  expect(prev).toBeDisabled()
  expect(next).not.toBeDisabled()

  fireEvent.click(next)
  await waitFor(() => {
    expect(mocks.search).toHaveBeenCalledWith('v1', '', 10, 10)
  })
})

it('approves a shop-initiated request only with the explicitly chosen permission', async () => {
  mocks.list.mockResolvedValue([row({})])
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('Pending')
  fireEvent.click(screen.getByLabelText(/allow adding maintenance records/))
  fireEvent.click(
    screen.getByRole('button', { name: 'Approve Fictional Garage' }),
  )
  await screen.findByText('Fictional Garage was approved.')
  expect(mocks.approve).toHaveBeenCalledExactlyOnceWith('v1', 'a1', true)
})

it('defaults approval to view-only and can decline', async () => {
  mocks.list.mockResolvedValue([row({})])
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('Pending')
  fireEvent.click(
    screen.getByRole('button', { name: 'Approve Fictional Garage' }),
  )
  await waitFor(() =>
    expect(mocks.approve).toHaveBeenCalledWith('v1', 'a1', false),
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Decline Fictional Garage' }),
  )
  await waitFor(() =>
    expect(mocks.resolve).toHaveBeenCalledWith('v1', 'a1', 'declined'),
  )
})

it('cancels owner-initiated requests when not accepted by shop', async () => {
  mocks.list.mockResolvedValue([row({ initiated_by: 'owner' })])
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText(/Waiting for the shop/)
  expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
  fireEvent.click(
    screen.getByRole('button', { name: 'Cancel request to Fictional Garage' }),
  )
  await waitFor(() =>
    expect(mocks.resolve).toHaveBeenCalledWith('v1', 'a1', 'cancelled'),
  )
})

it('allows owner to approve owner-initiated request once accepted by shop', async () => {
  mocks.list.mockResolvedValue([
    row({
      initiated_by: 'owner',
      shop_accepted_at: '2026-03-01T12:00:00Z',
    }),
  ])
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText(/The shop accepted your request/)
  fireEvent.click(screen.getByLabelText(/allow adding maintenance records/))
  fireEvent.click(
    screen.getByRole('button', { name: 'Approve Fictional Garage' }),
  )
  await screen.findByText('Fictional Garage was approved.')
  expect(mocks.approve).toHaveBeenCalledWith('v1', 'a1', true)
})

it('shows approved permissions and revokes after confirmation', async () => {
  mocks.list.mockResolvedValue([
    row({ status: 'approved', can_create_records: true }),
  ])
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('Approved')
  expect(
    screen.getByText('View vehicle and add maintenance records'),
  ).toBeTruthy()
  fireEvent.click(
    screen.getByRole('button', { name: 'Revoke Fictional Garage' }),
  )
  expect(mocks.revoke).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  await screen.findByText('Access for Fictional Garage was revoked.')
  expect(mocks.revoke).toHaveBeenCalledWith('v1', 'a1')
})

it('configures and saves owner-controlled data sharing for approved shops', async () => {
  mocks.list.mockResolvedValue([
    row({
      status: 'approved',
      customer_reference: 'Vehicle Alpha',
      share_operation_names: false,
      shared_visit_ids: ['vis-1'],
    }),
  ])
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('Approved')
  expect(screen.getByText(/Customer ref: Vehicle Alpha/)).toBeTruthy()
  expect(screen.getByText(/Schedule names: Hidden/)).toBeTruthy()
  expect(screen.getByText(/Shared visits: 1/)).toBeTruthy()

  fireEvent.click(
    screen.getByRole('button', { name: 'Configure data sharing' }),
  )
  await screen.findByRole('heading', {
    name: 'Data sharing for Fictional Garage',
  })

  // Private visits on transfer are excluded from sharing checklist
  expect(await screen.findByText(/2026-02-01 · 45,000 km/)).toBeTruthy()
  expect(screen.queryByText(/vis-private/)).toBeNull()

  const refInput = screen.getByLabelText(/^Customer reference/)
  expect(refInput).toHaveValue('Vehicle Alpha')
  fireEvent.change(refInput, { target: { value: 'Fleet Car 01' } })

  const opsCheckbox = screen.getByLabelText(
    'Share maintenance schedule and operation names',
  )
  expect(opsCheckbox).not.toBeChecked()
  fireEvent.click(opsCheckbox)

  fireEvent.click(
    screen.getByRole('button', { name: 'Save sharing preferences' }),
  )
  await screen.findByText(
    'Data sharing preferences saved for Fictional Garage.',
  )

  expect(mocks.setSharing).toHaveBeenCalledWith('v1', 'a1', {
    customer_reference: 'Fleet Car 01',
    share_operation_names: true,
    shared_visit_ids: ['vis-1'],
  })
})

it('validates customer reference length when configuring data sharing', async () => {
  mocks.list.mockResolvedValue([row({ status: 'approved' })])
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('Approved')
  fireEvent.click(
    screen.getByRole('button', { name: 'Configure data sharing' }),
  )

  const refInput = screen.getByLabelText(/^Customer reference/)
  fireEvent.change(refInput, { target: { value: 'x'.repeat(81) } })
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save sharing preferences' }),
    ).toBeEnabled(),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Save sharing preferences' }),
  )

  expect(
    await screen.findByText(
      /Customer reference must be 80 characters or fewer/,
    ),
  ).toBeTruthy()
  expect(mocks.setSharing).not.toHaveBeenCalled()
})

it('reports failed sharing-history loads and allows retry before saving', async () => {
  mocks.list.mockResolvedValue([
    row({ status: 'approved', shared_visit_ids: ['vis-1'] }),
  ])
  mocks.loadHistory.mockRejectedValueOnce(new Error('offline'))
  render(<RepairShopConnections vehicle={vehicle} />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Configure data sharing' }),
  )
  await screen.findByText(/Unable to load service visits/)
  expect(screen.queryByText('No shareable service visits recorded.')).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Save sharing preferences' }),
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry service visits' }))
  await screen.findByText(/2026-02-01 · 45,000 km/)
  expect(
    screen.getByRole('button', { name: 'Save sharing preferences' }),
  ).toBeEnabled()
  expect(screen.getByLabelText(/2026-02-01 · 45,000 km/)).toBeChecked()
  fireEvent.click(
    screen.getByRole('button', { name: 'Save sharing preferences' }),
  )
  await waitFor(() =>
    expect(mocks.setSharing).toHaveBeenCalledWith('v1', 'a1', {
      customer_reference: null,
      share_operation_names: false,
      shared_visit_ids: ['vis-1'],
    }),
  )
})

it('treats lapsed pending requests as expired', async () => {
  mocks.list.mockResolvedValue([
    row({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    row({ id: 'a3', status: 'revoked' }),
  ])
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('Expired')
  expect(screen.getByText('Revoked')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
})

it('surfaces action failures safely', async () => {
  mocks.list.mockResolvedValue([row({ status: 'approved' })])
  mocks.revoke.mockRejectedValue({ code: '40001' })
  render(<RepairShopConnections vehicle={vehicle} />)
  await screen.findByText('Approved')
  fireEvent.click(
    screen.getByRole('button', { name: 'Revoke Fictional Garage' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  await screen.findByText(/happened at the same time/)
})

it('offers retry when the connection list cannot load', async () => {
  mocks.list.mockRejectedValueOnce(new Error('network'))
  render(<RepairShopConnections vehicle={vehicle} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  await screen.findByText('No repair shop connections.')
})
