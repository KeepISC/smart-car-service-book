import { afterEach, expect, it, vi } from 'vitest'
import { isServiceHistoryEnabled } from './features'

afterEach(() => vi.unstubAllEnvs())
it.each([undefined, '', 'false', 'TRUE', '1', 'yes'])(
  'defaults Service History off for %s',
  (value) => {
    vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', value)
    expect(isServiceHistoryEnabled()).toBe(false)
  },
)
it('enables Service History only with an explicit true build flag', () => {
  vi.stubEnv('VITE_SERVICE_HISTORY_ENABLED', 'true')
  expect(isServiceHistoryEnabled()).toBe(true)
})
