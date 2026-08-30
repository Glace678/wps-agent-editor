// SuperDoc 1.44.0 parses Word section breaks and document grids, but its flow
// adapter loses two details that materially affect pagination:
//
// 1. A boundary uses the following section's w:type even though the sectPr at
//    the end of the current section defines how that boundary starts.
// 2. Paragraphs that snap to a line grid are measured from font metrics rather
//    than the section's w:docGrid line pitch.
//
// Keep this as an install-time patch so layout changes stay in memory and the
// source DOCX remains byte-for-byte untouched. The package is pinned to 1.44.0.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chunksDir = path.join(root, 'node_modules', 'superdoc', 'dist', 'chunks')
const converterChunks = readdirSync(chunksDir)
  .filter((name) => /^SuperConverter-.*\.(?:es\.js|cjs)$/.test(name))
  .sort()
const layoutChunks = readdirSync(chunksDir)
  .filter((name) => /^src-.*\.(?:es\.js|cjs)$/.test(name))
  .sort()

if (converterChunks.length !== 2) {
  throw new Error(`Expected one ESM and one CJS SuperConverter chunk, found ${converterChunks.length}`)
}
if (layoutChunks.length !== 2) {
  throw new Error(`Expected one ESM and one CJS layout chunk, found ${layoutChunks.length}`)
}

function countOccurrences(source, value) {
  return source.split(value).length - 1
}

function applyReplacement(source, replacement, file) {
  const { from, to, label, count = 1, applied = to, legacy = [] } = replacement
  const patchedCount = countOccurrences(source, applied)
  if (patchedCount === count) {
    console.log(`[SKIP] ${file}: ${label} (already applied)`)
    return source
  }
  if (patchedCount !== 0) {
    throw new Error(`${file}: ${label}: found ${patchedCount} partial patched occurrences`)
  }

  for (const legacySource of legacy) {
    const legacyCount = countOccurrences(source, legacySource)
    if (legacyCount === count) {
      console.log(`[OK]   ${file}: ${label} (migrated)`)
      return source.split(legacySource).join(to)
    }
    if (legacyCount !== 0) {
      throw new Error(`${file}: ${label}: found ${legacyCount} partial legacy occurrences`)
    }
  }

  const sourceCount = countOccurrences(source, from)
  if (sourceCount !== count) {
    throw new Error(`${file}: ${label}: expected ${count} source occurrences, found ${sourceCount}`)
  }
  console.log(`[OK]   ${file}: ${label}`)
  return source.split(from).join(to)
}

const replacements = [
  {
    label: 'measure automatic line spacing against the active Word document grid',
    from: `const normalizeParagraphSpacing = (value, isList$2) => {`,
    to: `const normalizeParagraphSpacing = (value, isList$2, snapToGrid, documentGrid) => {`,
  },
  {
    label: 'derive grid-snapped line height from raw OOXML spacing',
    from: `\tconst { value: line, unit: lineUnit } = normalizeLineValue(lineRaw, lineRule);\n\tif (beforeAutospacing)`,
    to: `\tconst { value: line, unit: lineUnit } = normalizeLineValue(lineRaw, lineRule);\n\tconst gridType = documentGrid?.type;\n\tconst gridLinePitchPx = pickNumber(documentGrid?.linePitchPx);\n\tconst shouldUseDocumentGrid = snapToGrid !== false && (gridType === "lines" || gridType === "linesAndChars") && gridLinePitchPx != null && gridLinePitchPx > 0 && (lineRule ?? "auto") === "auto";\n\tconst gridLineHeight = shouldUseDocumentGrid ? gridLinePitchPx * ((lineRaw ?? AUTO_SPACING_LINE_DEFAULT) / AUTO_SPACING_LINE_DEFAULT) : void 0;\n\tif (beforeAutospacing)`,
  },
  {
    label: 'store grid-snapped spacing as a physical line height',
    from: `\tspacing.line = line;\n\tspacing.lineUnit = lineUnit;`,
    to: `\tspacing.line = gridLineHeight ?? line;\n\tspacing.lineUnit = gridLineHeight == null ? lineUnit : "px";`,
  },
  {
    label: 'apply the document grid when a paragraph omits explicit spacing',
    from: `const normalizeParagraphSpacing = (value, isList$2, snapToGrid, documentGrid) => {\n\tif (!value || typeof value !== "object") return void 0;`,
    to: `const normalizeParagraphSpacing = (value, isList$2, snapToGrid, documentGrid) => {\n\tif (!value || typeof value !== "object") value = {};`,
  },
  {
    label: 'pass snap-to-grid and section grid into paragraph spacing',
    from: `\tconst normalizedSpacing = normalizeParagraphSpacing(resolvedParagraphProperties.spacing, Boolean(resolvedParagraphProperties.numberingProperties));`,
    to: `\tconst normalizedSpacing = normalizeParagraphSpacing(resolvedParagraphProperties.spacing, Boolean(resolvedParagraphProperties.numberingProperties), resolvedParagraphProperties.snapToGrid, converterContext?.documentGrid);`,
  },
  {
    label: 'read the section document grid',
    from: `function extractSectionData(para) {`,
    to: `function extractDocumentGrid(elements) {\n\tconst element = elements.find((candidate) => candidate?.name === "w:docGrid");\n\tconst linePitchTwips = Number(element?.attributes?.["w:linePitch"]);\n\tif (!Number.isFinite(linePitchTwips) || linePitchTwips <= 0) return;\n\treturn {\n\t\tlinePitchPx: twipsToPixels$1(linePitchTwips),\n\t\ttype: element?.attributes?.["w:type"] ?? "lines"\n\t};\n}\nfunction extractSectionData(para) {`,
  },
  {
    label: 'attach the parsed grid to section data',
    from: `\tconst vAlign = extractVerticalAlign(sectPrElements);\n\treturn {`,
    to: `\tconst vAlign = extractVerticalAlign(sectPrElements);\n\tconst docGrid = extractDocumentGrid(sectPrElements);\n\treturn {`,
  },
  {
    label: 'return the parsed grid with section data',
    from: `\t\tnumbering,\n\t\tvAlign\n\t};`,
    to: `\t\tnumbering,\n\t\tvAlign,\n\t\tdocGrid\n\t};`,
  },
  {
    label: 'carry the grid on paragraph-defined section ranges',
    from: `\t\t\tvAlign: sectionData.vAlign\n\t\t};`,
    to: `\t\t\tvAlign: sectionData.vAlign,\n\t\t\tdocGrid: sectionData.docGrid\n\t\t};`,
  },
  {
    label: 'carry the grid on the final body section',
    from: `\t\tnumbering: bodySectionData.numbering,\n\t\tvAlign: bodySectionData.vAlign\n\t};`,
    to: `\t\tnumbering: bodySectionData.numbering,\n\t\tvAlign: bodySectionData.vAlign,\n\t\tdocGrid: bodySectionData.docGrid\n\t};`,
  },
  {
    label: 'mark a synthetic final section as having no document grid',
    from: `\t\theaderRefs: void 0,\n\t\tfooterRefs: void 0\n\t};`,
    to: `\t\theaderRefs: void 0,\n\t\tfooterRefs: void 0,\n\t\tdocGrid: null\n\t};`,
  },
  {
    label: 'create section boundaries from current break semantics and next properties',
    from: `function shouldRequirePageBoundary(current, next) {`,
    to: `function createBoundarySectionBreakBlock(currentSection, nextSection, blockIdGen, extraAttrs) {\n\treturn createSectionBreakBlock({\n\t\t...nextSection,\n\t\ttype: currentSection.type,\n\t\ttypeIsExplicit: currentSection.typeIsExplicit\n\t}, blockIdGen, extraAttrs);\n}\nfunction activateSectionConverterContext(converterContext, section) {\n\tif (!converterContext) return;\n\tconverterContext.documentGrid = section?.docGrid ?? void 0;\n}\nfunction shouldRequirePageBoundary(current, next) {`,
  },
  {
    label: 'use current section break semantics at every emitted boundary',
    count: 4,
    from: `createSectionBreakBlock(nextSection, nextBlockId, shouldRequirePageBoundary(currentSection, nextSection) || hasIntrinsicBoundarySignals(nextSection) ? { requirePageBoundary: true } : void 0)`,
    to: `createBoundarySectionBreakBlock(currentSection, nextSection, nextBlockId, shouldRequirePageBoundary(currentSection, nextSection) || hasIntrinsicBoundarySignals(nextSection) ? { requirePageBoundary: true } : void 0)`,
  },
  {
    label: 'activate grid after a top-level section transition',
    from: `\tpushBlock(createBoundarySectionBreakBlock(currentSection, nextSection, nextBlockId, shouldRequirePageBoundary(currentSection, nextSection) || hasIntrinsicBoundarySignals(nextSection) ? { requirePageBoundary: true } : void 0));\n\tsectionState.currentSectionIndex++;`,
    to: `\tpushBlock(createBoundarySectionBreakBlock(currentSection, nextSection, nextBlockId, shouldRequirePageBoundary(currentSection, nextSection) || hasIntrinsicBoundarySignals(nextSection) ? { requirePageBoundary: true } : void 0));\n\tsectionState.currentSectionIndex++;\n\tactivateSectionConverterContext(args.converterContext, nextSection);`,
  },
  {
    label: 'activate grid after a nested paragraph section transition',
    from: `\tblocks.push(sectionBreak);\n\trecordBlockKind?.(sectionBreak.kind);\n\tsectionState.currentSectionIndex++;\n}\nvar DEFAULT_HEADER_FOOTER_MARGIN_PX`,
    to: `\tblocks.push(sectionBreak);\n\trecordBlockKind?.(sectionBreak.kind);\n\tsectionState.currentSectionIndex++;\n\tactivateSectionConverterContext(args.converterContext, nextSection);\n}\nvar DEFAULT_HEADER_FOOTER_MARGIN_PX`,
  },
  {
    label: 'activate grid in paragraph containers',
    from: `\t\t\t\tsectionState.currentSectionIndex++;\n\t\t\t}\n\t\t}\n\t\tparagraphToFlowBlocks$1({`,
    to: `\t\t\t\tsectionState.currentSectionIndex++;\n\t\t\t\tactivateSectionConverterContext(context.converterContext, nextSection);\n\t\t\t}\n\t\t}\n\t\tparagraphToFlowBlocks$1({`,
  },
  {
    label: 'activate grid in ordinary paragraphs',
    from: `\t\t\tsectionState.currentSectionIndex++;\n\t\t\tconverterContext.sectionDirection = resolveSectionDirectionFromSectPr$1(nextSection.sectPr);`,
    to: `\t\t\tsectionState.currentSectionIndex++;\n\t\t\tactivateSectionConverterContext(converterContext, nextSection);\n\t\t\tconverterContext.sectionDirection = resolveSectionDirectionFromSectPr$1(nextSection.sectPr);`,
  },
  {
    label: 'pass converter context to TOC section transitions',
    from: `\t\t\t\trecordBlockKind\n\t\t\t});\n\t\t\tconst paragraphBlocks = paragraphConverter({`,
    to: `\t\t\t\trecordBlockKind,\n\t\t\t\tconverterContext: context.converterContext\n\t\t\t});\n\t\t\tconst paragraphBlocks = paragraphConverter({`,
  },
  {
    label: 'pass converter context to structured section transitions',
    from: `\t\t\t\trecordBlockKind\n\t\t\t});\n\t\t\tconst childBlocks = paragraphToFlowBlocks$1({`,
    to: `\t\t\t\trecordBlockKind,\n\t\t\t\tconverterContext\n\t\t\t});\n\t\t\tconst childBlocks = paragraphToFlowBlocks$1({`,
  },
  {
    label: 'initialize converter context with the first section grid',
    from: `\tconverterContext.sectionDirection = converterContext.sectionDirection ?? resolveSectionDirectionFromSectPr(firstSectPr);\n\tconverterContext.sectionDirectionContext = resolveSectionDirection(firstSectPr);`,
    to: `\tconverterContext.sectionDirection = converterContext.sectionDirection ?? resolveSectionDirectionFromSectPr(firstSectPr);\n\tconverterContext.sectionDirectionContext = resolveSectionDirection(firstSectPr);\n\tconverterContext.documentGrid = sectionRanges[0]?.docGrid ?? converterContext.documentGrid;`,
  },
  {
    label: 'pass converter context to top-level section transitions',
    from: `\t\t\tpushBlock: (block) => {\n\t\t\t\tblocks.push(block);\n\t\t\t\trecordBlockKind(block.kind);\n\t\t\t}\n\t\t});`,
    to: `\t\t\tpushBlock: (block) => {\n\t\t\t\tblocks.push(block);\n\t\t\t\trecordBlockKind(block.kind);\n\t\t\t},\n\t\t\tconverterContext\n\t\t});`,
  },
  {
    label: 'keep sized content-table captions with their table',
    from: `\tconst mergedBlocks = mergeFusedParagraphs(mergeDropCapParagraphs(hydrateImageBlocks(blocks, options?.mediaFiles)));\n\tstampTrackedChangeColors(mergedBlocks, options?.resolveTrackedChangeColor);`,
    to: `\tconst mergedBlocks = mergeFusedParagraphs(mergeDropCapParagraphs(hydrateImageBlocks(blocks, options?.mediaFiles)));\n\tfor (let index = 0; index < mergedBlocks.length - 1; index++) {\n\t\tconst caption = mergedBlocks[index];\n\t\tconst nextBlock = mergedBlocks[index + 1];\n\t\tif (caption.kind !== "paragraph" || nextBlock.kind !== "table" || caption.attrs?.alignment !== "center" || caption.attrs?.keepNext === false) continue;\n\t\tconst firstRow = nextBlock.rows?.[0];\n\t\tconst rowStartHeight = firstRow?.attrs?.rowHeight?.value;\n\t\tconst hasSizedContentRow = typeof rowStartHeight === "number" && Number.isFinite(rowStartHeight) && rowStartHeight > 0 && firstRow.cells?.some((cell) => cell.blocks?.some((cellBlock) => cellBlock.runs?.some((run) => typeof run.text === "string" && run.text.trim().length > 0)));\n\t\tconst hasVisibleText = caption.runs?.some((run) => typeof run.text === "string" && run.text.trim().length > 0);\n\t\tconst hasBoldText = caption.runs?.some((run) => run.bold === true && typeof run.text === "string" && run.text.trim().length > 0);\n\t\tif (!hasSizedContentRow || !hasVisibleText || !hasBoldText) continue;\n\t\tcaption.attrs = {\n\t\t\t...caption.attrs,\n\t\t\tkeepNext: true\n\t\t};\n\t}\n\tstampTrackedChangeColors(mergedBlocks, options?.resolveTrackedChangeColor);`,
    legacy: [
      `\tconst mergedBlocks = mergeFusedParagraphs(mergeDropCapParagraphs(hydrateImageBlocks(blocks, options?.mediaFiles)));\n\tfor (let index = 0; index < mergedBlocks.length - 1; index++) {\n\t\tconst caption = mergedBlocks[index];\n\t\tconst nextBlock = mergedBlocks[index + 1];\n\t\tif (caption.kind !== "paragraph" || nextBlock.kind !== "table" || caption.attrs?.alignment !== "center" || caption.attrs?.keepNext === false) continue;\n\t\tconst hasVisibleText = caption.runs?.some((run) => typeof run.text === "string" && run.text.trim().length > 0);\n\t\tconst hasBoldText = caption.runs?.some((run) => run.bold === true && typeof run.text === "string" && run.text.trim().length > 0);\n\t\tif (!hasVisibleText || !hasBoldText) continue;\n\t\tcaption.attrs = {\n\t\t\t...caption.attrs,\n\t\t\tkeepNext: true\n\t\t};\n\t}\n\tstampTrackedChangeColors(mergedBlocks, options?.resolveTrackedChangeColor);`,
    ],
  },
]

const layoutReplacements = [
  {
    label: 'reserve Word table border clearance at a page boundary',
    from: `var ROW_HEIGHT_EPSILON = .1;`,
    to: `var ROW_HEIGHT_EPSILON = .1;\nvar WORD_TABLE_START_CLEARANCE_PX = 2;`,
  },
  {
    label: 'read the explicit minimum height used to start a table row',
    from: `function findSplitPoint(block, measure, startRow, availableHeight, fullPageHeight, _pendingPartialRow) {`,
    to: `function getExplicitRowStartHeight(blockRow) {\n\tconst rowHeight = blockRow?.attrs?.rowHeight;\n\tconst value = rowHeight?.value;\n\tif (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;\n\treturn value;\n}\nfunction findSplitPoint(block, measure, startRow, availableHeight, fullPageHeight, _pendingPartialRow) {`,
  },
  {
    label: 'move a row to a clean page when its minimum height cannot start here',
    from: `\t\t\tif (lastFitRow === startRow) {\n\t\t\t\tconst cellSpacingPx = measure.cellSpacingPx ?? 0;\n\t\t\t\tconst topBorderPx = borderCollapse === "separate" && measure.tableBorderWidths ? measure.tableBorderWidths.top : 0;\n\t\t\t\tremainingHeight = availableHeight - cellSpacingPx - topBorderPx;\n\t\t\t}\n\t\t\tif (fullPageHeight && rowHeight > fullPageHeight) {`,
    to: `\t\t\tif (lastFitRow === startRow) {\n\t\t\t\tconst cellSpacingPx = measure.cellSpacingPx ?? 0;\n\t\t\t\tconst topBorderPx = borderCollapse === "separate" && measure.tableBorderWidths ? measure.tableBorderWidths.top : 0;\n\t\t\t\tremainingHeight = availableHeight - cellSpacingPx - topBorderPx;\n\t\t\t}\n\t\t\tconst explicitRowStartHeight = getExplicitRowStartHeight(row);\n\t\t\tif (explicitRowStartHeight != null && fullPageHeight && explicitRowStartHeight <= fullPageHeight + ROW_HEIGHT_EPSILON && remainingHeight + ROW_HEIGHT_EPSILON < explicitRowStartHeight) {\n\t\t\t\tconst safeEndRow = maxRowspanEnd > lastFitRow && lastCleanFitRow > startRow ? lastCleanFitRow : lastFitRow;\n\t\t\t\treturn {\n\t\t\t\t\tendRow: safeEndRow,\n\t\t\t\t\tpartialRow: null,\n\t\t\t\t\tforcePageBreak: true\n\t\t\t\t};\n\t\t\t}\n\t\t\tif (fullPageHeight && rowHeight > fullPageHeight) {`,
    applied: `\t\t\tconst explicitRowStartHeight = getExplicitRowStartHeight(row);`,
  },
  {
    label: 'preserve a vertical row-span group at a page boundary',
    from: `\t\t\t\tconst safeEndRow = maxRowspanEnd > lastFitRow && lastCleanFitRow > startRow ? lastCleanFitRow : lastFitRow;`,
    to: `\t\t\t\tconst safeEndRow = maxRowspanEnd > lastFitRow ? lastCleanFitRow : lastFitRow;`,
  },
  {
    label: 'compute page-end clearance for a newly starting table',
    from: `\tlet maxRowspanEnd = startRow;\n\tlet lastCleanFitRow = startRow;\n\tfor (let i = startRow; i < block.rows.length; i++) {`,
    to: `\tlet maxRowspanEnd = startRow;\n\tlet lastCleanFitRow = startRow;\n\tconst pageEndClearance = startRow === 0 && fullPageHeight && availableHeight + ROW_HEIGHT_EPSILON < fullPageHeight ? WORD_TABLE_START_CLEARANCE_PX : 0;\n\tfor (let i = startRow; i < block.rows.length; i++) {`,
  },
  {
    label: 'honor page-end clearance when fitting table rows',
    from: `\t\tif (computeFragmentHeight(measure, startRow, i + 1, 0, borderCollapse) <= availableHeight) {`,
    to: `\t\tif (computeFragmentHeight(measure, startRow, i + 1, 0, borderCollapse) + pageEndClearance <= availableHeight) {`,
  },
  {
    label: 'measure a kept table anchor from its Word row start height',
    from: `\t\t\t\tif (anchorBlock.kind === "table" && anchorMeasure.kind === "table" && anchorMeasure.rows.length > 0) {\n\t\t\t\t\tconst firstRowHeight = anchorMeasure.rows[0]?.height;\n\t\t\t\t\tif (typeof firstRowHeight === "number" && Number.isFinite(firstRowHeight) && firstRowHeight > 0) anchorHeight = firstRowHeight;\n\t\t\t\t}`,
    to: `\t\t\t\tif (anchorBlock.kind === "table" && anchorMeasure.kind === "table" && anchorMeasure.rows.length > 0) {\n\t\t\t\t\tconst firstRowHeight = anchorMeasure.rows[0]?.height;\n\t\t\t\t\tconst explicitRowStartHeight = getExplicitRowStartHeight(anchorBlock.rows[0]);\n\t\t\t\t\tif (explicitRowStartHeight != null) anchorHeight = explicitRowStartHeight;\n\t\t\t\t\telse if (typeof firstRowHeight === "number" && Number.isFinite(firstRowHeight) && firstRowHeight > 0) anchorHeight = firstRowHeight;\n\t\t\t\t}`,
  },
]

for (const file of converterChunks) {
  const target = path.join(chunksDir, file)
  const source = readFileSync(target, 'utf8')
  const output = replacements.reduce(
    (current, replacement) => applyReplacement(current, replacement, file),
    source,
  )
  if (output !== source) writeFileSync(target, output, 'utf8')
}

for (const file of layoutChunks) {
  const target = path.join(chunksDir, file)
  const source = readFileSync(target, 'utf8')
  const output = layoutReplacements.reduce(
    (current, replacement) => applyReplacement(current, replacement, file),
    source,
  )
  if (output !== source) writeFileSync(target, output, 'utf8')
}

console.log('superdoc Word layout patch applied (idempotent)')
