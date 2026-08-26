import fs from 'node:fs'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const root = process.cwd()
const assetDir = path.join(root, 'src', 'assets', 'provider-logos')
const previewDir = path.join(assetDir, 'previews')
const manifest = JSON.parse(fs.readFileSync(path.join(assetDir, 'sources.json'), 'utf8'))
const entries = Object.entries(manifest.providers).sort(([left], [right]) => left.localeCompare(right))

const columns = 6
const rows = 8
const perPage = columns * rows
const tileWidth = 180
const tileHeight = 142
const iconSize = 92

fs.rmSync(previewDir, { recursive: true, force: true })
fs.mkdirSync(previewDir, { recursive: true })

async function previewImage(file) {
  const target = path.join(assetDir, file)
  if (!file.endsWith('.svg')) return loadImage(target)
  let svg = fs.readFileSync(target, 'utf8')
  const viewBox = svg.match(/viewBox=["']([^"']+)["']/i)?.[1]?.trim().split(/[\s,]+/).map(Number)
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    svg = svg
      .replace(/\bwidth=["']1em["']/i, `width="${viewBox[2]}"`)
      .replace(/\bheight=["']1em["']/i, `height="${viewBox[3]}"`)
  }
  return loadImage(Buffer.from(svg))
}

for (let page = 0; page < Math.ceil(entries.length / perPage); page += 1) {
  const canvas = createCanvas(columns * tileWidth, rows * tileHeight)
  const context = canvas.getContext('2d')
  context.fillStyle = '#F1F5F9'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = '13px Segoe UI, Arial, sans-serif'

  for (let index = 0; index < perPage; index += 1) {
    const entryIndex = page * perPage + index
    if (entryIndex >= entries.length) break
    const [id, source] = entries[entryIndex]
    const column = index % columns
    const row = Math.floor(index / columns)
    const tileX = column * tileWidth
    const tileY = row * tileHeight
    const iconX = tileX + (tileWidth - iconSize) / 2
    const iconY = tileY + 10

    context.fillStyle = source.presentationColor || '#FFFFFF'
    context.beginPath()
    context.roundRect(iconX, iconY, iconSize, iconSize, 12)
    context.fill()
    context.strokeStyle = '#CBD5E1'
    context.lineWidth = 1
    context.stroke()

    try {
      const image = await previewImage(source.assetFile)
      const inset = source.presentationColor ? 3 : 2
      const available = iconSize - inset * 2
      const scale = Math.min(available / image.width, available / image.height)
      const width = image.width * scale
      const height = image.height * scale
      context.drawImage(
        image,
        iconX + (iconSize - width) / 2,
        iconY + (iconSize - height) / 2,
        width,
        height,
      )
    } catch (error) {
      context.fillStyle = '#DC2626'
      context.fillText('Failed', tileX + tileWidth / 2, tileY + 54)
      console.error(`${id}: ${error instanceof Error ? error.message : error}`)
    }

    context.fillStyle = '#0F172A'
    context.fillText(id.length > 24 ? `${id.slice(0, 22)}...` : id, tileX + tileWidth / 2, tileY + 122)
  }

  const target = path.join(previewDir, `provider-logos-${page + 1}.png`)
  fs.writeFileSync(target, canvas.toBuffer('image/png'))
  console.log(target)
}
