import type { SystemFontFace } from '../utils/system-fonts'

function pdfBaseFont(
  fontId: string,
  faceName: string,
  weight: number,
  style: SystemFontFace['style'],
): SystemFontFace {
  return {
    fontId,
    familyName: 'Helvetica',
    displayName: `Helvetica ${faceName}`,
    faceName,
    faceIndex: 0,
    weight,
    style,
    stretch: 5,
    embedding: 'installable',
    subsetAllowed: true,
    outlineEmbeddingAllowed: true,
  }
}

export const PDF_BASE_FONTS = [
  pdfBaseFont('builtin:Helvetica', 'Regular', 400, 'normal'),
  pdfBaseFont('builtin:Helvetica-Bold', 'Bold', 700, 'normal'),
  pdfBaseFont('builtin:Helvetica-Oblique', 'Oblique', 400, 'oblique'),
  pdfBaseFont('builtin:Helvetica-BoldOblique', 'Bold Oblique', 700, 'oblique'),
]

export const PDF_BASE_FONT = PDF_BASE_FONTS[0]!

export const PDF_MESSAGES = {
  en: {
    encryptedPrompt: 'This PDF is encrypted. Enter its password to continue.',
    passwordRetry: 'The password was not accepted. Try again.',
    passwordCancelled: 'The encrypted PDF was not opened because no password was provided.',
    readOnly: 'This PDF can be viewed, but its permissions do not allow annotations.',
    signed: 'This PDF contains signature fields. Changes can only be saved to a new file and may change signature verification status.',
    conflict: 'The file changed outside Office Agentic. Select OK to reload it and discard these edits, or Cancel to save the edits as a new PDF.',
    invalidImage: 'Choose a PNG, JPEG, or WebP image whose MIME type matches its file contents.',
    imageTooLarge: 'Images are limited to 25 MiB and 40 million pixels.',
    saveCancelled: 'Save As was cancelled.',
    workerDegraded: 'The PDF worker stopped responding. Please close and reopen the document.',
  },
  zh: {
    encryptedPrompt: '此 PDF 已加密。请输入密码以继续。',
    passwordRetry: '密码不正确，请重试。',
    passwordCancelled: '未提供密码，已取消打开加密 PDF。',
    readOnly: '此 PDF 可以查看，但其权限不允许添加或修改注释。',
    signed: '此 PDF 包含签名字段，只能另存为新文件；后续修改可能改变签名验证状态。',
    conflict: '文件已被外部程序修改。选择“确定”将重新加载并放弃当前编辑；选择“取消”将把当前编辑另存为新 PDF。',
    invalidImage: '请选择 MIME 类型与文件内容一致的 PNG、JPEG 或 WebP 图片。',
    imageTooLarge: '图片不得超过 25 MiB 或 4000 万像素。',
    saveCancelled: '已取消另存为。',
    workerDegraded: 'PDF 工作进程已停止响应，请关闭后重新打开该文档。',
  },
} as const

export type PdfMessageKey = keyof typeof PDF_MESSAGES.en

export function pdfMessage(language: string, key: PdfMessageKey): string {
  return (language.toLowerCase().startsWith('zh') ? PDF_MESSAGES.zh : PDF_MESSAGES.en)[key]
}
