import type { LanguageCode } from '../i18n/types'

export const EXCEL_FUNCTION_CATALOG_VERSION = 'excel-curated-v1'

export const EXCEL_FUNCTION_CATEGORIES = [
  'aggregate-statistical',
  'math',
  'logical',
  'lookup-reference',
  'text',
  'date-time',
  'information',
  'financial',
] as const

export type ExcelFunctionCategory = (typeof EXCEL_FUNCTION_CATEGORIES)[number]

export interface ExcelFunctionDefinition {
  name: string
  category: ExcelFunctionCategory
  syntax: string
  example: string
  parameters: readonly string[]
  summaries: Readonly<Record<LanguageCode, string>>
  verified: true
}

export interface LocalizedExcelFunctionDefinition
  extends Omit<ExcelFunctionDefinition, 'summaries'> {
  summary: string
  categoryLabel: string
}

type FunctionSeed = readonly [
  name: string,
  category: ExcelFunctionCategory,
  syntax: string,
  example: string,
  parameters: readonly string[],
  englishSummary: string,
  chineseSummary: string,
]

const CATEGORY_LABELS: Record<ExcelFunctionCategory, Record<LanguageCode, string>> = {
  'aggregate-statistical': {
    'zh-CN': '汇总与统计',
    en: 'Aggregation & statistics',
    ja: '集計と統計',
    es: 'Agregación y estadística',
    pt: 'Agregação e estatística',
    de: 'Aggregation und Statistik',
    fr: 'Agrégation et statistiques',
    ru: 'Агрегация и статистика',
    ar: 'التجميع والإحصاء',
  },
  math: {
    'zh-CN': '数学',
    en: 'Math',
    ja: '数学',
    es: 'Matemáticas',
    pt: 'Matemática',
    de: 'Mathematik',
    fr: 'Mathématiques',
    ru: 'Математика',
    ar: 'الرياضيات',
  },
  logical: {
    'zh-CN': '逻辑',
    en: 'Logical',
    ja: '論理',
    es: 'Lógica',
    pt: 'Lógica',
    de: 'Logik',
    fr: 'Logique',
    ru: 'Логика',
    ar: 'المنطق',
  },
  'lookup-reference': {
    'zh-CN': '查找与引用',
    en: 'Lookup & reference',
    ja: '検索と参照',
    es: 'Búsqueda y referencia',
    pt: 'Pesquisa e referência',
    de: 'Nachschlagen und Verweis',
    fr: 'Recherche et référence',
    ru: 'Поиск и ссылки',
    ar: 'البحث والمراجع',
  },
  text: {
    'zh-CN': '文本',
    en: 'Text',
    ja: 'テキスト',
    es: 'Texto',
    pt: 'Texto',
    de: 'Text',
    fr: 'Texte',
    ru: 'Текст',
    ar: 'النص',
  },
  'date-time': {
    'zh-CN': '日期与时间',
    en: 'Date & time',
    ja: '日付と時刻',
    es: 'Fecha y hora',
    pt: 'Data e hora',
    de: 'Datum und Uhrzeit',
    fr: 'Date et heure',
    ru: 'Дата и время',
    ar: 'التاريخ والوقت',
  },
  information: {
    'zh-CN': '信息',
    en: 'Information',
    ja: '情報',
    es: 'Información',
    pt: 'Informação',
    de: 'Information',
    fr: 'Information',
    ru: 'Информация',
    ar: 'المعلومات',
  },
  financial: {
    'zh-CN': '财务',
    en: 'Financial',
    ja: '財務',
    es: 'Finanzas',
    pt: 'Finanças',
    de: 'Finanzen',
    fr: 'Finance',
    ru: 'Финансы',
    ar: 'المالية',
  },
}

const CATEGORY_SUMMARY_TEMPLATES: Record<Exclude<LanguageCode, 'zh-CN' | 'en'>, string> = {
  ja: '{name} は「{category}」カテゴリの検証済み Excel 関数です。',
  es: '{name} es una función de Excel verificada de la categoría «{category}».',
  pt: '{name} é uma função verificada do Excel na categoria “{category}”.',
  de: '{name} ist eine geprüfte Excel-Funktion aus der Kategorie „{category}“.',
  fr: '{name} est une fonction Excel vérifiée de la catégorie « {category} ».',
  ru: '{name} — проверенная функция Excel из категории «{category}».',
  ar: 'الدالة {name} هي دالة Excel تم التحقق منها ضمن فئة «{category}».',
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? '')
}

function buildSummaries(
  name: string,
  category: ExcelFunctionCategory,
  english: string,
  chinese: string,
): Record<LanguageCode, string> {
  const summaries = {
    'zh-CN': chinese,
    en: english,
  } as Record<LanguageCode, string>

  for (const language of ['ja', 'es', 'pt', 'de', 'fr', 'ru', 'ar'] as const) {
    summaries[language] = interpolate(CATEGORY_SUMMARY_TEMPLATES[language], {
      name,
      category: CATEGORY_LABELS[category][language],
    })
  }
  return summaries
}

const FUNCTION_SEEDS: readonly FunctionSeed[] = [
  ['SUM', 'aggregate-statistical', 'SUM(number1, [number2], ...)', '=SUM(1,2,3)', ['number1', '[number2]', '...'], 'Adds numbers, cells, or ranges.', '对数字、单元格或区域求和。'],
  ['SUMIF', 'aggregate-statistical', 'SUMIF(range, criterion, [sum_range])', '=SUMIF(A1:A3,">1",B1:B3)', ['range', 'criterion', '[sum_range]'], 'Adds values that meet one condition.', '对满足一个条件的值求和。'],
  ['SUMIFS', 'aggregate-statistical', 'SUMIFS(sum_range, criteria_range1, criterion1, ...)', '=SUMIFS(C1:C3,A1:A3,">1")', ['sum_range', 'criteria_range1', 'criterion1', '...'], 'Adds values that meet multiple conditions.', '对满足多个条件的值求和。'],
  ['SUMPRODUCT', 'aggregate-statistical', 'SUMPRODUCT(array1, [array2], ...)', '=SUMPRODUCT(A1:A3,B1:B3)', ['array1', '[array2]', '...'], 'Sums products of corresponding array values.', '对数组对应项的乘积求和。'],
  ['SUBTOTAL', 'aggregate-statistical', 'SUBTOTAL(function_num, ref1, [ref2], ...)', '=SUBTOTAL(9,A1:A3)', ['function_num', 'ref1', '[ref2]', '...'], 'Calculates a subtotal for a list or filtered range.', '计算列表或筛选区域的小计。'],
  ['AVERAGE', 'aggregate-statistical', 'AVERAGE(number1, [number2], ...)', '=AVERAGE(1,2,3)', ['number1', '[number2]', '...'], 'Returns the arithmetic mean.', '返回算术平均值。'],
  ['AVERAGEIF', 'aggregate-statistical', 'AVERAGEIF(range, criterion, [average_range])', '=AVERAGEIF(A1:A3,">1")', ['range', 'criterion', '[average_range]'], 'Averages values that meet one condition.', '计算满足一个条件的值的平均数。'],
  ['AVERAGEIFS', 'aggregate-statistical', 'AVERAGEIFS(average_range, criteria_range1, criterion1, ...)', '=AVERAGEIFS(C1:C3,A1:A3,">1")', ['average_range', 'criteria_range1', 'criterion1', '...'], 'Averages values that meet multiple conditions.', '计算满足多个条件的值的平均数。'],
  ['MIN', 'aggregate-statistical', 'MIN(number1, [number2], ...)', '=MIN(1,2,3)', ['number1', '[number2]', '...'], 'Returns the smallest numeric value.', '返回最小数值。'],
  ['MAX', 'aggregate-statistical', 'MAX(number1, [number2], ...)', '=MAX(1,2,3)', ['number1', '[number2]', '...'], 'Returns the largest numeric value.', '返回最大数值。'],
  ['MEDIAN', 'aggregate-statistical', 'MEDIAN(number1, [number2], ...)', '=MEDIAN(1,2,3)', ['number1', '[number2]', '...'], 'Returns the median of supplied numbers.', '返回一组数字的中位数。'],
  ['COUNT', 'aggregate-statistical', 'COUNT(value1, [value2], ...)', '=COUNT(1,2,"x")', ['value1', '[value2]', '...'], 'Counts cells or arguments containing numbers.', '统计包含数字的单元格或参数数量。'],
  ['COUNTA', 'aggregate-statistical', 'COUNTA(value1, [value2], ...)', '=COUNTA(1,"x",TRUE())', ['value1', '[value2]', '...'], 'Counts nonblank values.', '统计非空值数量。'],
  ['COUNTBLANK', 'aggregate-statistical', 'COUNTBLANK(range)', '=COUNTBLANK(A1:A3)', ['range'], 'Counts blank cells in a range.', '统计区域内空白单元格数量。'],
  ['COUNTIF', 'aggregate-statistical', 'COUNTIF(range, criterion)', '=COUNTIF(A1:A3,">1")', ['range', 'criterion'], 'Counts cells that meet one condition.', '统计满足一个条件的单元格数量。'],
  ['COUNTIFS', 'aggregate-statistical', 'COUNTIFS(criteria_range1, criterion1, ...)', '=COUNTIFS(A1:A3,">1",B1:B3,"<5")', ['criteria_range1', 'criterion1', '...'], 'Counts cells that meet multiple conditions.', '统计满足多个条件的单元格数量。'],
  ['LARGE', 'aggregate-statistical', 'LARGE(array, k)', '=LARGE(A1:A3,1)', ['array', 'k'], 'Returns the k-th largest value.', '返回第 k 个最大值。'],
  ['SMALL', 'aggregate-statistical', 'SMALL(array, k)', '=SMALL(A1:A3,1)', ['array', 'k'], 'Returns the k-th smallest value.', '返回第 k 个最小值。'],
  ['STDEV', 'aggregate-statistical', 'STDEV(number1, [number2], ...)', '=STDEV(1,2,3)', ['number1', '[number2]', '...'], 'Estimates sample standard deviation using the compatible function name.', '使用兼容函数名估算样本标准差。'],
  ['VAR', 'aggregate-statistical', 'VAR(number1, [number2], ...)', '=VAR(1,2,3)', ['number1', '[number2]', '...'], 'Estimates sample variance using the compatible function name.', '使用兼容函数名估算样本方差。'],

  ['ABS', 'math', 'ABS(number)', '=ABS(-2)', ['number'], 'Returns a number without its sign.', '返回数值的绝对值。'],
  ['ROUND', 'math', 'ROUND(number, num_digits)', '=ROUND(3.14159,2)', ['number', 'num_digits'], 'Rounds a number to a specified digit count.', '将数字四舍五入到指定小数位。'],
  ['ROUNDUP', 'math', 'ROUNDUP(number, num_digits)', '=ROUNDUP(3.141,2)', ['number', 'num_digits'], 'Rounds a number away from zero.', '将数字向远离零的方向舍入。'],
  ['ROUNDDOWN', 'math', 'ROUNDDOWN(number, num_digits)', '=ROUNDDOWN(3.149,2)', ['number', 'num_digits'], 'Rounds a number toward zero.', '将数字向零方向舍入。'],
  ['INT', 'math', 'INT(number)', '=INT(3.9)', ['number'], 'Rounds a number down to an integer.', '将数字向下舍入为整数。'],
  ['MOD', 'math', 'MOD(number, divisor)', '=MOD(10,3)', ['number', 'divisor'], 'Returns the remainder after division.', '返回除法余数。'],
  ['CEILING', 'math', 'CEILING(number, significance)', '=CEILING(4.2,1)', ['number', 'significance'], 'Rounds a number up to a multiple using the compatible function name.', '使用兼容函数名向上舍入到指定倍数。'],
  ['FLOOR', 'math', 'FLOOR(number, significance)', '=FLOOR(4.8,1)', ['number', 'significance'], 'Rounds a number down to a multiple using the compatible function name.', '使用兼容函数名向下舍入到指定倍数。'],
  ['MROUND', 'math', 'MROUND(number, multiple)', '=MROUND(10,3)', ['number', 'multiple'], 'Rounds a number to the nearest multiple.', '将数字舍入到最接近的指定倍数。'],
  ['PRODUCT', 'math', 'PRODUCT(number1, [number2], ...)', '=PRODUCT(2,3,4)', ['number1', '[number2]', '...'], 'Multiplies supplied numbers.', '将给定数字相乘。'],
  ['POWER', 'math', 'POWER(number, power)', '=POWER(2,3)', ['number', 'power'], 'Raises a number to a power.', '返回数字的指定次幂。'],
  ['SQRT', 'math', 'SQRT(number)', '=SQRT(16)', ['number'], 'Returns the positive square root.', '返回正平方根。'],

  ['IF', 'logical', 'IF(logical_test, value_if_true, value_if_false)', '=IF(A1>0,"Yes","No")', ['logical_test', 'value_if_true', 'value_if_false'], 'Returns one value for TRUE and another for FALSE.', '条件为真或假时返回不同的值。'],
  ['IFERROR', 'logical', 'IFERROR(value, value_if_error)', '=IFERROR(1/0,0)', ['value', 'value_if_error'], 'Returns a fallback when an expression has an error.', '表达式出错时返回备用值。'],
  ['IFNA', 'logical', 'IFNA(value, value_if_na)', '=IFNA(NA(),0)', ['value', 'value_if_na'], 'Returns a fallback specifically for #N/A.', '表达式为 #N/A 时返回备用值。'],
  ['AND', 'logical', 'AND(logical1, [logical2], ...)', '=AND(1<2,2<3)', ['logical1', '[logical2]', '...'], 'Returns TRUE when every condition is true.', '所有条件都为真时返回 TRUE。'],
  ['OR', 'logical', 'OR(logical1, [logical2], ...)', '=OR(1>2,2<3)', ['logical1', '[logical2]', '...'], 'Returns TRUE when any condition is true.', '任一条件为真时返回 TRUE。'],
  ['NOT', 'logical', 'NOT(logical)', '=NOT(FALSE())', ['logical'], 'Reverses a logical value.', '反转逻辑值。'],
  ['TRUE', 'logical', 'TRUE()', '=TRUE()', [], 'Returns the logical value TRUE.', '返回逻辑值 TRUE。'],
  ['FALSE', 'logical', 'FALSE()', '=FALSE()', [], 'Returns the logical value FALSE.', '返回逻辑值 FALSE。'],
  ['SWITCH', 'logical', 'SWITCH(expression, value1, result1, [default])', '=SWITCH(2,1,"A",2,"B","Other")', ['expression', 'value1', 'result1', '[default]'], 'Matches an expression to values and returns the corresponding result.', '匹配表达式并返回对应结果。'],

  ['VLOOKUP', 'lookup-reference', 'VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])', '=VLOOKUP(2,A1:B3,2,FALSE())', ['lookup_value', 'table_array', 'col_index_num', '[range_lookup]'], 'Looks down the first table column and returns a value from another column.', '在表格首列向下查找并返回其他列的值。'],
  ['HLOOKUP', 'lookup-reference', 'HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])', '=HLOOKUP(2,A1:C2,2,FALSE())', ['lookup_value', 'table_array', 'row_index_num', '[range_lookup]'], 'Looks across the first table row and returns a value from another row.', '在表格首行横向查找并返回其他行的值。'],
  ['INDEX', 'lookup-reference', 'INDEX(array, row_num, [column_num])', '=INDEX(A1:B3,2,2)', ['array', 'row_num', '[column_num]'], 'Returns a value at a row and column position.', '返回指定行列位置的值。'],
  ['MATCH', 'lookup-reference', 'MATCH(lookup_value, lookup_array, [match_type])', '=MATCH(2,A1:A3,0)', ['lookup_value', 'lookup_array', '[match_type]'], 'Returns the position of a matching item.', '返回匹配项的位置。'],
  ['LOOKUP', 'lookup-reference', 'LOOKUP(lookup_value, lookup_vector, [result_vector])', '=LOOKUP(2,A1:A3,B1:B3)', ['lookup_value', 'lookup_vector', '[result_vector]'], 'Looks up a value in a one-row or one-column range.', '在单行或单列区域中查找值。'],
  ['CHOOSE', 'lookup-reference', 'CHOOSE(index_num, value1, [value2], ...)', '=CHOOSE(2,"A","B")', ['index_num', 'value1', '[value2]', '...'], 'Selects a value by numeric index.', '按数字索引选择一个值。'],
  ['ROW', 'lookup-reference', 'ROW([reference])', '=ROW(A2)', ['[reference]'], 'Returns a reference row number.', '返回引用的行号。'],
  ['ROWS', 'lookup-reference', 'ROWS(array)', '=ROWS(A1:A3)', ['array'], 'Returns the number of rows in a range.', '返回区域的行数。'],
  ['COLUMN', 'lookup-reference', 'COLUMN([reference])', '=COLUMN(B1)', ['[reference]'], 'Returns a reference column number.', '返回引用的列号。'],
  ['COLUMNS', 'lookup-reference', 'COLUMNS(array)', '=COLUMNS(A1:C1)', ['array'], 'Returns the number of columns in a range.', '返回区域的列数。'],
  ['TRANSPOSE', 'lookup-reference', 'TRANSPOSE(array)', '=TRANSPOSE(A1:B2)', ['array'], 'Swaps rows and columns in an array.', '交换数组的行和列。'],
  ['UNIQUE', 'lookup-reference', 'UNIQUE(array, [by_col], [exactly_once])', '=UNIQUE(A1:A3)', ['array', '[by_col]', '[exactly_once]'], 'Returns distinct values from an array.', '返回数组中的唯一值。'],

  ['CONCAT', 'text', 'CONCAT(text1, [text2], ...)', '=CONCAT("A","B")', ['text1', '[text2]', '...'], 'Joins text values without a delimiter.', '不使用分隔符连接文本。'],
  ['CONCATENATE', 'text', 'CONCATENATE(text1, [text2], ...)', '=CONCATENATE("A","B")', ['text1', '[text2]', '...'], 'Joins text values using the compatible function name.', '使用兼容函数名连接文本。'],
  ['LEFT', 'text', 'LEFT(text, [num_chars])', '=LEFT("Excel",2)', ['text', '[num_chars]'], 'Returns characters from the start of text.', '返回文本开头的字符。'],
  ['RIGHT', 'text', 'RIGHT(text, [num_chars])', '=RIGHT("Excel",2)', ['text', '[num_chars]'], 'Returns characters from the end of text.', '返回文本末尾的字符。'],
  ['MID', 'text', 'MID(text, start_num, num_chars)', '=MID("Excel",2,3)', ['text', 'start_num', 'num_chars'], 'Returns characters from the middle of text.', '返回文本中间的字符。'],
  ['LEN', 'text', 'LEN(text)', '=LEN("Excel")', ['text'], 'Returns the number of characters in text.', '返回文本字符数。'],
  ['TRIM', 'text', 'TRIM(text)', '=TRIM("  Excel  ")', ['text'], 'Removes extra spaces from text.', '删除文本中的多余空格。'],
  ['CLEAN', 'text', 'CLEAN(text)', '=CLEAN("Excel")', ['text'], 'Removes nonprinting characters.', '删除不可打印字符。'],
  ['UPPER', 'text', 'UPPER(text)', '=UPPER("Excel")', ['text'], 'Converts text to uppercase.', '将文本转换为大写。'],
  ['LOWER', 'text', 'LOWER(text)', '=LOWER("Excel")', ['text'], 'Converts text to lowercase.', '将文本转换为小写。'],
  ['PROPER', 'text', 'PROPER(text)', '=PROPER("excel sheet")', ['text'], 'Capitalizes the first letter of each word.', '将每个单词的首字母大写。'],
  ['FIND', 'text', 'FIND(find_text, within_text, [start_num])', '=FIND("c","Excel")', ['find_text', 'within_text', '[start_num]'], 'Finds case-sensitive text and returns its position.', '区分大小写查找文本并返回位置。'],
  ['SEARCH', 'text', 'SEARCH(find_text, within_text, [start_num])', '=SEARCH("C","Excel")', ['find_text', 'within_text', '[start_num]'], 'Finds text without matching case and returns its position.', '不区分大小写查找文本并返回位置。'],
  ['SUBSTITUTE', 'text', 'SUBSTITUTE(text, old_text, new_text, [instance_num])', '=SUBSTITUTE("a-b","-","/")', ['text', 'old_text', 'new_text', '[instance_num]'], 'Replaces matching text.', '替换匹配的文本。'],
  ['REPLACE', 'text', 'REPLACE(old_text, start_num, num_chars, new_text)', '=REPLACE("Excel",1,2,"Ex")', ['old_text', 'start_num', 'num_chars', 'new_text'], 'Replaces characters by position.', '按位置替换字符。'],
  ['TEXT', 'text', 'TEXT(value, format_text)', '=TEXT(1234.5,"0.00")', ['value', 'format_text'], 'Formats a number as text.', '按指定格式将数字转换为文本。'],
  ['VALUE', 'text', 'VALUE(text)', '=VALUE("123.45")', ['text'], 'Converts numeric text to a number.', '将数字文本转换为数值。'],

  ['DATE', 'date-time', 'DATE(year, month, day)', '=DATE(2026,1,1)', ['year', 'month', 'day'], 'Builds a date from year, month, and day.', '根据年、月、日创建日期。'],
  ['DATEVALUE', 'date-time', 'DATEVALUE(date_text)', '=DATEVALUE("2026-01-01")', ['date_text'], 'Converts date text to a date value.', '将日期文本转换为日期值。'],
  ['TODAY', 'date-time', 'TODAY()', '=TODAY()', [], 'Returns the current date.', '返回当前日期。'],
  ['NOW', 'date-time', 'NOW()', '=NOW()', [], 'Returns the current date and time.', '返回当前日期和时间。'],
  ['YEAR', 'date-time', 'YEAR(serial_number)', '=YEAR(DATE(2026,1,1))', ['serial_number'], 'Returns the year component of a date.', '返回日期的年份。'],
  ['MONTH', 'date-time', 'MONTH(serial_number)', '=MONTH(DATE(2026,2,1))', ['serial_number'], 'Returns the month component of a date.', '返回日期的月份。'],
  ['DAY', 'date-time', 'DAY(serial_number)', '=DAY(DATE(2026,2,3))', ['serial_number'], 'Returns the day component of a date.', '返回日期的日。'],
  ['DAYS', 'date-time', 'DAYS(end_date, start_date)', '=DAYS(DATE(2026,1,10),DATE(2026,1,1))', ['end_date', 'start_date'], 'Returns the day count between two dates.', '返回两个日期之间的天数。'],
  ['DATEDIF', 'date-time', 'DATEDIF(start_date, end_date, unit)', '=DATEDIF(DATE(2025,1,1),DATE(2026,1,1),"y")', ['start_date', 'end_date', 'unit'], 'Returns a date difference in a selected unit.', '按指定单位返回日期差。'],
  ['EDATE', 'date-time', 'EDATE(start_date, months)', '=EDATE(DATE(2026,1,1),1)', ['start_date', 'months'], 'Moves a date by a number of months.', '将日期前后移动指定月数。'],
  ['EOMONTH', 'date-time', 'EOMONTH(start_date, months)', '=EOMONTH(DATE(2026,1,1),0)', ['start_date', 'months'], 'Returns the last day of a target month.', '返回目标月份的最后一天。'],
  ['WEEKDAY', 'date-time', 'WEEKDAY(serial_number, [return_type])', '=WEEKDAY(DATE(2026,1,1),2)', ['serial_number', '[return_type]'], 'Returns a date weekday number.', '返回日期对应的星期序号。'],
  ['WEEKNUM', 'date-time', 'WEEKNUM(serial_number, [return_type])', '=WEEKNUM(DATE(2026,1,1),2)', ['serial_number', '[return_type]'], 'Returns the week number within a year.', '返回日期在一年中的周数。'],
  ['NETWORKDAYS', 'date-time', 'NETWORKDAYS(start_date, end_date, [holidays])', '=NETWORKDAYS(DATE(2026,1,1),DATE(2026,1,10))', ['start_date', 'end_date', '[holidays]'], 'Counts working days between dates.', '统计两个日期之间的工作日。'],
  ['WORKDAY', 'date-time', 'WORKDAY(start_date, days, [holidays])', '=WORKDAY(DATE(2026,1,1),5)', ['start_date', 'days', '[holidays]'], 'Returns a date after a number of working days.', '返回经过指定工作日后的日期。'],
  ['HOUR', 'date-time', 'HOUR(serial_number)', '=HOUR(0.5)', ['serial_number'], 'Returns the hour component of a time.', '返回时间中的小时。'],
  ['MINUTE', 'date-time', 'MINUTE(serial_number)', '=MINUTE(0.5)', ['serial_number'], 'Returns the minute component of a time.', '返回时间中的分钟。'],

  ['ISBLANK', 'information', 'ISBLANK(value)', '=ISBLANK(A1)', ['value'], 'Checks whether a value is blank.', '检查值是否为空。'],
  ['ISNUMBER', 'information', 'ISNUMBER(value)', '=ISNUMBER(123)', ['value'], 'Checks whether a value is numeric.', '检查值是否为数字。'],
  ['ISTEXT', 'information', 'ISTEXT(value)', '=ISTEXT("Excel")', ['value'], 'Checks whether a value is text.', '检查值是否为文本。'],
  ['ISLOGICAL', 'information', 'ISLOGICAL(value)', '=ISLOGICAL(TRUE())', ['value'], 'Checks whether a value is logical.', '检查值是否为逻辑值。'],
  ['ISERROR', 'information', 'ISERROR(value)', '=ISERROR(1/0)', ['value'], 'Checks whether a value is any error.', '检查值是否为任意错误。'],
  ['ISNA', 'information', 'ISNA(value)', '=ISNA(NA())', ['value'], 'Checks whether a value is #N/A.', '检查值是否为 #N/A。'],

  ['PMT', 'financial', 'PMT(rate, nper, pv, [fv], [type])', '=PMT(0.05/12,60,10000)', ['rate', 'nper', 'pv', '[fv]', '[type]'], 'Calculates a periodic loan or investment payment.', '计算贷款或投资的定期付款额。'],
  ['PV', 'financial', 'PV(rate, nper, pmt, [fv], [type])', '=PV(0.05,10,100)', ['rate', 'nper', 'pmt', '[fv]', '[type]'], 'Calculates the present value of an investment.', '计算投资的现值。'],
  ['FV', 'financial', 'FV(rate, nper, pmt, [pv], [type])', '=FV(0.05,10,-100)', ['rate', 'nper', 'pmt', '[pv]', '[type]'], 'Calculates the future value of an investment.', '计算投资的未来值。'],
  ['NPV', 'financial', 'NPV(rate, value1, [value2], ...)', '=NPV(0.1,100,110)', ['rate', 'value1', '[value2]', '...'], 'Calculates net present value for periodic cash flows.', '计算周期性现金流的净现值。'],
  ['IRR', 'financial', 'IRR(values, [guess])', '=IRR(A1:A3)', ['values', '[guess]'], 'Calculates the internal rate of return for periodic cash flows.', '计算周期性现金流的内部收益率。'],
  ['XIRR', 'financial', 'XIRR(values, dates, [guess])', '=XIRR(A1:A2,B1:B2)', ['values', 'dates', '[guess]'], 'Calculates the internal rate of return for dated cash flows.', '计算非定期现金流的内部收益率。'],
  ['RATE', 'financial', 'RATE(nper, pmt, pv, [fv], [type], [guess])', '=RATE(12,-100,1000)', ['nper', 'pmt', 'pv', '[fv]', '[type]', '[guess]'], 'Calculates the interest rate per period.', '计算每期利率。'],
]

export const EXCEL_FUNCTION_CATALOG: readonly ExcelFunctionDefinition[] = FUNCTION_SEEDS.map(
  ([name, category, syntax, example, parameters, english, chinese]) => ({
    name,
    category,
    syntax,
    example,
    parameters,
    summaries: buildSummaries(name, category, english, chinese),
    verified: true as const,
  }),
)

const FUNCTION_BY_NAME = new Map(EXCEL_FUNCTION_CATALOG.map((item) => [item.name, item]))
const FUNCTION_NAME_SET = new Set(FUNCTION_BY_NAME.keys())

export function getExcelFunctionCategoryLabel(
  category: ExcelFunctionCategory,
  language: LanguageCode,
): string {
  return CATEGORY_LABELS[category][language]
}

export function getExcelFunction(
  name: string,
  language: LanguageCode = 'en',
): LocalizedExcelFunctionDefinition | undefined {
  const definition = FUNCTION_BY_NAME.get(name.trim().toUpperCase())
  if (!definition) return undefined
  const { summaries, ...rest } = definition
  return {
    ...rest,
    summary: summaries[language],
    categoryLabel: getExcelFunctionCategoryLabel(definition.category, language),
  }
}

export function isVerifiedExcelFunction(name: string): boolean {
  return FUNCTION_NAME_SET.has(name.trim().toUpperCase())
}

function containsQuery(value: string, query: string, language: LanguageCode): boolean {
  const normalizedValue = value.toLocaleLowerCase(language)
  if (normalizedValue.includes(query)) return true
  // Localized searches often omit grammar words: 条件求和 should still match
  // “对满足一个条件的值求和”. Treat an in-order character match as a
  // secondary signal while keeping exact substring matches preferred by order.
  let queryIndex = 0
  for (const character of normalizedValue) {
    if (character === query[queryIndex]) queryIndex += 1
    if (queryIndex === query.length) return true
  }
  return false
}

export function searchExcelFunctions(options: {
  query?: string
  category?: ExcelFunctionCategory
  limit?: number
  language?: LanguageCode
} = {}): LocalizedExcelFunctionDefinition[] {
  const language = options.language ?? 'en'
  const query = options.query?.trim().toLocaleLowerCase(language) ?? ''
  const limit = Math.max(1, Math.min(20, Math.trunc(options.limit ?? 10)))

  return EXCEL_FUNCTION_CATALOG
    .filter((definition) => !options.category || definition.category === options.category)
    .map((definition) => getExcelFunction(definition.name, language)!)
    .filter((definition) => {
      if (!query) return true
      return [
        definition.name,
        definition.summary,
        definition.categoryLabel,
        definition.syntax,
      ].some((value) => containsQuery(value, query, language))
    })
    .slice(0, limit)
}

/** Extract function identifiers while ignoring quoted strings and quoted sheet names. */
export function extractExcelFunctionCalls(formula: string): string[] {
  const stripped = formula
    .replace(/"(?:[^"]|"")*"/g, ' ')
    .replace(/'(?:[^']|'')*'!/g, ' ')
  const calls: string[] = []
  const callPattern = /\b([A-Za-z][A-Za-z0-9_.]*)\s*\(/g
  let match: RegExpExecArray | null
  while ((match = callPattern.exec(stripped)) !== null) {
    calls.push(match[1].toUpperCase())
  }
  return [...new Set(calls)]
}

export function validateCuratedExcelFormula(formula: string): {
  valid: boolean
  functions: string[]
  unsupported: string[]
  error?: 'FORMULA_REQUIRED' | 'FORMULA_TOO_LONG' | 'FORMULA_MUST_START_WITH_EQUALS' | 'UNSUPPORTED_FUNCTION'
} {
  if (!formula.trim()) {
    return { valid: false, functions: [], unsupported: [], error: 'FORMULA_REQUIRED' }
  }
  if (formula.length > 8_192) {
    return { valid: false, functions: [], unsupported: [], error: 'FORMULA_TOO_LONG' }
  }
  if (!formula.trimStart().startsWith('=')) {
    return { valid: false, functions: [], unsupported: [], error: 'FORMULA_MUST_START_WITH_EQUALS' }
  }
  const functions = extractExcelFunctionCalls(formula)
  const unsupported = functions.filter((name) => !isVerifiedExcelFunction(name))
  return unsupported.length > 0
    ? { valid: false, functions, unsupported, error: 'UNSUPPORTED_FUNCTION' }
    : { valid: true, functions, unsupported: [] }
}
