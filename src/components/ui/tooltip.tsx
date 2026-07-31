import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger
const TooltipPortal = TooltipPrimitive.Portal

/**
 * 通过 Portal 挂到 body，避免被 ScrollArea / overflow-hidden 裁切导致
 * 「只剩上半或下半边框」的渲染问题。
 */
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, collisionPadding = 8, ...props }, ref) => (
  <TooltipPortal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        // 实心背景 + 完整 1px 白边，避免半透明/裁切造成边框断裂
        'z-[9999] max-w-xs break-words rounded-md border border-white',
        'bg-card px-3 py-2 text-xs leading-relaxed text-card-foreground shadow-lg',
        'outline-none',
        // 不用 scale 动画，Electron 下偶发只绘半边框
        'animate-in fade-in-0 duration-100',
        className,
      )}
      {...props}
    />
  </TooltipPortal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipPortal }
