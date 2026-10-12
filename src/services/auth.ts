import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onIdTokenChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import type { Authentication, AuthUser } from '../types/auth'
import {
  firebaseAuth,
  firebaseConfigured,
  firebaseProjectId,
  firebaseReady,
} from './firebase'
import { firebaseOwnerId } from './firebaseIdentity'
import { provisionFirebaseUser, ProvisioningClientError } from './provisioning'
import { AccountSetupError } from './authErrors'
const preparedUsers = new WeakSet<User>()
const pendingUsers = new WeakMap<User, Promise<AuthUser>>()
async function ready() {
  if (!firebaseAuth)
    throw new Error('Configure Firebase Authentication before signing in.')
  await firebaseReady
  await firebaseAuth.authStateReady()
  return firebaseAuth
}
async function userView(user: User, forceRefresh = false): Promise<AuthUser> {
  const result = await user.getIdTokenResult(forceRefresh)
  const id = firebaseOwnerId(result.claims, user.uid, firebaseProjectId)
  if (!id)
    throw new Error(
      'Verify your email and complete trusted account provisioning before accessing your garage.',
    )
  return { id, email: user.email ?? undefined }
}
async function prepareUser(user: User): Promise<AuthUser> {
  const pending = pendingUsers.get(user)
  if (pending) return pending
  const preparation = (async () => {
    try {
      let identity: AuthUser
      if (preparedUsers.has(user)) {
        identity = await userView(user)
      } else {
        const initial = await user.getIdTokenResult()
        if (initial.claims.email_verified !== true)
          throw new AccountSetupError(
            'Firebase sign-in succeeded. Verify your email before accessing your garage.',
          )
        await provisionFirebaseUser(user)
        identity = await userView(user, true)
      }
      if (firebaseAuth?.currentUser !== user)
        throw new Error('Your active account changed. Sign in again.')
      preparedUsers.add(user)
      return identity
    } catch (error) {
      preparedUsers.delete(user)
      // A failed provisioning attempt must not leave a hidden Firebase session.
      // Never sign out a different account that replaced this one during a request.
      if (firebaseAuth?.currentUser === user) {
        try {
          await signOut(firebaseAuth)
        } catch {
          throw new AccountSetupError(
            'Firebase sign-in succeeded, but application setup failed. Use Sign out to clear the session, then retry.',
          )
        }
      }
      if (error instanceof AccountSetupError) throw error
      if (error instanceof ProvisioningClientError)
        throw new AccountSetupError(
          `Firebase sign-in succeeded, but application provisioning failed. ${error.message} Garage access is unavailable.`,
        )
      throw new AccountSetupError(
        'Firebase sign-in succeeded, but application provisioning failed. Garage access is unavailable. Retry or contact support.',
      )
    }
  })()
  pendingUsers.set(user, preparation)
  try {
    return await preparation
  } finally {
    if (pendingUsers.get(user) === preparation) pendingUsers.delete(user)
  }
}
export const authService: Authentication = {
  available: firebaseConfigured,
  async getSession() {
    if (!firebaseAuth) return null
    const auth = await ready()
    return auth.currentUser
      ? { user: await prepareUser(auth.currentUser) }
      : null
  },
  async getUser() {
    const auth = await ready()
    return auth.currentUser ? prepareUser(auth.currentUser) : null
  },
  subscribe(listener) {
    if (!firebaseAuth) return () => {}
    let active = true
    let generation = 0
    const unsubscribe = onIdTokenChanged(firebaseAuth, (user) => {
      const current = ++generation
      if (!user) {
        listener(null)
        return
      }
      prepareUser(user)
        .then((identity) => {
          if (active && current === generation) listener({ user: identity })
        })
        .catch(() => {
          if (active && current === generation) listener(null)
        })
    })
    return () => {
      active = false
      unsubscribe()
    }
  },
  async signIn(credentials) {
    const { user } = await signInWithEmailAndPassword(
      await ready(),
      credentials.email,
      credentials.password,
    )
    preparedUsers.delete(user)
    await prepareUser(user)
  },
  async register(credentials, redirectUrl) {
    const auth = await ready()
    const { user } = await createUserWithEmailAndPassword(
      auth,
      credentials.email,
      credentials.password,
    )
    try {
      await sendEmailVerification(user, { url: redirectUrl })
    } finally {
      await signOut(auth)
    }
    return { confirmationRequired: true }
  },
  async signInWithGoogle() {
    const { user } = await signInWithPopup(
      await ready(),
      new GoogleAuthProvider(),
    )
    preparedUsers.delete(user)
    await prepareUser(user)
  },
  async signOut() {
    if (firebaseAuth) {
      if (firebaseAuth.currentUser)
        preparedUsers.delete(firebaseAuth.currentUser)
      await signOut(firebaseAuth)
    }
  },
}
