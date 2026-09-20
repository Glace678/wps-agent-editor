import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'node_modules', 'superdoc', 'dist')

function read(relativePath) {
  return readFileSync(path.join(distDir, relativePath), 'utf8')
}

for (const file of ['chunks/src-CcBJnYZd.es.js', 'chunks/src-VzGe-_l_.cjs']) {
  const source = read(file)
  assert.match(source, /const layoutWidth = props\.imageElement\.offsetWidth \|\| rect\.width;/)
  assert.match(source, /visualScaleX = rect\.width \/ layoutWidth \|\| 1;/)
  assert.match(source, /event\.clientX - dragState\.value\.initialX\) \/ dragState\.value\.visualScaleX/)
  assert.match(source, /const diagonalSquared = initialWidth \* initialWidth \+ initialHeight \* initialHeight;/)
  assert.match(source, /emit\("resize-start", \{[\s\S]{0,160}initialWidth: layoutWidth,[\s\S]{0,80}initialHeight: layoutHeight/)
  assert.match(source, /let liveImagePreview = null;/)
  assert.match(source, /element\.style\.width = `\$\{width\}px`;/)
  assert.match(source, /applyLiveImagePreview\(newWidth, newHeight\);/)
  assert.match(source, /event instanceof MouseEvent\) updateResizeFromPointer\(event\);/)
  assert.match(source, /endLiveImagePreview\(!committed\);/)
  assert.match(source, /return true;[\s\S]{0,220}catch \(error\)/)
  assert.match(source, /constrainedWidth \* dragState\.value\.visualScaleX/)
  assert.doesNotMatch(source, /const scale = Math\.max\(scaleX, scaleY\);/)
}

const minified = read('superdoc.min.js')
assert.match(minified, /visualScaleX:H,visualScaleY:W/)
assert.match(minified, /constrainedWidth\*c\.value\.visualScaleX/)
assert.match(minified, /1\+\(E\*C\+L\*k\)\/\(E\*E\+L\*L\)/)
assert.match(minified, /_applyImageResizePreview\(M,O\)/)
assert.match(minified, /_endImageResizePreview\(!O\)/)
assert.match(minified, /x instanceof MouseEvent&&_updateImageResize\(x\)/)

function resizeFromCorner({
  width,
  height,
  zoom,
  handle,
  pointerDeltaX,
  pointerDeltaY,
}) {
  let deltaX = pointerDeltaX / zoom
  let deltaY = pointerDeltaY / zoom

  if (handle === 'nw') {
    deltaX = -deltaX
    deltaY = -deltaY
  } else if (handle === 'ne') {
    deltaY = -deltaY
  } else if (handle === 'sw') {
    deltaX = -deltaX
  }

  const diagonalSquared = width * width + height * height
  const scale = 1 + (width * deltaX + height * deltaY) / diagonalSquared
  return { width: width * scale, height: height * scale }
}

const base = { width: 400, height: 200 }

function createLivePreview(element) {
  const original = { width: element.style.width, height: element.style.height }
  return {
    apply(width, height) {
      element.style.width = `${width}px`
      element.style.height = `${height}px`
    },
    end(restore) {
      if (!restore) return
      element.style.width = original.width
      element.style.height = original.height
    },
  }
}

const previewElement = { style: { width: '400px', height: '200px' } }
const committedPreview = createLivePreview(previewElement)
committedPreview.apply(480, 240)
assert.deepEqual(previewElement.style, { width: '480px', height: '240px' })
committedPreview.end(false)
assert.deepEqual(previewElement.style, { width: '480px', height: '240px' })

previewElement.style = { width: '400px', height: '200px' }
const cancelledPreview = createLivePreview(previewElement)
cancelledPreview.apply(320, 160)
cancelledPreview.end(true)
assert.deepEqual(previewElement.style, { width: '400px', height: '200px' })

for (const zoom of [0.5, 1, 2]) {
  const expanded = resizeFromCorner({
    ...base,
    zoom,
    handle: 'se',
    pointerDeltaX: 80 * zoom,
    pointerDeltaY: 40 * zoom,
  })
  assert.equal(expanded.width, 480)
  assert.equal(expanded.height, 240)

  const horizontallyShrunk = resizeFromCorner({
    ...base,
    zoom,
    handle: 'se',
    pointerDeltaX: -100 * zoom,
    pointerDeltaY: 0,
  })
  assert.ok(horizontallyShrunk.width < base.width)
  assert.equal(horizontallyShrunk.width / horizontallyShrunk.height, 2)
}

const equivalentOutwardDrags = {
  nw: [-80, -40],
  ne: [80, -40],
  sw: [-80, 40],
  se: [80, 40],
}

for (const [handle, [pointerDeltaX, pointerDeltaY]] of Object.entries(equivalentOutwardDrags)) {
  const resized = resizeFromCorner({
    ...base,
    zoom: 1,
    handle,
    pointerDeltaX,
    pointerDeltaY,
  })
  assert.equal(resized.width, 480)
  assert.equal(resized.height, 240)
}

const equivalentInwardDrags = {
  nw: [80, 40],
  ne: [-80, 40],
  sw: [80, -40],
  se: [-80, -40],
}

for (const [handle, [pointerDeltaX, pointerDeltaY]] of Object.entries(equivalentInwardDrags)) {
  const resized = resizeFromCorner({
    ...base,
    zoom: 1,
    handle,
    pointerDeltaX,
    pointerDeltaY,
  })
  assert.equal(resized.width, 320)
  assert.equal(resized.height, 160)
}

console.log('SuperDoc image-resize regression checks passed')
