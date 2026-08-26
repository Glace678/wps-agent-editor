import { MousePointer2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { WordEditVisualKind } from '@/types/document'

export interface WordAgentOverlayVisual {
  planId?: string
  stepId?: string
  agentName: string
  agentColor: string
  phase: 'locate' | 'before' | 'commit' | 'after' | 'clear'
  visual: WordEditVisualKind
  pointer: { left: number; top: number }
  target: { left: number; top: number; width: number; height: number }
  action?: string
  beforeText?: string
  afterText?: string
  fineGrained: boolean
}

interface WordAgentOverlayProps {
  visual: WordAgentOverlayVisual | null
}

export function WordAgentOverlay({ visual }: WordAgentOverlayProps) {
  if (!visual) return null
  const pointerStyle = {
    '--agent-pointer-x': `${visual.pointer.left}px`,
    '--agent-pointer-y': `${visual.pointer.top}px`,
    '--word-agent-color': visual.agentColor,
  } as CSSProperties
  const targetStyle = {
    left: visual.target.left,
    top: visual.target.top,
    width: visual.target.width,
    height: visual.target.height,
  }

  return (
    <div
      className="word-agent-overlay"
      data-phase={visual.phase}
      data-visual={visual.visual}
      data-plan-id={visual.planId}
      data-step-id={visual.stepId}
      aria-hidden="true"
    >
      {visual.phase !== 'locate' && visual.phase !== 'clear' && (
        <div
          className="word-agent-change-target"
          style={targetStyle}
          data-fine-grained={visual.fineGrained ? 'true' : 'false'}
        >
          <span className="word-agent-change-sweep" />
          {visual.phase === 'before' && visual.beforeText && (
            <span className="word-agent-delete-trace">{visual.beforeText}</span>
          )}
          {visual.phase === 'after' && visual.afterText && (
            <span className="word-agent-insert-trace">{visual.afterText}</span>
          )}
          {visual.action && <span className="word-agent-property-trace">{visual.action}</span>}
        </div>
      )}
      <div
        className="word-agent-virtual-cursor"
        style={pointerStyle}
        data-testid="agent-live-word-cursor"
      >
        <MousePointer2 aria-hidden="true" />
        <span>{visual.agentName}</span>
      </div>
    </div>
  )
}
