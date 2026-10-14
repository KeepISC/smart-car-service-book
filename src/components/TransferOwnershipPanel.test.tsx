import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { TransferOwnershipPanel } from './TransferOwnershipPanel'
import type { Vehicle } from '../types/vehicle'

const mocks = vi.hoisted(() => ({
  loadServiceHistory: vi.fn(),
  setPrivacy: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  status: vi.fn(),
}))
vi.mock('../config/features', () => ({ isServiceHistoryEnabled: () => true }))
vi.mock('../services/serviceHistory', () => ({
  loadServiceHistory: mocks.loadServiceHistory,
  setServiceVisitTransferPrivacy: mocks.setPrivacy,
}))
vi.mock('../services/vehicleTransfers', () => ({
  createVehicleTransfer: mocks.create,
  revokeVehicleTransfer: mocks.revoke,
  getVehicleTransferStatus: mocks.status,
}))

const vehicle = {
  id: 'v1',
  type: 'car',
  make: 'Fictional',
  model: 'Audit',
  year: 2020,
  engine: '2.0',
  mileage: 10000,
} as Vehicle
const visit = (id: string, isPrivate: boolean) => ({
  id,
  vehicle_id: 'v1',
  service_date: '2026-01-01',
  mileage: 9000,
  private_on_transfer: isPrivate,
  operations: [{ operation_name: `Op ${id}`, notes: 'SECRET NOTE' }],
  notes: 'SECRET NOTE',
  workshop_name: 'SECRET SHOP',
})
const token = 'a'.repeat(64)
const future = () => new Date(Date.now() + 3600_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  mocks.loadServiceHistory.mockResolvedValue([
    visit('shared', false),
    visit('hidden', true),
  ])
  mocks.setPrivacy.mockResolvedValue(undefined)
  mocks.status.mockResolvedValue('pending')
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } })
})

it('previews shared history, hides private content and warns about access loss', async () => {
  render(<TransferOwnershipPanel vehicle={vehicle} onClose={() => {}} />)
  await screen.findByText(/Op shared/)
  expect(screen.queryByText(/Op hidden/)).not.toBeInTheDocument()
  expect(document.body.textContent).not.toContain('SECRET')
  expect(screen.getByText('1 of 2 visits will be shared.')).toBeInTheDocument()
  expect(screen.getByText(/only after the recipient accepts/)).toBeVisible()
  expect(screen.getByText(/you lose access/)).toBeVisible()
})

it('updates visit privacy through the privacy API', async () => {
  render(<TransferOwnershipPanel vehicle={vehicle} onClose={() => {}} />)
  await screen.findByText(/Op shared/)
  fireEvent.click(screen.getAllByLabelText('Keep private')[0])
  await waitFor(() =>
    expect(mocks.setPrivacy).toHaveBeenCalledWith('v1', 'shared', true),
  )
  await waitFor(() => expect(screen.queryByText(/Op shared/)).toBeNull())
})

it('shows privacy and history errors without leaking details', async () => {
  mocks.setPrivacy.mockRejectedValue(new Error('db detail'))
  render(<TransferOwnershipPanel vehicle={vehicle} onClose={() => {}} />)
  await screen.findByText(/Op shared/)
  fireEvent.click(screen.getAllByLabelText('Keep private')[0])
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to update privacy',
  )
  expect(document.body.textContent).not.toContain('db detail')
})

it('creates, copies and revokes an invitation using session storage only', async () => {
  mocks.create.mockResolvedValue({ id: 'i1', token, expires_at: future() })
  mocks.revoke.mockResolvedValue(undefined)
  const log = vi.spyOn(console, 'log')
  render(<TransferOwnershipPanel vehicle={vehicle} onClose={() => {}} />)
  await screen.findByText(/Op shared/)
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }))
  const input = (await screen.findByLabelText(
    'Invitation link',
  )) as HTMLInputElement
  expect(input.value).toContain(token)
  expect(screen.getByText(/Expires/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Copy link/ }))
  await screen.findByText('Link copied.')
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(input.value)
  expect(JSON.stringify({ ...localStorage })).not.toContain(token)
  expect(JSON.stringify({ ...sessionStorage })).toContain(token)
  expect(log).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Revoke invitation' }))
  await screen.findByText(/invitation was revoked/)
  expect(mocks.revoke).toHaveBeenCalledWith('v1', 'i1')
  expect(screen.queryByLabelText('Invitation link')).toBeNull()
  expect(document.body.textContent).not.toContain(token)
  expect(JSON.stringify({ ...sessionStorage })).not.toContain(token)
})

it('shows creation errors and the expired state', async () => {
  mocks.create.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
    id: 'i2',
    token,
    expires_at: new Date(Date.now() - 1000).toISOString(),
  })
  render(<TransferOwnershipPanel vehicle={vehicle} onClose={() => {}} />)
  await screen.findByText(/Op shared/)
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }))
  await screen.findByText('Unable to create the invitation. Please try again.')
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }))
  await screen.findByText(/has expired/)
  expect(screen.queryByLabelText('Invitation link')).toBeNull()
})

it('restores the same-tab sender link and clears it after a recipient decline', async () => {
  mocks.create.mockResolvedValue({ id: 'i1', token, expires_at: future() })
  const mounted = render(
    <TransferOwnershipPanel vehicle={vehicle} onClose={() => {}} />,
  )
  await screen.findByText(/Op shared/)
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }))
  await screen.findByLabelText('Invitation link')
  mounted.unmount()
  render(<TransferOwnershipPanel vehicle={vehicle} onClose={() => {}} />)
  expect(
    ((await screen.findByLabelText('Invitation link')) as HTMLInputElement)
      .value,
  ).toContain(token)
  await waitFor(() => expect(mocks.status).toHaveBeenCalledWith('v1', 'i1'))
  mocks.status.mockResolvedValue('declined')
  fireEvent(window, new Event('focus'))
  await screen.findByText(/recipient declined/)
  expect(sessionStorage.getItem('scsb:transfer:sender:v1')).toBeNull()
  expect(screen.queryByLabelText('Invitation link')).toBeNull()
})

it('hides a restored link until its server status is verified', async () => {
  sessionStorage.setItem(
    'scsb:transfer:sender:v1',
    JSON.stringify({
      id: 'i1',
      token,
      expires_at: future(),
    }),
  )
  let complete!: (value: string) => void
  mocks.status.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  render(<TransferOwnershipPanel vehicle={vehicle} onClose={() => {}} />)
  expect(screen.queryByLabelText('Invitation link')).toBeNull()
  expect(screen.getByRole('button', { name: /Copy link/ })).toBeDisabled()
  expect(document.body.innerHTML).not.toContain(token)
  await act(async () => complete('revoked'))
  await screen.findByText(/invitation was revoked/)
  expect(sessionStorage.getItem('scsb:transfer:sender:v1')).toBeNull()
})

it('does not clear a newer sender flow when revocation finishes after closing', async () => {
  sessionStorage.setItem(
    'scsb:transfer:sender:v1',
    JSON.stringify({
      id: 'i1',
      token,
      expires_at: future(),
    }),
  )
  let complete!: () => void
  mocks.revoke.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      complete = resolve
    }),
  )
  const mounted = render(
    <TransferOwnershipPanel vehicle={vehicle} onClose={() => {}} />,
  )
  await screen.findByLabelText('Invitation link')
  fireEvent.click(screen.getByRole('button', { name: 'Revoke invitation' }))
  mounted.unmount()
  const newer = JSON.stringify({
    id: 'i2',
    token: 'c'.repeat(64),
    expires_at: future(),
  })
  sessionStorage.setItem('scsb:transfer:sender:v1', newer)
  await act(async () => complete())
  expect(sessionStorage.getItem('scsb:transfer:sender:v1')).toBe(newer)
})
