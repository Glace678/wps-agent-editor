import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const CONVERSION_TIMEOUT_MS = 120_000
const CONVERSION_OUTPUT_LIMIT = 8 * 1024 * 1024

export type PresentationConverter = 'libreoffice' | 'powerpoint' | 'wps'

export interface PreparedPresentation {
  data: Buffer
  convertedFromLegacy: boolean
  converter: PresentationConverter | null
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function findOnPath(command: string): Promise<string | null> {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const { stdout } = await execFileAsync(locator, [command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    })
    const candidate = String(stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    return candidate || null
  } catch {
    return null
  }
}

async function findLibreOfficeExecutable(): Promise<string | null> {
  const candidates = process.platform === 'win32'
    ? [
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'LibreOffice', 'program', 'soffice.com'),
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'LibreOffice', 'program', 'soffice.exe'),
        process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'LibreOffice', 'program', 'soffice.com'),
        process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'LibreOffice', 'program', 'soffice.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
      : ['/usr/bin/libreoffice', '/usr/bin/soffice', '/snap/bin/libreoffice']

  for (const candidate of candidates) {
    if (candidate && await pathExists(candidate)) return candidate
  }

  return await findOnPath('libreoffice')
    || await findOnPath(process.platform === 'win32' ? 'soffice.com' : 'soffice')
}

async function findConvertedFile(outputDirectory: string): Promise<string | null> {
  const entries = await fs.readdir(outputDirectory, { withFileTypes: true })
  const converted = entries.find(
    (entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.pptx',
  )
  return converted ? path.join(outputDirectory, converted.name) : null
}

async function convertWithLibreOffice(
  executable: string,
  sourcePath: string,
  outputDirectory: string,
): Promise<string> {
  const profileDirectory = path.join(outputDirectory, 'libreoffice-profile')
  await fs.mkdir(profileDirectory, { recursive: true })
  await execFileAsync(
    executable,
    [
      `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
      '--headless',
      '--convert-to',
      'pptx',
      '--outdir',
      outputDirectory,
      sourcePath,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: CONVERSION_TIMEOUT_MS,
      maxBuffer: CONVERSION_OUTPUT_LIMIT,
    },
  )

  const convertedPath = await findConvertedFile(outputDirectory)
  if (!convertedPath) throw new Error('LibreOffice did not create a PPTX file')
  return convertedPath
}

function buildWindowsOfficeConversionScript(): string {
  return `
$ErrorActionPreference = 'Stop'
$sourcePath = $env:WPS_AGENT_PRESENTATION_SOURCE
$targetPath = $env:WPS_AGENT_PRESENTATION_TARGET
$lastError = ''

foreach ($progId in @('PowerPoint.Application', 'KWPP.Application')) {
  $app = $null
  $presentation = $null
  try {
    $type = [Type]::GetTypeFromProgID($progId)
    if ($null -eq $type) { continue }
    $app = [Activator]::CreateInstance($type)
    try { $app.DisplayAlerts = 1 } catch {}
    $presentation = $app.Presentations.Open($sourcePath, $true, $false, $false)
    $presentation.SaveAs($targetPath, 24)
    $presentation.Close()
    $presentation = $null
    $app.Quit()
    $app = $null
    Write-Output $progId
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

throw "No compatible Windows presentation converter was available. $lastError"
`
}

async function convertWithWindowsOffice(
  sourcePath: string,
  outputDirectory: string,
): Promise<{ path: string; converter: PresentationConverter }> {
  const targetPath = path.join(outputDirectory, `${path.parse(sourcePath).name}.pptx`)
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', buildWindowsOfficeConversionScript()],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: CONVERSION_TIMEOUT_MS,
      maxBuffer: CONVERSION_OUTPUT_LIMIT,
      env: {
        ...process.env,
        WPS_AGENT_PRESENTATION_SOURCE: sourcePath,
        WPS_AGENT_PRESENTATION_TARGET: targetPath,
      },
    },
  )

  if (!await pathExists(targetPath)) throw new Error('Windows Office did not create a PPTX file')
  return {
    path: targetPath,
    converter: String(stdout).includes('KWPP.Application') ? 'wps' : 'powerpoint',
  }
}

async function convertLegacyPresentation(sourcePath: string): Promise<PreparedPresentation> {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-agent-presentation-'))
  const failures: unknown[] = []

  try {
    const libreOffice = await findLibreOfficeExecutable()
    if (libreOffice) {
      try {
        const convertedPath = await convertWithLibreOffice(libreOffice, sourcePath, outputDirectory)
        return {
          data: await fs.readFile(convertedPath),
          convertedFromLegacy: true,
          converter: 'libreoffice',
        }
      } catch (error) {
        failures.push(error)
      }
    }

    if (process.platform === 'win32') {
      try {
        const converted = await convertWithWindowsOffice(sourcePath, outputDirectory)
        return {
          data: await fs.readFile(converted.path),
          convertedFromLegacy: true,
          converter: converted.converter,
        }
      } catch (error) {
        failures.push(error)
      }
    }

    if (failures.length > 0) {
      console.warn('[PresentationConverter] Legacy PPT conversion failed:', failures)
    }
    throw new Error('PRESENTATION_CONVERTER_UNAVAILABLE')
  } finally {
    await fs.rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function preparePresentation(filePath: string): Promise<PreparedPresentation> {
  const normalized = path.normalize(filePath)
  const extension = path.extname(normalized).toLowerCase()

  if (extension === '.pptx') {
    return {
      data: await fs.readFile(normalized),
      convertedFromLegacy: false,
      converter: null,
    }
  }
  if (extension === '.ppt') return convertLegacyPresentation(normalized)

  throw new TypeError(`Unsupported presentation format: ${extension || '(none)'}`)
}
