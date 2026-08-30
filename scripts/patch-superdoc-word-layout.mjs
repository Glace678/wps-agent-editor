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
    label: 'preserve exact formatting from imported heading style definitions',
    from: `function resolveStyleDefinition(params, styleId) {
	const styles = params.translatedLinkedStyles?.styles;
	const styleDef = styles?.[styleId];
	if (!styles || !styleDef) return;
	const headingLevel = getBuiltInHeadingLevel(styleDef);
	const canonicalHeadingStyleId = headingLevel ? \`Heading\${headingLevel}\` : null;
	const canonicalHeadingStyleDef = canonicalHeadingStyleId ? styles[canonicalHeadingStyleId] : void 0;
	if (canonicalHeadingStyleId && canonicalHeadingStyleId !== styleId && canonicalHeadingStyleDef && getBuiltInHeadingLevel(canonicalHeadingStyleDef) === headingLevel) return {
		styleId: canonicalHeadingStyleId,
		styleDef: canonicalHeadingStyleDef
	};
	return {
		styleId,
		styleDef
	};
}`,
    to: `function resolveStyleDefinition(params, styleId) {
	const styles = params.translatedLinkedStyles?.styles;
	const styleDef = styles?.[styleId];
	if (!styles || !styleDef) return;
	return {
		styleId,
		styleDef
	};
}`,
  },
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
    label: 'retain the grid pitch for implicit Word line spacing',
    from: `\tspacing.lineUnit = gridLineHeight == null ? lineUnit : "px";`,
    to: `\tspacing.lineUnit = gridLineHeight == null ? lineUnit : "px";\n\tif (shouldUseDocumentGrid && lineRaw == null) spacing.documentGridLinePitch = gridLinePitchPx;`,
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
    label: 'use the complex-script paragraph-mark size for empty lines',
    from: `function paragraphToFlowBlocks({ para, nextBlockId, positions, storyKey, trackedChangesConfig, bookmarks, hyperlinkConfig = DEFAULT_HYPERLINK_CONFIG, themeColors, converters: converters$1, converterContext, enableComments = true, stableBlockId, previousParagraphFont }) {`,
    to: `function getEmptyParagraphFontSize(paragraphProperties, defaultSize) {\n\tconst complexSizeHalfPoints = paragraphProperties?.runProperties?.fontSizeCs;\n\tif (typeof complexSizeHalfPoints !== "number" || !Number.isFinite(complexSizeHalfPoints) || complexSizeHalfPoints <= 0) return defaultSize;\n\treturn Math.max(defaultSize, ptToPx(complexSizeHalfPoints / 2));\n}\nfunction paragraphToFlowBlocks({ para, nextBlockId, positions, storyKey, trackedChangesConfig, bookmarks, hyperlinkConfig = DEFAULT_HYPERLINK_CONFIG, themeColors, converters: converters$1, converterContext, enableComments = true, stableBlockId, previousParagraphFont }) {`,
  },
  {
    label: 'measure empty lines from their full paragraph-mark size',
    from: `\t\t\tfontFamily: defaultFont,\n\t\t\tfontSize: defaultSize\n\t\t};\n\t\tif (paragraphMarkTrackedChange)`,
    to: `\t\t\tfontFamily: defaultFont,\n\t\t\tfontSize: getEmptyParagraphFontSize(resolvedParagraphProperties, defaultSize)\n\t\t};\n\t\tif (paragraphMarkTrackedChange)`,
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
  {
    label: 'keep paragraph-final spaces on the final visible Word line',
    from: `	const trimTrailingWrapSpaces = (lineToTrim) => {`,
    to: `	const lineHasNonSpaceContent = (line) => {
		for (let runIndex = line.fromRun; runIndex <= line.toRun; runIndex++) {
			const candidate = runsToProcess[runIndex];
			if (!candidate) continue;
			if (!isTextRun$2(candidate) || typeof candidate.text !== "string") return true;
			const fromChar = runIndex === line.fromRun ? line.fromChar : 0;
			const toChar = runIndex === line.toRun ? line.toChar : candidate.text.length;
			if (/[^ ]/.test(candidate.text.slice(fromChar, toChar))) return true;
		}
		return false;
	};
	const hasOnlyTrailingWrapSpaces = (fromRun, fromChar) => {
		for (let runIndex = fromRun; runIndex < runsToProcess.length; runIndex++) {
			const candidate = runsToProcess[runIndex];
			if (!isTextRun$2(candidate) || typeof candidate.text !== "string") return false;
			const text = runIndex === fromRun ? candidate.text.slice(fromChar) : candidate.text;
			if (/[^ ]/.test(text)) return false;
		}
		return true;
	};
	const trimTrailingWrapSpaces = (lineToTrim) => {`,
  },
  {
    label: 'preserve whitespace-only paragraphs while trimming visible line tails',
    from: `		if (trimCount === 0) return;
		if (lineToTrim.fromRun === lineToTrim.toRun && sliceText.trim().length === 0) return;`,
    to: `		if (trimCount === 0 || !lineHasNonSpaceContent(lineToTrim)) return;`,
  },
  {
    label: 'do not wrap spaces that only trail the paragraph',
    from: `						if (currentLine.width + boundarySpacing$1 + singleSpaceWidth > currentLine.maxWidth - WIDTH_FUDGE_PX$1 && currentLine.width > 0) {`,
    to: `						if (!hasOnlyTrailingWrapSpaces(runIndex, spaceStartChar) && currentLine.width + boundarySpacing$1 + singleSpaceWidth > currentLine.maxWidth - WIDTH_FUDGE_PX$1 && currentLine.width > 0) {`,
  },
  {
    label: 'do not wrap a trailing whitespace-only run',
    from: `					if (currentLine.width + boundarySpacing + spacesWidth > currentLine.maxWidth - WIDTH_FUDGE_PX$1 && currentLine.width > 0) {`,
    to: `					if (!hasOnlyTrailingWrapSpaces(runIndex, spacesStartChar) && currentLine.width + boundarySpacing + spacesWidth > currentLine.maxWidth - WIDTH_FUDGE_PX$1 && currentLine.width > 0) {`,
  },
  {
    label: 'remove paragraph-final space width before final line metrics',
    from: `	if (currentLine) {
		const metrics = finalizeLineMetrics(currentLine, spacing);
		const finalLine = {`,
    to: `	if (currentLine) {
		trimTrailingWrapSpaces(currentLine);
		const metrics = finalizeLineMetrics(currentLine, spacing);
		const finalLine = {`,
  },
  {
    label: 'snap implicit line boxes to whole Word document-grid rows',
    from: `var resolveLineHeight = (spacing, fontSize, maxHeight = -1) => {\n\tlet computedHeight = spacing?.line ?? WORD_SINGLE_LINE_SPACING_MULTIPLIER;\n\tif (spacing?.lineUnit === "multiplier") computedHeight = computedHeight * fontSize;\n\tconst lineRule = spacing?.lineRule ?? "auto";\n\tif (["atLeast", "auto"].includes(lineRule)) return Math.max(computedHeight, maxHeight, WORD_SINGLE_LINE_SPACING_MULTIPLIER * fontSize);\n\treturn computedHeight;\n};`,
    to: `var snapLineHeightToDocumentGrid = (height, spacing) => {\n\tconst gridPitch = spacing?.documentGridLinePitch;\n\tif (typeof gridPitch !== "number" || !Number.isFinite(gridPitch) || gridPitch <= 0) return height;\n\treturn Math.ceil(Math.max(0, height - ROW_HEIGHT_EPSILON) / gridPitch) * gridPitch;\n};\nvar resolveLineHeight = (spacing, fontSize, maxHeight = -1) => {\n\tlet computedHeight = spacing?.line ?? WORD_SINGLE_LINE_SPACING_MULTIPLIER;\n\tif (spacing?.lineUnit === "multiplier") computedHeight = computedHeight * fontSize;\n\tconst lineRule = spacing?.lineRule ?? "auto";\n\tconst resolvedHeight = ["atLeast", "auto"].includes(lineRule) ? Math.max(computedHeight, maxHeight, WORD_SINGLE_LINE_SPACING_MULTIPLIER * fontSize) : computedHeight;\n\treturn snapLineHeightToDocumentGrid(resolvedHeight, spacing);\n};`,
  },
  {
    label: 'snap inline images to whole Word document-grid rows',
    from: `\tconst imageH = line.maxImageHeight ?? 0;\n\tif (imageH > metrics.lineHeight) metrics.lineHeight = imageH;\n\treturn metrics;`,
    to: `\tconst imageH = line.maxImageHeight ?? 0;\n\tif (imageH > metrics.lineHeight) metrics.lineHeight = imageH;\n\tmetrics.lineHeight = snapLineHeightToDocumentGrid(metrics.lineHeight, spacing);\n\treturn metrics;`,
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
