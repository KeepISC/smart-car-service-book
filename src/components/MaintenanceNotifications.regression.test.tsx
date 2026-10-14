import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { NotificationCenter } from './NotificationCenter'
import { MaintenanceAlertSummary } from './MaintenanceAlertSummary'
import type { Vehicle } from '../types/vehicle'
import type { MaintenanceAlertSummary as Summary } from '../types/maintenance'

const api = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn() }))
vi.mock('../services/vehicles', () => ({ listVehicles: api.list }))
vi.mock('../services/maintenance', () => ({
  loadGarageMaintenanceSummary: api.summary,
}))
const vehicles = [{ id: 'fictional', mileage: 10000 }] as Vehicle[]
beforeEach(() => {
  vi.resetAllMocks()
  api.list.mockResolvedValue(vehicles)
})

it('recovers on refresh and ignores an older notification response', async () => {
  api.summary.mockRejectedValueOnce(new Error('Offline'))
  render(
    <MemoryRouter>
      <NotificationCenter initialOpen />
    </MemoryRouter>,
  )
  await screen.findByRole('alert')
  let resolveOld!: (value: Summary) => void
  api.summary.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(api.summary).toHaveBeenCalledTimes(2))
  expect(
    screen.getByText('Loading notifications…').closest('[role="status"]'),
  ).toBeInTheDocument()
  api.summary.mockResolvedValueOnce({ overdue: 0, dueSoon: 0, alerts: [] })
  fireEvent(window, new Event('app:maintenance-change'))
  await screen.findByText('All maintenance is up to date')
  await act(async () =>
    resolveOld({
      overdue: 1,
      dueSoon: 0,
      alerts: [
        {
          id: 'old',
          vehicleId: 'fictional',
          vehicleName: 'Fictional car',
          operationName: 'Old response',
          status: 'Due / overdue',
          dueDate: null,
          dueMileage: 10000,
          kmRemaining: 0,
          daysRemaining: null,
        },
      ],
    }),
  )
  expect(
    screen.getByRole('button', { name: 'Notifications' }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('refreshes garage counters after changes and recovers from an error', async () => {
  api.summary.mockRejectedValueOnce(new Error('Offline'))
  render(<MaintenanceAlertSummary vehicles={vehicles} />)
  await screen.findByRole('alert')
  api.summary.mockResolvedValueOnce({ overdue: 1, dueSoon: 0, alerts: [] })
  fireEvent(window, new Event('app:maintenance-change'))
  await waitFor(() =>
    expect(
      screen.getByLabelText('Overdue maintenance operations'),
    ).toHaveTextContent('01'),
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
