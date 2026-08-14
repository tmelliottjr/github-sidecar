import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide leading-none',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        open: 'border-open/30 bg-open/10 text-open',
        closed: 'border-closed/30 bg-closed/10 text-closed',
        merged: 'border-merged/30 bg-merged/10 text-merged',
        draft: 'border-draft/30 bg-draft/10 text-draft',
        attention: 'border-attention/30 bg-attention/10 text-attention',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { Badge, badgeVariants }
