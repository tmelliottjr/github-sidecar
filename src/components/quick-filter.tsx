import { useMemo, useRef } from 'react'
import type { Icon } from '@primer/octicons-react'
import {
  CheckIcon,
  GitPullRequestDraftIcon,
  PeopleIcon,
  PersonIcon,
  XIcon,
} from '@primer/octicons-react'

import { CHECK_META, MERGE_META, REVIEW_META } from '@/components/status-icons'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import type { SearchItem } from '@/lib/github/types'
import {
  FACETS,
  UNASSIGNED,
  UNASSIGNED_LABEL,
  avatarsOf,
  quickFilterOptions,
  toggleQuickFilter,
  type Facet,
  type QuickFilter,
  type QuickFilterOption,
} from '@/lib/list-view'
import { cn } from '@/lib/utils'

type StatusFacet = 'review' | 'checks' | 'merge' | 'state'
type PersonFacet = 'author' | 'assignee'

const TITLES: Record<Facet, string> = {
  review: 'Review',
  checks: 'Checks',
  merge: 'Merge',
  state: 'State',
  author: 'Author',
  assignee: 'Assignee',
}

interface Mark {
  label: string
  Icon: Icon
  className: string
}

const STATUS_FACETS: readonly StatusFacet[] = ['review', 'checks', 'merge', 'state']

/** The same glyph and color each value has on the rows. */
const MARKS: Record<StatusFacet, Record<string, Mark>> = {
  review: {
    REVIEW_REQUIRED: { ...REVIEW_META.REVIEW_REQUIRED, label: 'Needs review' },
    APPROVED: { ...REVIEW_META.APPROVED, label: 'Approved' },
    CHANGES_REQUESTED: { ...REVIEW_META.CHANGES_REQUESTED, label: 'Changes requested' },
  },
  checks: {
    failing: { ...CHECK_META.FAILURE, label: 'Checks failing' },
  },
  merge: {
    conflicting: { ...MERGE_META.conflicting, label: 'Conflicts' },
    behind: { ...MERGE_META.behind, label: 'Behind' },
  },
  state: {
    draft: { label: 'Draft', Icon: GitPullRequestDraftIcon, className: 'text-draft' },
  },
}

const PEOPLE: ReadonlyArray<{ facet: PersonFacet; Icon: Icon }> = [
  { facet: 'author', Icon: PersonIcon },
  { facet: 'assignee', Icon: PeopleIcon },
]

function isStatusFacet(facet: Facet): facet is StatusFacet {
  return (STATUS_FACETS as readonly Facet[]).includes(facet)
}

function valueLabel(facet: Facet, value: string): string {
  if (isStatusFacet(facet)) return MARKS[facet][value]?.label ?? value
  return value === UNASSIGNED ? UNASSIGNED_LABEL : value
}

/** Keeps the menu open, so several values can be chosen in one visit. */
function keepOpen(event: Event) {
  event.preventDefault()
}

function Avatar({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" className={cn('size-4 shrink-0 rounded-full bg-muted', className)} />
  ) : (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground',
        className,
      )}
    >
      <PersonIcon className="size-2.5" />
    </span>
  )
}

interface MenuProps {
  filter: QuickFilter
  /** The facets to offer, in menu order. */
  facets: readonly Facet[]
  /** Every row the list can show before anything narrows it. */
  rows: SearchItem[]
  /** The rows in `rows` that the typed text matches. */
  matching: SearchItem[]
  onChange: (filter: QuickFilter) => void
}

/** The menu that sets the quick filter, opened from a `DropdownMenuTrigger`. */
export function QuickFilterMenuContent(props: MenuProps) {
  return (
    <DropdownMenuContent
      align="end"
      className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-60 overflow-y-auto"
    >
      {/* A child of the content, so the counts are only worked out while the menu is open. */}
      <QuickFilterOptions {...props} />
    </DropdownMenuContent>
  )
}

function QuickFilterOptions({ filter, facets, rows, matching, onChange }: MenuProps) {
  const options = useMemo(
    () => quickFilterOptions(rows, matching, filter),
    [filter, matching, rows],
  )
  const toggle = (facet: Facet, value: string) =>
    onChange(toggleQuickFilter(filter, facet, value))

  const statuses = STATUS_FACETS.filter(
    (facet) => facets.includes(facet) && options[facet].length > 0,
  )
  const people = PEOPLE.filter(
    ({ facet }) => facets.includes(facet) && options[facet].length > 0,
  )

  return (
    <>
      {statuses.map((facet) => (
        <div key={facet} role="group" aria-label={TITLES[facet]}>
          <DropdownMenuLabel>{TITLES[facet]}</DropdownMenuLabel>
          {options[facet].map((option) => {
            const mark = MARKS[facet][option.value]
            return (
              <OptionItem
                key={option.value}
                option={option}
                label={mark?.label ?? option.value}
                onToggle={() => toggle(facet, option.value)}
              >
                {mark && <mark.Icon className={cn('size-3.5 shrink-0', mark.className)} />}
              </OptionItem>
            )
          })}
        </div>
      ))}

      {statuses.length > 0 && people.length > 0 && <DropdownMenuSeparator />}

      {people.map(({ facet, Icon }) => (
        <DropdownMenuSub key={facet}>
          <DropdownMenuSubTrigger className="pl-8">
            <span className="absolute left-2 flex size-3.5 items-center justify-center">
              {(filter[facet]?.length ?? 0) > 0 && (
                <CheckIcon className="size-3.5 text-foreground" aria-label="Chosen" />
              )}
            </span>
            <Icon />
            {TITLES[facet]}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] w-56 overflow-y-auto">
            <DropdownMenuLabel>{TITLES[facet]}</DropdownMenuLabel>
            {options[facet].map((option) => (
              <OptionItem
                key={option.value || UNASSIGNED_LABEL}
                option={option}
                label={valueLabel(facet, option.value)}
                onToggle={() => toggle(facet, option.value)}
              >
                <Avatar url={option.avatarUrl} />
              </OptionItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ))}
    </>
  )
}

function OptionItem({
  option,
  label,
  onToggle,
  children,
}: {
  option: QuickFilterOption
  label: string
  onToggle: () => void
  /** The glyph or avatar before the label. */
  children: React.ReactNode
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={option.selected}
      // A chosen value stays reachable at zero, or it could not be taken back.
      disabled={option.count === 0 && !option.selected}
      onCheckedChange={onToggle}
      onSelect={keepOpen}
      className="gap-2"
    >
      {children}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-[11px] tabular-nums text-muted-foreground">{option.count}</span>
    </DropdownMenuCheckboxItem>
  )
}

/** One removable token per facet with a choice, and a way to clear them all. */
export function QuickFilterTokens({
  filter,
  rows,
  onChange,
  onEmpty,
}: {
  filter: QuickFilter
  /** Where the avatars for chosen people come from. */
  rows: SearchItem[]
  onChange: (filter: QuickFilter) => void
  /** Called before the last token goes, so focus can move somewhere that stays. */
  onEmpty: () => void
}) {
  const avatars = useMemo(() => avatarsOf(rows), [rows])
  const removeButtons = useRef(new Map<Facet, HTMLButtonElement>())
  const chosen = FACETS.filter((facet) => (filter[facet]?.length ?? 0) > 0)

  // Focus moves before the change: the focused button unmounts with its token,
  // which would drop focus onto the github.com page.
  const remove = (facet: Facet) => {
    const index = chosen.indexOf(facet)
    const rest = chosen.filter((other) => other !== facet)
    const next = rest[index] ?? rest[index - 1]
    if (next) removeButtons.current.get(next)?.focus()
    else onEmpty()
    onChange({ ...filter, [facet]: [] })
  }

  return (
    <div role="group" aria-label="Quick filters" className="flex flex-wrap items-center gap-1">
      {chosen.map((facet) => {
        const values = filter[facet] ?? []
        const first = values[0]
        const showsAvatar = !isStatusFacet(facet) && first !== UNASSIGNED
        return (
          <span
            key={facet}
            data-quick-filter={facet}
            className="flex h-6 min-w-0 max-w-full items-center gap-1 rounded-full bg-muted pl-2 pr-0.5 text-[11px] font-medium"
          >
            <span className="shrink-0 text-muted-foreground">{TITLES[facet]}</span>
            {showsAvatar && <Avatar url={avatars.get(first) ?? null} className="size-3.5" />}
            <span className="truncate">
              {values.map((value) => valueLabel(facet, value)).join(', ')}
            </span>
            <button
              ref={(node) => {
                if (node) removeButtons.current.set(facet, node)
                else removeButtons.current.delete(facet)
              }}
              type="button"
              onClick={() => remove(facet)}
              aria-label={`Remove the ${TITLES[facet].toLowerCase()} filter`}
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors',
                'hover:bg-background hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              )}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        )
      })}
      <button
        type="button"
        onClick={() => {
          onEmpty()
          onChange({})
        }}
        className={cn(
          'rounded-full px-1.5 text-[11px] font-semibold leading-5 text-link hover:underline',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        Clear
      </button>
    </div>
  )
}
