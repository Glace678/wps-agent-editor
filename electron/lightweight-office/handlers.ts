import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { clipboard, nativeImage } from 'electron'
import iconv from 'iconv-lite'
import { getFonts } from 'font-list'
import type { BrowserWindow } from 'electron'
import { IPC } from '../ipc/channels'
import { handleTrustedIpc } from '../ipc/trusted-ipc'
import { normalizePath } from '../services/file.service'
import { writeFileWithSnapshot } from '../services/file-history.service'
import { setCurrentFileForAgent } from '../ipc/agent.handlers'
import { handleAgentResult } from './agent-bridge.service'
import { getLanguage, type LanguageCode } from '../i18n/types'
import { runCodeFile } from '../services/code-runner.service'
import {
  evaluateDebugExpression,
  sendDebugCommand,
  setDebugEventSink,
  startDebugSession,
  stopDebugSession,
} from '../services/code-debugger.service'
import {
  setTerminalEventSink,
  terminalExec,
  terminalKill,
} from '../services/terminal.service'
import { preparePresentation } from '../services/presentation-converter.service'
import { prepareWord } from '../services/word-converter.service'
import { editPresentation } from '../services/presentation-editor.service'
import type { PresentationEditRequest } from '../../src/types/presentation'

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
  handleTrustedIpc(IPC.LW_READ_FILE, async (_e, filePath: string) => {
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

  handleTrustedIpc(IPC.LW_READ_WORD, async (_e, filePath: string) => {
    try {
      const prepared = await prepareWord(normalizePath(filePath))
      return {
        data: prepared.data,
        encoding: 'binary' as const,
        convertedFromLegacy: prepared.convertedFromLegacy,
        converter: prepared.converter,
        nativeConversionFailed: prepared.nativeConversionFailed,
        normalizedLegacyImageCount: prepared.normalizedLegacyImageCount,
      }
    } catch (error) {
      console.error('LW_READ_WORD error:', error)
      throw error
    }
  })

  handleTrustedIpc(IPC.LW_READ_PRESENTATION, async (_e, filePath: string) => {
    try {
      const prepared = await preparePresentation(filePath)
      return {
        data: prepared.data,
        encoding: 'binary' as const,
        convertedFromLegacy: prepared.convertedFromLegacy,
        converter: prepared.converter,
        normalizedWmfCount: prepared.normalizedWmfCount,
      }
    } catch (error) {
      console.error('LW_READ_PRESENTATION error:', error)
      throw error
    }
  })

  handleTrustedIpc(IPC.LW_EDIT_PRESENTATION, async (_e, request: PresentationEditRequest) => {
    try {
      if (!request || !request.data || !request.operation) {
        throw new TypeError('Invalid presentation edit request')
      }
      return await editPresentation(request.data, request.operation)
    } catch (error) {
      console.error('LW_EDIT_PRESENTATION error:', error)
      throw error
    }
  })

  handleTrustedIpc(IPC.LW_SAVE_FILE, async (_e, filePath: string, base64: string) => {
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

  handleTrustedIpc(IPC.LW_SAVE_TEXT, async (_e, filePath: string, text: string, encoding: string) => {
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

  handleTrustedIpc(IPC.LW_LIST_FONTS, async (_event, language?: LanguageCode) => {
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

  handleTrustedIpc(IPC.LW_COPY_IMAGE_TO_CLIPBOARD, async (_e, dataUrl: string) => {
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

  handleTrustedIpc(IPC.LW_SET_CURRENT_FILE, async (_e, filePath: string | null) => {
    setCurrentFileForAgent(filePath)
    return { success: true }
  })

  handleTrustedIpc(
    IPC.LW_AGENT_RESULT,
    async (_e, payload: { requestId: string; result: unknown }) => {
      handleAgentResult(payload.requestId, payload.result)
      return { success: true }
    },
  )

  handleTrustedIpc(IPC.LW_AGENT_EVENT, async (_e, event: Record<string, unknown>) => {
    const runId = typeof event?.runId === 'string' ? event.runId : ''
    const sourceType = typeof event?.type === 'string' ? event.type : ''
    if (!runId || !sourceType) return { success: false }
    const typeMap: Record<string, string> = {
      'operation-prepared': 'document-operation-prepared',
      'cursor-moved': 'document-cursor-moved',
      'selection-changed': 'document-selection-changed',
      'operation-applied': 'document-operation-applied',
      'operation-rejected': 'document-operation-rejected',
      'operation-undone': 'document-operation-undone',
      'revision-changed': 'document-revision-changed',
      'plan-prepared': 'document-plan-prepared',
      'playback-started': 'word-playback-started',
      'playback-progress': 'word-playback-progress',
      'playback-paused': 'word-playback-paused',
      'playback-resumed': 'word-playback-resumed',
      'playback-interrupted': 'word-playback-interrupted',
      'playback-completed': 'word-playback-completed',
      'user-activity': 'user-document-activity',
      'approval-required': 'approval-required',
      'approval-resolved': 'approval-resolved',
      conflict: 'conflict',
      'run-cancelled': 'run-cancelled',
    }
    const type = typeMap[sourceType]
    if (!type) return { success: false }
    const globalEvent = { ...event }
    if (sourceType === 'cursor-moved' || sourceType.startsWith('playback-')) {
      delete globalEvent.position
      delete globalEvent.range
    }
    getMainWindow()?.webContents.send(IPC.AGENT_EVENT, {
      ...globalEvent,
      type,
      timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
    })
    return { success: true }
  })

  handleTrustedIpc(IPC.LW_RUN_CODE, async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new TypeError('Invalid code file path')
    }
    return runCodeFile(filePath)
  })

  setDebugEventSink((event) => {
    getMainWindow()?.webContents.send(IPC.LW_DEBUG_EVENT, event)
  })
  setTerminalEventSink((event) => {
    getMainWindow()?.webContents.send(IPC.LW_TERMINAL_EVENT, event)
  })

  handleTrustedIpc(IPC.LW_DEBUG_START, async (_e, filePath: string, breakpoints: unknown[]) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new TypeError('Invalid code file path')
    }
    const normalizedBreakpoints = (Array.isArray(breakpoints) ? breakpoints : []).filter(
      (item): item is { file: string; line: number } =>
        Boolean(item) && typeof item === 'object'
        && typeof (item as { file?: unknown }).file === 'string'
        && typeof (item as { line?: unknown }).line === 'number',
    )
    return startDebugSession(filePath, normalizedBreakpoints)
  })

  handleTrustedIpc(IPC.LW_DEBUG_STOP, () => {
    stopDebugSession()
    return { success: true }
  })

  handleTrustedIpc(IPC.LW_DEBUG_COMMAND, (_e, command: string) => {
    if (
      command === 'continue' || command === 'step-over'
      || command === 'step-into' || command === 'step-out'
    ) {
      sendDebugCommand(command)
    }
    return { success: true }
  })

  handleTrustedIpc(IPC.LW_DEBUG_EVALUATE, (_e, expression: string, id: string) => {
    if (typeof expression === 'string' && typeof id === 'string') {
      evaluateDebugExpression(expression, id)
    }
    return { success: true }
  })

  handleTrustedIpc(IPC.LW_TERMINAL_EXEC, (_e, input: string) => terminalExec(input))
  handleTrustedIpc(IPC.LW_TERMINAL_KILL, () => {
    terminalKill()
    return { success: true }
  })

  void getMainWindow
}
