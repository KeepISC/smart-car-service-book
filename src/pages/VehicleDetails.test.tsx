import { render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { VehicleDetails } from './VehicleDetails'
afterEach(() => vi.unstubAllEnvs())

vi.mock('../services/vehicles', () => ({
  getVehicle: async () => ({
    id: 'fictional',
    make: 'Fictional',
    model: 'Audit',
    mileage: 10000,
  }),
}))
vi.mock('../components/ServiceHistoryPanel', () => ({
  ServiceHistoryPanel: () => <p>Fictional history</p>,
}))
vi.mock('../components/MaintenancePanel', () => ({
  MaintenancePanel: () => null,
}))

it('marks only Service history pressed when the history section is open', async () => {
  vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', 'true')
  render(
    <MemoryRouter initialEntries={['/vehicles/fictional?tab=history']}>
      <Routes>
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByText('Fictional history')
  expect(
    screen.getByRole('button', { name: 'Service history' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(screen.getByRole('button', { name: 'Maintenance' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

it('does not render Service History or honor its deep link when disabled', async () => {
  vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', 'false')
  render(
    <MemoryRouter initialEntries={['/vehicles/fictional?tab=history']}>
      <Routes>
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Vehicle overview' })
  expect(
    screen.queryByRole('button', { name: 'Service history' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Fictional history')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
