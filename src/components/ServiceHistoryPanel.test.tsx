import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ServiceHistoryPanel } from './ServiceHistoryPanel'
import type { Vehicle } from '../types/vehicle'
import type { ServiceVisit } from '../types/serviceHistory'

const api = vi.hoisted(() => ({
  loadServiceHistory: vi.fn(),
  saveServiceVisit: vi.fn(),
  deleteServiceVisit: vi.fn(),
  loadMaintenance: vi.fn(),
}))
vi.mock('../services/serviceHistory', () => api)
vi.mock('../services/maintenance', () => ({
  loadMaintenance: api.loadMaintenance,
}))

const vehicle = {
  id: 'fictional-vehicle',
  mileage: 20000,
} as Vehicle
const schedule = {
  id: 'fictional-schedule',
  name: 'Fictional scheduled inspection',
  interval_km: 10000,
  interval_months: 12,
  enabled: true,
  history_status: 'unknown',
  last_completed_date: null,
  last_completed_mileage: null,
  vehicle_id: vehicle.id,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}
const visit: ServiceVisit = {
  id: 'fictional-visit',
  vehicle_id: vehicle.id,
  service_date: '2026-10-01',
  mileage: 15000,
  service_type: 'diy',
  workshop_name: null,
  total_cost: 100,
  notes: 'Fictional note',
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
  operations: [
    {
      id: 'fictional-operation',
      service_visit_id: 'fictional-visit',
      maintenance_item_id: 'fictional-schedule',
      operation_name: 'Fictional service',
      cost: null,
      next_interval_km: 12000,
      next_interval_months: null,
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:00:00Z',
    },
  ],
}
beforeEach(() => {
  vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', 'true')
  vi.clearAllMocks()
  api.loadServiceHistory.mockResolvedValue([])
  api.loadMaintenance.mockResolvedValue({ items: [schedule], templates: [] })
  api.saveServiceVisit.mockResolvedValue('fictional-visit')
  api.deleteServiceVisit.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

it('renders nothing and invokes no service when disabled', () => {
  vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', 'false')
  const view = render(<ServiceHistoryPanel vehicle={vehicle} />)
  expect(view.container).toBeEmptyDOMElement()
  expect(api.loadServiceHistory).not.toHaveBeenCalled()
  expect(api.loadMaintenance).not.toHaveBeenCalled()
})

it('adds a workshop visit with selected and custom operations', async () => {
  render(<ServiceHistoryPanel vehicle={vehicle} />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Add service visit' }),
  )
  fireEvent.change(screen.getByLabelText('Service date'), {
    target: { value: '2026-10-01' },
  })
  fireEvent.click(screen.getByLabelText('Workshop'))
  fireEvent.change(screen.getByLabelText('Workshop name (optional)'), {
    target: { value: 'Fictional workshop' },
  })
  fireEvent.change(screen.getByLabelText('Total cost (optional)'), {
    target: { value: '145.75' },
  })
  fireEvent.click(screen.getByLabelText('Fictional scheduled inspection'))
  fireEvent.change(screen.getByLabelText('Operation name'), {
    target: { value: 'Fictional scheduled inspection' },
  })
  fireEvent.change(screen.getByLabelText('Operation cost (optional)'), {
    target: { value: '25.40' },
  })
  fireEvent.change(
    screen.getByLabelText('Next interval override (km, optional)'),
    { target: { value: '15000' } },
  )
  fireEvent.change(
    screen.getByLabelText('Next interval override (months, optional)'),
    { target: { value: '18' } },
  )
  fireEvent.click(screen.getByRole('button', { name: 'Add custom operation' }))
  const operationNames = screen.getAllByLabelText('Operation name')
  fireEvent.change(operationNames[1], {
    target: { value: 'Fictional custom task' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save service visit' }))
  await waitFor(() => expect(api.saveServiceVisit).toHaveBeenCalledOnce())
  expect(api.saveServiceVisit.mock.calls[0][1]).toMatchObject({
    service_type: 'workshop',
    workshop_name: 'Fictional workshop',
    total_cost: 145.75,
    operations: [
      expect.objectContaining({
        maintenance_item_id: schedule.id,
        operation_name: schedule.name,
        cost: 25.4,
        next_interval_km: 15000,
        next_interval_months: 18,
      }),
      expect.objectContaining({
        maintenance_item_id: null,
        operation_name: 'Fictional custom task',
      }),
    ],
  })
})

it('edits then confirms deletion of a historical DIY visit', async () => {
  api.loadServiceHistory.mockResolvedValue([visit])
  render(<ServiceHistoryPanel vehicle={vehicle} />)
  fireEvent.click(await screen.findByRole('button', { name: /^Edit$/ }))
  fireEvent.change(screen.getByLabelText('Total cost (optional)'), {
    target: { value: '90.25' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(api.saveServiceVisit).toHaveBeenCalledWith(
      vehicle,
      expect.objectContaining({ total_cost: 90.25 }),
      visit.id,
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
  expect(
    screen.getByRole('group', { name: 'Confirm service visit deletion' }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Delete visit' }))
  await waitFor(() =>
    expect(api.deleteServiceVisit).toHaveBeenCalledWith(vehicle.id, visit.id),
  )
})

it('shows an empty state and surfaces form validation feedback', async () => {
  render(<ServiceHistoryPanel vehicle={vehicle} />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Add service visit' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save service visit' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Add between 1 and 50 service operations.',
  )
  expect(api.saveServiceVisit).not.toHaveBeenCalled()
})
