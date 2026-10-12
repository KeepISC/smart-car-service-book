import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const account = vi.hoisted(() => ({
  session: { user: { id: 'fictional-owner-a' } },
}))
vi.mock('./services/auth', () => ({ authService: { available: true } }))
vi.mock('./components/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: import('react').ReactNode }) =>
    children,
  useAuth: () => ({ session: account.session, loading: false, error: '' }),
}))
vi.mock('./components/Layout', async () => {
  const { useState } = await import('react')
  return {
    Layout: function TestGarage() {
      const [data, setData] = useState('Empty test garage')
      return (
        <button onClick={() => setData('Account A cached vehicle')}>
          {data}
        </button>
      )
    },
  }
})
import App from './App'

beforeEach(() => {
  account.session = { user: { id: 'fictional-owner-a' } }
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})
afterEach(() => vi.unstubAllGlobals())

it('clears mounted garage data when the authenticated owner changes', () => {
  const view = render(<App />)
  fireEvent.click(screen.getByText('Empty test garage'))
  view.rerender(<App />)
  expect(screen.getByText('Account A cached vehicle')).toBeInTheDocument()
  account.session = { user: { id: 'fictional-owner-b' } }
  view.rerender(<App />)
  expect(screen.queryByText('Account A cached vehicle')).not.toBeInTheDocument()
  expect(screen.getByText('Empty test garage')).toBeInTheDocument()
})
