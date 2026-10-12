import { NavLink, Outlet, Link } from 'react-router-dom'
import {
  CarFront,
  LayoutGrid,
  Settings,
  Plus,
  ArrowUpRight,
} from 'lucide-react'
import { useAuth } from './AuthProvider'
export function Layout() {
  const { session } = useAuth()
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
          <Link className="button button-small" to="/vehicles/new">
            <Plus size={17} />
            Add vehicle
          </Link>
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
        <NavLink to="/vehicles/new">
          <Plus size={21} />
          Add vehicle
        </NavLink>
        <NavLink to="/settings">
          <Settings size={21} />
          Settings
        </NavLink>
      </nav>
    </div>
  )
}
