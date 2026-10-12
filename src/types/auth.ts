// Application owner identity stays stable across login methods; email is not an ownership key.
export type AuthUser = { id: string; email?: string }
export type AuthSession = { user: AuthUser }
export type Credentials = { email: string; password: string }
export interface Authentication {
  readonly available: boolean
  getSession(): Promise<AuthSession | null>
  getUser(): Promise<AuthUser | null>
  subscribe(listener: (session: AuthSession | null) => void): () => void
  signIn(credentials: Credentials): Promise<void>
  register(
    credentials: Credentials,
    redirectUrl: string,
  ): Promise<{ confirmationRequired: boolean }>
  signInWithGoogle(redirectUrl: string): Promise<void>
  signOut(): Promise<void>
}
