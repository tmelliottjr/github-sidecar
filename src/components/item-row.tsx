import { memo, useCallback, useRef, useState } from 'react'
import {
  AlertIcon,
  BellIcon,
  BellSlashIcon,
  CheckIcon,
  CommentIcon,
  EyeClosedIcon,
  EyeIcon,
  CopyIcon,
  GitBranchIcon,
  LinkIcon,
  MarkdownIcon,
  PinIcon,
  PinSlashIcon,
  StackIcon,
  SyncIcon,
  TypographyIcon,
} from '@primer/octicons-react'

import { ChecksSection } from '@/components/checks-section'
import { StackBadge, StackSection } from '@/components/stack-section'
import {
  ChangeBadge,
  CheckIndicator,
  HiddenMark,
  LabelDots,
  MergeIndicator,
  ReminderMark,
  ReviewIndicator,
  StateIcon,
  StatusPill,
  drawsMergeState,
} from '@/components/status-icons'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ClampedTitle } from '@/components/ui/clamped-title'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Hint } from '@/components/ui/tooltip'
import { copyLink, copyText } from '@/lib/clipboard'
import { itemMarkdown, stackMarkdown, stackUrls } from '@/lib/links'
import {
  describeReminder,
  reminderChoiceLabel,
  REMINDER_LABELS,
  type ChangeKind,
  type ItemMemory,
  type ItemSignature,
  type ReminderChoice,
  type ReminderOverrides,
  type ReminderState,
} from '@/lib/attention'
import type { SearchItem } from '@/lib/github/types'
import { cn, relativeTime } from '@/lib/utils'

/** Row padding (10px) plus the state disc (28px) and the gap after it (10px). */
const MARKS_INDENT = 'pl-12'

/**
 * The colors a row and its chips are drawn on, as variables so the marks
 * inside can match them: label discs ring themselves in the surface, and the
 * gray chips swap to the page color whenever the row itself turns gray.
 */
const SURFACES = cn(
  '[--row-surface:var(--color-background)] [--row-chip:var(--color-muted)]',
  'hover:[--row-surface:var(--color-accent)] hover:[--row-chip:var(--color-background)]',
  'has-[:focus-visible]:[--row-surface:var(--color-accent)] has-[:focus-visible]:[--row-chip:var(--color-background)]',
  'group-data-[state=open]/row:[--row-surface:var(--color-accent)] group-data-[state=open]/row:[--row-chip:var(--color-background)]',
)

interface Props {
  item: SearchItem
  isPinned: boolean
  /** Whether this row is the page the tab is showing. */
  isCurrent: boolean
  isStackOpen: boolean
  /** What has changed since the reader last looked; empty when it is off. */
  changes: readonly ChangeKind[]
  /** The state those changes are measured against. */
  seen: ItemSignature | undefined
  /** Where the reader's reminder for this row stands, if they set one. */
  reminder: ReminderState
  reminderDetail: ItemMemory['reminder']
  /** True while the row is on screen only because hidden rows are showing. */
  isHidden: boolean
  isChecksOpen: boolean
  canRemind: boolean
  /** Set in developer mode, where the named times are seconds instead. */
  reminderOverrides: ReminderOverrides | null
  canHide: boolean
  showFailingChecks: boolean
  showMergeState: boolean
  onOpen: (item: SearchItem, event: React.MouseEvent) => void
  onOpenUrl: (url: string, event: React.MouseEvent) => void
  onRefresh: (item: SearchItem) => Promise<void>
  onTogglePin: (item: SearchItem) => void
  onToggleStack: (item: SearchItem) => void
  onToggleChecks: (item: SearchItem) => void
  onMarkSeen: (item: SearchItem) => void
  onRemind: (item: SearchItem, choice: ReminderChoice) => void
  onClearReminder: (item: SearchItem) => void
  onHide: (item: SearchItem) => void
  onUnhide: (item: SearchItem) => void
}

type RefreshState = { status: 'idle' | 'loading' } | { status: 'error'; message: string }

function ItemRowImpl({
  item,
  isPinned,
  isCurrent,
  isStackOpen,
  changes,
  seen,
  reminder,
  reminderDetail,
  isHidden,
  isChecksOpen,
  canRemind,
  reminderOverrides,
  canHide,
  showFailingChecks,
  showMergeState,
  onOpen,
  onOpenUrl,
  onRefresh,
  onTogglePin,
  onToggleStack,
  onToggleChecks,
  onMarkSeen,
  onRemind,
  onClearReminder,
  onHide,
  onUnhide,
}: Props) {
  const [refresh, setRefresh] = useState<RefreshState>({ status: 'idle' })
  // Quick actions mount on the first hover or focus, so scrolling through
  // hundreds of rows never builds toolbars nobody reaches.
  const [hasQuickActions, setHasQuickActions] = useState(false)
  const showQuickActions = useCallback(() => setHasQuickActions(true), [])
  const stack = item.stack

  const refreshItem = useCallback(() => {
    setRefresh({ status: 'loading' })
    void onRefresh(item)
      .then(() => setRefresh({ status: 'idle' }))
      .catch((error: unknown) =>
        setRefresh({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      )
  }, [item, onRefresh])

  const togglePin = useCallback(() => onTogglePin(item), [item, onTogglePin])
  const toggleStack = useCallback(() => onToggleStack(item), [item, onToggleStack])
  const toggleChecks = useCallback(() => onToggleChecks(item), [item, onToggleChecks])

  // A failed copy is reported where a failed refresh is not: it changes
  // nothing on screen, so the row has nothing to say about it either way.
  const copy = useCallback((write: Promise<void>) => {
    void write.catch((error: unknown) =>
      console.warn('[github-sidecar] could not copy to the clipboard', error),
    )
  }, [])

  const copyItemLink = useCallback(
    () => copy(copyLink(item.url, item.title)),
    [copy, item.title, item.url],
  )
  const copyItemTitle = useCallback(() => copy(copyText(item.title)), [copy, item.title])
  const copyItemMarkdown = useCallback(() => copy(copyText(itemMarkdown(item))), [copy, item])
  const copyStackLinks = useCallback(() => {
    if (stack) copy(copyText(stackUrls(stack)))
  }, [copy, stack])
  const copyStackMarkdown = useCallback(() => {
    if (stack) copy(copyText(stackMarkdown(stack)))
  }, [copy, stack])
  const branch = item.kind === 'pull-request' ? item.headRefName : null
  const copyBranch = useCallback(() => {
    if (branch) copy(copyText(branch))
  }, [branch, copy])

  const markSeen = useCallback(() => onMarkSeen(item), [item, onMarkSeen])
  const clearReminder = useCallback(() => onClearReminder(item), [item, onClearReminder])
  const remindAbout = useCallback(
    (choice: ReminderChoice) => onRemind(item, choice),
    [item, onRemind],
  )
  const hide = useCallback(() => onHide(item), [item, onHide])
  const unhide = useCallback(() => onUnhide(item), [item, onUnhide])

  /*
   * Read defensively: a tab that was open when the extension updated is still
   * holding rows fetched by the build before it, and a row from before a field
   * existed must cost the panel that field rather than the list.
   */
  const failing = showFailingChecks ? (item.failingChecks ?? []) : []
  const mergeState = showMergeState ? (item.mergeState ?? null) : null
  const hasChanges = changes.length > 0 && seen !== undefined

  /**
   * The costly half of a row arrives a moment after the row does, and four of
   * the marks on this line come with it. Keeping the line while they are out
   * means the list is laid out once, when it appears, rather than reflowing
   * under the reader's cursor a second later.
   */
  const awaitingMarks = item.enrichment === 'pending'

  const hasStatus =
    Boolean(item.checkState) || drawsMergeState(mergeState) || Boolean(item.reviewDecision)

  const hasMarks =
    awaitingMarks ||
    Boolean(stack) ||
    hasChanges ||
    reminder !== 'none' ||
    isHidden ||
    item.labels.length > 0 ||
    item.commentCount > 0 ||
    hasStatus

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-pinned={isPinned || undefined}
          data-current={isCurrent || undefined}
          data-row-hidden={isHidden || undefined}
          className="group/row flex flex-col"
        >
          {/*
           * Hover and focus are carried by the row's own wrapper rather than
           * the button, so the marks below the meta line, which sit outside
           * the click target because some of them are controls, still read as
           * part of the same row.
           */}
          <div
            data-item-body=""
            onPointerEnter={hasQuickActions ? undefined : showQuickActions}
            onFocus={hasQuickActions ? undefined : showQuickActions}
            className={cn(
              'group/body relative flex flex-col rounded-xl bg-[color:var(--row-surface)] transition-colors',
              SURFACES,
              isCurrent &&
                '[--row-surface:color-mix(in_oklab,var(--color-ring)_8%,var(--color-background))]',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/70',
            )}
          >
            <button
              type="button"
              onClick={(event) => onOpen(item, event)}
              aria-busy={refresh.status === 'loading'}
              aria-current={isCurrent ? 'page' : undefined}
              className={cn(
                'flex w-full min-w-0 gap-2.5 rounded-xl px-2.5 pt-2 text-left focus-visible:outline-none',
                hasMarks ? 'pb-1.5' : 'pb-2',
              )}
            >
              <span className="relative mt-0.5 shrink-0">
                <StateIcon
                  item={item}
                  variant="disc"
                  // Still here, still put away: the disc loses its fill but keeps its glyph.
                  className={cn(isHidden && 'border border-dashed border-muted-foreground/70 bg-transparent')}
                />
                {hasChanges && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-link ring-2 ring-[color:var(--row-surface)]"
                  />
                )}
              </span>

              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-start gap-2">
                  <ClampedTitle
                    title={item.title}
                    className={cn(
                      'line-clamp-2 flex-1 text-[13px] font-semibold leading-[18px]',
                      isHidden ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  />
                  {/*
                   * A refresh reports itself in the same slot as the timestamp it
                   * is about to change, so the row says what it is doing without
                   * reflowing around a new element.
                   */}
                  <span className="flex shrink-0 items-center gap-1 pt-px text-[11px] tabular-nums text-muted-foreground">
                    {isPinned && <PinIcon className="size-3 shrink-0" aria-label="Pinned" />}
                    {refresh.status === 'loading' ? (
                      <SyncIcon
                        className="size-3 animate-spin-slow"
                        aria-label="Refreshing"
                      />
                    ) : refresh.status === 'error' ? (
                      <Hint label={refresh.message}>
                        <AlertIcon
                          className="size-3 text-attention"
                          aria-label="Refresh failed"
                        />
                      </Hint>
                    ) : (
                      relativeTime(item.updatedAt)
                    )}
                  </span>
                </span>

                <span className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground">
                  <span className="truncate">{item.repository}</span>
                  <span aria-hidden className="tabular-nums">
                    #{item.number}
                  </span>
                  {item.authorLogin && (
                    <Author login={item.authorLogin} avatarUrl={item.authorAvatarUrl} />
                  )}
                </span>
              </span>
            </button>

            {/*
             * After the row's own button, so moving to a row still focuses the
             * row and Tab steps from it into these.
             */}
            {hasQuickActions && (
              <QuickActions
                isPinned={isPinned}
                hasChanges={hasChanges}
                canRemind={canRemind}
                hasReminder={reminder !== 'none'}
                reminderOverrides={reminderOverrides}
                onTogglePin={togglePin}
                onMarkSeen={markSeen}
                onRemind={remindAbout}
                onClearReminder={clearReminder}
                onCopyLink={copyItemLink}
              />
            )}

            {/*
             * Indented past the state disc so the marks line up under the
             * title. `MARKS_INDENT` is that disc plus the row's own padding.
             */}
            {hasMarks && (
              <div
                className={cn(
                  'flex flex-wrap items-center gap-x-2 gap-y-1 pb-2 pr-2.5',
                  MARKS_INDENT,
                  // Holds the line open at the height of the pill it is
                  // waiting for, plus the line's own bottom padding.
                  awaitingMarks && 'min-h-7',
                )}
              >
                {/*
                 * The pill leads, so checks, review, and merge state sit in
                 * the same place on every row and can be read down the list.
                 */}
                {hasStatus && (
                  <StatusPill>
                    <CheckIndicator
                      state={item.checkState}
                      failing={failing}
                      isOpen={isChecksOpen}
                      partial={
                        item.checkCount != null && (item.checksRead ?? 0) < item.checkCount
                      }
                      onToggle={showFailingChecks ? toggleChecks : undefined}
                    />
                    <ReviewIndicator decision={item.reviewDecision} />
                    <MergeIndicator state={mergeState} />
                  </StatusPill>
                )}
                {hasChanges && <ChangeBadge kinds={changes} item={item} seen={seen} />}
                {stack && (
                  <StackBadge
                    stack={stack}
                    isOpen={isStackOpen}
                    onToggle={toggleStack}
                  />
                )}
                {reminder !== 'none' && reminderDetail && (
                  <ReminderMark state={reminder} label={describeReminder(reminderDetail)} />
                )}
                {isHidden && <HiddenMark />}

                {item.commentCount > 0 && (
                  <span className="flex items-center gap-1 text-[12px] tabular-nums text-muted-foreground">
                    <CommentIcon className="size-3.5" />
                    {item.commentCount}
                  </span>
                )}

                {/* Labels are the least of what this line says, so they come last. */}
                <LabelDots labels={item.labels} total={item.labelCount} />
              </div>
            )}
          </div>

          {/*
           * Both drawers stay mounted so they can slide rather than appear. A
           * collapsed grid row measures the section without reserving space
           * for it, which is what lets the height animate at all; `inert`
           * keeps the hidden rows out of the tab order while one is closed.
           */}
          {failing.length > 0 && (
            <div
              data-checks={isChecksOpen ? 'open' : 'closed'}
              inert={!isChecksOpen}
              aria-hidden={!isChecksOpen}
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-300 ease-stack',
                'motion-reduce:transition-none',
                isChecksOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="overflow-hidden">
                <ChecksSection
                  checks={failing}
                  total={item.checkCount ?? null}
                  read={item.checksRead ?? 0}
                  onOpen={onOpenUrl}
                  onCollapse={toggleChecks}
                />
              </div>
            </div>
          )}

          {stack && (
            <div
              data-stack={isStackOpen ? 'open' : 'closed'}
              inert={!isStackOpen}
              aria-hidden={!isStackOpen}
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-300 ease-stack',
                'motion-reduce:transition-none',
                isStackOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="overflow-hidden">
                <StackSection
                  stack={stack}
                  currentId={item.id}
                  onOpen={onOpenUrl}
                  onCollapse={toggleStack}
                />
              </div>
            </div>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onSelect={togglePin}>
          {isPinned ? <PinSlashIcon /> : <PinIcon />}
          {isPinned ? 'Unpin item' : 'Pin item'}
        </ContextMenuItem>
        {stack && (
          <ContextMenuItem onSelect={toggleStack}>
            <StackIcon />
            {isStackOpen ? 'Hide the stack' : 'Show the stack'}
          </ContextMenuItem>
        )}
        {hasChanges && (
          <ContextMenuItem onSelect={markSeen}>
            <CheckIcon />
            Mark as seen
          </ContextMenuItem>
        )}
        {canRemind && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <BellIcon />
              {reminder === 'none' ? 'Remind me…' : 'Remind me instead…'}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {(Object.keys(REMINDER_LABELS) as ReminderChoice[]).map((choice) => (
                <ContextMenuItem key={choice} onSelect={() => onRemind(item, choice)}>
                  {reminderChoiceLabel(choice, reminderOverrides)}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {canRemind && reminder !== 'none' && (
          <ContextMenuItem onSelect={clearReminder}>
            <BellSlashIcon />
            Clear the reminder
          </ContextMenuItem>
        )}
        {canHide && (
          <ContextMenuItem onSelect={isHidden ? unhide : hide}>
            {isHidden ? <EyeIcon /> : <EyeClosedIcon />}
            {isHidden ? 'Show it again' : 'Hide this row'}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={refreshItem} disabled={refresh.status === 'loading'}>
          <SyncIcon />
          Refresh this item
        </ContextMenuItem>

        <ContextMenuSeparator />

        {/*
         * Gathered into a submenu once there were six of them. They are all
         * the same verb on the same row, and a menu that lists every way of
         * copying alongside every way of acting reads as neither.
         */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CopyIcon />
            Copy
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={copyItemLink}>
              <LinkIcon />
              Link
            </ContextMenuItem>
            <ContextMenuItem onSelect={copyItemMarkdown}>
              <MarkdownIcon />
              Link as Markdown
            </ContextMenuItem>
            <ContextMenuItem onSelect={copyItemTitle}>
              <TypographyIcon />
              Title
            </ContextMenuItem>
            {branch && (
              <ContextMenuItem onSelect={copyBranch}>
                <GitBranchIcon />
                Branch
              </ContextMenuItem>
            )}

            {stack && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={copyStackLinks}>
                  <StackIcon />
                  Stack links
                </ContextMenuItem>
                <ContextMenuItem onSelect={copyStackMarkdown}>
                  <MarkdownIcon />
                  Stack links as Markdown
                </ContextMenuItem>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const ItemRow = memo(ItemRowImpl)

/** How long the copy button shows a check after copying. */
const COPIED_FOR_MS = 1500

/**
 * The commonest row actions as a capsule over the row's top-right corner,
 * shown while the row is hovered or holds keyboard focus. Laid over the row
 * rather than in it, so showing it never moves anything. The context menu
 * still lists every action.
 */
function QuickActions({
  isPinned,
  hasChanges,
  canRemind,
  hasReminder,
  reminderOverrides,
  onTogglePin,
  onMarkSeen,
  onRemind,
  onClearReminder,
  onCopyLink,
}: {
  isPinned: boolean
  hasChanges: boolean
  canRemind: boolean
  hasReminder: boolean
  reminderOverrides: ReminderOverrides | null
  onTogglePin: () => void
  onMarkSeen: () => void
  onRemind: (choice: ReminderChoice) => void
  onClearReminder: () => void
  onCopyLink: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef(0)

  const copyAndConfirm = () => {
    onCopyLink()
    setCopied(true)
    window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_FOR_MS)
  }

  return (
    <div
      data-quick-actions=""
      role="group"
      aria-label="Quick actions"
      className={cn(
        'absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-full border border-border bg-background p-0.5 shadow-capsule',
        'pointer-events-none opacity-0 transition-opacity duration-150 ease-stack motion-reduce:transition-none',
        'group-hover/body:pointer-events-auto group-hover/body:opacity-100',
        'group-has-[:focus-visible]/body:pointer-events-auto group-has-[:focus-visible]/body:opacity-100',
        // Stays up while its reminder menu is open, after the pointer has left for the menu.
        'group-has-[[data-state=open]]/body:pointer-events-auto group-has-[[data-state=open]]/body:opacity-100',
      )}
    >
      {hasChanges && (
        <QuickAction label="Mark as seen" onClick={onMarkSeen}>
          <CheckIcon />
        </QuickAction>
      )}

      <QuickAction label={isPinned ? 'Unpin item' : 'Pin item'} onClick={onTogglePin}>
        {isPinned ? <PinSlashIcon /> : <PinIcon />}
      </QuickAction>

      {canRemind && (
        <DropdownMenu>
          <Hint label={hasReminder ? 'Remind me instead' : 'Remind me'} side="top">
            <DropdownMenuTrigger
              aria-label={hasReminder ? 'Remind me instead' : 'Remind me'}
              className={QUICK_ACTION}
            >
              <BellIcon />
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Remind me</DropdownMenuLabel>
            {(Object.keys(REMINDER_LABELS) as ReminderChoice[]).map((choice) => (
              <DropdownMenuItem key={choice} onSelect={() => onRemind(choice)}>
                {reminderChoiceLabel(choice, reminderOverrides)}
              </DropdownMenuItem>
            ))}
            {hasReminder && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onClearReminder}>
                  <BellSlashIcon />
                  Clear the reminder
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <QuickAction label={copied ? 'Copied' : 'Copy link'} onClick={copyAndConfirm}>
        {copied ? <CheckIcon className="text-open" /> : <LinkIcon />}
      </QuickAction>
    </div>
  )
}

const QUICK_ACTION = cn(
  'flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors',
  'hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
  '[&_svg]:size-3.5',
)

function QuickAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Hint label={label} side="top">
      <button type="button" onClick={onClick} aria-label={label} className={QUICK_ACTION}>
        {children}
      </button>
    </Hint>
  )
}

/**
 * The author, as a face and a handle. The avatar stands in for the separator
 * that would otherwise sit before the login, so it reads as one more mark in
 * the meta line rather than an extra element.
 */
function Author({ login, avatarUrl }: { login: string; avatarUrl: string | null }) {
  // A blocked or missing avatar must not leave a torn image in the row, so it
  // falls back to the separator the handle used to carry on its own.
  const [broken, setBroken] = useState(false)
  const showAvatar = Boolean(avatarUrl) && !broken

  return (
    <span className="flex min-w-0 items-center gap-1">
      {showAvatar ? (
        <img
          src={avatarUrl as string}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="size-3.5 shrink-0 rounded-full bg-muted ring-1 ring-border/60"
        />
      ) : (
        <span aria-hidden>·</span>
      )}
      <span className="truncate">{login}</span>
    </span>
  )
}
