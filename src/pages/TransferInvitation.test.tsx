import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import {
  BrowserRouter,
  Link,
  MemoryRouter,
  Route,
  Routes,
} from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { TransferInvitation } from './TransferInvitation'

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
}))
vi.mock('../services/vehicleTransfers', () => ({
  previewVehicleTransfer: mocks.preview,
  acceptVehicleTransfer: mocks.accept,
  declineVehicleTransfer: mocks.decline,
}))

const token = 'b'.repeat(64)
const preview = (expires = Date.now() + 3600_000) => ({
  id: 'i1',
  expires_at: new Date(expires).toISOString(),
  maintenance_schedules: [
    { id: 's1', interval_km: 10000, interval_months: 12, enabled: true },
  ],
  maintenance_records: [
    {
      id: 'r1',
      service_date: '2026-01-31',
      mileage: 10000,
      private_on_transfer: true,
      operations: [{ next_interval_km: 5000 }],
    },
  ],
  vehicle: {
    id: 'v1',
    type: 'car',
    make: 'Fictional',
    model: 'Audit',
    year: 2020,
    engine: '2.0',
    mileage: 12345,
  },
})
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/transfer']}>
      <Routes>
        <Route path="/transfer" element={<TransferInvitation />} />
        <Route path="/vehicles/:id" element={<p>Vehicle page</p>} />
        <Route path="/" element={<p>Garage page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  window.history.replaceState(null, '', `/transfer#${token}`)
  mocks.preview.mockResolvedValue(preview())
})

it('previews from the fragment, removes it from the URL and stores it only for this session', async () => {
  const log = vi.spyOn(console, 'log')
  renderPage()
  await screen.findByText('2020 Fictional Audit')
  expect(mocks.preview).toHaveBeenCalledWith(token)
  expect(window.location.hash).toBe('')
  expect(JSON.stringify({ ...localStorage })).not.toContain(token)
  expect(sessionStorage.getItem('scsb:transfer:recipient')).toBe(token)
  expect(log).not.toHaveBeenCalled()
  expect(screen.getByText(/Invitation expires/)).toBeInTheDocument()
  expect(
    screen.getByText(/previous owner immediately loses access/),
  ).toBeVisible()
  expect(screen.getByText(/private arrive without their details/)).toBeVisible()
  expect(document.body.textContent).not.toContain(token)
})

it('accepts and navigates to the transferred vehicle', async () => {
  mocks.accept.mockResolvedValue('v1')
  renderPage()
  await screen.findByText('2020 Fictional Audit')
  fireEvent.click(screen.getByRole('button', { name: 'Accept vehicle' }))
  await screen.findByText('Vehicle page')
  expect(mocks.accept).toHaveBeenCalledWith(token)
  expect(sessionStorage.getItem('scsb:transfer:recipient')).toBeNull()
})

it.each(['preview', 'accept'] as const)(
  'replaces an open invitation and ignores the previous pending %s',
  async (pending) => {
    const newer = 'c'.repeat(64)
    let complete!: (value: unknown) => void
    mocks[pending].mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    render(
      <BrowserRouter>
        <Link to={`/transfer#${newer}`}>Open another invitation</Link>
        <Routes>
          <Route path="/transfer" element={<TransferInvitation />} />
          <Route path="/vehicles/:id" element={<p>Vehicle page</p>} />
        </Routes>
      </BrowserRouter>,
    )
    if (pending === 'accept')
      fireEvent.click(
        await screen.findByRole('button', { name: 'Accept vehicle' }),
      )
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledWith(token))
    fireEvent.click(
      screen.getByRole('link', { name: 'Open another invitation' }),
    )
    await screen.findByRole('button', { name: 'Accept vehicle' })
    expect(mocks.preview).toHaveBeenLastCalledWith(newer)
    await act(async () => {
      complete(
        pending === 'accept'
          ? 'old-vehicle'
          : {
              ...preview(),
              vehicle: { ...preview().vehicle, model: 'Old invitation' },
            },
      )
    })
    expect(screen.queryByText('Vehicle page')).toBeNull()
    expect(screen.queryByText(/Old invitation/)).toBeNull()
    expect(sessionStorage.getItem('scsb:transfer:recipient')).toBe(newer)
    expect(window.location.hash).toBe('')
  },
)

it('restores an incomplete transfer after reload and renders only sanitized facts', async () => {
  const mounted = renderPage()
  await screen.findByText('2020 Fictional Audit')
  expect(screen.getByText(/Private details excluded/)).toHaveTextContent(
    '2026-01-31',
  )
  expect(screen.getByText(/Maintenance schedule:/)).toHaveTextContent(
    '10,000 km / 12 months',
  )
  mounted.unmount()
  mocks.preview.mockClear()
  renderPage()
  await screen.findByText('2020 Fictional Audit')
  expect(mocks.preview).toHaveBeenCalledWith(token)
  expect(window.location.hash).toBe('')
})

it('retains tokens through a transient failure and retries acceptance once loading ends', async () => {
  mocks.accept
    .mockRejectedValueOnce({ code: '40001' })
    .mockResolvedValueOnce('v1')
  renderPage()
  const accept = await screen.findByRole('button', { name: 'Accept vehicle' })
  fireEvent.click(accept)
  await screen.findByText(/at the same time/)
  expect(sessionStorage.getItem('scsb:transfer:recipient')).toBe(token)
  fireEvent.click(accept)
  await screen.findByText('Vehicle page')
  expect(sessionStorage.getItem('scsb:transfer:recipient')).toBeNull()
})

it('declines without changing ownership', async () => {
  mocks.decline.mockResolvedValue(undefined)
  renderPage()
  await screen.findByText('2020 Fictional Audit')
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
  await screen.findByText(/Ownership was not changed/)
  expect(mocks.accept).not.toHaveBeenCalled()
  expect(sessionStorage.getItem('scsb:transfer:recipient')).toBeNull()
})

it('handles concurrent acceptance as an unavailable invitation', async () => {
  mocks.accept.mockRejectedValue({ code: '42501' })
  renderPage()
  await screen.findByText('2020 Fictional Audit')
  fireEvent.click(screen.getByRole('button', { name: 'Accept vehicle' }))
  await screen.findByText(/no longer available/)
  expect(screen.queryByRole('button', { name: 'Accept vehicle' })).toBeNull()
})

it('shows a retryable message for serialization and other accept failures', async () => {
  mocks.accept.mockRejectedValueOnce({ code: '40001' })
  renderPage()
  await screen.findByText('2020 Fictional Audit')
  const accept = screen.getByRole('button', { name: 'Accept vehicle' })
  fireEvent.click(accept)
  await screen.findByText(/at the same time/)
  await waitFor(() => expect(accept).toBeEnabled())
})

it.each([
  ['missing token', ''],
  ['malformed token', '#nope'],
])('shows the invalid state for a %s', async (_name, hash) => {
  window.history.replaceState(null, '', `/transfer${hash}`)
  renderPage()
  await screen.findByText(/invalid or incomplete/)
  expect(mocks.preview).not.toHaveBeenCalled()
})

it('shows unavailable for revoked, used or self invitations', async () => {
  mocks.preview.mockRejectedValue({ code: '42501' })
  renderPage()
  await screen.findByText(/revoked, already been used/)
})

it('shows the expired state and retries transient preview errors', async () => {
  mocks.preview.mockResolvedValueOnce(preview(Date.now() - 1000))
  const { unmount } = renderPage()
  await screen.findByText(/has expired/)
  expect(screen.queryByRole('button', { name: 'Accept vehicle' })).toBeNull()
  unmount()
  window.history.replaceState(null, '', `/transfer#${token}`)
  mocks.preview.mockRejectedValueOnce(new Error('offline'))
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  await screen.findByText('2020 Fictional Audit')
})
