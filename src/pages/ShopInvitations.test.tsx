import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { ShopInvitations } from './ShopInvitations'

const renderPage = () =>
  render(
    <MemoryRouter>
      <ShopInvitations />
    </MemoryRouter>,
  )

const mocks = vi.hoisted(() => ({
  shops: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock('../services/repairShops', async () => {
  const actual = await vi.importActual<
    typeof import('../services/repairShops')
  >('../services/repairShops')
  return {
    listRepairShops: mocks.shops,
    listRepairShopConnectionInvitations: mocks.list,
    createRepairShopConnectionInvitation: mocks.create,
    cancelRepairShopConnectionInvitation: mocks.cancel,
    repairShopConnectionInvitationLink:
      actual.repairShopConnectionInvitationLink,
  }
})

const token = 'd'.repeat(64)
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  mocks.shops.mockResolvedValue([
    { id: 's1', name: 'Fictional Garage', role: 'admin' },
    { id: 's2', name: 'Mechanic Only', role: 'mechanic' },
  ])
  mocks.list.mockResolvedValue([
    { id: 'i1', status: 'pending', expires_at: '2030-01-01T10:00:00Z' },
    { id: 'i2', status: 'accepted', expires_at: '2030-01-01T10:00:00Z' },
  ])
  mocks.create.mockResolvedValue({
    id: 'i3',
    token,
    expires_at: '2030-01-02T10:00:00Z',
  })
  mocks.cancel.mockResolvedValue(undefined)
})

it('lists only administered shops and creates a fragment link without persisting it', async () => {
  const log = vi.spyOn(console, 'log')
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  renderPage()
  await screen.findByRole('option', { name: 'Fictional Garage' })
  expect(screen.queryByRole('option', { name: 'Mechanic Only' })).toBeNull()
  fireEvent.change(screen.getByLabelText('Link valid for'), {
    target: { value: '3' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Create invitation link' }),
  )
  const field = (await screen.findByLabelText(
    'Invitation link',
  )) as HTMLInputElement
  expect(field.value).toBe(
    `${window.location.origin}/shop-connections#shop-connection=${token}`,
  )
  const [shopId, expiry] = mocks.create.mock.calls[0]
  expect(shopId).toBe('s1')
  const days = (Date.parse(expiry) - Date.now()) / 86_400_000
  expect(days).toBeGreaterThan(2.9)
  expect(days).toBeLessThan(3)
  fireEvent.click(screen.getByRole('button', { name: /Copy link/ }))
  await screen.findByText('Link copied.')
  expect(writeText).toHaveBeenCalledWith(field.value)
  expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain(
    token,
  )
  expect(log).not.toHaveBeenCalled()
  log.mockRestore()
})

it('shows invitation statuses and cancels only pending links', async () => {
  renderPage()
  await screen.findByText('Accepted')
  expect(
    screen.getAllByRole('button', { name: /Cancel invitation/ }),
  ).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: /Cancel invitation/ }))
  await screen.findByText(/link no longer works/)
  expect(mocks.cancel).toHaveBeenCalledWith('s1', 'i1')
})

it('shows a clear message to non-admins', async () => {
  mocks.shops.mockResolvedValue([
    { id: 's2', name: 'Mechanic Only', role: 'mechanic' },
  ])
  renderPage()
  await screen.findByText(/not an administrator/)
  expect(mocks.list).not.toHaveBeenCalled()
})

it('reports creation failures and retries shop loading', async () => {
  mocks.create.mockRejectedValue(new Error('denied'))
  renderPage()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Create invitation link' }),
  )
  await screen.findByText(/Unable to create the invitation/)
  expect(screen.queryByLabelText('Invitation link')).toBeNull()
})

it('offers retry when shops fail to load', async () => {
  mocks.shops.mockRejectedValueOnce(new Error('network'))
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  await waitFor(() => screen.getByRole('option', { name: 'Fictional Garage' }))
})

it('keeps the issuing shop selected until an invitation action completes', async () => {
  mocks.shops.mockResolvedValue([
    { id: 's1', name: 'Fictional Garage', role: 'admin' },
    { id: 's3', name: 'Other Fictional Garage', role: 'admin' },
  ])
  let complete!: (value: {
    id: string
    token: string
    expires_at: string
  }) => void
  mocks.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  renderPage()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Create invitation link' }),
  )
  expect(screen.getByLabelText('Shop')).toBeDisabled()
  expect(screen.getByLabelText('Link valid for')).toBeDisabled()
  await act(async () =>
    complete({ id: 'i3', token, expires_at: '2030-01-02T10:00:00Z' }),
  )
  expect(screen.getByLabelText('Shop')).toBeEnabled()
  expect(screen.getByLabelText('Shop')).toHaveValue('s1')
  expect(screen.getByLabelText('Invitation link')).toHaveValue(
    `${window.location.origin}/shop-connections#shop-connection=${token}`,
  )
  fireEvent.change(screen.getByLabelText('Shop'), { target: { value: 's3' } })
  expect(screen.queryByLabelText('Invitation link')).toBeNull()
})
