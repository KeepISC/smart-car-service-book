import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MaintenancePanel } from './MaintenancePanel'
import type { Vehicle } from '../types/vehicle'
const api = vi.hoisted(() => ({
  loadMaintenance: vi.fn(),
  saveMaintenance: vi.fn(),
  removeMaintenance: vi.fn(),
}))
vi.mock('../services/maintenance', () => api)
const vehicle = { id: 'fictional-vehicle', mileage: 10000 } as Vehicle
beforeEach(() => {
  vi.clearAllMocks()
  api.loadMaintenance.mockResolvedValue({ items: [], templates: [] })
  api.saveMaintenance.mockImplementation(async (_vehicle, inputs) =>
    inputs.map((item: object, index: number) => ({
      ...item,
      id: `fictional-item-${index}`,
      vehicle_id: vehicle.id,
    })),
  )
})
it('requires explicit review before persisting starter examples and saves edited intervals', async () => {
  render(<MaintenancePanel vehicle={vehicle} />)
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Review editable starter schedule',
    }),
  )
  expect(api.saveMaintenance).not.toHaveBeenCalled()
  expect(
    screen.getByText(/Unverified illustrative starter values/),
  ).toBeInTheDocument()
  expect(screen.getAllByLabelText('Operation name')).toHaveLength(5)
  fireEvent.change(screen.getAllByLabelText('Interval (km, optional)')[0], {
    target: { value: '15000' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Save reviewed schedule' }),
  )
  await waitFor(() => expect(api.saveMaintenance).toHaveBeenCalledOnce())
  expect(api.saveMaintenance.mock.calls[0][1][0].interval_km).toBe(15000)
  expect(
    api.saveMaintenance.mock.calls[0][1].every(
      (item: { history_status: string }) => item.history_status === 'unknown',
    ),
  ).toBe(true)
})
it('allows a blank schedule without saving unintended operations', async () => {
  render(<MaintenancePanel vehicle={vehicle} />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Start a blank schedule' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Remove operation 1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Keep schedule blank' }))
  expect(api.saveMaintenance).not.toHaveBeenCalled()
})
it('offers matching verified templates with source information without auto-loading', async () => {
  api.loadMaintenance.mockResolvedValue({
    items: [],
    templates: [
      {
        id: 'fictional-template',
        name: 'Fictional verified test template',
        source_name: 'Test source',
        source_url: 'https://example.invalid/document',
        maintenance_template_items: [
          { name: 'Test operation', interval_km: 10000, interval_months: 12 },
        ],
      },
    ],
  })
  render(<MaintenancePanel vehicle={vehicle} />)
  expect(
    await screen.findByRole('button', { name: 'Review verified template' }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Source: Test source' }),
  ).toHaveAttribute('href', 'https://example.invalid/document')
  expect(api.saveMaintenance).not.toHaveBeenCalled()
})
it('shows a recoverable setup error when migrations are unavailable', async () => {
  api.loadMaintenance.mockRejectedValue(new Error('Missing relation'))
  render(<MaintenancePanel vehicle={vehicle} />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'maintenance migration',
  )
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
})
