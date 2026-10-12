// @vitest-environment node
import { expect, it } from 'vitest'
import pg from 'pg'
import { parseDatabaseUrl, databaseOptions } from './database-config.mjs'

const endpoint = 'aws-0-eu-west-1.pooler.supabase.com:5432/postgres'
const login = 'scsb_provisioning_local.ttwlscydylnaogawmgce'
const fictionalUrl = (password) =>
  `postgresql://${login}:${password}@${endpoint}`

it('preserves reserved characters and literal percent sequences by decoding once', () => {
  const password = 'fictional@:#/?%40 space+!'
  const connection = parseDatabaseUrl(
    fictionalUrl(encodeURIComponent(password)),
  )
  const client = new pg.Client(databaseOptions(connection, 'fictional-ca'))
  expect(client.connectionParameters.password).toBe(password)
  expect(client.connectionParameters.user).toBe(login)
})

it.each([
  '?sslmode=no-verify',
  '?password=override',
  '?host=other',
  '#fragment',
])('rejects connection overrides %s', (suffix) => {
  expect(() => parseDatabaseUrl(fictionalUrl('fictional') + suffix)).toThrow(
    'Invalid provisioning database configuration',
  )
})

it('rejects administrator credentials and malformed encoding without exposing the URL', () => {
  for (const value of [
    fictionalUrl('fictional').replace(login, 'postgres'),
    fictionalUrl('bad%xx'),
  ]) {
    try {
      parseDatabaseUrl(value)
      expect.fail('Expected configuration rejection')
    } catch (error) {
      expect(error.message).toBe('Invalid provisioning database configuration')
      expect(error.message).not.toContain(value)
    }
  }
})

it('requires certificate and hostname verification in the driver', () => {
  const connection = parseDatabaseUrl(fictionalUrl('fictional'))
  const client = new pg.Client(databaseOptions(connection, 'fictional-ca'))
  expect(client.connectionParameters.ssl).toEqual({
    ca: 'fictional-ca',
    rejectUnauthorized: true,
    servername: connection.host,
  })
  expect(client.connectionParameters.sslnegotiation).toBe('postgres')
})
