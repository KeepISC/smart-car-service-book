import { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useLocation,
} from 'react-router-dom'
import { AuthProvider, useAuth } from './components/AuthProvider'
import { Layout } from './components/Layout'
import { Loading, ErrorState } from './components/States'
import { Garage } from './pages/Garage'
import { Auth } from './pages/Auth'
import { VehicleForm } from './pages/VehicleForm'
import { VehicleDetails } from './pages/VehicleDetails'
import { TransferInvitation } from './pages/TransferInvitation'
import { Settings } from './pages/Settings'
import type { Theme } from './pages/Settings'
import { authService } from './services/auth'
function Protected() {
  const { session, loading, error } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (error)
    return (
      <>
        <ErrorState message={error} />
        <Link className="button" to="/login">
          Return to sign in
        </Link>
      </>
    )
  // Sign in in place on /transfer so the invitation #fragment is not lost.
  if (authService.available && !session)
    return location.pathname === '/transfer' ? (
      <Auth />
    ) : (
      <Navigate to="/login" replace />
    )
  // Discard all mounted user-data state when the verified application owner changes.
  return <Layout key={session?.user.id ?? 'preview'} />
}
export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('theme')
      return saved === 'light' || saved === 'dark' ? saved : 'system'
    } catch {
      return 'system'
    }
  })
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () =>
      document.documentElement.classList.toggle(
        'dark',
        theme === 'dark' || (theme === 'system' && media.matches),
      )
    apply()
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* Preference persistence is optional. */
    }
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Auth />} />
          <Route element={<Protected />}>
            <Route index element={<Garage />} />
            <Route path="vehicles/new" element={<VehicleForm key="new" />} />
            <Route path="transfer" element={<TransferInvitation />} />
            <Route path="vehicles/:id" element={<VehicleDetails />} />
            <Route
              path="vehicles/:id/edit"
              element={<VehicleForm key="edit" />}
            />
            <Route
              path="settings"
              element={<Settings theme={theme} onTheme={setTheme} />}
            />
            <Route
              path="*"
              element={
                <div className="state">
                  <h1>Page not found</h1>
                  <Link className="button" to="/">
                    Back to garage
                  </Link>
                </div>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
