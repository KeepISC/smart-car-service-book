import { useState } from 'react'
import { Moon, Sun, Monitor, LogOut, ShieldCheck } from 'lucide-react'
import { useAuth } from '../components/AuthProvider'
import { authService } from '../services/auth'
import { ErrorState } from '../components/States'
export type Theme = 'light' | 'dark' | 'system'
export function Settings({
  theme,
  onTheme,
}: {
  theme: Theme
  onTheme: (theme: Theme) => void
}) {
  const { session } = useAuth()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function logout() {
    setBusy(true)
    try {
      await authService.signOut()
    } catch {
      setError('Unable to sign out. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE IT YOURS</p>
          <h1>
            Settings<span className="blue-dot">.</span>
          </h1>
          <p>Your account and workspace preferences.</p>
        </div>
      </div>
      {error && <ErrorState message={error} />}
      <section className="panel settings-panel">
        <h2>Appearance</h2>
        <p className="muted">Choose how your garage looks on this device.</p>
        <div className="theme-options">
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <button
              key={mode}
              className={`theme-option ${theme === mode ? 'selected' : ''}`}
              aria-pressed={theme === mode}
              onClick={() => onTheme(mode)}
            >
              {mode === 'light' ? (
                <Sun />
              ) : mode === 'dark' ? (
                <Moon />
              ) : (
                <Monitor />
              )}
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </section>
      <section className="panel settings-panel">
        <h2>Account</h2>
        <p className="muted">{session?.user.email || 'No account connected'}</p>
        {session && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void logout()}
          >
            <LogOut size={18} />
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        )}
      </section>
      <section className="panel settings-panel">
        <h2>
          <ShieldCheck size={22} />
          Connection & privacy
        </h2>
        <p className="muted">
          {authService.available
            ? 'Firebase Authentication configuration is present.'
            : 'Firebase Authentication configuration is missing. Add the values in .env.local and restart the dev server.'}
        </p>
        <p className="muted">
          Vehicle access is restricted to your account through database row
          level security.
        </p>
      </section>
    </>
  )
}
