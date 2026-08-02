import type { PptxViewer } from '@aiden0z/pptx-renderer'

export type PresentationAnimationKind = 'entrance' | 'emphasis' | 'exit'
export type PresentationTransitionKind = 'fade' | 'push' | 'wipe' | 'split' | 'cover' | 'uncover'

interface PresentationAnimationAction {
  nodeId: string
  kind: PresentationAnimationKind
}

export interface PresentationAnimationStep {
  actions: PresentationAnimationAction[]
}

export interface PresentationTransition {
  kind: PresentationTransitionKind
  durationMs: number
}

export interface PresentationSlideMotion {
  steps: PresentationAnimationStep[]
  transition: PresentationTransition
}

export interface PresentationAnimationRuntime {
  slideIndex: number
  steps: PresentationAnimationStep[]
  nextStep: number
  slideElement: HTMLElement | null
}

const ANIMATION_CLASSES = [
  'presentation-animation-target--pending',
  'presentation-animation-target--entrance',
  'presentation-animation-target--emphasis',
  'presentation-animation-target--exit',
]

function allElements(documentNode: Document): Element[] {
  return Array.from(documentNode.getElementsByTagName('*'))
}

function descendantsByLocalName(element: Element, localName: string): Element[] {
  return Array.from(element.getElementsByTagName('*')).filter(
    (candidate) => candidate.localName === localName,
  )
}

function parseAnimationKind(value: string | null): PresentationAnimationKind | null {
  if (value === 'entr') return 'entrance'
  if (value === 'emph') return 'emphasis'
  if (value === 'exit') return 'exit'
  return null
}

function parseTransition(elements: Element[]): PresentationTransition {
  const transition = elements.find((element) => element.localName === 'transition')
  const speed = transition?.getAttribute('spd')
  const durationMs = speed === 'slow' ? 520 : speed === 'fast' ? 220 : 340
  const childName = transition
    ? Array.from(transition.children).find((element) => element.localName !== 'sndAc')?.localName
    : undefined
  const kind: PresentationTransitionKind = childName === 'push'
    ? 'push'
    : childName === 'wipe'
      ? 'wipe'
      : childName === 'split'
        ? 'split'
        : childName === 'cover'
          ? 'cover'
          : childName === 'uncover'
            ? 'uncover'
            : 'fade'
  return { kind, durationMs }
}

export function parsePresentationSlideMotion(sourceXml?: string): PresentationSlideMotion {
  if (!sourceXml || typeof DOMParser === 'undefined') {
    return { steps: [], transition: { kind: 'fade', durationMs: 340 } }
  }

  const documentNode = new DOMParser().parseFromString(sourceXml, 'application/xml')
  if (documentNode.querySelector('parsererror')) {
    return { steps: [], transition: { kind: 'fade', durationMs: 340 } }
  }

  const elements = allElements(documentNode)
  const steps: PresentationAnimationStep[] = []
  let currentStep: PresentationAnimationStep | null = null
  const seen = new Set<string>()

  for (const timeNode of elements.filter((element) => element.localName === 'cTn')) {
    const kind = parseAnimationKind(timeNode.getAttribute('presetClass'))
    if (!kind) continue
    const targets = descendantsByLocalName(timeNode, 'spTgt')
      .map((target) => target.getAttribute('spid')?.trim() ?? '')
      .filter(Boolean)
    if (targets.length === 0) continue

    const nodeType = timeNode.getAttribute('nodeType')
    if (!currentStep || nodeType === 'clickEffect') {
      currentStep = { actions: [] }
      steps.push(currentStep)
    }
    for (const nodeId of targets) {
      const key = `${steps.length - 1}:${nodeId}:${kind}`
      if (seen.has(key)) continue
      seen.add(key)
      currentStep.actions.push({ nodeId, kind })
    }
  }

  return {
    steps: steps.filter((step) => step.actions.length > 0),
    transition: parseTransition(elements),
  }
}

function clearAnimationClasses(slideElement: HTMLElement | null): void {
  if (!slideElement) return
  const targets = slideElement.querySelectorAll<HTMLElement>('[data-presentation-node-id]')
  for (const target of targets) target.classList.remove(...ANIMATION_CLASSES)
}

function annotateSlideNodes(viewer: PptxViewer, slideIndex: number, slideElement: HTMLElement): void {
  const nodes = viewer.presentationData?.slides[slideIndex]?.nodes ?? []
  if (nodes.length === 0) return
  const children = Array.from(slideElement.children)
  const nodeElements = children.slice(Math.max(0, children.length - nodes.length))
  nodes.forEach((node, index) => {
    const element = nodeElements[index]
    if (element instanceof HTMLElement) element.dataset.presentationNodeId = String(node.id)
  })
}

export function preparePresentationAnimations(
  viewer: PptxViewer,
  slideIndex: number,
  slideElement: HTMLElement | null,
  active: boolean,
): PresentationAnimationRuntime {
  if (slideElement) annotateSlideNodes(viewer, slideIndex, slideElement)
  clearAnimationClasses(slideElement)
  const sourceXml = viewer.presentationData?.slides[slideIndex]?.sourceXml
  const motion = parsePresentationSlideMotion(sourceXml)

  if (active && slideElement) {
    const entranceIds = new Set(
      motion.steps.flatMap((step) => step.actions)
        .filter((action) => action.kind === 'entrance')
        .map((action) => action.nodeId),
    )
    for (const nodeId of entranceIds) {
      slideElement
        .querySelector<HTMLElement>(`[data-presentation-node-id="${CSS.escape(nodeId)}"]`)
        ?.classList.add('presentation-animation-target--pending')
    }
  }

  return { slideIndex, steps: motion.steps, nextStep: 0, slideElement }
}

export function runNextPresentationAnimation(runtime: PresentationAnimationRuntime): boolean {
  const step = runtime.steps[runtime.nextStep]
  if (!step || !runtime.slideElement) return false
  runtime.nextStep += 1

  for (const action of step.actions) {
    const target = runtime.slideElement.querySelector<HTMLElement>(
      `[data-presentation-node-id="${CSS.escape(action.nodeId)}"]`,
    )
    if (!target) continue
    target.classList.remove(...ANIMATION_CLASSES)
    void target.offsetWidth
    target.classList.add(`presentation-animation-target--${action.kind}`)
  }
  return true
}

export function clearPresentationAnimations(runtime: PresentationAnimationRuntime | null): void {
  clearAnimationClasses(runtime?.slideElement ?? null)
}

export function getPresentationTransition(
  viewer: PptxViewer,
  slideIndex: number,
): PresentationTransition {
  return parsePresentationSlideMotion(
    viewer.presentationData?.slides[slideIndex]?.sourceXml,
  ).transition
}
