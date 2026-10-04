/** Fortune toolbar tip heuristics: font-size combos (Fortune locales + app langs). */
export const EXCEL_FONT_SIZE_LABEL_RE =
  /font\s*[- ]?\s*size|\btama[nñ]o\s*(de\s*)?fuente\b|\btama[nñ]o\s*fuente\b|размер\s*шрифта|шрифта\s*размер|फ़ॉन्ट\s*साइज़|字号|字號|字体大小|字體大小|schriftgr[oö]ße|taille\s*(de\s*)?(la\s*)?police|tamanho\s*(da\s*)?fonte|フォント\s*サイズ|حجم\s*الخط/

/** Fortune toolbar tip heuristics: font-family combos (\b is ASCII-only; Cyrillic tokens stay bare). */
export const EXCEL_FONT_LABEL_RE =
  /\bfont\b|\bfuente\b|шрифт|फ़ॉन्ट|字体|字體|\bschriftart\b|\bpolice\b|\bfonte\b|フォント|الخط/

export const EXCEL_FONT_COLOR_LABEL_RE =
  /font[\s-]*colou?r|text[\s-]*colou?r|文本颜色|字体颜色|color\s*(?:de\s*)?(?:texto|fuente)|цвет\s*шрифта/i

export const EXCEL_BG_COLOR_LABEL_RE =
  /background|fill[\s-]*colou?r|cell[\s-]*colou?r|填充颜色|单元格颜色|背景颜色|color\s*(?:de\s*)?(?:fondo|relleno|celda)|цвет\s*(?:заливки|фона|ячейки)/i

/** Fortune toolbar tip heuristics: cell number-format combos. */
export const EXCEL_FORMAT_LABEL_RE =
  /\bformat(?:o|ear)?\b|\bformatear\b|формат|格式|प्रारूप|फॉर्मेट|書式|تنسيق/

/** Typical format-list option labels (locale-independent heuristic). */
export const EXCEL_FORMAT_OPTION_HINT_RE =
  /automatic|general|plain\s*text|percent|scientific|accounting|currency|custom\s*format|date\s*time|number|автомат|обычный текст|числов|процент|валют|дата|время|финанс|бухгалтер|формат|personalizado|contabilidad|moneda|fecha|porcentaje|científico|自动|常规|文本|数字|百分比|科学|会计|货币|日期|时间|自定义/
