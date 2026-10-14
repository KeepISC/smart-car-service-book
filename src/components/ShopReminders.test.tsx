import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ShopReminderAction } from './ShopReminderAction'
import { NotificationCenter } from './NotificationCenter'
import type { ShopReminder } from '../types/shopReminder'
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
}))
vi.mock('../services/shopReminders', () => ({
  sendShopMaintenanceReminder: mocks.send,
  listShopMaintenanceReminders: mocks.list,
  setShopMaintenanceReminderState: mocks.update,
}))
vi.mock('../services/vehicles', () => ({ listVehicles: async () => [] }))
vi.mock('../services/maintenance', () => ({
  loadGarageMaintenanceSummary: vi.fn(),
}))
const reminder: ShopReminder = {
  id: 'r1',
  vehicle_id: 'v1',
  shop_id: 's1',
  shop_name: 'Fictional reminder garage',
  maintenance_item_id: 'm1',
  operation_name: 'Oil and filter',
  vehicle_name: '2020 Fictional Example',
  created_at: '2026-01-01T12:00:00Z',
  read_at: null,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.send.mockResolvedValue('r1')
  mocks.list.mockResolvedValue([reminder])
  mocks.update.mockResolvedValue(undefined)
})
function inbox() {
  return render(
    <MemoryRouter>
      <NotificationCenter initialOpen />
    </MemoryRouter>,
  )
}
function action(onDenied = vi.fn()) {
  return render(
    <ShopReminderAction
      shopId="s1"
      vehicleId="v1"
      itemId="m1"
      label="Schedule 1"
      onDenied={onDenied}
    />,
  )
}

it('sends a reminder once and disables the action while saving and after success', async () => {
  let resolve!: (value: string) => void
  mocks.send.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done
    }),
  )
  action()
  fireEvent.click(
    screen.getByRole('button', { name: 'Send reminder for Schedule 1' }),
  )
  expect(screen.getByRole('button')).toBeDisabled()
  fireEvent.click(screen.getByRole('button'))
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith('s1', 'v1', 'm1')
  resolve('r1')
  await screen.findByText('Reminder sent to the vehicle owner.')
  expect(screen.getByRole('button')).toBeDisabled()
})
it.each(['P0001', '23514', '40001', 'network'])(
  'shows sending error %s without success or automatic retry',
  async (code) => {
    mocks.send.mockRejectedValue({ code })
    action()
    fireEvent.click(screen.getByRole('button'))
    await screen.findByRole('alert')
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(screen.queryByText('Reminder sent to the vehicle owner.')).toBeNull()
  },
)
it('reports lost vehicle/shop access to the CRM', async () => {
  mocks.send.mockRejectedValue({ code: '42501' })
  const denied = vi.fn()
  action(denied)
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(denied).toHaveBeenCalledOnce())
})
it('shows persisted reminder details, destination and unread badge on mount', async () => {
  inbox()
  await screen.findByText('Fictional reminder garage')
  expect(screen.getByText(/2020 Fictional Example/)).toHaveTextContent(
    'Oil and filter',
  )
  expect(
    screen.getByRole('link', { name: 'View vehicle for Oil and filter' }),
  ).toHaveAttribute('href', '/vehicles/v1?tab=maintenance')
  expect(
    screen.getByRole('button', {
      name: 'Notifications (1 items require attention)',
    }),
  ).toBeTruthy()
})
it('persists read/dismiss state without removing ordinary maintenance notification controls', async () => {
  inbox()
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Mark Oil and filter reminder as read',
    }),
  )
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('r1', 'read'))
  await screen.findByRole('button', { name: 'Notifications' })
  expect(
    screen.queryByRole('button', {
      name: 'Mark Oil and filter reminder as read',
    }),
  ).toBeNull()
  fireEvent.click(
    screen.getByRole('button', { name: 'Dismiss Oil and filter reminder' }),
  )
  await waitFor(() =>
    expect(mocks.update).toHaveBeenLastCalledWith('r1', 'dismissed'),
  )
  await waitFor(() =>
    expect(screen.queryByText('Fictional reminder garage')).toBeNull(),
  )
})
it('refreshes reminders on focus and clears reminders invalidated by a transfer', async () => {
  inbox()
  await screen.findByText('Fictional reminder garage')
  mocks.list.mockResolvedValue([])
  fireEvent(window, new Event('focus'))
  await waitFor(() =>
    expect(screen.queryByText('Fictional reminder garage')).toBeNull(),
  )
  expect(mocks.list).toHaveBeenCalledTimes(2)
})
it('does not restore a late inbox response after an ownership-change signal', async () => {
  let resolve!: (rows: ShopReminder[]) => void
  mocks.list.mockReturnValue(
    new Promise<ShopReminder[]>((done) => {
      resolve = done
    }),
  )
  inbox()
  await waitFor(() => expect(mocks.list).toHaveBeenCalledOnce())
  fireEvent(window, new Event('app:ownership-change'))
  await act(async () => resolve([reminder]))
  expect(screen.queryByText('Fictional reminder garage')).toBeNull()
})
it('shows inbox and update failures with a reload path', async () => {
  mocks.list.mockRejectedValueOnce(new Error('unavailable'))
  inbox()
  await screen.findByText(/Unable to load shop reminders/)
  fireEvent.click(screen.getByRole('button', { name: 'Reload shop reminders' }))
  await screen.findByText('Fictional reminder garage')
  mocks.update.mockRejectedValue({ code: '42501' })
  fireEvent.click(
    screen.getByRole('button', { name: 'Dismiss Oil and filter reminder' }),
  )
  await screen.findByText(/Unable to update the reminder/)
  expect(screen.queryByText('Fictional reminder garage')).toBeNull()
})
