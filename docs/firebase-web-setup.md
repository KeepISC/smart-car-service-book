# Firebase web app configuration

Selected project: `smart-car-service-book-61a9d`.

Open Firebase Console, select this project, then **Project settings > General > Your apps**. Select the web app and open **SDK setup and configuration > Config**. If there is no web app, register one with the web (`</>`) button; Firebase Hosting and Analytics are not required for this authentication setup.

Copy these properties from the same `firebaseConfig` object into the root ignored `.env.local`. Preserve existing valid Supabase and Firebase values.

| Environment variable        | Console property | What to copy                                                                          |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `VITE_FIREBASE_API_KEY`     | `apiKey`         | The complete web app API key string                                                   |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain`     | The exact domain from Config, normally `smart-car-service-book-61a9d.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID`  | `projectId`      | `smart-car-service-book-61a9d`                                                        |
| `VITE_FIREBASE_APP_ID`      | `appId`          | The complete web app identifier, normally `1:<project-number>:web:<identifier>`       |

Do not copy the display name, project number, OAuth client ID or Android/iOS app ID in place of these properties. This initializer does not need `storageBucket`, `messagingSenderId`, `measurementId` or `databaseURL`. The Firebase browser API key is public configuration; it does not grant database ownership. Firebase Admin keys, service-account JSON and PostgreSQL credentials belong only in the trusted server environment.

`VITE_FIREBASE_PROVISIONING_URL` is also required for an application session. It comes from your trusted provisioning service, not Firebase's web Config. Use its HTTPS `/provision` endpoint in production, or `http://127.0.0.1:8787/provision` when the local service has been configured and started. See [trusted provisioning](trusted-provisioning.md) for server credentials, database configuration and pending migration requirements.

Restart Vite after changing environment variables. The initializer checks for missing/placeholder values, initializes the SDK, and sets local browser persistence before authService proceeds. SDK initialization alone does not prove the API key belongs to the selected project or that remote providers are enabled.

For live Google testing, finish enabling Google (including support email) and Email/Password in Firebase Authentication. Check **Authentication > Settings > Authorized domains** includes `localhost` and your exact production hostname. Start Vite with `npm run dev`, open the displayed localhost URL, allow popups and select Google sign-in. Confirm the account appears in Firebase Authentication. Full garage access additionally requires the configured provisioning server, approved identity migration, matching database project configuration and Supabase Firebase third-party integration. A provisioning failure intentionally signs the Firebase user out.

After that setup, verify first login, logout, returning login, page reload/session restoration and isolation between two fictional users. Tokens should refresh after server claim assignment. Do not log tokens or credentials. Email/password registration requires email verification before garage access. Dashboard changes, migration application and deployment remain separate manual steps requiring authorization.

References: [Firebase web setup](https://firebase.google.com/docs/web/setup), [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin), [Firebase API keys](https://firebase.google.com/docs/projects/api-keys).
