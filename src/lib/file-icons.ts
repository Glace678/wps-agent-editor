import wordIcon from '@/assets/file-icons/word.svg'
import excelIcon from '@/assets/file-icons/excel.svg'
import powerpointIcon from '@/assets/file-icons/powerpoint.svg'
import pdfIcon from '@/assets/file-icons/pdf.svg'
import textIcon from '@/assets/file-icons/text.svg'
import markdownIcon from '@/assets/file-icons/markdown.svg'
import odtIcon from '@/assets/file-icons/odt.svg'
import odsIcon from '@/assets/file-icons/ods.svg'
import folderIcon from '@/assets/file-icons/folder.svg'
import defaultIcon from '@/assets/file-icons/default.svg'

const EXTENSION_ICON_MAP: Record<string, string> = {
  '.docx': wordIcon,
  '.doc': wordIcon,
  '.xlsx': excelIcon,
  '.xls': excelIcon,
  '.csv': excelIcon,
  '.pptx': powerpointIcon,
  '.ppt': powerpointIcon,
  '.pdf': pdfIcon,
  '.txt': textIcon,
  '.md': markdownIcon,
  '.odt': odtIcon,
  '.ods': odsIcon,
}

export function getExtensionFromPath(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() || ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot).toLowerCase()
}

export function resolveFileIconSrc(filePath: string, isDirectory?: boolean): string {
  if (isDirectory) return folderIcon
  const ext = getExtensionFromPath(filePath)
  return EXTENSION_ICON_MAP[ext] ?? defaultIcon
}