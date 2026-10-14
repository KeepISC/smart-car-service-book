import { client } from './supabase'
import { notifyMaintenanceChange } from './maintenanceChanges'
import type { ShopReminder } from '../types/shopReminder'

export async function sendShopMaintenanceReminder(
  shopId: string,
  vehicleId: string,
  itemId: string,
) {
  const { data, error } = await client().rpc('send_shop_maintenance_reminder', {
    p_shop_id: shopId,
    p_vehicle_id: vehicleId,
    p_maintenance_item_id: itemId,
  })
  if (error) throw error
  if (typeof data !== 'string' || !data)
    throw new Error('Reminder confirmation is unavailable.')
  notifyMaintenanceChange()
  return data
}

export async function listShopMaintenanceReminders(): Promise<ShopReminder[]> {
  const { data, error } = await client().rpc('list_shop_maintenance_reminders')
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Reminders are unavailable.')
  return data
}

export async function setShopMaintenanceReminderState(
  id: string,
  state: 'read' | 'dismissed',
) {
  const { error } = await client().rpc('set_shop_maintenance_reminder_state', {
    p_reminder_id: id,
    p_state: state,
  })
  if (error) throw error
  notifyMaintenanceChange()
}
