import type { PptxViewer } from '@aiden0z/pptx-renderer'
import JSZip from 'jszip'
import { normalizePath } from '@/lib/path'

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

const MAX_PPTX_INPUT_BYTES = 100 * 1024 * 1024
const MAX_PPTX_ENTRIES = 10000
const MAX_PPTX_SLIDES = 1000
const MAX_SLIDE_XML_BYTES = 5 * 1024 * 1024
const ZIP_EXTRACT_CONCURRENCY = 6

function normalizeZipPath(baseDirectory: string, target: string): string {
  let cleanTarget = normalizePath(target)
  // A relationship Target starting with '/' is an absolute package reference and
  // must resolve from the package root, not relative to baseDirectory (otherwise
  // a '/ppt/...' target becomes 'ppt/ppt/...' and the slide XML is silently lost).
  if (cleanTarget.startsWith('/')) {
    cleanTarget = cleanTarget.slice(1)
    baseDirectory = ''
  }
  const segments = `${baseDirectory}/${cleanTarget}`.split('/')
  const normalized: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') normalized.pop()
    else normalized.push(segment)
  }
  return normalized.join('/')
}

/** Run `fn` over items with bounded concurrency to avoid exploding memory/CPU. */
async function boundedMap<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        results[index] = await fn(items[index] as T, index)
      }
    },
  )
  await Promise.all(workers)
  return results
}

export async function extractPresentationSlideXml(
  input: ArrayBuffer,
  slideIndexes?: readonly number[],
): Promise<string[]> {
  // Fail closed on obviously oversized input to avoid zip-bomb / memory blowups.
  if (input.byteLength > MAX_PPTX_INPUT_BYTES) return []
  const zip = await JSZip.loadAsync(input)
  if (Object.keys(zip.files).length > MAX_PPTX_ENTRIES) return []
  const presentationEntry = zip.file('ppt/presentation.xml')
  const relationshipsEntry = zip.file('ppt/_rels/presentation.xml.rels')
  if (!presentationEntry || !relationshipsEntry || typeof DOMParser === 'undefined') return []

  const [presentationXml, relationshipsXml] = await Promise.all([
    presentationEntry.async('string'),
    relationshipsEntry.async('string'),
  ])
  const parser = new DOMParser()
  const presentationDocument = parser.parseFromString(presentationXml, 'application/xml')
  const relationshipsDocument = parser.parseFromString(relationshipsXml, 'application/xml')
  if (presentationDocument.querySelector('parsererror') || relationshipsDocument.querySelector('parsererror')) {
    return []
  }

  const relationshipTargets = new Map<string, string>()
  for (const relationship of allElements(relationshipsDocument).filter(
    (element) => element.localName === 'Relationship',
  )) {
    const id = relationship.getAttribute('Id')
    const target = relationship.getAttribute('Target')
    if (id && target) relationshipTargets.set(id, target)
  }

  const orderedPaths = allElements(presentationDocument)
    .filter((element) => element.localName === 'sldId')
    .map((element) => element.getAttribute('r:id') || element.getAttribute('id'))
    .map((relationshipId) => relationshipId ? relationshipTargets.get(relationshipId) : undefined)
    .filter((target): target is string => Boolean(target))
    .map((target) => normalizeZipPath('ppt', target))

  const paths = orderedPaths.length > 0
    ? orderedPaths
    : Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((left, right) => {
        const leftNumber = Number(left.match(/slide(\d+)\.xml$/i)?.[1] ?? 0)
        const rightNumber = Number(right.match(/slide(\d+)\.xml$/i)?.[1] ?? 0)
        return leftNumber - rightNumber
      })
  const requested = slideIndexes ? new Set(slideIndexes) : null
  const limitedPaths = paths.slice(0, MAX_PPTX_SLIDES)
  return boundedMap(limitedPaths, ZIP_EXTRACT_CONCURRENCY, async (slidePath, index) => {
    if (requested && !requested.has(index)) return ''
    const entry = zip.file(slidePath)
    if (!entry) return ''
    const text = await entry.async('string')
    // Per-slide decompressed size cap.
    return text.length > MAX_SLIDE_XML_BYTES ? '' : text
  })
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

  // F13: this renderer version exposes no node-id -> element map, so the
  // old "last N children" guess mislabeled every element if the renderer
  // inserted extra decorations or skipped an unrenderable node. Leading
  // children may be the renderer's known background decorations (gradient
  // SVG, picture div); strip those, then require the remaining elements to
  // line up 1:1 with the slide nodes. Any other mismatch skips annotation,
  // so animations can never attach to wrong elements.
  const isBackgroundDecoration = (element: Element): boolean =>
    element.hasAttribute('data-pptx-background-gradient')
    || element.hasAttribute('data-pptx-background-image')
  let firstNodeChild = 0
  while (firstNodeChild < children.length && isBackgroundDecoration(children[firstNodeChild])) {
    firstNodeChild += 1
  }
  const nodeElements = children.slice(firstNodeChild)
  if (nodeElements.length !== nodes.length) return

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
  sourceXml?: string,
): PresentationAnimationRuntime {
  if (slideElement) annotateSlideNodes(viewer, slideIndex, slideElement)
  clearAnimationClasses(slideElement)
  const motion = parsePresentationSlideMotion(
    sourceXml ?? viewer.presentationData?.slides[slideIndex]?.sourceXml,
  )

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
  sourceXml?: string,
): PresentationTransition {
  return parsePresentationSlideMotion(
    sourceXml ?? viewer.presentationData?.slides[slideIndex]?.sourceXml,
  ).transition
}
