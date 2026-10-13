import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MaintenanceAlertSummary } from './MaintenanceAlertSummary'
import type { Vehicle } from '../types/vehicle'

const mockSummary = vi.hoisted(() => ({
  loadGarageMaintenanceSummary: vi.fn(),
}))

vi.mock('../services/maintenance', () => ({
  loadGarageMaintenanceSummary: mockSummary.loadGarageMaintenanceSummary,
}))

const fictionalCar: Vehicle = {
  id: 'car-1',
  owner_id: 'owner-1',
  type: 'car',
  make: 'Fictional',
  model: 'Sedan',
  year: 2021,
  engine: '2.0L',
  mileage: 25000,
  license_plate: null,
  vin: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const fictionalBike: Vehicle = {
  id: 'bike-1',
  owner_id: 'owner-1',
  type: 'motorcycle',
  make: 'Fictional',
  model: 'Cruiser',
  year: 2022,
  engine: '650cc',
  mileage: 12000,
  license_plate: null,
  vin: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('displays loading state while vehicles or alerts are loading', () => {
  render(<MaintenanceAlertSummary vehicles={[]} vehiclesLoading={true} />)

  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(screen.getByText('Loading maintenance alerts…')).toBeInTheDocument()
})

it('displays zero counters and empty state message when garage has no vehicles', async () => {
  render(<MaintenanceAlertSummary vehicles={[]} vehiclesLoading={false} />)

  expect(
    screen.getByLabelText('Overdue maintenance operations'),
  ).toHaveTextContent('00')
  expect(
    screen.getByLabelText('Maintenance operations due soon'),
  ).toHaveTextContent('00')
  expect(
    screen.getByText(
      'No vehicles in your garage yet. Add a vehicle to track maintenance alerts.',
    ),
  ).toBeInTheDocument()
  expect(mockSummary.loadGarageMaintenanceSummary).not.toHaveBeenCalled()
})

it('displays error state with retry option when alert loading fails', async () => {
  mockSummary.loadGarageMaintenanceSummary.mockRejectedValueOnce(
    new Error('Network error'),
  )

  render(
    <MaintenanceAlertSummary
      vehicles={[fictionalCar]}
      vehiclesLoading={false}
    />,
  )

  expect(
    await screen.findByText(
      'We couldn’t load maintenance alerts. Check your connection and try again.',
    ),
  ).toBeInTheDocument()

  mockSummary.loadGarageMaintenanceSummary.mockResolvedValueOnce({
    overdue: 0,
    dueSoon: 0,
  })

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

  await waitFor(() => {
    expect(
      screen.getByText(
        'All scheduled maintenance across your vehicles is up to date.',
      ),
    ).toBeInTheDocument()
  })
})

it('displays reassuring up-to-date status when no operations are overdue or due soon', async () => {
  mockSummary.loadGarageMaintenanceSummary.mockResolvedValueOnce({
    overdue: 0,
    dueSoon: 0,
  })

  render(
    <MaintenanceAlertSummary
      vehicles={[fictionalCar, fictionalBike]}
      vehiclesLoading={false}
    />,
  )

  await waitFor(() => {
    expect(
      screen.getByText(
        'All scheduled maintenance across your vehicles is up to date.',
      ),
    ).toBeInTheDocument()
  })

  expect(
    screen.getByLabelText('Overdue maintenance operations'),
  ).toHaveTextContent('00')
  expect(
    screen.getByLabelText('Maintenance operations due soon'),
  ).toHaveTextContent('00')
})

it('displays aggregated overdue and due soon counters and attention banner', async () => {
  mockSummary.loadGarageMaintenanceSummary.mockResolvedValueOnce({
    overdue: 2,
    dueSoon: 1,
  })

  render(
    <MaintenanceAlertSummary
      vehicles={[fictionalCar, fictionalBike]}
      vehiclesLoading={false}
    />,
  )

  await waitFor(() => {
    expect(
      screen.getByLabelText('Overdue maintenance operations'),
    ).toHaveTextContent('02')
  })

  expect(
    screen.getByLabelText('Maintenance operations due soon'),
  ).toHaveTextContent('01')
  expect(
    screen.getByText('2 overdue and 1 due soon operations require attention.'),
  ).toBeInTheDocument()
})

it('handles vehicles error from parent gracefully', () => {
  render(
    <MaintenanceAlertSummary
      vehicles={[]}
      vehiclesLoading={false}
      vehiclesError="Failed to load vehicles"
    />,
  )

  expect(
    screen.getByText(
      'Unable to load vehicles for maintenance alert calculation.',
    ),
  ).toBeInTheDocument()
  expect(mockSummary.loadGarageMaintenanceSummary).not.toHaveBeenCalled()
})

it('refreshes alert calculations when local date changes at midnight', async () => {
  mockSummary.loadGarageMaintenanceSummary.mockResolvedValueOnce({
    overdue: 0,
    dueSoon: 0,
  })

  const { rerender } = render(
    <MaintenanceAlertSummary
      vehicles={[fictionalCar]}
      vehiclesLoading={false}
      today="2026-10-12"
    />,
  )

  await waitFor(() => {
    expect(mockSummary.loadGarageMaintenanceSummary).toHaveBeenCalledWith(
      [fictionalCar],
      '2026-10-12',
    )
  })

  mockSummary.loadGarageMaintenanceSummary.mockResolvedValueOnce({
    overdue: 1,
    dueSoon: 0,
  })

  rerender(
    <MaintenanceAlertSummary
      vehicles={[fictionalCar]}
      vehiclesLoading={false}
      today="2026-10-13"
    />,
  )

  await waitFor(() => {
    expect(mockSummary.loadGarageMaintenanceSummary).toHaveBeenCalledWith(
      [fictionalCar],
      '2026-10-13',
    )
    expect(
      screen.getByLabelText('Overdue maintenance operations'),
    ).toHaveTextContent('01')
  })
})

it('refreshes alert counters when vehicles prop updates', async () => {
  mockSummary.loadGarageMaintenanceSummary.mockResolvedValueOnce({
    overdue: 1,
    dueSoon: 0,
  })

  const { rerender } = render(
    <MaintenanceAlertSummary
      vehicles={[fictionalCar]}
      vehiclesLoading={false}
    />,
  )

  await waitFor(() => {
    expect(
      screen.getByLabelText('Overdue maintenance operations'),
    ).toHaveTextContent('01')
  })

  mockSummary.loadGarageMaintenanceSummary.mockResolvedValueOnce({
    overdue: 0,
    dueSoon: 1,
  })

  rerender(
    <MaintenanceAlertSummary
      vehicles={[fictionalCar, fictionalBike]}
      vehiclesLoading={false}
    />,
  )

  await waitFor(() => {
    expect(
      screen.getByLabelText('Overdue maintenance operations'),
    ).toHaveTextContent('00')
    expect(
      screen.getByLabelText('Maintenance operations due soon'),
    ).toHaveTextContent('01')
  })
})

it('reflects Service History completion changes in the counters', async () => {
  mockSummary.loadGarageMaintenanceSummary.mockResolvedValueOnce({
    overdue: 1,
    dueSoon: 0,
  })

  const { rerender } = render(
    <MaintenanceAlertSummary
      vehicles={[fictionalCar]}
      vehiclesLoading={false}
    />,
  )

  await waitFor(() => {
    expect(
      screen.getByLabelText('Overdue maintenance operations'),
    ).toHaveTextContent('01')
  })

  mockSummary.loadGarageMaintenanceSummary.mockResolvedValueOnce({
    overdue: 0,
    dueSoon: 0,
  })

  rerender(
    <MaintenanceAlertSummary
      vehicles={[{ ...fictionalCar, mileage: 26000 }]}
      vehiclesLoading={false}
    />,
  )

  await waitFor(() => {
    expect(
      screen.getByText(
        'All scheduled maintenance across your vehicles is up to date.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText('Overdue maintenance operations'),
    ).toHaveTextContent('00')
  })
})
