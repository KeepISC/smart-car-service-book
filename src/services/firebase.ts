import { initializeApp } from 'firebase/app'
import { browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth'
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
export const firebaseProjectId = config.projectId ?? ''
export const firebaseConfigured =
  Object.values(config).every(
    (value) =>
      typeof value === 'string' &&
      value.length > 0 &&
      !/REPLACE_ME|your-project/i.test(value),
  ) && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(firebaseProjectId)
export const firebaseAuth = firebaseConfigured
  ? getAuth(initializeApp(config))
  : null
// Set persistence before starting sign-in; SDK restoration remains responsible for refreshes.
export const firebaseReady = firebaseAuth
  ? setPersistence(firebaseAuth, browserLocalPersistence)
  : Promise.resolve()
// Attach a rejection handler immediately; callers still receive persistence errors when awaiting readiness.
void firebaseReady.catch(() => {})
