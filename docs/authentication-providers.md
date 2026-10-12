# Future Firebase login providers and secure linking

**Update:** Firebase Google and email/password are now implemented locally behind `authService`; see [migration setup](firebase-migration.md). Facebook, Apple and linking remain design-only. The original scope description below is retained as design context, not the current runtime status.

## Scope

The local application uses Firebase behind `Authentication` in `src/types/auth.ts` and `authService` in `src/services/auth.ts`. [Trusted provisioning](trusted-provisioning.md) establishes the stable application owner before a session is exposed. Remote cutover remains pending. This document describes future Facebook/Apple and account linking, none of which is implemented yet.

Keep SDK initialization, provider creation, redirects, credential handling, session restoration and linking in the authentication service. Components should consume the application contract and application identity, never Firebase `User`, OAuth credentials, or access tokens. Keep a single adapter and a small provider switch when implementation is authorized; no provider registry or extra framework is needed.

## Stable application ownership

`AuthUser.id` is the application's owner UUID. It must remain stable across login methods. `vehicles.owner_id` and maintenance-to-vehicle foreign keys must never depend on email, provider names, Facebook IDs, Apple IDs, or a raw Firebase UID.

Firebase account linking preserves a Firebase user's UID across linked login methods. See [Firebase account linking](https://firebase.google.com/docs/auth/web/account-linking).

If Firebase is introduced, a trusted backend must map the verified Firebase identity `(Firebase project, Firebase UID)` to an existing application owner UUID. Enforce uniqueness so that one identity cannot belong to multiple owners. Existing accounts retain their UUIDs. Create a new application UUID only for a genuinely new account; linking must not create another owner or rewrite vehicle ownership. The browser cannot choose or supply a trusted ownership mapping.

An initial Firebase transition would still require a separately approved authentication integration: current foreign keys reference Supabase `auth.users`, and policies use `auth.uid()`. Firebase tokens are not automatically interchangeable with Supabase sessions. Preserve existing owner rows and establish server-verified identity access before switching. Once that integration exists, adding Facebook or Apple must require no changes to vehicle/maintenance relationships or ownership policies.

## Small future contract extension

When additional providers are implemented, replace the Google-specific entry point with a provider-aware method and expose only enabled providers. Proposed operations (design only):

```ts
type LoginProvider = 'google' | 'facebook' | 'apple'

signInWithProvider(provider: LoginProvider, redirectUrl: string): Promise<void>
getLinkedProviders(): Promise<LoginProvider[]>
linkProvider(provider: LoginProvider, redirectUrl: string): Promise<void>
```

Keep existing email/password, session and sign-out methods. Authentication availability does not imply a provider is enabled: show a login/link button only when that provider is configured. Facebook and Apple remain unavailable until explicitly implemented and tested.

Sign-in and linking are distinct operations. Sign-in establishes a session; linking adds another login method to the current verified account. Never implement linking as another sign-in call or silently replace the current account.

## Secure linking flow

1. Require an authenticated account and recent reauthentication. Save the expected application owner ID and Firebase UID inside the authentication flow.
2. Explain the provider being connected and obtain explicit consent. Obtain the provider credential through Firebase's supported popup/redirect flow and link it to the current user with the SDK linking methods.
3. After success, verify the Firebase UID and backend-resolved owner UUID are unchanged. Refresh the session and linked-provider list. No vehicle writes are part of this operation.
4. If the provider credential belongs to another account, stop. Require proof of access to the existing account before any separate account-resolution process. Do not auto-merge based on matching email addresses, move records, delete users, or guess which owner should win.
5. On cancellation, expired credentials, redirect failure or a changed active account, leave ownership and existing login methods unchanged. Keep pending OAuth credentials only in SDK-managed flow state or short-lived memory; never persist them in application logs, query parameters or project files.

Firebase documents the account-exists-with-different-credential flow in its [Facebook login guide](https://firebase.google.com/docs/auth/web/facebook-login). Translate SDK errors into concise application errors inside the service, and do not disclose which account owns a credential.

Unlinking is outside this design's implementation scope. Before adding it, require reauthentication and prevent removal of the last usable sign-in method.

## Provider setup when authorized

- **Facebook:** enable the provider in Firebase Authentication, configure the Meta app and approved OAuth redirect URI, and store its app secret in provider/backend configuration. Follow the [Firebase Facebook guide](https://firebase.google.com/docs/auth/web/facebook-login).
- **Apple:** configure Sign in with Apple identifiers, keys and redirect URLs, enable the Firebase provider, handle private relay email and obtain consent when linking an anonymized Apple identity to another identity. Email may be hidden or change; it is never an ownership key. Follow the [Firebase Apple web guide](https://firebase.google.com/docs/auth/web/apple).
- **Both:** use SDK-supported OAuth protections and authorized domains, validate Firebase ID tokens server-side, and keep Apple private keys, Meta app secrets and Firebase Admin credentials out of frontend environment variables and this public repository.

## Required future tests

- Each enabled provider signs in to the same mapped application owner.
- Linking a new provider leaves both Firebase UID and application owner UUID unchanged.
- Provider collisions, cancellation, stale sessions and account switching cannot merge or transfer ownership.
- Apple private relay/missing email does not create duplicate owners.
- Existing vehicles and maintenance items remain accessible through every linked method, while cross-owner API requests remain denied.
- No provider credentials escape the authentication service or appear in logs/storage snapshots.
- Disabled providers are neither shown nor accepted by the authentication adapter.

No provider implementation, identity migration or remote configuration is authorized by this design document.
