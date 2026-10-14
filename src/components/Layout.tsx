import { NavLink, Outlet, Link } from 'react-router-dom'
import {
  CarFront,
  LayoutGrid,
  Settings,
  Plus,
  ArrowUpRight,
  Wrench,
  ShieldCheck,
  ClipboardList,
} from 'lucide-react'
import { useAuth } from './AuthProvider'
import { NotificationCenter } from './NotificationCenter'
import { useOwnershipWatch } from '../hooks/useOwnershipWatch'
import { usePlatformAdministrator } from '../hooks/usePlatformAdministrator'
export function Layout() {
  const { session } = useAuth()
  useOwnershipWatch(Boolean(session))
  // Navigation visibility only; the server authorizes every platform action.
  const platformAdmin = usePlatformAdministrator(Boolean(session))
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-icon">
            <CarFront />
          </span>
          <span>
            Smart Car<span className="brand-sub">SERVICE BOOK</span>
          </span>
        </Link>
        <span className="nav-label">YOUR WORKSPACE</span>
        <nav>
          <NavLink to="/" end>
            <LayoutGrid size={20} />
            Garage
          </NavLink>
          <NavLink to="/shops">
            <Wrench size={20} />
            Repair shop
          </NavLink>
          <NavLink to="/workshop">
            <ClipboardList size={20} />
            Shop customers
          </NavLink>
          {platformAdmin && (
            <NavLink to="/platform">
              <ShieldCheck size={20} />
              Platform
            </NavLink>
          )}
          <NavLink to="/settings">
            <Settings size={20} />
            Settings
          </NavLink>
        </nav>
        <div className="sidebar-note">
          <span className="eyebrow">BUILT FOR THE ROAD</span>
          <p>
            A little organization.
            <br />A smoother journey.
          </p>
          <ArrowUpRight size={22} />
        </div>
        <div className="account">
          <span className="avatar">
            {session?.user.email?.slice(0, 1).toUpperCase() || 'S'}
          </span>
          <div>
            <strong>Your personal garage</strong>
            <small>{session?.user.email || 'Connect your account'}</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <Link to="/" className="mobile-brand">
            <CarFront size={23} /> Smart Car
          </Link>
          <span className="desktop-only">Personal vehicle workspace</span>
          <div className="topbar-actions">
            <NotificationCenter />
            <Link className="button button-small" to="/vehicles/new">
              <Plus size={17} />
              Add vehicle
            </Link>
          </div>
        </header>
        <main>
          <Outlet />
        </main>
        <footer>
          Smart Car Service Book <span>Made for every mile.</span>
        </footer>
      </div>
      <nav className="bottom-nav">
        <NavLink to="/" end>
          <LayoutGrid size={21} />
          Garage
        </NavLink>
        <NavLink to="/shops">
          <Wrench size={21} />
          Repair shop
        </NavLink>
        <NavLink to="/workshop">
          <ClipboardList size={21} />
          Shop customers
        </NavLink>
        {platformAdmin && (
          <NavLink to="/platform">
            <ShieldCheck size={21} />
            Platform
          </NavLink>
        )}
        <NavLink to="/settings">
          <Settings size={21} />
          Settings
        </NavLink>
      </nav>
    </div>
  )
}
