import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationCenter } from './NotificationCenter'
import type { MaintenanceAlertItem } from '../types/maintenance'

const mockVehicles = vi.hoisted(() => ({
  listVehicles: vi.fn(),
}))
const mockMaintenance = vi.hoisted(() => ({
  loadGarageMaintenanceSummary: vi.fn(),
}))

vi.mock('../services/vehicles', () => ({
  listVehicles: mockVehicles.listVehicles,
}))
vi.mock('../services/maintenance', () => ({
  loadGarageMaintenanceSummary: mockMaintenance.loadGarageMaintenanceSummary,
}))

const sampleOverdueAlert: MaintenanceAlertItem = {
  id: 'op-1',
  vehicleId: 'veh-car',
  vehicleName: '2021 Fictional Corolla',
  operationName: 'Engine oil and filter',
  status: 'Due / overdue',
  dueDate: '2026-10-01',
  dueMileage: 20000,
  kmRemaining: -2000,
  daysRemaining: -12,
}

const sampleSoonAlert: MaintenanceAlertItem = {
  id: 'op-2',
  vehicleId: 'veh-bike',
  vehicleName: '2022 Fictional Cruiser',
  operationName: 'Brake fluid service',
  status: 'Due soon',
  dueDate: '2026-10-25',
  dueMileage: 12500,
  kmRemaining: 400,
  daysRemaining: 12,
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('NotificationCenter badge and toggle', () => {
  it('does not render a badge when there are no alerts', async () => {
    mockVehicles.listVehicles.mockResolvedValueOnce([])

    render(
      <MemoryRouter>
        <NotificationCenter />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(mockVehicles.listVehicles).toHaveBeenCalled()
    })

    const button = screen.getByRole('button', { name: 'Notifications' })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/^[0-9]/)).not.toBeInTheDocument()
  })

  it('renders badge with correct count and accessible aria-label when alerts exist', () => {
    render(
      <MemoryRouter>
        <NotificationCenter
          summary={{
            overdue: 1,
            dueSoon: 1,
            alerts: [sampleOverdueAlert, sampleSoonAlert],
          }}
          loading={false}
        />
      </MemoryRouter>,
    )

    const button = screen.getByRole('button', {
      name: 'Notifications (2 items require attention)',
    })
    expect(button).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders 99+ on badge when alert count exceeds 99', () => {
    const manyAlerts: MaintenanceAlertItem[] = Array.from(
      { length: 105 },
      (_, i) => ({
        ...sampleOverdueAlert,
        id: `op-${i}`,
      }),
    )

    render(
      <MemoryRouter>
        <NotificationCenter
          summary={{
            overdue: 105,
            dueSoon: 0,
            alerts: manyAlerts,
          }}
          loading={false}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('99+')).toBeInTheDocument()
  })

  it('opens panel on bell button click and closes on close button click', () => {
    render(
      <MemoryRouter>
        <NotificationCenter
          summary={{
            overdue: 1,
            dueSoon: 0,
            alerts: [sampleOverdueAlert],
          }}
          loading={false}
        />
      </MemoryRouter>,
    )

    const button = screen.getByRole('button', {
      name: 'Notifications (1 items require attention)',
    })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('dialog', { name: 'Maintenance notifications' }),
    ).not.toBeInTheDocument()

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('dialog', { name: 'Maintenance notifications' }),
    ).toBeInTheDocument()

    const closeButton = screen.getByRole('button', {
      name: 'Close notifications',
    })
    fireEvent.click(closeButton)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('dialog', { name: 'Maintenance notifications' }),
    ).not.toBeInTheDocument()
  })

  it('closes panel when pressing Escape and restores focus to the bell button', () => {
    render(
      <MemoryRouter>
        <NotificationCenter
          initialOpen={true}
          summary={{
            overdue: 1,
            dueSoon: 0,
            alerts: [sampleOverdueAlert],
          }}
          loading={false}
        />
      </MemoryRouter>,
    )

    const button = screen.getByRole('button', {
      name: 'Notifications (1 items require attention)',
    })
    expect(
      screen.getByRole('dialog', { name: 'Maintenance notifications' }),
    ).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(
      screen.queryByRole('dialog', { name: 'Maintenance notifications' }),
    ).not.toBeInTheDocument()
    expect(document.activeElement).toBe(button)
  })

  it('closes panel when pointer down occurs outside the panel', () => {
    render(
      <MemoryRouter>
        <div data-testid="outside-area">Outside</div>
        <NotificationCenter
          initialOpen={true}
          summary={{
            overdue: 1,
            dueSoon: 0,
            alerts: [sampleOverdueAlert],
          }}
          loading={false}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('dialog', { name: 'Maintenance notifications' }),
    ).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTestId('outside-area'))
    expect(
      screen.queryByRole('dialog', { name: 'Maintenance notifications' }),
    ).not.toBeInTheDocument()
  })
})

describe('NotificationCenter ordering and navigation', () => {
  it('renders alerts with overdue operations first followed by due soon operations', () => {
    render(
      <MemoryRouter>
        <NotificationCenter
          initialOpen={true}
          summary={{
            overdue: 1,
            dueSoon: 1,
            alerts: [sampleOverdueAlert, sampleSoonAlert],
          }}
          loading={false}
        />
      </MemoryRouter>,
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)

    // First item is overdue
    expect(items[0]).toHaveTextContent('2021 Fictional Corolla')
    expect(items[0]).toHaveTextContent('Engine oil and filter')
    expect(items[0]).toHaveTextContent('Due / overdue')
    expect(items[0]).toHaveTextContent('2,000 km overdue · 12 days overdue')

    // Second item is due soon
    expect(items[1]).toHaveTextContent('2022 Fictional Cruiser')
    expect(items[1]).toHaveTextContent('Brake fluid service')
    expect(items[1]).toHaveTextContent('Due soon')
    expect(items[1]).toHaveTextContent('Due in 400 km · Due in 12 days')
  })

  it('navigates to the vehicle maintenance tab and closes the panel on alert click', () => {
    const handleNavigate = vi.fn()

    render(
      <MemoryRouter>
        <NotificationCenter
          initialOpen={true}
          summary={{
            overdue: 1,
            dueSoon: 0,
            alerts: [sampleOverdueAlert],
          }}
          loading={false}
          onNavigate={handleNavigate}
        />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', {
      name: 'View Engine oil and filter for 2021 Fictional Corolla',
    })
    expect(link).toHaveAttribute('href', '/vehicles/veh-car?tab=maintenance')

    fireEvent.click(link)
    expect(handleNavigate).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('dialog', { name: 'Maintenance notifications' }),
    ).not.toBeInTheDocument()
  })
})

describe('NotificationCenter states and refreshes', () => {
  it('displays loading state while notifications are loading', () => {
    render(
      <MemoryRouter>
        <NotificationCenter initialOpen={true} loading={true} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading notifications…',
    )
  })

  it('displays empty state when all maintenance is up to date', () => {
    render(
      <MemoryRouter>
        <NotificationCenter
          initialOpen={true}
          summary={{ overdue: 0, dueSoon: 0, alerts: [] }}
          loading={false}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByText('All maintenance is up to date'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'No overdue or upcoming maintenance operations across your vehicles.',
      ),
    ).toBeInTheDocument()
  })

  it('displays error state with retry button when loading fails', () => {
    const handleReload = vi.fn()

    render(
      <MemoryRouter>
        <NotificationCenter
          initialOpen={true}
          error="Unable to load maintenance alerts."
          loading={false}
          onReload={handleReload}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByText('Unable to load maintenance alerts.'),
    ).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: 'Try again' })
    fireEvent.click(retryBtn)
    expect(handleReload).toHaveBeenCalledOnce()
  })

  it('refreshes alert calculations on window focus, midnight and app:maintenance-change', async () => {
    mockVehicles.listVehicles.mockResolvedValue([
      { id: 'veh-1', mileage: 10000 },
    ])
    mockMaintenance.loadGarageMaintenanceSummary.mockResolvedValue({
      overdue: 0,
      dueSoon: 0,
      alerts: [],
    })

    const { rerender } = render(
      <MemoryRouter>
        <NotificationCenter today="2026-10-12" />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(mockMaintenance.loadGarageMaintenanceSummary).toHaveBeenCalledWith(
        [{ id: 'veh-1', mileage: 10000 }],
        '2026-10-12',
      )
    })

    // Local midnight: today prop changes
    rerender(
      <MemoryRouter>
        <NotificationCenter today="2026-10-13" />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(mockMaintenance.loadGarageMaintenanceSummary).toHaveBeenCalledWith(
        [{ id: 'veh-1', mileage: 10000 }],
        '2026-10-13',
      )
    })

    // Window focus
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => {
      expect(
        mockMaintenance.loadGarageMaintenanceSummary,
      ).toHaveBeenCalledTimes(3)
    })

    // Custom maintenance change event
    window.dispatchEvent(new CustomEvent('app:maintenance-change'))
    await waitFor(() => {
      expect(
        mockMaintenance.loadGarageMaintenanceSummary,
      ).toHaveBeenCalledTimes(4)
    })
  })
})
