import { useMemo } from 'react'
import {
  BellIcon,
  BellSlashIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  EyeIcon,
  LinkExternalIcon,
  PinIcon,
  PinSlashIcon,
} from '@primer/octicons-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Hint } from '@/components/ui/tooltip'
import { useItemLookup } from '@/hooks/use-item-lookup'
import { useStorageValue } from '@/hooks/use-storage-value'
import {
  describeReminder,
  reminderChoiceLabel,
  REMINDER_LABELS,
  type ItemMemory,
  type ReminderChoice,
  type ReminderOverrides,
} from '@/lib/attention'
import type { SearchItem } from '@/lib/github/types'
import {
  hiddenEntries,
  movePin,
  removePin,
  removeReminder,
  reminderEntries,
  rescheduleReminder,
  unhideItem,
} from '@/lib/manage'
import { cn, relativeTime } from '@/lib/utils'

const REMINDER_CHOICES = Object.keys(REMINDER_LABELS) as ReminderChoice[]

/**
 * One place to look over everything the reader has put aside — the rows they
 * hid, the reminders they set, the rows they pinned — and take any of it back.
 * Each of these is kept as a bare node id, apart from the row it stands for, so
 * the panel resolves the rows it still can from the shared cache and lists the
 * rest by what it knows: an id it can still act on.
 */
export function ManagementPanel({
  reminderOverrides,
  SectionComponent,
}: {
  reminderOverrides: ReminderOverrides | null
  SectionComponent: SectionRenderer
}) {
  const [memory, setMemory] = useStorageValue('itemMemory')
  const [pinnedIds, setPinnedIds] = useStorageValue('pinnedIds')

  const hidden = useMemo(() => hiddenEntries(memory ?? {}), [memory])
  const reminders = useMemo(() => reminderEntries(memory ?? {}), [memory])
  const pins = useMemo(() => pinnedIds ?? [], [pinnedIds])

  const ids = useMemo(
    () => [...hidden.map((entry) => entry.id), ...reminders.map((entry) => entry.id), ...pins],
    [hidden, pins, reminders],
  )
  const items = useItemLookup(ids)

  const patchMemory = (
    change: (current: Record<string, ItemMemory>) => Record<string, ItemMemory>,
  ) => setMemory((current) => change(current ?? {}))

  const Section = SectionComponent

  return (
    <>
      <Section
        title="Hidden rows"
        description="Rows you have taken out of the list. They stay counted and come back the moment you say so."
      >
        {hidden.length === 0 ? (
          <Empty>No rows are hidden.</Empty>
        ) : (
          <List>
            {hidden.map((entry) => (
              <Row key={entry.id} item={items[entry.id]} id={entry.id}>
                <Meta>
                  <ClockIcon className="size-3" />
                  hidden {relativeTime(new Date(entry.hiddenAt).toISOString())}
                </Meta>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    patchMemory((current) => unhideItem(current, entry.id, items[entry.id]))
                  }
                >
                  <EyeIcon />
                  Show
                </Button>
              </Row>
            ))}
          </List>
        )}
      </Section>

      <Section
        title="Reminders"
        description="Rows you asked to hear about again — on the clock, or when they next change. Move a reminder to a different time, or drop it."
      >
        {reminders.length === 0 ? (
          <Empty>No reminders are set.</Empty>
        ) : (
          <List>
            {reminders.map((entry) => (
              <Row key={entry.id} item={items[entry.id]} id={entry.id}>
                <Meta>
                  <BellIcon className="size-3" />
                  {describeReminder(entry.reminder)}
                </Meta>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <ClockIcon />
                      Change
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Remind me…</DropdownMenuLabel>
                    {REMINDER_CHOICES.map((choice) => (
                      <DropdownMenuItem
                        key={choice}
                        onSelect={() =>
                          patchMemory((current) =>
                            rescheduleReminder(current, entry.id, choice, {
                              overrides: reminderOverrides,
                            }),
                          )
                        }
                      >
                        {reminderChoiceLabel(choice, reminderOverrides)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => patchMemory((current) => removeReminder(current, entry.id))}
                >
                  <BellSlashIcon />
                  Remove
                </Button>
              </Row>
            ))}
          </List>
        )}
      </Section>

      <Section
        title="Pinned rows"
        description="Rows lifted to the top of the list, in the order they are drawn. Reorder them, or lift a pin off."
      >
        {pins.length === 0 ? (
          <Empty>No rows are pinned.</Empty>
        ) : (
          <List>
            {pins.map((id, index) => (
              <Row key={id} item={items[id]} id={id}>
                <Meta>
                  <PinIcon className="size-3" />
                  {index + 1} of {pins.length}
                </Meta>
                <div className="flex items-center">
                  <Hint label="Move up">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => setPinnedIds((current) => movePin(current ?? [], id, -1))}
                    >
                      <ChevronUpIcon />
                    </Button>
                  </Hint>
                  <Hint label="Move down">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move down"
                      disabled={index === pins.length - 1}
                      onClick={() => setPinnedIds((current) => movePin(current ?? [], id, 1))}
                    >
                      <ChevronDownIcon />
                    </Button>
                  </Hint>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setPinnedIds((current) => removePin(current ?? [], id))}
                >
                  <PinSlashIcon />
                  Unpin
                </Button>
              </Row>
            ))}
          </List>
        )}
      </Section>
    </>
  )
}

/** The card-and-heading wrapper the options page draws each section in. */
export type SectionRenderer = (props: {
  title: string
  description?: string
  children: React.ReactNode
}) => React.ReactNode

function List({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col divide-y divide-border">{children}</div>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>
}

/**
 * A single managed row: what it is, and the controls that act on it. When the
 * cache no longer holds the row it is named by its id instead, and stays fully
 * actionable — every control here works on the id alone.
 */
function Row({
  item,
  id,
  children,
}: {
  item: SearchItem | undefined
  id: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        {item ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="group inline-flex max-w-full items-center gap-1.5"
          >
            <span className="truncate text-[13px] font-semibold text-foreground group-hover:underline">
              {item.title}
            </span>
            <LinkExternalIcon className="size-3 shrink-0 text-muted-foreground" />
          </a>
        ) : (
          <span className="text-[13px] font-semibold text-muted-foreground">
            Row no longer cached
          </span>
        )}
        <p className="truncate text-[12px] text-muted-foreground">
          {item ? (
            <>
              {item.repository} <span aria-hidden>#{item.number}</span>
            </>
          ) : (
            <span className="font-mono text-[11px]" title={id}>
              {id}
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** The one-line note beside a managed row saying where it stands. */
function Meta({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'hidden items-center gap-1 text-[12px] tabular-nums text-muted-foreground sm:flex',
        className,
      )}
    >
      {children}
    </span>
  )
}
