import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import JSZip from 'jszip'

const execFileAsync = promisify(execFile)
const WMF_CONVERSION_TIMEOUT_MS = 120_000
const WMF_CONVERSION_OUTPUT_LIMIT = 8 * 1024 * 1024

export interface NormalizedPresentationMedia {
  data: Buffer
  convertedWmfCount: number
}

function buildWmfConversionScript(): string {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$manifest = Get-Content -LiteralPath $env:WPS_AGENT_WMF_MANIFEST -Raw -Encoding UTF8 | ConvertFrom-Json

foreach ($item in @($manifest)) {
  $image = $null
  $bitmap = $null
  $graphics = $null
  try {
    $image = [System.Drawing.Image]::FromFile([string]$item.source)
    $width = [Math]::Max(1, [Math]::Min(8192, [int]$image.Width))
    $height = [Math]::Max(1, [Math]::Min(8192, [int]$image.Height))
    $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    if ($image.HorizontalResolution -gt 0 -and $image.VerticalResolution -gt 0) {
      $bitmap.SetResolution($image.HorizontalResolution, $image.VerticalResolution)
    }
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.DrawImage($image, 0, 0, $width, $height)
    $bitmap.Save([string]$item.target, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    if ($null -ne $graphics) { $graphics.Dispose() }
    if ($null -ne $bitmap) { $bitmap.Dispose() }
    if ($null -ne $image) { $image.Dispose() }
  }
}
`
}

async function convertWmfFiles(
  items: Array<{ mediaPath: string; data: Uint8Array }>,
): Promise<Map<string, Buffer>> {
  if (process.platform !== 'win32' || items.length === 0) return new Map()

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-agent-wmf-'))
  try {
    const manifest: Array<{ source: string; target: string; mediaPath: string }> = []
    for (const [index, item] of items.entries()) {
      const source = path.join(tempDirectory, `source-${index}.wmf`)
      const target = path.join(tempDirectory, `target-${index}.png`)
      await fs.writeFile(source, item.data)
      manifest.push({ source, target, mediaPath: item.mediaPath })
    }

    const manifestPath = path.join(tempDirectory, 'manifest.json')
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8')
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', buildWmfConversionScript()],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: WMF_CONVERSION_TIMEOUT_MS,
        maxBuffer: WMF_CONVERSION_OUTPUT_LIMIT,
        env: { ...process.env, WPS_AGENT_WMF_MANIFEST: manifestPath },
      },
    )

    const converted = new Map<string, Buffer>()
    for (const item of manifest) {
      try {
        converted.set(item.mediaPath, await fs.readFile(item.target))
      } catch {
        // Keep the original WMF when GDI+ cannot decode this particular file.
      }
    }
    return converted
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

function replaceWmfRelationshipTargets(
  xml: string,
  convertedNames: ReadonlyMap<string, string>,
): string {
  return xml.replace(/Target=(['"])([^'"]+\.wmf)\1/gi, (match, quote: string, target: string) => {
    const fileName = path.posix.basename(target).toLowerCase()
    const replacement = convertedNames.get(fileName)
    if (!replacement) return match
    return `Target=${quote}${target.slice(0, -path.posix.basename(target).length)}${replacement}${quote}`
  })
}

export async function normalizePresentationMedia(data: Buffer): Promise<NormalizedPresentationMedia> {
  const zip = await JSZip.loadAsync(data)
  const wmfEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && /^ppt\/media\/[^/]+\.wmf$/i.test(entry.name),
  )
  if (wmfEntries.length === 0) return { data, convertedWmfCount: 0 }

  const sources = await Promise.all(wmfEntries.map(async (entry) => ({
    mediaPath: entry.name,
    data: await entry.async('uint8array'),
  })))
  const converted = await convertWmfFiles(sources)
  if (converted.size === 0) return { data, convertedWmfCount: 0 }

  const convertedNames = new Map<string, string>()
  for (const [mediaPath, png] of converted) {
    const pngPath = mediaPath.replace(/\.wmf$/i, '.png')
    zip.file(pngPath, png)
    zip.remove(mediaPath)
    convertedNames.set(path.posix.basename(mediaPath).toLowerCase(), path.posix.basename(pngPath))
  }

  const relationshipFiles = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.endsWith('.rels'),
  )
  await Promise.all(relationshipFiles.map(async (entry) => {
    const xml = await entry.async('string')
    const next = replaceWmfRelationshipTargets(xml, convertedNames)
    if (next !== xml) zip.file(entry.name, next)
  }))

  const contentTypesEntry = zip.file('[Content_Types].xml')
  if (contentTypesEntry) {
    const xml = await contentTypesEntry.async('string')
    if (!/<Default\b[^>]*\bExtension=(['"])png\1/i.test(xml)) {
      zip.file(
        '[Content_Types].xml',
        xml.replace(
          /<\/Types>\s*$/i,
          '<Default Extension="png" ContentType="image/png"/></Types>',
        ),
      )
    }
  }

  return {
    data: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    convertedWmfCount: converted.size,
  }
}
