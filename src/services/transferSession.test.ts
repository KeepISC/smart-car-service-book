import { beforeEach, expect, it, vi } from 'vitest'
import {
  clearRecipientTransferToken,
  readRecipientTransferToken,
  readSenderTransfer,
  saveSenderTransfer,
} from './transferSession'

const token = 'a'.repeat(64)
beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  window.history.replaceState(null, '', '/transfer')
})
it('restores a same-tab recipient reload and preserves a newer invitation against an old completion', () => {
  window.history.replaceState(null, '', `/transfer#${token}`)
  expect(readRecipientTransferToken()).toBe(token)
  window.history.replaceState(null, '', '/transfer')
  expect(readRecipientTransferToken()).toBe(token)
  const newer = 'b'.repeat(64)
  window.history.replaceState(null, '', `/transfer#${newer}`)
  expect(readRecipientTransferToken()).toBe(newer)
  clearRecipientTransferToken(token)
  expect(sessionStorage.getItem('scsb:transfer:recipient')).toBe(newer)
  clearRecipientTransferToken(newer)
  expect(sessionStorage.length).toBe(0)
  expect(localStorage.length).toBe(0)
})
it('rejects a malformed fragment rather than reusing the previous valid token', () => {
  sessionStorage.setItem('scsb:transfer:recipient', token)
  window.history.replaceState(null, '', '/transfer#invalid')
  expect(readRecipientTransferToken()).toBe('')
  expect(sessionStorage.length).toBe(0)
})
it('restores only unexpired sender invitations and clears expired or corrupt entries', () => {
  const invite = {
    id: 'i',
    token,
    expires_at: new Date(Date.now() + 60000).toISOString(),
  }
  saveSenderTransfer('v', invite)
  expect(readSenderTransfer('v')).toEqual(invite)
  saveSenderTransfer('v', { ...invite, expires_at: '2000-01-01T00:00:00Z' })
  expect(readSenderTransfer('v')).toBeNull()
  sessionStorage.setItem('scsb:transfer:sender:v', '{corrupt')
  expect(readSenderTransfer('v')).toBeNull()
  expect(localStorage.length).toBe(0)
})
it('continues in memory when session storage is blocked without using persistent storage', () => {
  const stored = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('Blocked')
    })
  window.history.replaceState(null, '', `/transfer#${token}`)
  expect(readRecipientTransferToken()).toBe(token)
  expect(localStorage.length).toBe(0)
  stored.mockRestore()
})
