import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { VehicleForm } from './VehicleForm'
import { MileageConsistencyError } from '../services/dataErrors'

const api = vi.hoisted(() => ({ getVehicle: vi.fn(), saveVehicle: vi.fn() }))
vi.mock('../services/vehicles', () => api)
vi.mock('../services/auth', () => ({ authService: { available: true } }))
const vehicle = {
  id: 'a',
  type: 'car',
  make: 'Fictional A',
  model: 'Example',
  year: 2020,
  engine: 'Example',
  mileage: 20000,
  license_plate: null,
  vin: null,
}
function openForm() {
  const router = createMemoryRouter(
    [
      { path: '/vehicles/:id/edit', element: <VehicleForm /> },
      { path: '/vehicles/:id', element: <div>Saved vehicle</div> },
    ],
    { initialEntries: ['/vehicles/a/edit'] },
  )
  render(<RouterProvider router={router} />)
  return router
}
beforeEach(() => {
  vi.resetAllMocks()
  api.getVehicle.mockResolvedValue(vehicle)
  api.saveVehicle.mockResolvedValue(vehicle)
})
it('clears the old draft and disables submission while a new vehicle loads', async () => {
  const router = openForm()
  await screen.findByDisplayValue('Fictional A')
  let complete!: (value: object) => void
  api.getVehicle.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  await act(() => router.navigate('/vehicles/b/edit'))
  expect(screen.queryByDisplayValue('Fictional A')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Save vehicle' }),
  ).not.toBeInTheDocument()
  await act(async () => complete({ ...vehicle, id: 'b', make: 'Fictional B' }))
  expect(await screen.findByDisplayValue('Fictional B')).toBeInTheDocument()
  expect(api.saveVehicle).not.toHaveBeenCalled()
})
it('ignores an older fetch that finishes after switching vehicles', async () => {
  let complete!: (value: object) => void
  api.getVehicle.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  const router = openForm()
  api.getVehicle.mockResolvedValueOnce({
    ...vehicle,
    id: 'b',
    make: 'Fictional B',
  })
  await act(() => router.navigate('/vehicles/b/edit'))
  await screen.findByDisplayValue('Fictional B')
  await act(async () => complete(vehicle))
  expect(screen.queryByDisplayValue('Fictional A')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save vehicle' }))
  await screen.findByText('Saved vehicle')
  expect(api.saveVehicle).toHaveBeenCalledWith(
    expect.objectContaining({ make: 'Fictional B' }),
    'b',
  )
})
it('clears load errors when navigating to an accessible vehicle', async () => {
  api.getVehicle.mockRejectedValueOnce(
    new Error('Fictional inaccessible record'),
  )
  const router = openForm()
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
  await act(() => router.navigate('/vehicles/b/edit'))
  await screen.findByDisplayValue('Fictional A')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save vehicle' })).toBeEnabled()
})
it('shows an inline odometer error without exposing database diagnostics', async () => {
  api.saveVehicle.mockRejectedValue(new MileageConsistencyError())
  openForm()
  await screen.findByDisplayValue('Fictional A')
  fireEvent.click(screen.getByRole('button', { name: 'Save vehicle' }))
  expect(
    await screen.findByText(/highest recorded maintenance/),
  ).toBeInTheDocument()
  expect(screen.getByLabelText('Current mileage (km)')).toHaveAttribute(
    'aria-invalid',
    'true',
  )
})
it('does not navigate an old save into the newly selected vehicle', async () => {
  let complete!: (value: object) => void
  api.saveVehicle.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  const router = openForm()
  await screen.findByDisplayValue('Fictional A')
  fireEvent.click(screen.getByRole('button', { name: 'Save vehicle' }))
  await act(() => router.navigate('/vehicles/b/edit'))
  await screen.findByDisplayValue('Fictional A')
  await act(async () => complete(vehicle))
  expect(router.state.location.pathname).toBe('/vehicles/b/edit')
})

it('removes an open draft after losing ownership and ignores an older save result', async () => {
  let complete!: (value: object) => void
  api.saveVehicle.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  const router = openForm()
  await screen.findByDisplayValue('Fictional A')
  fireEvent.click(screen.getByRole('button', { name: 'Save vehicle' }))
  api.getVehicle.mockRejectedValueOnce({ code: 'PGRST116' })
  fireEvent(window, new Event('app:vehicle-change'))
  fireEvent(window, new Event('app:ownership-change'))
  expect(screen.queryByDisplayValue('Fictional A')).toBeNull()
  await screen.findByText(
    'This vehicle is unavailable or you do not have access.',
  )
  expect(screen.queryByRole('button', { name: 'Save vehicle' })).toBeNull()
  await act(async () => complete(vehicle))
  expect(router.state.location.pathname).toBe('/vehicles/a/edit')
})
