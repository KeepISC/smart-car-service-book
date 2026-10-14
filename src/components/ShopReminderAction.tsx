import { useEffect, useRef, useState } from 'react'
import { sendShopMaintenanceReminder } from '../services/shopReminders'

export function ShopReminderAction({
  shopId,
  vehicleId,
  itemId,
  label,
  onDenied,
}: {
  shopId: string
  vehicleId: string
  itemId: string
  label: string
  onDenied: () => void
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'sent' | 'error'>(
    'idle',
  )
  const [message, setMessage] = useState('')
  const active = useRef(true)
  const pending = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  async function send() {
    if (pending.current || state === 'sent') return
    pending.current = true
    setState('saving')
    setMessage('')
    try {
      await sendShopMaintenanceReminder(shopId, vehicleId, itemId)
      if (active.current) {
        setState('sent')
        setMessage('Reminder sent to the vehicle owner.')
      }
    } catch (error) {
      if (!active.current) return
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String(error.code)
          : ''
      if (code === '42501') {
        onDenied()
        return
      }
      setState('error')
      setMessage(
        code === 'P0001'
          ? 'Reminder limit reached. Please try again later.'
          : code === '23514' || code === '40001'
            ? 'The maintenance status or access changed. Refresh the vehicle before sending again.'
            : 'Unable to confirm the reminder. Refresh before trying again.',
      )
    } finally {
      pending.current = false
    }
  }
  return (
    <div>
      <button
        type="button"
        className="button secondary button-small"
        disabled={state === 'saving' || state === 'sent'}
        aria-label={`Send reminder for ${label}`}
        onClick={() => void send()}
      >
        {state === 'saving'
          ? 'Sending…'
          : state === 'sent'
            ? 'Reminder sent'
            : 'Send reminder'}
      </button>
      {message && (
        <p
          className="service-feedback"
          role={state === 'error' ? 'alert' : 'status'}
        >
          {message}
        </p>
      )}
    </div>
  )
}
