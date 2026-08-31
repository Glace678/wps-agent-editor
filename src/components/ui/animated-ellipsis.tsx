import * as React from 'react'
import { cn } from '@/lib/utils'

export function stripEllipsis(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/(?:\s*(?:\.{2,}|…|\u2026))+\s*$/, '')
}

export interface AnimatedEllipsisProps extends React.HTMLAttributes<HTMLSpanElement> {
  className?: string
}

export function AnimatedEllipsis({ className, ...props }: AnimatedEllipsisProps) {
  return (
    <span
      className={cn('inline-flex tracking-tight select-none ml-[1px]', className)}
      aria-hidden="true"
      {...props}
    >
      <span className="animate-ellipsis-dot-1">.</span>
      <span className="animate-ellipsis-dot-2">.</span>
      <span className="animate-ellipsis-dot-3">.</span>
    </span>
  )
}

export interface WaitingTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  text: string
  className?: string
  ellipsisClassName?: string
}

export function WaitingText({ text, className, ellipsisClassName, ...props }: WaitingTextProps) {
  return (
    <span className={cn('inline-flex items-baseline', className)} {...props}>
      <span>{stripEllipsis(text)}</span>
      <AnimatedEllipsis className={ellipsisClassName} />
    </span>
  )
}
