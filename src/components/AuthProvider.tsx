import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthSession } from '../types/auth'
import { authService } from '../services/auth'
import { authenticationErrorMessage } from '../services/authErrors'
const AuthContext = createContext<{
  session: AuthSession | null
  loading: boolean
  error: string
}>({ session: null, loading: true, error: '' })
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(authService.available)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!authService.available) return
    let alive = true
    // A new auth event takes precedence over an older session-restoration request.
    let sessionChanged = false
    const unsubscribe = authService.subscribe((next) => {
      if (alive) {
        sessionChanged = true
        setSession(next)
        setError('')
        setLoading(false)
      }
    })
    authService
      .getSession()
      .then((restored) => {
        if (alive && !sessionChanged) {
          setSession(restored)
          setLoading(false)
        }
      })
      .catch((error) => {
        if (alive && !sessionChanged) {
          setError(
            authenticationErrorMessage(
              error,
              'Unable to restore your session.',
            ),
          )
          setLoading(false)
        }
      })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  return (
    <AuthContext.Provider value={{ session, loading, error }}>
      {children}
    </AuthContext.Provider>
  )
}
// Context hook is shared by route guards and account controls.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
