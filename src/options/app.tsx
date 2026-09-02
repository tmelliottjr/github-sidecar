import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BellIcon,
  CheckCircleFillIcon,
  EyeClosedIcon,
  EyeIcon,
  LinkExternalIcon,
  SyncIcon,
  TrashIcon,
  XCircleFillIcon,
} from '@primer/octicons-react'

import { QueryEditor } from '@/components/query-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ManagementPanel } from '@/options/management-panel'
import { useStorageValue } from '@/hooks/use-storage-value'
import { sendMessage, type ApiLogEntry } from '@/lib/messages'
import { REMINDER_LABELS, type ReminderOverrides } from '@/lib/attention'
import { playSound, SOUNDS, SOUND_NAMES, type SoundName } from '@/lib/sound'
import type { FeatureFlags, Settings, SoundSettings } from '@/lib/storage'
import { cn } from '@/lib/utils'

/**
 * Every feature the panel offers beyond listing rows, in the order they show
 * up in the list itself. Each says what it does rather than what it is called,
 * because the switch beside it is the only documentation most of them get.
 */
const FEATURES: Array<{
  key: keyof FeatureFlags
  title: string
  description: string
}> = [
  {
    key: 'changes',
    title: 'What changed since you looked',
    description:
      'Marks rows whose state, review, checks, comments or commits have moved since you last read them. Opening a row, or being on its page, clears the mark.',
  },
  {
    key: 'mergeState',
    title: 'Merge conflicts and stale branches',
    description:
      'Says when a pull request conflicts with its base branch, or has fallen behind it, without opening the pull request to find out.',
  },
  {
    key: 'failingChecks',
    title: 'List the failing checks',
    description:
      'Counts the red checks beside the checks mark and opens them under the row, each one a link to the run that failed.',
  },
  {
    key: 'reminders',
    title: 'Remind me about a row',
    description:
      'Ask to be told about a row again — in an hour, this evening, tomorrow, next week, or whenever it next changes. The row stays where it is until the reminder comes round.',
  },
  {
    key: 'hide',
    title: 'Hide a row',
    description:
      'Takes a row out of the list without losing it. The footer says how many are hidden and brings them back on request.',
  },
  {
    key: 'keyboard',
    title: 'Keyboard navigation',
    description:
      'j and k move through the list, Enter or o opens, p pins, h hides, r asks to be reminded when it changes, / filters.',
  },
  {
    key: 'filter',
    title: 'Filter and reorder',
    description:
      'Narrows the rows already loaded and reorders them. Costs no request, so it answers as fast as you can type.',
  },
  {
    key: 'badge',
    title: 'Count on the toolbar icon',
    description:
      'Shows how many rows in the active query have changed since you looked at them.',
  },
]

const TOKEN_SCOPES_URL =
  'https://github.com/settings/tokens/new?scopes=repo,read:org&description=GitHub%20Sidecar'

const POLL_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '30 seconds', value: 30_000 },
  { label: '1 minute', value: 60_000 },
  { label: '5 minutes', value: 300_000 },
  { label: '15 minutes', value: 900_000 },
]

const REMINDER_KEYS = ['hour', 'evening', 'tomorrow', 'week'] as const

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

  const setFeature = (key: keyof FeatureFlags, enabled: boolean) => {
    setSettings((current) => ({
      ...current,
      features: { ...current.features, [key]: enabled },
    }))
  }

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
        <h1 className="text-xl font-bold tracking-tight">GitHub Sidecar</h1>
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
              {revealed ? <EyeClosedIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
            </button>
          </div>

          <Button
            variant="outline"
            onClick={() => void validate()}
            disabled={!settings.token || validation.status === 'checking'}
          >
            {validation.status === 'checking' && <SyncIcon className="animate-spin" />}
            Verify
          </Button>
        </div>

        {validation.status === 'valid' && (
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-open">
            <CheckCircleFillIcon className="size-3.5" />
            Connected as {validation.login}
          </p>
        )}
        {validation.status === 'invalid' && (
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-closed">
            <XCircleFillIcon className="size-3.5" />
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
          <LinkExternalIcon className="size-3" />
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
        description="Hold ⌘ or Ctrl while clicking to open a tab whatever this says."
      >
        <div className="flex gap-1.5">
          {(['tab', 'window'] as const).map((target) => (
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
        title="Features"
        description="Each of these can be switched off. The list reads the same without any of them."
      >
        <div className="flex flex-col divide-y divide-border">
          {FEATURES.map((feature) => (
            <div key={feature.key} className="py-3 first:pt-0 last:pb-0">
              <SettingRow title={feature.title} description={feature.description}>
                <Switch
                  label={feature.title}
                  checked={settings.features[feature.key]}
                  onChange={(next) => setFeature(feature.key, next)}
                />
              </SettingRow>
            </div>
          ))}
        </div>
      </Section>

      <NotificationsSection settings={settings} onPatch={patch} />

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

      <ManagementPanel
        reminderOverrides={
          settings.developer.enabled ? settings.developer.reminderSeconds : null
        }
        SectionComponent={Section}
      />

      <DeveloperSection settings={settings} onPatch={patch} />
    </main>
  )
}

/**
 * Everything about being interrupted, in the order it is decided: whether to
 * speak at all, what to speak about, and what it sounds like. Each answer is
 * nested inside the one it depends on, so a reader can stop reading as soon as
 * they have said no.
 */
function NotificationsSection({
  settings,
  onPatch,
}: {
  settings: Settings
  onPatch: (next: Partial<Settings>) => void
}) {
  const context = useRef<AudioContext | null>(null)
  const { notifications } = settings
  const { sounds } = notifications

  const patch = (next: Partial<Settings['notifications']>) =>
    onPatch({ notifications: { ...notifications, ...next } })

  const preview = (name: SoundName, volume = sounds.volume) => {
    context.current ??= new AudioContext()
    void context.current.resume().catch(() => undefined)
    playSound(context.current, name, volume)
  }

  /**
   * The permission is asked for from the click that switched this on, because
   * Chrome will only prompt during a gesture — and given back when it goes
   * off, so nothing keeps a permission it has stopped using.
   */
  const setEnabled = async (enabled: boolean) => {
    const granted = enabled
      ? await chrome.permissions.request({ permissions: ['notifications'] })
      : !(await chrome.permissions.remove({ permissions: ['notifications'] }))
    if (enabled && !granted) return
    patch({ enabled })
  }

  const setSound = (next: Partial<SoundSettings>, heard: SoundName) => {
    patch({ sounds: { ...sounds, ...next } })
    preview(heard, next.volume ?? sounds.volume)
  }

  return (
    <Section
      title="Notifications"
      description="Whether the panel may interrupt you, what for, and what each of those sounds like."
    >
      <SettingRow
        title="Desktop notifications"
        description="Needs Chrome’s permission to post them, which is asked for when you switch this on."
      >
        <Switch
          label="Desktop notifications"
          checked={notifications.enabled}
          onChange={(next) => void setEnabled(next)}
        />
      </SettingRow>

      <Nested disabled={!notifications.enabled}>
        {(
          [
            {
              kind: 'reminder',
              key: 'reminders',
              title: 'Reminders you set',
              description: 'When one comes round, on the clock or because the row moved.',
            },
            {
              kind: 'change',
              key: 'changes',
              title: 'Rows that changed',
              description: 'A review, a red check, new comments, a push, a merge.',
            },
          ] as const
        ).map(({ kind, key, title, description }) => (
          <div key={kind} className="flex flex-col gap-3">
            <SettingRow title={title} description={description}>
              <Switch
                label={`Notify me about ${key === 'reminders' ? 'reminders' : 'changes'}`}
                checked={notifications[key]}
                disabled={!notifications.enabled}
                onChange={(next) => patch({ [key]: next })}
              />
            </SettingRow>

            {/*
             * The sound belongs to the kind rather than to notifications as a
             * whole: it is part of what being told about this looks like, and
             * a reader who wants a chime for their own reminders and nothing
             * at all for everything else should not have to think twice.
             */}
            <Nested disabled={!notifications.enabled || !notifications[key]}>
              <div
                role="group"
                aria-label={`${title} sound`}
                className="flex flex-wrap items-center gap-1.5"
              >
                <span className="mr-1 text-[12px] font-semibold">Sound</span>
                {SOUND_NAMES.map((name) => (
                  <Button
                    key={name}
                    variant={sounds[kind] === name ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={sounds[kind] === name}
                    disabled={!notifications.enabled || !notifications[key]}
                    onClick={() => setSound({ [kind]: name }, name)}
                    title={SOUNDS[name].description}
                  >
                    {SOUNDS[name].label}
                  </Button>
                ))}
              </div>
            </Nested>
          </div>
        ))}

        {/*
         * One volume for both, shown only while something would use it.
         * Silence is chosen per kind above, so there is no switch here to
         * contradict them with.
         */}
        {(sounds.reminder !== 'none' || sounds.change !== 'none') && (
          <label className="flex items-center gap-3">
            <span className="text-[12px] font-semibold">Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(sounds.volume * 100)}
              aria-label="Volume"
              disabled={!notifications.enabled}
              onChange={(event) =>
                setSound(
                  { volume: Number(event.target.value) / 100 },
                  sounds.reminder === 'none' ? sounds.change : sounds.reminder,
                )
              }
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-input accent-ring disabled:cursor-not-allowed"
            />
            <span className="w-9 text-right text-[12px] tabular-nums text-muted-foreground">
              {Math.round(sounds.volume * 100)}%
            </span>
          </label>
        )}
      </Nested>
    </Section>
  )
}

/** One setting: what it is, what it does, and the control that does it. */
function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="space-y-0.5">
        <span className="block text-[13px] font-semibold">{title}</span>
        {description && (
          <span className="block text-[12px] leading-relaxed text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {children}
    </label>
  )
}

/**
 * Settings that only mean anything while the one above them is on. The rule is
 * drawn rather than the children hidden: what is on offer is part of what the
 * switch above is offering.
 */
function Nested({
  disabled,
  children,
}: {
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'ml-1 flex flex-col gap-3 border-l-2 border-border pl-4 transition-opacity',
        disabled && 'opacity-50',
      )}
    >
      {children}
    </div>
  )
}

/**
 * Settings for working on the panel rather than with it, kept well away from
 * the feature switches: those are choices about how the panel behaves, and
 * these make it behave wrongly on purpose so that behaviour can be watched.
 */
function DeveloperSection({
  settings,
  onPatch,
}: {
  settings: Settings
  onPatch: (next: Partial<Settings>) => void
}) {
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const { developer } = settings
  const section = useRef<HTMLElement>(null)

  /*
   * The sidebar links straight here, and does it by opening the page at
   * `#developer`. The browser cannot act on that fragment itself: this page is
   * a React tree, so nothing with that id exists when the URL is read.
   */
  useEffect(() => {
    if (window.location.hash !== '#developer') return
    section.current?.scrollIntoView({ block: 'start' })
  }, [])

  const setSeconds = (key: keyof ReminderOverrides, value: number) =>
    onPatch({
      developer: {
        ...developer,
        reminderSeconds: { ...developer.reminderSeconds, [key]: value },
      },
    })

  const sendTest = async () => {
    try {
      await sendMessage({ type: 'test-notification' })
      setTest({ ok: true, message: 'Sent. If nothing appeared, Chrome or the system is holding it back.' })
    } catch (error) {
      setTest({
        ok: false,
        message: error instanceof Error ? error.message : 'That did not work.',
      })
    }
  }

  return (
    <section
      id="developer"
      ref={section}
      className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-5"
    >
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span className="space-y-0.5">
          <span className="block text-[14px] font-bold tracking-tight">Developer mode</span>
          <span className="block text-[12px] leading-relaxed text-muted-foreground">
            Nothing here changes what the panel does for a reader. It makes the parts that
            wait — reminders, chiefly — happen soon enough to watch.
          </span>
        </span>
        <Switch
          label="Developer mode"
          checked={developer.enabled}
          onChange={(enabled) => onPatch({ developer: { ...developer, enabled } })}
        />
      </label>

      {developer.enabled && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="space-y-0.5">
            <h3 className="text-[13px] font-semibold">Reminder times, in seconds</h3>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Each named choice waits this long instead of reading the clock, and says so in
              the menu. The panel marks a reminder due the moment it is; the toolbar count and
              any notification wait for Chrome, which will not wake an extension more often
              than every 30 seconds.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {REMINDER_KEYS.map((key) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-[12px] font-medium">{REMINDER_LABELS[key]}</span>
                <Input
                  type="number"
                  min={1}
                  value={developer.reminderSeconds[key]}
                  onChange={(event) =>
                    setSeconds(key, Math.max(1, Number(event.target.value) || 1))
                  }
                  className="h-7 text-[12px] tabular-nums"
                />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void sendTest()}>
              <BellIcon />
              Send a test notification
            </Button>
            {test && (
              <span
                className={cn(
                  'text-[12px]',
                  test.ok ? 'text-muted-foreground' : 'text-closed',
                )}
              >
                {test.message}
              </span>
            )}
          </div>

          <ApiLog />
        </div>
      )}
    </section>
  )
}

/** Turns a duration into something readable at a glance in a list. */
function duration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function timeOfDay(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const OPERATION_LABELS: Record<ApiLogEntry['operation'], string> = {
  search: 'Search',
  enrich: 'Row detail',
  item: 'Single row',
}

/**
 * Every request the worker has made this session, most recent first.
 *
 * This is the only place the panel can answer "why is that row missing its
 * marks?". The list itself cannot: a row whose checks were never read and a
 * row with nothing to report look exactly alike on screen.
 */
function ApiLog() {
  const [entries, setEntries] = useState<ApiLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      // Read defensively: an older worker, or one that has just been reloaded
      // and does not know this message, answers with nothing at all, and this
      // panel must not take the settings page down with it.
      const answer = await sendMessage({ type: 'api-log' })
      setEntries(Array.isArray(answer) ? answer : [])
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not read the log.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const clear = async () => {
    await sendMessage({ type: 'clear-api-log' })
    await load()
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <h3 className="text-[13px] font-semibold">What the panel has asked GitHub</h3>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Kept for this browser session only. A search lists the rows; a row detail
            request reads the review, checks, merge state and stack for a handful of them
            at a time, and is the one that fails on a query GitHub finds too broad.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <SyncIcon />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => void clear()}>
            <TrashIcon />
            Clear
          </Button>
        </div>
      </div>

      {error && <p className="text-[12px] text-closed">{error}</p>}

      {entries !== null && entries.length === 0 && (
        <p className="text-[12px] text-muted-foreground">
          Nothing yet. Open the sidebar on github.com and the requests will appear here.
        </p>
      )}

      {entries !== null && entries.length > 0 && (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-background">
          {entries.map((entry) => (
            <li
              key={`${entry.at}-${entry.requestId ?? entry.detail}`}
              className="flex flex-col gap-0.5 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-[12px]">
                {entry.ok ? (
                  <CheckCircleFillIcon className="size-3 shrink-0 text-open" />
                ) : (
                  <XCircleFillIcon className="size-3 shrink-0 text-closed" />
                )}
                <span className="font-semibold">{OPERATION_LABELS[entry.operation]}</span>
                <span className="tabular-nums text-muted-foreground">
                  {entry.status ?? 'no response'} · {duration(entry.durationMs)}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {timeOfDay(entry.at)}
                </span>
              </div>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {entry.detail}
              </p>
              {entry.error && (
                <p className="text-[11px] leading-snug text-closed">{entry.error}</p>
              )}
              {entry.requestId && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  {entry.requestId}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
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
