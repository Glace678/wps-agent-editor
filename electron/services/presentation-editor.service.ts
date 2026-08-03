import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  PresentationEditOperation,
  PresentationEditResult,
  PresentationSlideText,
} from '../../src/types/presentation'
import { normalizePath } from './file.service'
import { normalizePresentationMedia } from './presentation-media.service'

const execFileAsync = promisify(execFile)
const EDIT_TIMEOUT_MS = 120_000
const EDIT_OUTPUT_LIMIT = 8 * 1024 * 1024

interface AutomationResult {
  converter: 'powerpoint' | 'wps'
  slideCount: number
  currentSlideIndex: number
  title?: string
  body?: string
  mutated: boolean
}

function buildWindowsPresentationEditScript(): string {
  return `
$ErrorActionPreference = 'Stop'
$sourcePath = $env:WPS_AGENT_PRESENTATION_SOURCE
$targetPath = $env:WPS_AGENT_PRESENTATION_TARGET
$operation = Get-Content -LiteralPath $env:WPS_AGENT_PRESENTATION_OPERATION -Raw -Encoding UTF8 | ConvertFrom-Json
$resultPath = $env:WPS_AGENT_PRESENTATION_RESULT
$lastError = ''

function Get-TitleShape($slide) {
  try { return $slide.Shapes.Title } catch { return $null }
}

function Get-BodyShape($slide) {
  $title = Get-TitleShape $slide
  $titleId = if ($null -ne $title) { [int]$title.Id } else { -1 }
  foreach ($shape in @($slide.Shapes)) {
    try {
      if ([int]$shape.Id -eq $titleId) { continue }
      if ([int]$shape.HasTextFrame -ne 0) { return $shape }
    } catch {}
  }
  return $null
}

function Get-ShapeText($shape) {
  if ($null -eq $shape) { return '' }
  try {
    if ([int]$shape.HasTextFrame -eq 0 -or [int]$shape.TextFrame.HasText -eq 0) { return '' }
    return [string]$shape.TextFrame.TextRange.Text
  } catch { return '' }
}

function Set-SlideText($presentation, $slide, [string]$titleText, [string]$bodyText) {
  $title = Get-TitleShape $slide
  if ($null -eq $title) {
    $title = $slide.Shapes.AddTextbox(1, 36, 24, [double]$presentation.PageSetup.SlideWidth - 72, 54)
  }
  $title.TextFrame.TextRange.Text = $titleText

  $body = Get-BodyShape $slide
  if ($null -eq $body) {
    $body = $slide.Shapes.AddTextbox(1, 54, 96, [double]$presentation.PageSetup.SlideWidth - 108, [double]$presentation.PageSetup.SlideHeight - 132)
  }
  $body.TextFrame.TextRange.Text = $bodyText
}

function Add-TextSlide($presentation, [int]$position, [string]$titleText, [string]$bodyText) {
  $slide = $presentation.Slides.Add($position, 2)
  Set-SlideText $presentation $slide $titleText $bodyText
  return $slide
}

foreach ($entry in @(
  @{ progId = 'PowerPoint.Application'; converter = 'powerpoint' },
  @{ progId = 'KWPP.Application'; converter = 'wps' }
)) {
  $app = $null
  $presentation = $null
  try {
    $type = [Type]::GetTypeFromProgID([string]$entry.progId)
    if ($null -eq $type) { continue }
    $app = [Activator]::CreateInstance($type)
    try { $app.DisplayAlerts = 1 } catch {}
    $presentation = $app.Presentations.Open($sourcePath, $false, $false, $false)
    $slideCount = [int]$presentation.Slides.Count
    $currentIndex = [Math]::Max(0, [Math]::Min([int]$operation.slideIndex, [Math]::Max(0, $slideCount - 1)))
    $title = ''
    $body = ''
    $mutated = $false

    switch ([string]$operation.type) {
      'inspect' {
        $slide = $presentation.Slides.Item($currentIndex + 1)
        $title = Get-ShapeText (Get-TitleShape $slide)
        $body = Get-ShapeText (Get-BodyShape $slide)
      }
      'add' {
        $after = [Math]::Max(-1, [Math]::Min([int]$operation.afterSlideIndex, $slideCount - 1))
        $slide = Add-TextSlide $presentation ($after + 2) '' ''
        $currentIndex = [int]$slide.SlideIndex - 1
        $mutated = $true
      }
      'updateText' {
        $slide = $presentation.Slides.Item($currentIndex + 1)
        Set-SlideText $presentation $slide ([string]$operation.title) ([string]$operation.body)
        $mutated = $true
      }
      'updateNodeText' {
        $slide = $presentation.Slides.Item($currentIndex + 1)
        $targetId = [int]$operation.nodeId
        $found = $false
        foreach ($shape in @($slide.Shapes)) {
          try {
            if ([int]$shape.Id -ne $targetId) { continue }
            if ([int]$shape.HasTextFrame -eq 0) { throw 'PRESENTATION_NODE_NOT_TEXT' }
            $shape.TextFrame.TextRange.Text = ([string]$operation.text).Replace("\`r\`n", "\`r").Replace("\`n", "\`r")
            $found = $true
            break
          } catch {}
        }
        if (-not $found) { throw 'PRESENTATION_NODE_NOT_FOUND' }
        $mutated = $true
      }
      'duplicate' {
        $range = $presentation.Slides.Item($currentIndex + 1).Duplicate()
        $currentIndex = [int]$range.Item(1).SlideIndex - 1
        $mutated = $true
      }
      'delete' {
        if ($slideCount -le 1) { throw 'PRESENTATION_CANNOT_DELETE_ONLY_SLIDE' }
        $presentation.Slides.Item($currentIndex + 1).Delete()
        $currentIndex = [Math]::Min($currentIndex, [int]$presentation.Slides.Count - 1)
        $mutated = $true
      }
      'importOutline' {
        $after = [Math]::Max(-1, [Math]::Min([int]$operation.afterSlideIndex, $slideCount - 1))
        $position = $after + 2
        $firstIndex = -1
        foreach ($outlineSlide in @($operation.slides)) {
          $slide = Add-TextSlide $presentation $position ([string]$outlineSlide.title) ([string]$outlineSlide.body)
          if ($firstIndex -lt 0) { $firstIndex = [int]$slide.SlideIndex - 1 }
          $position++
        }
        if ($firstIndex -ge 0) { $currentIndex = $firstIndex }
        $mutated = $true
      }
      'reuseSlides' {
        $reusePath = [string]$operation.sourcePath
        if (-not (Test-Path -LiteralPath $reusePath -PathType Leaf)) { throw 'PRESENTATION_REUSE_FILE_NOT_FOUND' }
        $after = [Math]::Max(0, [Math]::Min([int]$operation.afterSlideIndex + 1, $slideCount))
        $inserted = [int]$presentation.Slides.InsertFromFile($reusePath, $after)
        if ($inserted -le 0) { throw 'PRESENTATION_REUSE_INSERT_FAILED' }
        $currentIndex = $after
        $mutated = $true
      }
      default { throw "Unsupported presentation edit operation: $($operation.type)" }
    }

    if ($mutated) {
      $presentation.SaveAs($targetPath, 24)
      $slideCount = [int]$presentation.Slides.Count
    }

    $result = [PSCustomObject]@{
      converter = [string]$entry.converter
      slideCount = $slideCount
      currentSlideIndex = $currentIndex
      title = $title
      body = $body
      mutated = $mutated
    }
    [IO.File]::WriteAllText($resultPath, ($result | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
    $presentation.Close()
    $presentation = $null
    $app.Quit()
    $app = $null
    exit 0
  } catch {
    $lastError = $_.Exception.Message
  } finally {
    if ($null -ne $presentation) {
      try { $presentation.Close() } catch {}
      try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation) } catch {}
    }
    if ($null -ne $app) {
      try { $app.Quit() } catch {}
      try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

throw "PRESENTATION_EDITOR_UNAVAILABLE: $lastError"
`
}

function operationForAutomation(operation: PresentationEditOperation): Record<string, unknown> {
  if (operation.type === 'reuseSlides') {
    return { ...operation, sourcePath: normalizePath(operation.sourcePath) }
  }
  return operation
}

function toBuffer(data: Uint8Array | ArrayBuffer): Buffer {
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

export async function editPresentation(
  data: Uint8Array | ArrayBuffer,
  operation: PresentationEditOperation,
): Promise<PresentationEditResult> {
  if (process.platform !== 'win32') throw new Error('PRESENTATION_EDITOR_UNAVAILABLE')
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-agent-presentation-edit-'))
  const sourcePath = path.join(tempDirectory, 'source.pptx')
  const targetPath = path.join(tempDirectory, 'edited.pptx')
  const operationPath = path.join(tempDirectory, 'operation.json')
  const resultPath = path.join(tempDirectory, 'result.json')

  try {
    await Promise.all([
      fs.writeFile(sourcePath, toBuffer(data)),
      fs.writeFile(operationPath, JSON.stringify(operationForAutomation(operation)), 'utf8'),
    ])
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', buildWindowsPresentationEditScript()],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: EDIT_TIMEOUT_MS,
        maxBuffer: EDIT_OUTPUT_LIMIT,
        env: {
          ...process.env,
          WPS_AGENT_PRESENTATION_SOURCE: sourcePath,
          WPS_AGENT_PRESENTATION_TARGET: targetPath,
          WPS_AGENT_PRESENTATION_OPERATION: operationPath,
          WPS_AGENT_PRESENTATION_RESULT: resultPath,
        },
      },
    )

    const automation = JSON.parse(await fs.readFile(resultPath, 'utf8')) as AutomationResult
    let output: Buffer | undefined
    let normalizedWmfCount = 0
    if (automation.mutated) {
      const normalized = await normalizePresentationMedia(await fs.readFile(targetPath))
      output = normalized.data
      normalizedWmfCount = normalized.convertedWmfCount
    }

    const slide: PresentationSlideText | undefined = operation.type === 'inspect'
      ? { title: automation.title ?? '', body: automation.body ?? '' }
      : undefined
    return {
      data: output,
      slideCount: automation.slideCount,
      currentSlideIndex: automation.currentSlideIndex,
      slide,
      converter: automation.converter,
      normalizedWmfCount,
    }
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}
