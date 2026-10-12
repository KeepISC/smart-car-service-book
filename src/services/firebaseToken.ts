import { firebaseAuth, firebaseProjectId, firebaseReady } from './firebase'
import { firebaseOwnerId } from './firebaseIdentity'
export async function firebaseDatabaseToken(): Promise<string | null> {
  await firebaseReady
  if (!firebaseAuth) return null
  await firebaseAuth.authStateReady()
  const user = firebaseAuth.currentUser
  if (!user) return null
  const result = await user.getIdTokenResult()
  if (!firebaseOwnerId(result.claims, user.uid, firebaseProjectId))
    throw new Error(
      'Verify your email and sign in again to complete account setup.',
    )
  return result.token
}
