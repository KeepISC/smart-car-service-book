import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MileageHistoryPanel } from './MileageHistoryPanel'
import type { VehicleMileageHistory } from '../types/vehicle'

const mocks = vi.hoisted(() => ({
  loadVehicleMileageHistory: vi.fn(),
}))

vi.mock('../services/vehicles', () => ({
  loadVehicleMileageHistory: (...args: unknown[]) =>
    mocks.loadVehicleMileageHistory(...args),
}))

const sampleHistory: VehicleMileageHistory[] = [
  {
    id: 'hist-1',
    vehicle_id: 'veh-1',
    recorded_at: '2026-03-15T10:00:00Z',
    mileage: 15000,
    source: 'manual',
  },
  {
    id: 'hist-2',
    vehicle_id: 'veh-1',
    recorded_at: '2026-02-10T08:30:00Z',
    mileage: 12000,
    source: 'manual',
  },
  {
    id: 'hist-3',
    vehicle_id: 'veh-1',
    recorded_at: '2026-01-05T14:15:00Z',
    mileage: 10000,
    source: 'manual',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
})

it('displays paginated mileage history records showing date, mileage and source', async () => {
  mocks.loadVehicleMileageHistory.mockResolvedValue(sampleHistory)

  render(<MileageHistoryPanel vehicleId="veh-1" />)

  await screen.findByRole('heading', { name: 'Mileage history' })

  expect(screen.getByText('15,000 km')).toBeInTheDocument()
  expect(screen.getByText('12,000 km')).toBeInTheDocument()
  expect(screen.getByText('10,000 km')).toBeInTheDocument()

  const manualBadges = screen.getAllByText('Manual')
  expect(manualBadges).toHaveLength(3)

  expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
})

it('paginates entries across multiple pages and handles navigation', async () => {
  const sevenEntries: VehicleMileageHistory[] = Array.from(
    { length: 7 },
    (_, i) => ({
      id: `hist-${i + 1}`,
      vehicle_id: 'veh-1',
      recorded_at: `2026-0${i + 1}-01T00:00:00Z`,
      mileage: 10000 + (7 - i) * 1000,
      source: 'manual',
    }),
  )
  mocks.loadVehicleMileageHistory.mockResolvedValue(sevenEntries)

  render(<MileageHistoryPanel vehicleId="veh-1" pageSize={3} />)

  await screen.findByRole('heading', { name: 'Mileage history' })

  expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  expect(screen.getByText('17,000 km')).toBeInTheDocument()
  expect(screen.getByText('16,000 km')).toBeInTheDocument()
  expect(screen.getByText('15,000 km')).toBeInTheDocument()
  expect(screen.queryByText('14,000 km')).not.toBeInTheDocument()

  const prevBtn = screen.getByRole('button', { name: 'Previous page' })
  const nextBtn = screen.getByRole('button', { name: 'Next page' })
  expect(prevBtn).toBeDisabled()
  expect(nextBtn).toBeEnabled()

  // Navigate to Page 2
  fireEvent.click(nextBtn)

  expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  expect(screen.getByText('14,000 km')).toBeInTheDocument()
  expect(screen.getByText('13,000 km')).toBeInTheDocument()
  expect(screen.getByText('12,000 km')).toBeInTheDocument()
  expect(screen.queryByText('17,000 km')).not.toBeInTheDocument()
  expect(prevBtn).toBeEnabled()
  expect(nextBtn).toBeEnabled()

  // Navigate to Page 3
  fireEvent.click(nextBtn)

  expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
  expect(screen.getByText('11,000 km')).toBeInTheDocument()
  expect(prevBtn).toBeEnabled()
  expect(nextBtn).toBeDisabled()

  // Navigate back to Page 2
  fireEvent.click(prevBtn)

  expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  expect(screen.getByText('14,000 km')).toBeInTheDocument()
})

it('handles loading state with spinner and label', () => {
  mocks.loadVehicleMileageHistory.mockReturnValue(new Promise(() => {}))

  render(<MileageHistoryPanel vehicleId="veh-1" />)

  expect(screen.getByText('Loading mileage history…')).toBeInTheDocument()
  expect(
    screen.queryByRole('table', { name: 'Mileage history records' }),
  ).not.toBeInTheDocument()
})

it('handles empty state when no history is recorded', async () => {
  mocks.loadVehicleMileageHistory.mockResolvedValue([])

  render(<MileageHistoryPanel vehicleId="veh-1" />)

  await screen.findByRole('heading', { name: 'Mileage history' })
  expect(
    screen.getByText('No mileage history recorded yet.'),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('table', { name: 'Mileage history records' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText(/Page \d of \d/)).not.toBeInTheDocument()
})

it('handles error state and allows retrying', async () => {
  mocks.loadVehicleMileageHistory
    .mockRejectedValueOnce(new Error('Network failure'))
    .mockResolvedValueOnce(sampleHistory)

  render(<MileageHistoryPanel vehicleId="veh-1" />)

  await screen.findByText('Unable to load mileage history. Please try again.')
  const retryBtn = screen.getByRole('button', { name: 'Try again' })
  expect(retryBtn).toBeInTheDocument()

  fireEvent.click(retryBtn)

  await screen.findByText('15,000 km')
  expect(
    screen.queryByText('Unable to load mileage history. Please try again.'),
  ).not.toBeInTheDocument()
})

it('refreshes history when refreshTrigger changes', async () => {
  mocks.loadVehicleMileageHistory.mockResolvedValue(sampleHistory)

  const { rerender } = render(
    <MileageHistoryPanel vehicleId="veh-1" refreshTrigger={0} />,
  )

  await screen.findByText('15,000 km')
  expect(mocks.loadVehicleMileageHistory).toHaveBeenCalledTimes(1)

  rerender(<MileageHistoryPanel vehicleId="veh-1" refreshTrigger={1} />)

  await waitFor(() => {
    expect(mocks.loadVehicleMileageHistory).toHaveBeenCalledTimes(2)
  })
})

it('ignores an old retry response after switching vehicles', async () => {
  let resolveOld!: (value: VehicleMileageHistory[]) => void
  mocks.loadVehicleMileageHistory
    .mockRejectedValueOnce(new Error('Fictional offline failure'))
    .mockImplementationOnce(
      () =>
        new Promise<VehicleMileageHistory[]>((resolve) => {
          resolveOld = resolve
        }),
    )
    .mockResolvedValueOnce([
      {
        ...sampleHistory[0],
        id: 'other-history',
        vehicle_id: 'veh-2',
        mileage: 45000,
      },
    ])
  const { rerender } = render(<MileageHistoryPanel vehicleId="veh-1" />)
  await screen.findByText('Unable to load mileage history. Please try again.')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() =>
    expect(mocks.loadVehicleMileageHistory).toHaveBeenCalledTimes(2),
  )
  rerender(<MileageHistoryPanel vehicleId="veh-2" />)
  await screen.findByText('45,000 km')
  await act(async () => resolveOld(sampleHistory))
  expect(screen.getByText('45,000 km')).toBeInTheDocument()
  expect(screen.queryByText('15,000 km')).not.toBeInTheDocument()
})

it('ignores an older load when a save refreshes history and resets pagination', async () => {
  let resolveOld!: (value: VehicleMileageHistory[]) => void
  mocks.loadVehicleMileageHistory
    .mockResolvedValueOnce(sampleHistory)
    .mockImplementationOnce(
      () =>
        new Promise<VehicleMileageHistory[]>((resolve) => {
          resolveOld = resolve
        }),
    )
    .mockResolvedValueOnce([
      { ...sampleHistory[0], id: 'new-history', mileage: 18000 },
      ...sampleHistory,
    ])
  const { rerender } = render(
    <MileageHistoryPanel vehicleId="veh-1" pageSize={1} refreshTrigger={0} />,
  )
  await screen.findByText('15,000 km')
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  rerender(
    <MileageHistoryPanel vehicleId="veh-1" pageSize={1} refreshTrigger={1} />,
  )
  await waitFor(() =>
    expect(mocks.loadVehicleMileageHistory).toHaveBeenCalledTimes(2),
  )
  rerender(
    <MileageHistoryPanel vehicleId="veh-1" pageSize={1} refreshTrigger={2} />,
  )
  await screen.findByText('18,000 km')
  expect(screen.getByText('Page 1 of 4')).toBeInTheDocument()
  await act(async () => resolveOld(sampleHistory))
  expect(screen.getByText('18,000 km')).toBeInTheDocument()
  expect(screen.getByText('Page 1 of 4')).toBeInTheDocument()
})
