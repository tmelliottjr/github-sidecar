import { useState, type ReactNode } from 'react'

import {
  resolvePosition,
  useWindowGeometry,
  type ResizeDirection,
} from '@/hooks/use-window-geometry'
import type { WindowState } from '@/lib/storage'
import { cn } from '@/lib/utils'

interface Props {
  state: WindowState
  onStateChange: (patch: Partial<WindowState>) => void
  header: (dragHandleProps: {
    onPointerDown: (event: React.PointerEvent) => void
  }) => ReactNode
  children: ReactNode
}

const HANDLES: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: 'n', className: 'left-3 right-3 top-0 h-1.5 cursor-ns-resize' },
  { direction: 's', className: 'bottom-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { direction: 'w', className: 'bottom-3 left-0 top-3 w-1.5 cursor-ew-resize' },
  { direction: 'e', className: 'bottom-3 right-0 top-3 w-1.5 cursor-ew-resize' },
  { direction: 'nw', className: 'left-0 top-0 size-3 cursor-nwse-resize' },
  { direction: 'ne', className: 'right-0 top-0 size-3 cursor-nesw-resize' },
  { direction: 'sw', className: 'bottom-0 left-0 size-3 cursor-nesw-resize' },
  { direction: 'se', className: 'bottom-0 right-0 size-3 cursor-nwse-resize' },
]

export function FloatingWindow({ state, onStateChange, header, children }: Props) {
  const { nodeRef, startDrag, startResize } = useWindowGeometry({
    state,
    onCommit: onStateChange,
  })

  // Frozen at mount: geometry is written imperatively from here on. Recomputing
  // this on every render would let an unrelated re-render (a poll tick, say)
  // overwrite the DOM mid-drag and snap the window back.
  const [initial] = useState(() => resolvePosition(state))

  return (
    <div
      ref={nodeRef}
      role="complementary"
      aria-label="GitHub Sidebar"
      className={cn(
        'fixed left-0 top-0 z-[2147483646] flex flex-col overflow-hidden',
        'rounded-window border border-border bg-background text-foreground shadow-window',
        'transition-[height] duration-200 ease-out data-[gesture=active]:transition-none',
        'data-[gesture=active]:select-none',
      )}
      style={{
        transform: `translate3d(${initial.x}px, ${initial.y}px, 0)`,
        width: initial.width,
        height: initial.height,
      }}
    >
      {header({ onPointerDown: startDrag })}

      {!state.collapsed && <div className="min-h-0 flex-1">{children}</div>}

      {!state.locked &&
        !state.collapsed &&
        HANDLES.map(({ direction, className }) => (
          <div
            key={direction}
            onPointerDown={(event) => startResize(event, direction)}
            className={cn('absolute z-10 touch-none', className)}
            aria-hidden
          />
        ))}
    </div>
  )
}
