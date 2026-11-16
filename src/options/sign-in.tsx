import { useEffect, useRef, useState } from 'react'
import {
  CheckIcon,
  CopyIcon,
  LinkExternalIcon,
  MarkGithubIcon,
  SyncIcon,
  XCircleFillIcon,
} from '@primer/octicons-react'

import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'
import {
  OAUTH_CLIENT_ID,
  pollForToken,
  requestDeviceCode,
  type DeviceCode,
} from '@/lib/github/oauth'
import { sendMessage } from '@/lib/messages'

type SignInState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'waiting'; code: DeviceCode }
  | { status: 'finishing' }
  | { status: 'failed'; message: string }

/**
 * Signs in with the device flow: shows a code, sends the reader to GitHub to
 * enter it, and waits for them to approve it there.
 *
 * Polling runs in this page, so closing the page cancels signing in.
 */
export function SignInWithGitHub({
  onSignedIn,
}: {
  /** Handler that is called with the new token and the account it belongs to. */
  onSignedIn: (token: string, login: string) => void
}) {
  const [state, setState] = useState<SignInState>({ status: 'idle' })
  const [copied, setCopied] = useState(false)
  const attempt = useRef<AbortController | null>(null)

  useEffect(() => () => attempt.current?.abort(), [])

  const start = async () => {
    attempt.current?.abort()
    const controller = new AbortController()
    attempt.current = controller
    const { signal } = controller

    setCopied(false)
    setState({ status: 'starting' })
    try {
      const code = await requestDeviceCode(OAUTH_CLIENT_ID, { signal })
      setState({ status: 'waiting', code })
      const token = await pollForToken(OAUTH_CLIENT_ID, code, { signal })
      setState({ status: 'finishing' })
      // GitHub can sign in a different account than the reader expects.
      const { login } = await sendMessage({ type: 'validate-token', token })
      if (signal.aborted) return
      setState({ status: 'idle' })
      onSignedIn(token, login)
    } catch (error) {
      if (signal.aborted) return
      setState({
        status: 'failed',
        message: error instanceof Error ? error.message : 'Could not sign in.',
      })
    }
  }

  const cancel = () => {
    attempt.current?.abort()
    setState({ status: 'idle' })
  }

  const copy = (code: string) => {
    void copyText(code).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  }

  if (state.status === 'waiting') {
    const { userCode, verificationUri } = state.code
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Enter this code on GitHub to finish signing in.
        </p>
        <div className="flex items-center gap-2">
          <code
            aria-label="Sign-in code"
            className="font-mono text-[20px] font-bold tracking-[0.15em]"
          >
            {userCode}
          </code>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copied ? 'Copied' : 'Copy code'}
            onClick={() => copy(userCode)}
          >
            {copied ? <CheckIcon className="text-open" /> : <CopyIcon />}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <a
              href={verificationUri}
              target="_blank"
              rel="noreferrer"
              onClick={() => copy(userCode)}
            >
              Copy code and open GitHub
              <LinkExternalIcon className="size-3" />
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={cancel}>
            Cancel
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <SyncIcon className="size-3.5 animate-spin" />
          Waiting for you to approve on GitHub…
        </p>
      </div>
    )
  }

  const busy = state.status === 'starting' || state.status === 'finishing'

  return (
    <div className="flex flex-col gap-2">
      <Button className="w-fit" onClick={() => void start()} disabled={busy}>
        {busy ? <SyncIcon className="animate-spin" /> : <MarkGithubIcon />}
        {state.status === 'finishing' ? 'Finishing sign-in…' : 'Sign in with GitHub'}
      </Button>
      {state.status === 'failed' && (
        <p className="flex items-center gap-1.5 text-[12px] font-semibold text-closed">
          <XCircleFillIcon className="size-3.5" />
          {state.message}
        </p>
      )}
    </div>
  )
}
