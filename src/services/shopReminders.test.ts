import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), notify: vi.fn() }))
vi.mock('./supabase', () => ({ client: () => ({ rpc: mocks.rpc }) }))
vi.mock('./maintenanceChanges', () => ({
  notifyMaintenanceChange: mocks.notify,
}))
import {
  sendShopMaintenanceReminder,
  listShopMaintenanceReminders,
  setShopMaintenanceReminderState,
} from './shopReminders'
beforeEach(() => {
  vi.resetAllMocks()
})

it('sends only shop, vehicle and schedule references and notifies after confirmation', async () => {
  mocks.rpc.mockResolvedValue({ data: 'reminder-id', error: null })
  await expect(
    sendShopMaintenanceReminder('shop', 'vehicle', 'operation'),
  ).resolves.toBe('reminder-id')
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    'send_shop_maintenance_reminder',
    {
      p_shop_id: 'shop',
      p_vehicle_id: 'vehicle',
      p_maintenance_item_id: 'operation',
    },
  )
  expect(mocks.notify).toHaveBeenCalledOnce()
})
it('lists recipient reminders without accepting an owner identity and persists states', async () => {
  mocks.rpc.mockResolvedValue({ data: [], error: null })
  await expect(listShopMaintenanceReminders()).resolves.toEqual([])
  expect(mocks.rpc).toHaveBeenLastCalledWith('list_shop_maintenance_reminders')
  for (const state of ['read', 'dismissed'] as const) {
    await setShopMaintenanceReminderState('reminder', state)
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      'set_shop_maintenance_reminder_state',
      { p_reminder_id: 'reminder', p_state: state },
    )
  }
  expect(mocks.notify).toHaveBeenCalledTimes(2)
})
it.each(['42501', '40001', '23514', 'P0001'])(
  'preserves %s without retrying or notifying',
  async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code } })
    await expect(
      sendShopMaintenanceReminder('shop', 'vehicle', 'item'),
    ).rejects.toEqual({ code })
    await expect(listShopMaintenanceReminders()).rejects.toEqual({ code })
    await expect(
      setShopMaintenanceReminderState('reminder', 'read'),
    ).rejects.toEqual({ code })
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
    expect(mocks.notify).not.toHaveBeenCalled()
  },
)
it('rejects malformed confirmations and list responses', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  await expect(
    sendShopMaintenanceReminder('shop', 'vehicle', 'item'),
  ).rejects.toThrow('confirmation')
  await expect(listShopMaintenanceReminders()).rejects.toThrow('unavailable')
  expect(mocks.notify).not.toHaveBeenCalled()
})
