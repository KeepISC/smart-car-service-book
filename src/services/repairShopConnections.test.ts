import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ client: () => ({ rpc: mock.rpc }) }))
import {
  acceptRepairShopConnectionInvitation,
  cancelRepairShopConnectionInvitation,
  createRepairShopConnectionInvitation,
  declineRepairShopConnectionInvitation,
  listRepairShopConnectionInvitations,
  previewRepairShopConnectionInvitation,
  repairShopConnectionInvitationLink,
  resolveVehicleShopRequest,
} from './repairShops'

const token = 'a'.repeat(64)
beforeEach(() => {
  vi.clearAllMocks()
  mock.rpc.mockResolvedValue({ data: null, error: null })
})

it('creates a generic invitation without a customer identity or vehicle', async () => {
  const data = { id: 'invitation', token, expires_at: '2026-10-15T12:00:00Z' }
  mock.rpc.mockResolvedValueOnce({ data, error: null })
  await expect(createRepairShopConnectionInvitation('shop')).resolves.toEqual(
    data,
  )
  expect(mock.rpc).toHaveBeenCalledWith(
    'create_repair_shop_connection_invitation',
    { p_shop_id: 'shop', p_expires_at: null },
  )
  await expect(
    createRepairShopConnectionInvitation('shop', 'bad'),
  ).rejects.toThrow('expiry')
  expect(mock.rpc).toHaveBeenCalledTimes(1)
})

it('puts link tokens only in a fragment on the intended application origin', () => {
  const link = new URL(
    repairShopConnectionInvitationLink(token, 'http://localhost:5173'),
  )
  expect(link.origin).toBe('http://localhost:5173')
  expect(link.pathname).toBe('/shop-connections')
  expect(link.search).toBe('')
  expect(link.hash).toBe(`#shop-connection=${token}`)
  expect(
    repairShopConnectionInvitationLink(token, 'https://example.test'),
  ).toContain('#shop-connection=')
  for (const origin of [
    'http://example.test',
    'https://example.test/path',
    'https://example.test?token=value',
    'https://user:password@example.test',
  ])
    expect(() => repairShopConnectionInvitationLink(token, origin)).toThrow()
})

it('previews only the shop and requires explicit vehicle and write approval on acceptance', async () => {
  const preview = {
    id: 'invitation',
    expires_at: '2026-10-15T12:00:00Z',
    shop: { id: 'shop', name: 'Fictional' },
  }
  mock.rpc.mockResolvedValueOnce({ data: preview, error: null })
  await expect(previewRepairShopConnectionInvitation(token)).resolves.toEqual(
    preview,
  )
  mock.rpc.mockResolvedValueOnce({ data: 'authorization', error: null })
  await expect(
    acceptRepairShopConnectionInvitation(token, 'vehicle', false),
  ).resolves.toBe('authorization')
  expect(mock.rpc).toHaveBeenLastCalledWith(
    'accept_repair_shop_connection_invitation',
    { p_token: token, p_vehicle_id: 'vehicle', p_can_create_records: false },
  )
})

it('resolves pending requests, declines links and cancels them without bearer-token exposure', async () => {
  await resolveVehicleShopRequest('vehicle', 'authorization', 'declined')
  expect(mock.rpc).toHaveBeenLastCalledWith('resolve_vehicle_shop_request', {
    p_vehicle_id: 'vehicle',
    p_authorization_id: 'authorization',
    p_outcome: 'declined',
  })
  await declineRepairShopConnectionInvitation(token)
  expect(mock.rpc).toHaveBeenLastCalledWith(
    'decline_repair_shop_connection_invitation',
    { p_token: token },
  )
  await cancelRepairShopConnectionInvitation('shop', 'invitation')
  expect(mock.rpc).toHaveBeenLastCalledWith(
    'cancel_repair_shop_connection_invitation',
    { p_shop_id: 'shop', p_invitation_id: 'invitation' },
  )
  mock.rpc.mockResolvedValueOnce({ data: [], error: null })
  await expect(listRepairShopConnectionInvitations('shop')).resolves.toEqual([])
})

it('rejects malformed tokens and missing approval before RPC calls', async () => {
  for (const bad of ['bad', 'A'.repeat(64), 'a'.repeat(63)]) {
    await expect(previewRepairShopConnectionInvitation(bad)).rejects.toThrow(
      'invalid',
    )
    await expect(
      acceptRepairShopConnectionInvitation(bad, 'vehicle', true),
    ).rejects.toThrow('invalid')
    await expect(declineRepairShopConnectionInvitation(bad)).rejects.toThrow(
      'invalid',
    )
  }
  await expect(
    acceptRepairShopConnectionInvitation(
      token,
      'vehicle',
      undefined as unknown as boolean,
    ),
  ).rejects.toThrow('Choose')
  expect(mock.rpc).not.toHaveBeenCalled()
})

it('preserves replay, expiry and serialization failures without retrying approval', async () => {
  for (const code of ['42501', '40001']) {
    const error = { code, message: 'Unavailable' }
    mock.rpc.mockResolvedValueOnce({ data: null, error })
    await expect(
      acceptRepairShopConnectionInvitation(token, 'vehicle', true),
    ).rejects.toEqual(error)
  }
  expect(mock.rpc).toHaveBeenCalledTimes(2)
})

it('rejects malformed success responses', async () => {
  await expect(createRepairShopConnectionInvitation('shop')).rejects.toThrow(
    'not created',
  )
  await expect(previewRepairShopConnectionInvitation(token)).rejects.toThrow(
    'unavailable',
  )
  await expect(
    acceptRepairShopConnectionInvitation(token, 'vehicle', true),
  ).rejects.toThrow('not completed')
  await expect(listRepairShopConnectionInvitations('shop')).rejects.toThrow(
    'unavailable',
  )
})
