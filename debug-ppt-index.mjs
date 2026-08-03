import { buildTextIndex } from '@aiden0z/pptx-renderer'
import pptxgen from 'pptxgenjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wps-ppt-debug-'))
const pptxPath = path.join(fixtureDir, 'editable.pptx')
const pptx = new pptxgen()
pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 })
pptx.layout = 'WIDE'
const slide = pptx.addSlide()
slide.addText('Editable Title', { x: 0.5, y: 0.4, w: 12, h: 1.2, fontSize: 44, bold: true, fontFace: 'Arial' })
slide.addText('Editable Body Line', { x: 0.5, y: 2.2, w: 8, h: 1.0, fontSize: 28, fontFace: 'Arial' })
slide.addText('Secondary Text', { x: 0.5, y: 3.8, w: 6, h: 0.8, fontSize: 20, fontFace: 'Arial' })
await pptx.writeFile({ fileName: pptxPath })

const { PptxViewer } = await import('@aiden0z/pptx-renderer')
const buffer = fs.readFileSync(pptxPath)
const host = { appendChild: () => {}, clientWidth: 800, clientHeight: 450 }
const viewer = new PptxViewer(host, { fitMode: 'contain', zoomPercent: 100, lazyMedia: true, lazySlides: true })
await viewer.open(buffer.buffer, { renderMode: 'slide' })
const data = viewer.presentationData
console.log('slide size:', data.width, 'x', data.height)
const index = buildTextIndex(data, { includeShapes: true, includeTables: false, includeGroups: false })
for (const entry of index) {
  console.log(JSON.stringify({
    slideIndex: entry.slideIndex,
    nodeId: entry.nodeId,
    kind: entry.textKind,
    nodeType: entry.nodeType,
    text: entry.text.replace(/\n/g, '\\n'),
    bounds: entry.bounds,
  }))
}
viewer.destroy()
fs.rmSync(fixtureDir, { recursive: true, force: true })
