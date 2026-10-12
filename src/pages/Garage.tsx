import { Link } from 'react-router-dom'
import {
  CarFront,
  Bike,
  Plus,
  ArrowUpRight,
  Gauge,
  ShieldCheck,
} from 'lucide-react'
import { useVehicles } from '../hooks/useVehicles'
import { authService } from '../services/auth'
import { Loading, ErrorState } from '../components/States'
export function Garage() {
  const { vehicles, loading, error, reload } = useVehicles()
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR VEHICLES, TOGETHER</p>
          <h1>
            My garage<span className="blue-dot">.</span>
          </h1>
          <p>A clear view of the vehicles that move you.</p>
        </div>
        <Link to="/vehicles/new" className="button heading-action">
          <Plus size={19} />
          Add vehicle
        </Link>
      </div>
      {!authService.available && (
        <div className="notice">
          <ShieldCheck size={22} />
          <div>
            <strong>Your garage is ready to connect.</strong>
            <p>
              Add your Firebase and Supabase configuration to enable sign-in and
              securely save vehicles.{' '}
              <Link className="text-link" to="/settings">
                View setup status
              </Link>
            </p>
          </div>
        </div>
      )}
      <section className="stats" aria-label="Garage overview">
        <div className="stat">
          <span>
            Total vehicles
            <CarFront size={20} />
          </span>
          <strong>{vehicles.length.toString().padStart(2, '0')}</strong>
          <small>In your personal garage</small>
        </div>
        <div className="stat">
          <span>
            Cars
            <CarFront size={20} />
          </span>
          <strong>
            {vehicles
              .filter((v) => v.type === 'car')
              .length.toString()
              .padStart(2, '0')}
          </strong>
          <small>Four wheels, endless possibilities</small>
        </div>
        <div className="stat">
          <span>
            Motorcycles
            <Bike size={20} />
          </span>
          <strong>
            {vehicles
              .filter((v) => v.type === 'motorcycle')
              .length.toString()
              .padStart(2, '0')}
          </strong>
          <small>Ready for the open road</small>
        </div>
      </section>
      <div className="section-heading">
        <h2>
          Your vehicles <span className="count">{vehicles.length}</span>
        </h2>
        <span>All vehicles</span>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} retry={() => void reload()} />
      ) : vehicles.length ? (
        <div className="vehicle-grid">
          {vehicles.map((v) => (
            <Link key={v.id} to={`/vehicles/${v.id}`} className="vehicle-card">
              <div className="vehicle-art">
                {v.type === 'car' ? (
                  <CarFront size={86} strokeWidth={1} />
                ) : (
                  <Bike size={86} strokeWidth={1} />
                )}
                <span className="pill">
                  {v.type === 'car' ? 'Car' : 'Motorcycle'}
                </span>
              </div>
              <div className="vehicle-content">
                <small>
                  {v.year} · {v.engine}
                </small>
                <h3>
                  {v.make} {v.model}
                  <ArrowUpRight size={20} />
                </h3>
                <div className="vehicle-mileage">
                  <Gauge size={17} />
                  {v.mileage.toLocaleString()} km
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <section className="empty-card">
          <div className="empty-art">
            <div className="road-line" />
            <CarFront size={80} strokeWidth={1.25} />
            <span className="empty-plus">
              <Plus size={20} />
            </span>
          </div>
          <span className="eyebrow">A NEW JOURNEY STARTS HERE</span>
          <h2>Make room for your first vehicle</h2>
          <p>
            Add your car or motorcycle and keep its
            <br className="desktop-only" /> essential details in one organized
            place.
          </p>
          <Link to="/vehicles/new" className="button">
            <Plus size={18} />
            Add your first vehicle
          </Link>
          <small>Just the essentials. It takes a minute.</small>
        </section>
      )}
      <div className="garage-note">
        <ShieldCheck size={19} />
        <p>
          Your garage is personal. Your vehicle details stay with your account.
        </p>
      </div>
    </>
  )
}
