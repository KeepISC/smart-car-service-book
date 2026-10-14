import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ShopConnection } from './ShopConnection'

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
}))
vi.mock('../services/repairShops', () => ({
  previewRepairShopConnectionInvitation: mocks.preview,
  acceptRepairShopConnectionInvitation: mocks.accept,
  declineRepairShopConnectionInvitation: mocks.decline,
}))
vi.mock('../hooks/useVehicles', () => ({
  useVehicles: () => ({
    vehicles: [
      { id: 'v1', year: 2020, make: 'Fictional', model: 'Audit' },
      { id: 'v2', year: 2018, make: 'Sample', model: 'Bike' },
    ],
    loading: false,
    error: '',
    reload: vi.fn(),
  }),
}))

const token = 'c'.repeat(64)
const preview = (expires = Date.now() + 3600_000) => ({
  id: 'i1',
  expires_at: new Date(expires).toISOString(),
  shop: { id: 's1', name: 'Fictional Garage' },
})
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/shop-connections']}>
      <Routes>
        <Route path="/shop-connections" element={<ShopConnection />} />
        <Route path="/vehicles/:id" element={<p>Vehicle page</p>} />
        <Route path="/" element={<p>Garage page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState(
    null,
    '',
    `/shop-connections#shop-connection=${token}`,
  )
  mocks.preview.mockResolvedValue(preview())
  mocks.accept.mockResolvedValue('auth-1')
  mocks.decline.mockResolvedValue(undefined)
})

it('shows the shop, removes the token from the URL and never persists or logs it', async () => {
  const log = vi.spyOn(console, 'log')
  renderPage()
  await screen.findByText('Fictional Garage')
  expect(mocks.preview).toHaveBeenCalledWith(token)
  expect(window.location.hash).toBe('')
  expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain(
    token,
  )
  expect(log).not.toHaveBeenCalled()
  expect(screen.getByText('Access: view only')).toBeTruthy()
  log.mockRestore()
})

it('requires an explicit vehicle choice and sends the chosen permission', async () => {
  renderPage()
  await screen.findByText('Fictional Garage')
  const approve = screen.getByRole('button', {
    name: 'Approve access',
  }) as HTMLButtonElement
  expect(approve.disabled).toBe(true)
  fireEvent.click(screen.getByLabelText('2018 Sample Bike'))
  fireEvent.click(
    screen.getByLabelText('Also allow this shop to add maintenance records'),
  )
  expect(screen.getByText('Access: view vehicle and add records')).toBeTruthy()
  fireEvent.click(approve)
  await screen.findByText('Vehicle page')
  expect(mocks.accept).toHaveBeenCalledExactlyOnceWith(token, 'v2', true)
})

it('declines without selecting a vehicle', async () => {
  renderPage()
  await screen.findByText('Fictional Garage')
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
  await screen.findByText(/You declined the invitation/)
  expect(mocks.decline).toHaveBeenCalledWith(token)
  expect(mocks.accept).not.toHaveBeenCalled()
})

it.each([
  ['malformed', '#shop-connection=abc'],
  ['missing', ''],
])('rejects a %s link without calling the backend', async (_name, hash) => {
  window.history.replaceState(null, '', `/shop-connections${hash}`)
  renderPage()
  await screen.findByText(/not valid/)
  expect(mocks.preview).not.toHaveBeenCalled()
})

it('handles expired invitations', async () => {
  mocks.preview.mockResolvedValue(preview(Date.now() - 1000))
  renderPage()
  await screen.findByText(/has expired/)
  expect(screen.queryByRole('button', { name: 'Approve access' })).toBeNull()
})

it('reports cancelled or already-used invitations as unavailable', async () => {
  mocks.preview.mockRejectedValue({ code: '42501' })
  renderPage()
  await screen.findByText(/no longer available/)
})

it('becomes unavailable if the link is consumed before approval', async () => {
  mocks.accept.mockRejectedValue({ code: '42501' })
  renderPage()
  await screen.findByText('Fictional Garage')
  fireEvent.click(screen.getByLabelText('2020 Fictional Audit'))
  fireEvent.click(screen.getByRole('button', { name: 'Approve access' }))
  await screen.findByText(/no longer available/)
  expect(screen.queryByText('Vehicle page')).toBeNull()
})

it('retries a transient preview failure', async () => {
  mocks.preview.mockRejectedValueOnce(new Error('network'))
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  await waitFor(() => screen.getByText('Fictional Garage'))
  expect(mocks.preview).toHaveBeenCalledTimes(2)
})
