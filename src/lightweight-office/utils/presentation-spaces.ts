const RENDERER_PRESERVED_SPACE_PAIR = /  /g
const LEADING_CJK_SPACE = /^ +(?=[㐀-鿿豈-﫿])/
const PRESENTATION_SPACE_SEQUENCE = / {2,}|^ (?=[㐀-鿿豈-﫿])/g

export function normalizeRenderedPresentationSpaces(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Array<{ node: Text; normalizedText: string }> = []
  let node = walker.nextNode()

  while (node) {
    const textNode = node as Text
    const normalizedText = textNode.data.replace(RENDERER_PRESERVED_SPACE_PAIR, '  ')
    if (normalizedText !== textNode.data || LEADING_CJK_SPACE.test(normalizedText)) {
      textNodes.push({ node: textNode, normalizedText })
    }
    node = walker.nextNode()
  }

  for (const { node: textNode, normalizedText } of textNodes) {
    const fragment = document.createDocumentFragment()
    let cursor = 0

    for (const match of normalizedText.matchAll(PRESENTATION_SPACE_SEQUENCE)) {
      const index = match.index ?? 0
      if (index > cursor) fragment.append(normalizedText.slice(cursor, index))
      const spaces = document.createElement('span')
      spaces.className = 'presentation-preserved-spaces'
      spaces.textContent = ' '.repeat(match[0].length)
      fragment.append(spaces)
      cursor = index + match[0].length
    }

    if (cursor < normalizedText.length) fragment.append(normalizedText.slice(cursor))
    textNode.replaceWith(fragment)
  }

  // Some producers write a paragraph's indentation as a run containing only a
  // single space, split from the CJK text. A lone space run collapses to zero
  // width under white-space: normal (the renderer preserves runs of two or
  // more spaces), so wrap space-only runs at the start of a paragraph line
  // just like the other preserved space above.
  const leadingSpaceOnlyNode = /^ +$/
  const spaceWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const leadingSpaceNodes: Text[] = []
  let spaceNode = spaceWalker.nextNode()
  while (spaceNode) {
    const spaceTextNode = spaceNode as Text
    const parent = spaceTextNode.parentElement
    if (
      leadingSpaceOnlyNode.test(spaceTextNode.data)
      && parent
      && !parent.classList.contains('presentation-preserved-spaces')
      && parent.childNodes.length === 1
      && parent.parentElement
      && parent.parentElement.firstElementChild === parent
    ) {
      leadingSpaceNodes.push(spaceTextNode)
    }
    spaceNode = spaceWalker.nextNode()
  }
  for (const spaceTextNode of leadingSpaceNodes) {
    const spaces = document.createElement('span')
    spaces.className = 'presentation-preserved-spaces'
    spaces.textContent = spaceTextNode.data
    spaceTextNode.replaceWith(spaces)
  }
}
