/**
 * Signing in with GitHub through the OAuth device flow.
 *
 * The web flow is not an option: GitHub needs the client secret to trade its
 * code for a token, even with PKCE, and an extension cannot keep a secret.
 * The device flow needs no secret and no redirect back to the extension.
 */

/**
 * Client ID of the GitHub Sidecar OAuth app, which needs device flow enabled in
 * its settings. Client IDs are public. Signing in is hidden while this is empty.
 */
export const OAUTH_CLIENT_ID = ''

export const canSignIn = OAUTH_CLIENT_ID !== ''

/** The same access the settings page asks a classic token for. */
export const OAUTH_SCOPES = ['repo', 'read:org']

/** Where GitHub lists the organizations this app can reach, and revokes it. */
export function appSettingsUrl(clientId: string = OAUTH_CLIENT_ID): string {
  return `https://github.com/settings/connections/applications/${clientId}`
}

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

/** GitHub adds this much to the poll interval with every `slow_down`. */
const SLOW_DOWN_MS = 5_000

/** How long one request may hang before it is dropped and polling moves on. */
const REQUEST_TIMEOUT_MS = 30_000

export interface DeviceCode {
  deviceCode: string
  /** What the reader types at `verificationUri`, such as `WDJB-MJHT`. */
  userCode: string
  verificationUri: string
  /** Unix milliseconds. */
  expiresAt: number
  /** The shortest wait GitHub allows between polls. */
  intervalMs: number
}

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Sign-in was canceled on GitHub.',
  expired_token: 'The code expired before it was entered. Sign in again for a new one.',
  device_flow_disabled: 'This OAuth app does not have device flow enabled.',
  incorrect_client_credentials: 'GitHub does not recognize this OAuth app.',
  'Not Found': 'GitHub does not recognize this OAuth app.',
}

function describeError(error: unknown, status: number): string {
  if (typeof error === 'string' && ERROR_MESSAGES[error]) return ERROR_MESSAGES[error]
  return typeof error === 'string'
    ? `GitHub could not sign you in (${error}).`
    : `GitHub responded with ${status}.`
}

/**
 * Rejects with a network error when the connection drops or hangs, including
 * partway through the body, and resolves with a null body when GitHub answers
 * with something other than JSON.
 */
async function post(
  url: string,
  params: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  // Joined by hand: `AbortSignal.any` needs Chrome 116, and the minimum is 114.
  const request = new AbortController()
  const forward = () => request.abort(signal?.reason)
  if (signal?.aborted) forward()
  signal?.addEventListener('abort', forward, { once: true })
  const timer = setTimeout(
    () => request.abort(new Error('GitHub did not answer in time. Try again.')),
    REQUEST_TIMEOUT_MS,
  )

  try {
    const response = await fetch(url, {
      method: 'POST',
      // Form-encoded with this Accept header is a CORS simple request. GitHub
      // answers no preflight on these endpoints.
      headers: { Accept: 'application/json' },
      body: new URLSearchParams(params),
      credentials: 'omit',
      signal: request.signal,
    })
    const body: unknown = await response.json().catch((error: unknown) => {
      if (error instanceof SyntaxError) return null
      throw error
    })
    return {
      status: response.status,
      body: body && typeof body === 'object' ? (body as Record<string, unknown>) : null,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forward)
  }
}

/** Starts signing in. The reader enters `userCode` at `verificationUri`. */
export async function requestDeviceCode(
  clientId: string,
  { signal, now = Date.now }: { signal?: AbortSignal; now?: () => number } = {},
): Promise<DeviceCode> {
  const { status, body } = await post(
    DEVICE_CODE_URL,
    { client_id: clientId, scope: OAUTH_SCOPES.join(' ') },
    signal,
  )
  if (
    typeof body?.device_code !== 'string' ||
    typeof body.user_code !== 'string' ||
    typeof body.verification_uri !== 'string'
  ) {
    throw new Error(describeError(body?.error, status))
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    expiresAt: now() + Number(body.expires_in ?? 900) * 1000,
    intervalMs: Number(body.interval ?? 5) * 1000,
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export interface PollOptions {
  signal?: AbortSignal
  now?: () => number
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/**
 * Resolves with an access token once the reader approves the code on GitHub.
 * Rejects when they cancel there, when the code expires, or with the signal
 * reason once `signal` aborts.
 */
export async function pollForToken(
  clientId: string,
  code: DeviceCode,
  { signal, now = Date.now, wait = sleep }: PollOptions = {},
): Promise<string> {
  let intervalMs = code.intervalMs

  for (;;) {
    // GitHub refuses a poll that comes sooner than the interval after the last.
    // eslint-disable-next-line no-await-in-loop
    await wait(intervalMs, signal)
    if (now() >= code.expiresAt) throw new Error(ERROR_MESSAGES.expired_token)

    let answer: Awaited<ReturnType<typeof post>>
    try {
      // eslint-disable-next-line no-await-in-loop
      answer = await post(
        ACCESS_TOKEN_URL,
        { client_id: clientId, device_code: code.deviceCode, grant_type: DEVICE_GRANT },
        signal,
      )
    } catch (error) {
      if (signal?.aborted) throw error
      // A dropped or hung request leaves the code usable, so the next poll can still finish.
      continue
    }

    const { status, body } = answer
    if (typeof body?.access_token === 'string' && body.access_token) return body.access_token
    if (status >= 500) continue
    if (body?.error === 'authorization_pending') continue
    if (body?.error === 'slow_down') {
      intervalMs =
        typeof body.interval === 'number' ? body.interval * 1000 : intervalMs + SLOW_DOWN_MS
      continue
    }
    throw new Error(describeError(body?.error, status))
  }
}
