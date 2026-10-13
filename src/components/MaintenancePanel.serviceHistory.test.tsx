import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MaintenancePanel } from './MaintenancePanel'
import type { Vehicle } from '../types/vehicle'

const api = vi.hoisted(() => ({
  loadMaintenance: vi.fn(),
  saveMaintenance: vi.fn(),
  removeMaintenance: vi.fn(),
}))
vi.mock('../services/maintenance', () => api)
afterEach(() => vi.unstubAllEnvs())

it('reloads derived service completions after editing permanent schedule intervals', async () => {
  vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', 'true')
  const baseline = {
    id: 'schedule',
    vehicle_id: 'vehicle',
    name: 'Fictional oil',
    interval_km: 10000,
    interval_months: 12,
    enabled: true,
    history_status: 'known',
    last_completed_date: '2025-01-01',
    last_completed_mileage: 1000,
  }
  const derived = {
    ...baseline,
    last_completed_date: '2026-10-01',
    last_completed_mileage: 15000,
    next_interval_km: 12000,
  }
  api.loadMaintenance.mockResolvedValue({ items: [derived], templates: [] })
  api.saveMaintenance.mockResolvedValue([baseline])
  render(
    <MaintenancePanel vehicle={{ id: 'vehicle', mileage: 20000 } as Vehicle} />,
  )
  await screen.findByText('Fictional oil')
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
  fireEvent.click(screen.getByRole('button', { name: /Save/ }))
  await waitFor(() => expect(api.loadMaintenance).toHaveBeenCalledTimes(2))
  expect(await screen.findByText(/27,000/)).toBeInTheDocument()
})
