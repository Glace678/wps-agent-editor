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
import { extensionOf } from '@/lib/path'

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
  // extensionOf returns the lowercased extension without a dot; the icon map is
  // keyed with leading dots, and its hidden-file semantics (dot <= 0 → '') are
  // preserved: extensionOf already returns '' for dotfiles like '.gitignore'.
  const ext = extensionOf(filePath)
  return ext ? `.${ext}` : ''
}

export function resolveFileIconSrc(filePath: string, isDirectory?: boolean): string {
  if (isDirectory) return folderIcon
  const ext = getExtensionFromPath(filePath)
  return EXTENSION_ICON_MAP[ext] ?? defaultIcon
}