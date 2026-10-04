import type { LanguageCode } from '@/lib/i18n'

export const EXCEL_FONT_SIZE_MIN = 1
export const EXCEL_FONT_SIZE_MAX = 409

export interface ExcelPickerCopy {
  placeholder: string
  empty: string
  invalid: string
}

export type ExcelToolbarPickerKind = 'font' | 'font-size' | 'format'

const EXCEL_FONT_EMPTY_TEXTS: Record<LanguageCode, string> = {
  'zh-CN': '没有匹配的字体，按 Enter 使用输入的字体',
  en: 'No matching font. Press Enter to use the typed font.',
  ja: '一致するフォントがありません。Enter を押して入力したフォントを使用します。',
  es: 'No hay fuentes coincidentes. Presione Entrar para usar la fuente escrita.',
  pt: 'Nenhuma fonte correspondente. Pressione Enter para usar a fonte digitada.',
  de: 'Keine passende Schriftart. Drücken Sie die Eingabetaste, um die eingegebene Schriftart zu verwenden.',
  fr: 'Aucune police correspondante. Appuyez sur Entrée pour utiliser la police saisie.',
  ru: 'Шрифт не найден. Нажмите Enter, чтобы использовать введенный шрифт.',
  ar: 'لا يوجد خط مطابق. اضغط على Enter لاستخدام الخط المكتوب.',
}

const EXCEL_FONT_SIZE_EMPTY_TEXTS: Record<LanguageCode, (min: number, max: number) => string> = {
  'zh-CN': (min, max) => `请输入 ${min} 到 ${max} 之间的字号`,
  en: (min, max) => `Enter a size from ${min} to ${max}.`,
  ja: (min, max) => `${min} から ${max} までのサイズを入力してください。`,
  es: (min, max) => `Introduzca un tamaño de ${min} a ${max}.`,
  pt: (min, max) => `Insira um tamanho de ${min} a ${max}.`,
  de: (min, max) => `Geben Sie eine Größe zwischen ${min} und ${max} ein.`,
  fr: (min, max) => `Entrez une taille comprise entre ${min} et ${max}.`,
  ru: (min, max) => `Введите размер от ${min} до ${max}.`,
  ar: (min, max) => `أدخل حجمًا من ${min} إلى ${max}.`,
}

const EXCEL_FONT_SIZE_INVALID_TEXTS: Record<LanguageCode, (min: number, max: number) => string> = {
  'zh-CN': (min, max) => `字号需介于 ${min} 和 ${max} 之间`,
  en: (min, max) => `Font size must be from ${min} to ${max}.`,
  ja: (min, max) => `フォントサイズは ${min} ～ ${max} の範囲内である必要があります。`,
  es: (min, max) => `El tamaño de fuente debe estar entre ${min} y ${max}.`,
  pt: (min, max) => `O tamanho da fonte deve estar entre ${min} e ${max}.`,
  de: (min, max) => `Der Schriftgrad muss zwischen ${min} und ${max} liegen.`,
  fr: (min, max) => `La taille de la police doit être comprise entre ${min} et ${max}.`,
  ru: (min, max) => `Размер шрифта должен быть от ${min} до ${max}.`,
  ar: (min, max) => `يجب أن يكون حجم الخط بين ${min} و ${max}.`,
}

const EXCEL_FORMAT_EMPTY_TEXTS: Record<LanguageCode, string> = {
  'zh-CN': '没有匹配的格式',
  en: 'No matching format.',
  ja: '一致する書式がありません。',
  es: 'No hay formato coincidente.',
  pt: 'Nenhum formato correspondente.',
  de: 'Kein passendes Format.',
  fr: 'Aucun format correspondant.',
  ru: 'Формат не найден.',
  ar: 'لا يوجد تنسيق مطابق.',
}

export function getExcelPickerCopyForPicker(
  kind: ExcelToolbarPickerKind,
  language: string,
  placeholders: {
    font: string
    fontSize: string
    format: string
  },
): ExcelPickerCopy {
  const lang = (language in EXCEL_FONT_EMPTY_TEXTS ? language : 'en') as LanguageCode

  if (kind === 'font') {
    return {
      placeholder: placeholders.font,
      empty: EXCEL_FONT_EMPTY_TEXTS[lang],
      invalid: '',
    }
  }

  if (kind === 'font-size') {
    return {
      placeholder: placeholders.fontSize,
      empty: EXCEL_FONT_SIZE_EMPTY_TEXTS[lang](EXCEL_FONT_SIZE_MIN, EXCEL_FONT_SIZE_MAX),
      invalid: EXCEL_FONT_SIZE_INVALID_TEXTS[lang](EXCEL_FONT_SIZE_MIN, EXCEL_FONT_SIZE_MAX),
    }
  }

  // format
  return {
    placeholder: placeholders.format,
    empty: EXCEL_FORMAT_EMPTY_TEXTS[lang],
    invalid: '',
  }
}
