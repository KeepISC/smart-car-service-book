import { createClient } from '@supabase/supabase-js'
import { firebaseDatabaseToken } from './firebaseToken'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const configured = Boolean(
  url &&
  /^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(url) &&
  key?.startsWith('sb_publishable_') &&
  !key.includes('REPLACE_ME') &&
  !url.includes('your-project'),
)
export const supabase = configured
  ? createClient(url, key, {
      accessToken: firebaseDatabaseToken,
    })
  : null
export function client() {
  if (!supabase) throw new Error('Configure Supabase to connect your garage.')
  return supabase
}
