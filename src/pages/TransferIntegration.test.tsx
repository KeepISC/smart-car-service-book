import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TransferInvitation } from './TransferInvitation'
import { Garage } from './Garage'
import { VehicleDetails } from './VehicleDetails'
import { NotificationCenter } from '../components/NotificationCenter'
import { refreshOwnershipViews } from '../services/ownershipChanges'

const api = vi.hoisted(() => ({
  rpc: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  history: vi.fn(),
  summary: vi.fn(),
  owns: false,
}))
vi.mock('../services/supabase', () => ({ client: () => ({ rpc: api.rpc }) }))
vi.mock('../services/auth', () => ({
  authService: { available: true, getUser: vi.fn() },
}))
vi.mock('../services/vehicles', async (original) => ({
  ...(await original<typeof import('../services/vehicles')>()),
  listVehicles: api.list,
  getVehicle: api.get,
  loadVehicleMileageHistory: api.history,
}))
vi.mock('../services/maintenance', () => ({
  loadGarageMaintenanceSummary: api.summary,
}))
vi.mock('../components/MaintenancePanel', () => ({
  MaintenancePanel: () => <p>Maintenance page</p>,
}))
const token = 'a'.repeat(64)
const vehicle = {
  id: 'v1',
  type: 'car',
  make: 'Fictional',
  model: 'Integrated',
  year: 2020,
  engine: 'Example',
  mileage: 25000,
  license_plate: null,
  vin: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  api.owns = false
  sessionStorage.clear()
  window.history.replaceState(null, '', `/transfer#${token}`)
  api.list.mockImplementation(async () => (api.owns ? [vehicle] : []))
  api.get.mockImplementation(async () => {
    if (!api.owns) throw { code: 'PGRST116' }
    return vehicle
  })
  api.history.mockResolvedValue([
    {
      id: 'h1',
      vehicle_id: 'v1',
      mileage: 24000,
      source: 'manual',
      recorded_at: '2026-01-31T12:00:00Z',
    },
  ])
  api.summary.mockResolvedValue({
    overdue: 1,
    dueSoon: 0,
    alerts: [
      {
        id: 'oil',
        vehicleId: 'v1',
        vehicleName: 'Fictional Integrated',
        operationName: 'Oil service',
        status: 'Due / overdue',
        dueDate: '2026-01-31',
        dueMileage: 24000,
        kmRemaining: -1000,
        daysRemaining: -1,
      },
    ],
  })
  api.rpc.mockImplementation(async (name: string) => {
    if (name === 'preview_vehicle_transfer')
      return {
        data: {
          id: 'invite',
          expires_at: new Date(Date.now() + 60000).toISOString(),
          vehicle,
          maintenance_records: [],
          maintenance_schedules: [],
        },
        error: null,
      }
    if (name === 'accept_vehicle_transfer') {
      api.owns = true
      return { data: 'v1', error: null }
    }
    throw new Error('Unexpected RPC')
  })
})
function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationCenter initialOpen />
      <Garage />
      <Routes>
        <Route path="/transfer" element={<TransferInvitation />} />
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
}
it('acceptance refreshes mounted Garage, alerts, notifications, details and mileage history', async () => {
  open('/transfer')
  const accept = await screen.findByRole('button', { name: 'Accept vehicle' })
  await screen.findByText('Make room for your first vehicle')
  fireEvent.click(accept)
  await screen.findByRole('heading', { name: 'Vehicle overview' })
  await screen.findByRole('link', { name: /Fictional Integrated.*25,000 km/ })
  await waitFor(() =>
    expect(screen.getAllByText('Oil service').length).toBeGreaterThanOrEqual(1),
  )
  expect(await screen.findByText('24,000 km')).toBeInTheDocument()
  expect(api.history).toHaveBeenCalledWith('v1')
  expect(api.summary).toHaveBeenCalledWith([vehicle], expect.any(String))
  expect(sessionStorage.length).toBe(0)
})
it('an ownership signal clears existing cards, notifications, details and history', async () => {
  api.owns = true
  open('/vehicles/v1')
  await screen.findByRole('heading', { name: 'Vehicle overview' })
  await screen.findByText('24,000 km')
  await waitFor(() =>
    expect(screen.getAllByText('Oil service').length).toBeGreaterThanOrEqual(1),
  )
  api.owns = false
  fireEvent(window, new Event('focus'))
  // Same signal used by another tab and by authoritative ownership polling.
  refreshOwnershipViews()
  await screen.findByText(
    'This vehicle is unavailable or you do not have access.',
  )
  await screen.findByText('Make room for your first vehicle')
  expect(screen.queryByText('Oil service')).toBeNull()
  expect(screen.queryByText('24,000 km')).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Vehicle overview' })).toBeNull()
})
