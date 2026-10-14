import { beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ rpc: vi.fn(), notify: vi.fn() }))
vi.mock('./supabase', () => ({ client: () => ({ rpc: mock.rpc }) }))
vi.mock('./vehicles', () => ({ notifyVehicleChange: mock.notify }))
vi.mock('./ownershipChanges', () => ({ announceOwnershipChange: vi.fn() }))
import {
  acceptVehicleTransfer,
  createVehicleTransfer,
  declineVehicleTransfer,
  previewVehicleTransfer,
  revokeVehicleTransfer,
} from './vehicleTransfers'

const token = 'a'.repeat(64)
beforeEach(() => {
  vi.clearAllMocks()
  mock.rpc.mockResolvedValue({ data: null, error: null })
})

it('creates an invitation without choosing a sender or recipient identity', async () => {
  const invitation = {
    id: 'invitation',
    token,
    expires_at: '2026-10-14T10:00:00Z',
  }
  mock.rpc.mockResolvedValueOnce({ data: invitation, error: null })
  await expect(createVehicleTransfer('vehicle')).resolves.toEqual(invitation)
  expect(mock.rpc).toHaveBeenCalledWith('create_vehicle_transfer', {
    p_vehicle_id: 'vehicle',
    p_expires_at: null,
  })
  await expect(createVehicleTransfer('vehicle', 'bad')).rejects.toThrow(
    'expiry',
  )
  expect(mock.rpc).toHaveBeenCalledTimes(1)
})

it('returns the constrained preview and performs acceptance with only the token', async () => {
  const preview = {
    id: 'invitation',
    expires_at: '2026-10-14T10:00:00Z',
    vehicle: { id: 'vehicle' },
    maintenance_records: [],
    maintenance_schedules: [],
  }
  mock.rpc.mockResolvedValueOnce({ data: preview, error: null })
  await expect(previewVehicleTransfer(token)).resolves.toEqual(preview)
  mock.rpc.mockResolvedValueOnce({ data: 'vehicle', error: null })
  await expect(acceptVehicleTransfer(token)).resolves.toBe('vehicle')
  expect(mock.rpc).toHaveBeenLastCalledWith('accept_vehicle_transfer', {
    p_token: token,
  })
  expect(mock.notify).toHaveBeenCalledExactlyOnceWith('vehicle')
})

it('declines by token and revokes by vehicle and invitation identifiers', async () => {
  await declineVehicleTransfer(token)
  expect(mock.rpc).toHaveBeenLastCalledWith('decline_vehicle_transfer', {
    p_token: token,
  })
  await revokeVehicleTransfer('vehicle', 'invitation')
  expect(mock.rpc).toHaveBeenLastCalledWith('revoke_vehicle_transfer', {
    p_vehicle_id: 'vehicle',
    p_invitation_id: 'invitation',
  })
  expect(mock.notify).not.toHaveBeenCalled()
})

it('rejects malformed tokens before sending them to the database', async () => {
  for (const action of [
    acceptVehicleTransfer,
    previewVehicleTransfer,
    declineVehicleTransfer,
  ]) {
    await expect(action('bad')).rejects.toThrow('invalid')
    await expect(action('A'.repeat(64))).rejects.toThrow('invalid')
  }
  expect(mock.rpc).not.toHaveBeenCalled()
})

it('surfaces authorization, expiry, replay and serialization failures without notifying success', async () => {
  for (const code of ['42501', '40001']) {
    const error = { code, message: 'Transfer refused' }
    for (const action of [
      acceptVehicleTransfer,
      previewVehicleTransfer,
      declineVehicleTransfer,
    ]) {
      mock.rpc.mockResolvedValueOnce({ data: null, error })
      await expect(action(token)).rejects.toEqual(error)
    }
  }
  expect(mock.notify).not.toHaveBeenCalled()
})

it('rejects empty success responses without treating a transfer as completed', async () => {
  await expect(createVehicleTransfer('vehicle')).rejects.toThrow('not created')
  await expect(previewVehicleTransfer(token)).rejects.toThrow('unavailable')
  await expect(acceptVehicleTransfer(token)).rejects.toThrow('not completed')
  expect(mock.notify).not.toHaveBeenCalled()
})
