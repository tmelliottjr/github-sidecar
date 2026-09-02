import { memo, useCallback, useState } from 'react'
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

/** Row padding (12px) plus the state icon (16px) and the gap after it (10px). */
const MARKS_INDENT = 'pl-[38px]'

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

  const hasMarks =
    awaitingMarks ||
    Boolean(stack) ||
    hasChanges ||
    reminder !== 'none' ||
    isHidden ||
    item.labels.length > 0 ||
    item.commentCount > 0 ||
    Boolean(item.checkState) ||
    Boolean(mergeState) ||
    Boolean(item.reviewDecision)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-pinned={isPinned || undefined}
          data-current={isCurrent || undefined}
          data-row-hidden={isHidden || undefined}
          className={cn(
            'group flex flex-col',
            isPinned && 'bg-accent/40',
            // A row only on screen because the reader asked to see what they
            // had hidden is drawn as what it is: still here, still put away.
            isHidden && 'opacity-55',
            // Layered over a pin rather than instead of it: a row can be both,
            // and the tint is faint enough to read as a wash either way.
            isCurrent && 'bg-ring/8',
          )}
        >
          {/*
           * Hover and focus are carried by the row's own wrapper rather than
           * the button, so the marks below the meta line — which sit outside
           * the click target now that one of them is a control — still read as
           * part of the same row.
           */}
          <div
            data-item-body=""
            className={cn(
              'flex flex-col transition-colors',
              'hover:bg-accent has-[:focus-visible]:bg-accent',
              'group-data-[state=open]:bg-accent',
            )}
          >
            <button
              type="button"
              onClick={(event) => onOpen(item, event)}
              aria-busy={refresh.status === 'loading'}
              aria-current={isCurrent ? 'page' : undefined}
              className={cn(
                'flex w-full min-w-0 gap-2.5 px-3 pt-2.5 text-left focus-visible:outline-none',
                hasMarks ? 'pb-1' : 'pb-2.5',
              )}
            >
              <StateIcon item={item} />

              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-start gap-2">
                  <ClampedTitle
                    title={item.title}
                    className="line-clamp-2 flex-1 text-[13px] font-semibold leading-snug text-foreground"
                  />
                  {/*
                   * A refresh reports itself in the same slot as the timestamp it
                   * is about to change, so the row says what it is doing without
                   * reflowing around a new element.
                   */}
                  <span className="flex shrink-0 items-center pt-px text-[11px] tabular-nums text-muted-foreground">
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

                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {isPinned && (
                    <PinIcon
                      className="size-3 shrink-0 text-accent-foreground"
                      aria-label="Pinned"
                    />
                  )}
                  <span className="truncate font-medium">{item.repository}</span>
                  <span aria-hidden>#{item.number}</span>
                  {item.authorLogin && (
                    <Author login={item.authorLogin} avatarUrl={item.authorAvatarUrl} />
                  )}
                </span>
              </span>
            </button>

            {/*
             * Indented past the state icon so the marks line up under the
             * title. `MARKS_INDENT` is that icon plus the row's own padding.
             */}
            {hasMarks && (
              <div
                className={cn(
                  'flex flex-wrap items-center gap-1.5 pb-2.5 pr-3',
                  MARKS_INDENT,
                  // Holds the line open at the height of the marks it is
                  // waiting for, which are all drawn at 14px.
                  awaitingMarks && 'min-h-[14px]',
                )}
              >
                {/*
                 * What changed leads the line: it is the only mark here that
                 * is about the reader rather than about the item.
                 */}
                {hasChanges && <ChangeBadge kinds={changes} item={item} seen={seen} />}
                {reminder !== 'none' && reminderDetail && (
                  <ReminderMark state={reminder} label={describeReminder(reminderDetail)} />
                )}
                {isHidden && <HiddenMark />}
                {stack && (
                  <StackBadge
                    stack={stack}
                    isOpen={isStackOpen}
                    onToggle={toggleStack}
                  />
                )}
                <CheckIndicator
                  state={item.checkState}
                  failing={failing}
                  isOpen={isChecksOpen}
                  partial={
                    item.checkCount != null && (item.checksRead ?? 0) < item.checkCount
                  }
                  onToggle={showFailingChecks ? toggleChecks : undefined}
                />
                <MergeIndicator state={mergeState} />
                <ReviewIndicator decision={item.reviewDecision} />

                {item.commentCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                    <CommentIcon className="size-3" />
                    {item.commentCount}
                  </span>
                )}

                {/*
                 * Labels are the least of what this line says, so they are put
                 * where the eye lands last rather than in the run of marks.
                 */}
                <span className="ml-auto flex items-center pl-1.5">
                  <LabelDots labels={item.labels} total={item.labelCount} />
                </span>
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
