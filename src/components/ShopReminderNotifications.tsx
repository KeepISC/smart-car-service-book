import { Link } from 'react-router-dom'
import type { ShopReminder } from '../types/shopReminder'

export function ShopReminderNotifications({
  reminders,
  error,
  loading,
  busy,
  update,
  reload,
  onNavigate,
}: {
  reminders: ShopReminder[]
  error: string
  loading: boolean
  busy: string | null
  update: (id: string, state: 'read' | 'dismissed') => Promise<void>
  reload: () => void
  onNavigate: () => void
}) {
  return (
    <section aria-label="Shop reminders">
      <h4>Shop reminders</h4>
      {loading && <p role="status">Loading shop reminders…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" className="text-link" onClick={reload}>
            Reload shop reminders
          </button>
        </p>
      )}
      <ul className="shop-list">
        {reminders.map((reminder) => (
          <li className="shop-row" key={reminder.id}>
            <div>
              <strong>{reminder.shop_name}</strong>
              <p>
                {reminder.vehicle_name} · {reminder.operation_name}
              </p>
              <p className="muted">
                <time dateTime={reminder.created_at}>
                  {new Date(reminder.created_at).toLocaleString()}
                </time>{' '}
                · {reminder.read_at ? 'Read' : 'Unread'}
              </p>
              <Link
                className="text-link"
                to={`/vehicles/${reminder.vehicle_id}?tab=maintenance`}
                onClick={onNavigate}
              >
                View vehicle for {reminder.operation_name}
              </Link>
            </div>
            <div className="shop-actions">
              {!reminder.read_at && (
                <button
                  type="button"
                  className="button secondary button-small"
                  disabled={busy !== null}
                  onClick={() => void update(reminder.id, 'read')}
                >
                  Mark {reminder.operation_name} reminder as read
                </button>
              )}
              <button
                type="button"
                className="button secondary button-small"
                disabled={busy !== null}
                onClick={() => void update(reminder.id, 'dismissed')}
              >
                Dismiss {reminder.operation_name} reminder
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
