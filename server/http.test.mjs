// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { provisioningHandler } from './http.mjs'
import { ProvisioningError } from './provisioning.mjs'
import { createServer } from 'node:http'
import { once } from 'node:events'
let request
let response
const provision = vi.fn()
const handler = provisioningHandler({
  allowedOrigins: ['https://example.invalid'],
  provision,
})
beforeEach(() => {
  vi.resetAllMocks()
  request = {
    method: 'POST',
    url: '/provision',
    headers: {
      origin: 'https://example.invalid',
      authorization: 'Bearer fictional-token',
    },
  }
  response = { setHeader: vi.fn(), writeHead: vi.fn(), end: vi.fn() }
  response.writeHead.mockReturnValue(response)
  provision.mockResolvedValue({ provisioned: true })
})
it('accepts only a bearer token and returns no ownership or credential material', async () => {
  await handler(request, response)
  expect(provision).toHaveBeenCalledWith('fictional-token')
  expect(response.end).toHaveBeenCalledWith('{"provisioned":true}')
})
it.each([
  { origin: 'https://untrusted.invalid' },
  { origin: undefined },
  { authorization: '' },
  { 'content-length': '20' },
  { 'transfer-encoding': 'chunked' },
])(
  'rejects untrusted origins, missing identity and frontend payloads %j',
  async (headers) => {
    Object.assign(request.headers, headers)
    await handler(request, response)
    expect(provision).not.toHaveBeenCalled()
  },
)
it('supports restricted CORS preflight without provisioning', async () => {
  request.method = 'OPTIONS'
  await handler(request, response)
  expect(response.writeHead).toHaveBeenCalledWith(204)
  expect(provision).not.toHaveBeenCalled()
})
it('limits token verification attempts and resets the request window', async () => {
  let timestamp = 0
  const limited = provisioningHandler({
    allowedOrigins: ['https://example.invalid'],
    provision,
    maxRequests: 1,
    now: () => timestamp,
  })
  provision.mockRejectedValue(
    new ProvisioningError(401, 'Fictional invalid identity'),
  )
  await limited(request, response)
  await limited(request, response)
  expect(response.writeHead).toHaveBeenLastCalledWith(429, {
    'Retry-After': '60',
  })
  expect(provision).toHaveBeenCalledOnce()
  timestamp = 60000
  await limited(request, response)
  expect(provision).toHaveBeenCalledTimes(2)
})

it('rejects excess concurrent work and releases capacity after failure', async () => {
  let rejectPending
  provision.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        rejectPending = reject
      }),
  )
  const limited = provisioningHandler({
    allowedOrigins: ['https://example.invalid'],
    provision,
    maxConcurrent: 1,
  })
  const pending = limited(request, response)
  await limited(request, response)
  expect(response.writeHead).toHaveBeenLastCalledWith(429, {
    'Retry-After': '1',
  })
  expect(provision).toHaveBeenCalledOnce()
  rejectPending(new Error('Fictional private failure'))
  await pending
  await limited(request, response)
  expect(provision).toHaveBeenCalledTimes(2)
})
it.each([
  new Error('Secret database diagnostic'),
  new ProvisioningError(403, 'Private account diagnostic'),
])('never exposes backend diagnostics', async (error) => {
  provision.mockRejectedValue(error)
  await handler(request, response)
  expect(response.end.mock.calls[0][0]).not.toContain(error.message)
  expect(response.writeHead).toHaveBeenCalledWith(error.status ?? 503, {
    'Content-Type': 'application/json',
  })
})
it('serves local preflight and fictional provisioning while denying wrong paths, origins and missing tokens', async () => {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}/provision`
  const headers = { Origin: 'https://example.invalid' }
  try {
    const preflight = await fetch(url, { method: 'OPTIONS', headers })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      headers.Origin,
    )
    expect(preflight.headers.get('access-control-allow-headers')).toBe(
      'Authorization',
    )
    expect((await fetch(url, { method: 'POST', headers })).status).toBe(401)
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { Origin: 'https://untrusted.invalid' },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await fetch(url.replace('/provision', '/wrong'), {
          method: 'POST',
          headers,
        })
      ).status,
    ).toBe(404)
    const result = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer fictional-token' },
    })
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ provisioned: true })
    expect(provision).toHaveBeenCalledOnce()
    provision.mockRejectedValueOnce(
      new ProvisioningError(401, 'Private identity diagnostic'),
    )
    const rejected = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer invalid-fictional-token' },
    })
    expect(rejected.status).toBe(401)
    expect(JSON.stringify(await rejected.json())).not.toContain(
      'Private identity diagnostic',
    )
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
