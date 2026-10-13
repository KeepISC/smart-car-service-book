import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { VehicleDetails } from './VehicleDetails'

const mocks = vi.hoisted(() => ({
  getVehicle: vi.fn(),
  updateVehicleMileage: vi.fn(),
  deleteVehicle: vi.fn(),
  loadVehicleMileageHistory: vi.fn(),
}))

vi.mock('../services/vehicles', () => ({
  getVehicle: (...args: unknown[]) => mocks.getVehicle(...args),
  updateVehicleMileage: (...args: unknown[]) =>
    mocks.updateVehicleMileage(...args),
  deleteVehicle: (...args: unknown[]) => mocks.deleteVehicle(...args),
  loadVehicleMileageHistory: (...args: unknown[]) =>
    mocks.loadVehicleMileageHistory(...args),
}))

vi.mock('../components/ServiceHistoryPanel', () => ({
  ServiceHistoryPanel: () => <p>Fictional history</p>,
}))
vi.mock('../components/MaintenancePanel', () => ({
  MaintenancePanel: () => <p>Fictional maintenance</p>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadVehicleMileageHistory.mockResolvedValue([])
  mocks.getVehicle.mockResolvedValue({
    id: 'fictional',
    type: 'car',
    make: 'Fictional',
    model: 'Audit',
    year: 2022,
    engine: '2.0',
    mileage: 10000,
    license_plate: 'DEMO-01',
    vin: null,
  })
})

afterEach(() => vi.unstubAllEnvs())

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

it('opens the maintenance tab and marks Maintenance button pressed when navigating with ?tab=maintenance', async () => {
  render(
    <MemoryRouter initialEntries={['/vehicles/fictional?tab=maintenance']}>
      <Routes>
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByText('Fictional maintenance')
  expect(screen.getByRole('button', { name: 'Maintenance' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(
    screen.queryByRole('heading', { name: 'Vehicle overview' }),
  ).not.toBeInTheDocument()
})

it('displays current mileage and an edit button in vehicle overview', async () => {
  render(
    <MemoryRouter initialEntries={['/vehicles/fictional']}>
      <Routes>
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Vehicle overview' })
  expect(screen.getByText('10,000 km')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Edit current mileage' }),
  ).toBeInTheDocument()
})

it('opens edit mode with initial mileage and cancels back to view mode', async () => {
  render(
    <MemoryRouter initialEntries={['/vehicles/fictional']}>
      <Routes>
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Vehicle overview' })
  const editBtn = screen.getByRole('button', { name: 'Edit current mileage' })
  fireEvent.click(editBtn)

  const input = screen.getByLabelText(
    'Current mileage in km',
  ) as HTMLInputElement
  expect(input).toBeInTheDocument()
  expect(input.value).toBe('10000')

  const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
  fireEvent.click(cancelBtn)

  expect(
    screen.queryByLabelText('Current mileage in km'),
  ).not.toBeInTheDocument()
  expect(screen.getByText('10,000 km')).toBeInTheDocument()
  expect(mocks.updateVehicleMileage).not.toHaveBeenCalled()
})

it.each(['', '-5', '10000.5', 'invalid'])(
  'rejects invalid mileage input %s',
  async (invalidValue) => {
    render(
      <MemoryRouter initialEntries={['/vehicles/fictional']}>
        <Routes>
          <Route path="/vehicles/:id" element={<VehicleDetails />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'Vehicle overview' })
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit current mileage' }),
    )

    const input = screen.getByLabelText('Current mileage in km')
    fireEvent.change(input, { target: { value: invalidValue } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      screen.getByText('Enter a whole number between 0 and 10,000,000.'),
    ).toBeInTheDocument()
    expect(mocks.updateVehicleMileage).not.toHaveBeenCalled()
  },
)

it('prevents decreases below the existing recorded mileage', async () => {
  render(
    <MemoryRouter initialEntries={['/vehicles/fictional']}>
      <Routes>
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Vehicle overview' })
  fireEvent.click(screen.getByRole('button', { name: 'Edit current mileage' }))

  const input = screen.getByLabelText('Current mileage in km')
  fireEvent.change(input, { target: { value: '9999' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(
    screen.getByText(
      'Mileage cannot be decreased below the existing recorded 10,000 km.',
    ),
  ).toBeInTheDocument()
  expect(mocks.updateVehicleMileage).not.toHaveBeenCalled()
})

it('successfully updates mileage and shows success feedback', async () => {
  mocks.updateVehicleMileage.mockResolvedValueOnce({
    id: 'fictional',
    type: 'car',
    make: 'Fictional',
    model: 'Audit',
    year: 2022,
    engine: '2.0',
    mileage: 12500,
    license_plate: 'DEMO-01',
    vin: null,
  })

  render(
    <MemoryRouter initialEntries={['/vehicles/fictional']}>
      <Routes>
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Vehicle overview' })
  fireEvent.click(screen.getByRole('button', { name: 'Edit current mileage' }))

  const input = screen.getByLabelText('Current mileage in km')
  fireEvent.change(input, { target: { value: '12500' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

  await waitFor(() => {
    expect(
      screen.getByText('Vehicle mileage updated successfully.'),
    ).toBeInTheDocument()
  })
  expect(screen.getByText('12,500 km')).toBeInTheDocument()
  expect(
    screen.queryByLabelText('Current mileage in km'),
  ).not.toBeInTheDocument()
  expect(mocks.updateVehicleMileage).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'fictional', mileage: 10000 }),
    12500,
  )
})

it('displays error message when mileage update fails and keeps input intact', async () => {
  mocks.updateVehicleMileage.mockRejectedValueOnce(
    new Error('Network error occurred'),
  )

  render(
    <MemoryRouter initialEntries={['/vehicles/fictional']}>
      <Routes>
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Vehicle overview' })
  fireEvent.click(screen.getByRole('button', { name: 'Edit current mileage' }))

  const input = screen.getByLabelText('Current mileage in km')
  fireEvent.change(input, { target: { value: '13000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => {
    expect(screen.getByText('Network error occurred')).toBeInTheDocument()
  })
  expect(screen.getByLabelText('Current mileage in km')).toHaveValue(13000)
  expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
})

it('cancels editing when Escape key is pressed in the input', async () => {
  render(
    <MemoryRouter initialEntries={['/vehicles/fictional']}>
      <Routes>
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Vehicle overview' })
  fireEvent.click(screen.getByRole('button', { name: 'Edit current mileage' }))

  const input = screen.getByLabelText('Current mileage in km')
  fireEvent.keyDown(input, { key: 'Escape' })

  expect(
    screen.queryByLabelText('Current mileage in km'),
  ).not.toBeInTheDocument()
  expect(screen.getByText('10,000 km')).toBeInTheDocument()
})

it('displays mileage history panel in vehicle details overview', async () => {
  mocks.loadVehicleMileageHistory.mockResolvedValueOnce([
    {
      id: 'hist-1',
      vehicle_id: 'fictional',
      recorded_at: '2026-01-01T00:00:00Z',
      mileage: 10000,
      source: 'manual',
    },
  ])

  render(
    <MemoryRouter initialEntries={['/vehicles/fictional']}>
      <Routes>
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Vehicle overview' })
  await screen.findByRole('heading', { name: 'Mileage history' })
  expect(mocks.loadVehicleMileageHistory).toHaveBeenCalledWith('fictional')
  expect(screen.getByText('Manual')).toBeInTheDocument()
})

it('refreshes mileage history after a successful mileage update', async () => {
  mocks.loadVehicleMileageHistory
    .mockResolvedValueOnce([
      {
        id: 'hist-1',
        vehicle_id: 'fictional',
        recorded_at: '2026-01-01T00:00:00Z',
        mileage: 10000,
        source: 'manual',
      },
    ])
    .mockResolvedValueOnce([
      {
        id: 'hist-2',
        vehicle_id: 'fictional',
        recorded_at: '2026-02-01T00:00:00Z',
        mileage: 12500,
        source: 'manual',
      },
      {
        id: 'hist-1',
        vehicle_id: 'fictional',
        recorded_at: '2026-01-01T00:00:00Z',
        mileage: 10000,
        source: 'manual',
      },
    ])

  mocks.updateVehicleMileage.mockResolvedValueOnce({
    id: 'fictional',
    type: 'car',
    make: 'Fictional',
    model: 'Audit',
    year: 2022,
    engine: '2.0',
    mileage: 12500,
    license_plate: 'DEMO-01',
    vin: null,
  })

  render(
    <MemoryRouter initialEntries={['/vehicles/fictional']}>
      <Routes>
        <Route path="/vehicles/:id" element={<VehicleDetails />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByRole('heading', { name: 'Vehicle overview' })
  expect(mocks.loadVehicleMileageHistory).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: 'Edit current mileage' }))
  fireEvent.change(screen.getByLabelText('Current mileage in km'), {
    target: { value: '12500' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => {
    expect(mocks.loadVehicleMileageHistory).toHaveBeenCalledTimes(2)
  })
})
