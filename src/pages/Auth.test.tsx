import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({
  signIn: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
  useAuth: vi.fn(),
}))
vi.mock('../services/auth', () => ({
  authService: {
    available: true,
    signIn: api.signIn,
    signInWithGoogle: api.signInWithGoogle,
    signOut: api.signOut,
  },
}))
vi.mock('../components/AuthProvider', () => ({ useAuth: api.useAuth }))
import { Auth } from './Auth'
import { AccountSetupError } from '../services/authErrors'
beforeEach(() => {
  vi.resetAllMocks()
  api.useAuth.mockReturnValue({ session: null, error: '' })
  api.signOut.mockResolvedValue(undefined)
})
function showLogin() {
  render(
    <MemoryRouter>
      <Auth />
    </MemoryRouter>,
  )
}
it('provides explicit logout after Google provisioning failure', async () => {
  api.signInWithGoogle.mockRejectedValue(
    new AccountSetupError(
      'Firebase sign-in succeeded, but application provisioning failed. Garage access is unavailable.',
    ),
  )
  showLogin()
  fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))
  const recovery = await screen.findByRole('button', {
    name: 'Sign out and try again',
  })
  expect(
    screen.getByText(
      /Firebase sign-in succeeded, but application provisioning failed/,
    ),
  ).toBeInTheDocument()
  fireEvent.click(recovery)
  expect(
    await screen.findByText(/Signed out. You can try again/),
  ).toBeInTheDocument()
  expect(api.signOut).toHaveBeenCalledOnce()
})
it('keeps recovery available when logout fails', async () => {
  api.useAuth.mockReturnValue({
    session: null,
    error: 'Unable to restore your session.',
  })
  api.signOut.mockRejectedValueOnce(new Error('Logout failed'))
  showLogin()
  fireEvent.click(
    screen.getByRole('button', { name: 'Sign out and try again' }),
  )
  expect(
    await screen.findByText(/Unable to sign out. Retry/),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Sign out and try again' }),
  ).toBeEnabled()
})
it('clears busy state after successful Google login while waiting for a session event', async () => {
  api.signInWithGoogle.mockResolvedValue(undefined)
  showLogin()
  fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))
  expect(api.signInWithGoogle).toHaveBeenCalledWith(
    window.location.origin + '/login',
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /Continue with Google/ }),
    ).toBeEnabled(),
  )
})
it.each([
  [
    'auth/popup-blocked',
    'Google sign-in was blocked by your browser. Allow popups and retry.',
  ],
  [
    'auth/popup-closed-by-user',
    'Google sign-in was cancelled. Try again when you are ready.',
  ],
  [
    'auth/unauthorized-domain',
    'Firebase sign-in is not enabled for this website. Contact support.',
  ],
  [
    'auth/operation-not-allowed',
    'This sign-in method is not enabled in Firebase. Contact support.',
  ],
  [
    'auth/network-request-failed',
    'Could not reach Firebase Authentication. Check your connection and retry.',
  ],
])(
  'explains Google authentication failure %s without claiming provisioning failed',
  async (code, message) => {
    api.signInWithGoogle.mockRejectedValue(
      Object.assign(new Error('Private SDK diagnostic'), { code }),
    )
    showLogin()
    fireEvent.click(
      screen.getByRole('button', { name: /Continue with Google/ }),
    )
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(
      screen.queryByText(
        /Private SDK diagnostic|application provisioning failed/,
      ),
    ).not.toBeInTheDocument()
  },
)
it('routes email credentials through authService and explains invalid credentials', async () => {
  api.signIn.mockRejectedValue(
    Object.assign(new Error('Private SDK diagnostic'), {
      code: 'auth/invalid-credential',
    }),
  )
  showLogin()
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'driver@example.invalid' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'fictional-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }))
  expect(
    await screen.findByText(
      'Firebase sign-in failed. Check your email and password.',
    ),
  ).toBeInTheDocument()
  expect(api.signIn).toHaveBeenCalledWith({
    email: 'driver@example.invalid',
    password: 'fictional-password',
  })
})
