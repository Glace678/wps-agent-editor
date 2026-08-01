import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { clipboard, ipcMain, nativeImage } from 'electron'
import iconv from 'iconv-lite'
import { getFonts } from 'font-list'
import type { BrowserWindow } from 'electron'
import { IPC } from '../ipc/channels'
import { normalizePath } from '../services/file.service'
import { writeFileWithSnapshot } from '../services/file-history.service'
import { setCurrentFileForAgent } from '../ipc/agent.handlers'
import { handleAgentResult } from './agent-bridge.service'
import { getLanguage, type LanguageCode } from '../i18n/types'
import { runCodeFile } from '../services/code-runner.service'
import { preparePresentation } from '../services/presentation-converter.service'

interface SystemFontFace {
  familyName: string
  displayName: string
  faceName: string
  weight: number
  style: 'normal' | 'italic' | 'oblique'
  stretch: number
}

const execFileAsync = promisify(execFile)
const MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH = 64 * 1024 * 1024

const FONT_LOCALE_BY_LANGUAGE: Record<LanguageCode, string> = {
  'zh-CN': 'zh-cn',
  en: 'en-us',
  ja: 'ja-jp',
  es: 'es-es',
  pt: 'pt-br',
  de: 'de-de',
  fr: 'fr-fr',
  ru: 'ru-ru',
  ar: 'ar-sa',
}

function buildWindowsFontScript(locale: string): string {
  return `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName PresentationCore
$items = foreach ($family in [Windows.Media.Fonts]::SystemFontFamilies) {
  $displayName = ''
  if (!$family.FamilyNames.TryGetValue([Windows.Markup.XmlLanguage]::GetLanguage('${locale}'), [ref]$displayName)) {
    if (!$family.FamilyNames.TryGetValue([Windows.Markup.XmlLanguage]::GetLanguage('en-us'), [ref]$displayName)) {
      $displayName = $family.Source
    }
  }
  foreach ($typeface in $family.GetTypefaces()) {
    $style = $typeface.Style.ToString().ToLowerInvariant()
    if ($style -notin @('normal', 'italic', 'oblique')) { $style = 'normal' }
    $faceName = ''
    if (!$typeface.FaceNames.TryGetValue([Windows.Markup.XmlLanguage]::GetLanguage('${locale}'), [ref]$faceName)) {
      if (!$typeface.FaceNames.TryGetValue([Windows.Markup.XmlLanguage]::GetLanguage('en-us'), [ref]$faceName)) {
        $faceName = $typeface.FaceNames.Values | Select-Object -First 1
      }
    }
    [PSCustomObject]@{
      familyName = $family.Source
      displayName = $displayName
      faceName = $faceName
      weight = $typeface.Weight.ToOpenTypeWeight()
      style = $style
      stretch = $typeface.Stretch.ToOpenTypeStretch()
    }
  }
}
@($items) | ConvertTo-Json -Compress
`
}

async function listSystemFontFaces(language: LanguageCode = getLanguage()): Promise<SystemFontFace[]> {
  if (process.platform === 'win32') {
    try {
      const locale = FONT_LOCALE_BY_LANGUAGE[language] ?? 'en-us'
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', buildWindowsFontScript(locale)],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      )
      const parsed = JSON.parse(String(stdout).replace(/^\uFEFF/, '')) as SystemFontFace | SystemFontFace[]
      const faces = (Array.isArray(parsed) ? parsed : [parsed]).filter(
        (face) => face.familyName && Number.isFinite(face.weight),
      )
      if (faces.length > 0) return faces
    } catch (error) {
      console.warn('Detailed Windows font enumeration failed:', error)
    }
  }

  const families = await getFonts({ disableQuoting: true })
  return families.flatMap((familyName) => [
    { familyName, displayName: familyName, faceName: 'Regular', weight: 400, style: 'normal' as const, stretch: 5 },
    { familyName, displayName: familyName, faceName: 'Italic', weight: 400, style: 'italic' as const, stretch: 5 },
    { familyName, displayName: familyName, faceName: 'Bold', weight: 700, style: 'normal' as const, stretch: 5 },
    { familyName, displayName: familyName, faceName: 'Bold Italic', weight: 700, style: 'italic' as const, stretch: 5 },
  ])
}

export function registerLightweightOfficeHandlers(
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(IPC.LW_READ_FILE, async (_e, filePath: string) => {
    try {
      const normalized = normalizePath(filePath)
      const buffer = await fs.readFile(normalized)
      // 直接传二进制，避免 base64 编解码（大 PDF 可快数倍）
      // Electron IPC 会把 Buffer 结构化克隆为 Uint8Array
      return { data: buffer, encoding: 'binary' as const }
    } catch (error) {
      console.error('LW_READ_FILE error:', error)
      throw error
    }
  })

  ipcMain.handle(IPC.LW_READ_PRESENTATION, async (_e, filePath: string) => {
    try {
      const prepared = await preparePresentation(filePath)
      return {
        data: prepared.data,
        encoding: 'binary' as const,
        convertedFromLegacy: prepared.convertedFromLegacy,
        converter: prepared.converter,
      }
    } catch (error) {
      console.error('LW_READ_PRESENTATION error:', error)
      throw error
    }
  })

  ipcMain.handle(IPC.LW_SAVE_FILE, async (_e, filePath: string, base64: string) => {
    try {
      const normalized = normalizePath(filePath)
      const buffer = Buffer.from(base64, 'base64')
      // 覆盖前为旧内容留版本快照；快照+写盘在同一串行链内，防止并发快照读到半成品
      await writeFileWithSnapshot(normalized, buffer)
      return { success: true }
    } catch (error) {
      console.error('LW_SAVE_FILE error:', error)
      throw error
    }
  })

  ipcMain.handle(IPC.LW_SAVE_TEXT, async (_e, filePath: string, text: string, encoding: string) => {
    const normalized = normalizePath(filePath)
    let buffer: Buffer
    if (encoding === 'utf-8-bom') {
      buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
    } else if (encoding === 'utf-16le') {
      buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(text, 'utf16-le')])
    } else if (encoding === 'utf-16be') {
      buffer = Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(text, 'utf16-be')])
    } else if (encoding === 'gbk') {
      buffer = iconv.encode(text, 'gbk')
    } else {
      buffer = Buffer.from(text, 'utf8')
    }
    await writeFileWithSnapshot(normalized, buffer)
    return { success: true }
  })

  ipcMain.handle(IPC.LW_LIST_FONTS, async (_event, language?: LanguageCode) => {
    const faces = await listSystemFontFaces(language)
    const unique = new Map<string, SystemFontFace>()
    for (const face of faces) {
      const key = `${face.familyName}\u0000${face.faceName}\u0000${face.weight}\u0000${face.style}\u0000${face.stretch}`
      unique.set(key, face)
    }
    return [...unique.values()].sort((left, right) =>
      left.familyName.localeCompare(right.familyName)
      || left.weight - right.weight
      || left.style.localeCompare(right.style),
    )
  })

  ipcMain.handle(IPC.LW_COPY_IMAGE_TO_CLIPBOARD, async (_e, dataUrl: string) => {
    if (
      typeof dataUrl !== 'string'
      || !dataUrl.startsWith('data:image/png;base64,')
      || dataUrl.length > MAX_CLIPBOARD_IMAGE_DATA_URL_LENGTH
    ) {
      throw new TypeError('Invalid screenshot image data')
    }

    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) throw new Error('Unable to decode screenshot image')

    clipboard.writeImage(image, 'clipboard')
    const copiedImage = clipboard.readImage('clipboard')
    if (copiedImage.isEmpty()) throw new Error('System clipboard did not retain the screenshot image')

    const { width, height } = copiedImage.getSize()
    return { success: true as const, width, height }
  })

  ipcMain.handle(IPC.LW_SET_CURRENT_FILE, async (_e, filePath: string | null) => {
    setCurrentFileForAgent(filePath)
    return { success: true }
  })

  ipcMain.handle(
    IPC.LW_AGENT_RESULT,
    async (_e, payload: { requestId: string; result: unknown }) => {
      handleAgentResult(payload.requestId, payload.result)
      return { success: true }
    },
  )

  ipcMain.handle(IPC.LW_RUN_CODE, async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new TypeError('Invalid code file path')
    }
    return runCodeFile(filePath)
  })

  void getMainWindow
}
