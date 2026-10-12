export class AccountSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountSetupError'
  }
}

export function authenticationErrorMessage(error: unknown, fallback: string) {
  // Display only our own safe messages or known SDK codes, never raw diagnostics.
  if (error instanceof AccountSetupError) return error.message
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined
  switch (code) {
    case 'auth/popup-blocked':
      return 'Google sign-in was blocked by your browser. Allow popups and retry.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled. Try again when you are ready.'
    case 'auth/unauthorized-domain':
      return 'Firebase sign-in is not enabled for this website. Contact support.'
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in Firebase. Contact support.'
    case 'auth/network-request-failed':
      return 'Could not reach Firebase Authentication. Check your connection and retry.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Firebase sign-in failed. Check your email and password.'
    case 'auth/too-many-requests':
      return 'Too many authentication attempts. Wait a moment and retry.'
    default:
      return fallback
  }
}
