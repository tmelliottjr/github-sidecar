import { useState } from 'react'
import { CheckCircle2, ExternalLink, Eye, EyeOff, Loader2, XCircle } from 'lucide-react'

import { QueryEditor } from '@/components/query-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStorageValue } from '@/hooks/use-storage-value'
import { sendMessage } from '@/lib/messages'
import type { Settings } from '@/lib/storage'
import { cn } from '@/lib/utils'

const TOKEN_SCOPES_URL =
  'https://github.com/settings/tokens/new?scopes=repo,read:org&description=GitHub%20Sidebar'

const POLL_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '30 seconds', value: 30_000 },
  { label: '1 minute', value: 60_000 },
  { label: '5 minutes', value: 300_000 },
  { label: '15 minutes', value: 900_000 },
]

type ValidationState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'valid'; login: string }
  | { status: 'invalid'; message: string }

export function OptionsApp() {
  const [settings, setSettings] = useStorageValue('settings')
  const [savedQueries, setSavedQueries] = useStorageValue('savedQueries')
  const [revealed, setRevealed] = useState(false)
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle' })

  if (!settings || !savedQueries) return null

  const patch = (next: Partial<Settings>) => setSettings((current) => ({ ...current, ...next }))

  const validate = async () => {
    setValidation({ status: 'checking' })
    try {
      const { login } = await sendMessage({
        type: 'validate-token',
        token: settings.token,
      })
      setValidation({ status: 'valid', login })
    } catch (error) {
      setValidation({
        status: 'invalid',
        message: error instanceof Error ? error.message : 'Validation failed.',
      })
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">GitHub Sidebar</h1>
        <p className="text-[13px] text-muted-foreground">
          Track the issues and pull requests you care about from anywhere on github.com.
        </p>
      </header>

      <Section
        title="Access token"
        description="Stored locally in this browser and sent only to api.github.com. A classic token needs repo and read:org scope to see private repositories."
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={revealed ? 'text' : 'password'}
              value={settings.token}
              placeholder="ghp_…"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                patch({ token: event.target.value.trim() })
                setValidation({ status: 'idle' })
              }}
              className="pr-9 font-mono text-[12px]"
            />
            <button
              type="button"
              onClick={() => setRevealed((current) => !current)}
              aria-label={revealed ? 'Hide token' : 'Show token'}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
            >
              {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>

          <Button
            variant="outline"
            onClick={() => void validate()}
            disabled={!settings.token || validation.status === 'checking'}
          >
            {validation.status === 'checking' && <Loader2 className="animate-spin" />}
            Verify
          </Button>
        </div>

        {validation.status === 'valid' && (
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-open">
            <CheckCircle2 className="size-3.5" />
            Connected as {validation.login}
          </p>
        )}
        {validation.status === 'invalid' && (
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-closed">
            <XCircle className="size-3.5" />
            {validation.message}
          </p>
        )}

        <a
          href={TOKEN_SCOPES_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-[12px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Create a token on GitHub
          <ExternalLink className="size-3" />
        </a>
      </Section>

      <Section
        title="Refresh"
        description="How often the sidebar re-checks GitHub for state changes while it is open."
      >
        <div className="flex flex-wrap gap-1.5">
          {POLL_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={settings.pollIntervalMs === option.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => patch({ pollIntervalMs: option.value })}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Opening items"
        description="Hold ⌘ or Ctrl while clicking to override this and open a tab."
      >
        <div className="flex gap-1.5">
          {(['window', 'tab'] as const).map((target) => (
            <Button
              key={target}
              variant={settings.openIn === target ? 'default' : 'outline'}
              size="sm"
              onClick={() => patch({ openIn: target })}
            >
              {target === 'window' ? 'New window' : 'New tab'}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Saved queries"
        description="Written in GitHub search syntax. These appear in the sidebar's query menu."
      >
        <div className="-mx-3 max-h-[420px] overflow-y-auto rounded-lg border border-border bg-background">
          <QueryEditor
            queries={savedQueries}
            activeQueryId={settings.activeQueryId}
            onChange={setSavedQueries}
            onSelect={(id) => patch({ activeQueryId: id })}
          />
        </div>
      </Section>
    </main>
  )
}

function Section({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm',
        className,
      )}
    >
      <div className="space-y-0.5">
        <h2 className="text-[14px] font-bold tracking-tight">{title}</h2>
        {description && (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  )
}
