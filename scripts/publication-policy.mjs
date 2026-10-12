export function forbiddenPublicationPath(path) {
  if (['.env.example', 'server/.env.example'].includes(path)) return false
  if (
    /(^|\/)(?:\.netrc|\.npmrc|\.pypirc)$|(^|\/)(?:dump|backup|pg_dump)[^/]*\.sql$/i.test(
      path,
    )
  )
    return true
  return /(^|\/)(?:\.env(?:\..*)?|\.aws|\.ssh|\.gnupg|\.codex|\.agents|\.vscode|\.idea|private|credentials|secrets|uploads|user-uploads|vehicle-photos|invoices|documents|private-data|backups|exports|node_modules|dist|build|coverage|\.tmp|tmp|temp)(?:\/|$)|(?:^|\/)(?:credentials[^/]*|service-account[^/]*|client_secret[^/]*|firebase-admin[^/]*|[^/]*firebase-adminsdk[^/]*)\.json$|(?:^|\/)supabase-root\.crt$|\.(?:env|pem|key|p12|pfx|keystore|dump|backup|sqlite3?|db|log|sql\.gz|sql\.zip)$/i.test(
    path,
  )
}
