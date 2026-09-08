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
import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
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
    label: 'combine negative paragraph left indents with first-line indents',
    from: `\tconst firstLineOffset = suppressFirstLineIndent ? 0 : (indent?.firstLine ?? 0) - (indent?.hanging ?? 0);\n\tconst isFirstLine = lineIndex === 0 && localStartLine === 0 && !continuesFromPrev;`,
    to: `\tconst firstLineOffset = suppressFirstLineIndent ? 0 : (indent?.firstLine ?? 0) - (indent?.hanging ?? 0);\n\tconst effectiveFirstLineOffset = firstLineOffset > 0 && paraIndentLeft < 0 ? Math.max(0, firstLineOffset + paraIndentLeft) : firstLineOffset;\n\tconst isFirstLine = lineIndex === 0 && localStartLine === 0 && !continuesFromPrev;`,
  },
  {
    label: 'paint the effective first-line indent',
    from: `\t} else if (explicitSegmentPositioning) {\n\t\tif (isFirstLine && firstLineOffset !== 0) {\n\t\t\tconst adjustedPadding = (paraIndentLeft < 0 ? 0 : paraIndentLeft) + firstLineOffset;\n\t\t\tif (adjustedPadding > 0) lineEl.style.paddingLeft = \`\${adjustedPadding}px\`;\n\t\t}\n\t} else if (paraIndentLeft && paraIndentLeft > 0) lineEl.style.paddingLeft = \`\${paraIndentLeft}px\`;\n\telse if (!isFirstLine && indent?.hanging && indent.hanging > 0 && (paraIndentLeft == null || paraIndentLeft >= 0)) lineEl.style.paddingLeft = \`\${indent.hanging}px\`;\n\tif (paraIndentRight && paraIndentRight > 0) lineEl.style.paddingRight = \`\${paraIndentRight}px\`;\n\tif (isFirstLine && firstLineOffset && !explicitSegmentPositioning) lineEl.style.textIndent = \`\${firstLineOffset}px\`;\n\telse if (firstLineOffset && explicitSegmentPositioning) lineEl.style.textIndent = "0px";`,
    to: `\t} else if (explicitSegmentPositioning) {\n\t\tif (isFirstLine && effectiveFirstLineOffset !== 0) {\n\t\t\tconst adjustedPadding = Math.max(0, paraIndentLeft) + effectiveFirstLineOffset;\n\t\t\tif (adjustedPadding > 0) lineEl.style.paddingLeft = \`\${adjustedPadding}px\`;\n\t\t}\n\t} else if (paraIndentLeft && paraIndentLeft > 0) lineEl.style.paddingLeft = \`\${paraIndentLeft}px\`;\n\telse if (!isFirstLine && indent?.hanging && indent.hanging > 0 && (paraIndentLeft == null || paraIndentLeft >= 0)) lineEl.style.paddingLeft = \`\${indent.hanging}px\`;\n\tif (paraIndentRight && paraIndentRight > 0) lineEl.style.paddingRight = \`\${paraIndentRight}px\`;\n\tif (isFirstLine && effectiveFirstLineOffset && !explicitSegmentPositioning) lineEl.style.textIndent = \`\${effectiveFirstLineOffset}px\`;\n\telse if (effectiveFirstLineOffset && explicitSegmentPositioning) lineEl.style.textIndent = "0px";`,
  },
  {
    label: 'measure body lines from the effective first-line indent',
    from: `\tconst firstLineOffset = suppressFirstLineIndent ? 0 : (paraIndent?.firstLine ?? 0) - (paraIndent?.hanging ?? 0);\n\tconst expandedRunsForBlock =`,
    to: `\tconst firstLineOffset = suppressFirstLineIndent ? 0 : (paraIndent?.firstLine ?? 0) - (paraIndent?.hanging ?? 0);\n\tconst effectiveFirstLineOffset = firstLineOffset > 0 && paraIndentLeft < 0 ? Math.max(0, firstLineOffset + paraIndentLeft) : firstLineOffset;\n\tconst expandedRunsForBlock =`,
  },
  {
    label: 'pass the effective first-line indent to body line measurement',
    from: `\t\t\t\tfirstLineOffset,\n\t\t\t\tisFirstLine,\n\t\t\t\tisListFirstLine,`,
    to: `\t\t\t\tfirstLineOffset: effectiveFirstLineOffset,\n\t\t\t\tisFirstLine,\n\t\t\t\tisListFirstLine,`,
  },
  {
    label: 'include each collapsed row bottom border in Word table height',
    from: `\t\tconst bandReservation = (band) => band > 2 ? band - 1 : 0;`,
    to: `\t\tconst bandReservation = (band) => band > 2 ? band - 1 : Math.max(0, band);`,
  },
  {
    label: 'assign collapsed gridline height to the row above it',
    from: `\t\tfor (let i = 0; i < block.rows.length; i++) rowHeights[i] += bandReservation(gridlineBand(i));\n\t\trowHeights[block.rows.length - 1] += bandReservation(gridlineBand(block.rows.length));`,
    to: `\t\tfor (let i = 0; i < block.rows.length; i++) rowHeights[i] += bandReservation(gridlineBand(i + 1));`,
  },
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
  {
    label: 'skip full document re-render on zoom in paginated modes',
    // setZoom() 在写完 #applyZoom（transform/视口尺寸，同步、纯视觉）和
    // painter.setZoom（virtual 滚动窗口同步刷新）之后，仍然挂 pendingDocChange
    // 触发整份文档 getJSON→toFlowBlocks→resolveLayout→paint 全量重绘。
    // 分页模式下页面物理尺寸固定、内容不随缩放重排，重绘纯属浪费；且 book
    // 模式每次重绘都 innerHTML 重建全部页面，再由应用层 120ms 轮询把页面
    // 搬回两页一排——搬运窗口期就是双页缩放到一半「闪一下」的根源。
    // semantic flow 模式的内容宽度随缩放变化（width:100/zoom%），仍需重排。
    from: `\t\tthis.#pendingDocChange = true;
\t\tthis.#scheduleRerender();
\t}
\tdestroy() {`,
    to: `\t\tif (this.#isSemanticFlowMode()) {
\t\t\tthis.#pendingDocChange = true;
\t\t\tthis.#scheduleRerender();
\t\t}
\t}
\tdestroy() {`,
  },
  {
    label: 'pair book-mode pages two-up from the first page',
    // 引擎 book 排法模仿书籍封面：第 1 页单独一行，之后才两页一排；
    // 应用层（WordDocumentLayout.pairBookPages）要在每次重绘后异步搬运
    // DOM 节点才能得到 Word「多页」的 (1,2)(3,4) 排法，搬运窗口期页面
    // 会闪回封面排法。这里直接让引擎按 Word 排法输出，与 #applyZoom
    // book 分支的几何假设（spreadCount = ceil(页数/2)）天然一致；
    // 指针换算全部基于真实页面元素的 getBoundingClientRect，排列变化
    // 后依然自洽。spread 之间补纵向间距（原引擎只在 vertical/horizontal
    // 路径写 mount.style.gap，book 路径遗漏）。
    from: `\trenderBookMode(layout, mount) {
\t\tif (!this.doc) return;
\t\tmount.innerHTML = "";
\t\tconst pages = layout.pages;
\t\tif (pages.length === 0) return;
\t\tconst firstPage = pages[0];
\t\tconst firstPageEl = this.renderPage(firstPage.width, firstPage.height, firstPage, 0);
\t\tmount.appendChild(firstPageEl);
\t\tfor (let i = 1; i < pages.length; i += 2) {
\t\t\tconst spreadEl = this.doc.createElement("div");
\t\t\tspreadEl.classList.add(CLASS_NAMES$1.spread);
\t\t\tapplyStyles(spreadEl, spreadStyles);
\t\t\tconst leftPage = pages[i];
\t\t\tconst leftPageEl = this.renderPage(leftPage.width, leftPage.height, leftPage, i);
\t\t\tspreadEl.appendChild(leftPageEl);
\t\t\tif (i + 1 < pages.length) {
\t\t\t\tconst rightPage = pages[i + 1];
\t\t\t\tconst rightPageEl = this.renderPage(rightPage.width, rightPage.height, rightPage, i + 1);
\t\t\t\tspreadEl.appendChild(rightPageEl);
\t\t\t}
\t\t\tmount.appendChild(spreadEl);
\t\t}
\t}`,
    to: `\trenderBookMode(layout, mount) {
\t\tif (!this.doc) return;
\t\tmount.innerHTML = "";
\t\tconst pages = layout.pages;
\t\tif (pages.length === 0) return;
\t\tmount.style.gap = \`\${this.pageGap}px\`;
\t\tfor (let i = 0; i < pages.length; i += 2) {
\t\t\tconst spreadEl = this.doc.createElement("div");
\t\t\tspreadEl.classList.add(CLASS_NAMES$1.spread);
\t\t\tapplyStyles(spreadEl, spreadStyles);
\t\t\tconst leftPage = pages[i];
\t\t\tconst leftPageEl = this.renderPage(leftPage.width, leftPage.height, leftPage, i);
\t\t\tspreadEl.appendChild(leftPageEl);
\t\t\tif (i + 1 < pages.length) {
\t\t\t\tconst rightPage = pages[i + 1];
\t\t\t\tconst rightPageEl = this.renderPage(rightPage.width, rightPage.height, rightPage, i + 1);
\t\t\t\tspreadEl.appendChild(rightPageEl);
\t\t\t}
\t\t\tmount.appendChild(spreadEl);
\t\t}
\t}`,
  },
  {
    label: 'support book mode geometry natively in #applyZoom',
    from: `\t\tif (layoutMode === "horizontal") {\n\t\t\tconst scaledWidth$1 = totalWidth * zoom;\n\t\t\tconst scaledHeight$1 = maxHeight * zoom;\n\t\t\tthis.#viewportHost.style.width = \`\${scaledWidth$1}px\`;\n\t\t\tthis.#viewportHost.style.minWidth = \`\${scaledWidth$1}px\`;\n\t\t\tthis.#viewportHost.style.minHeight = \`\${scaledHeight$1}px\`;\n\t\t\tthis.#viewportHost.style.height = "";\n\t\t\tthis.#viewportHost.style.overflow = "";\n\t\t\tthis.#viewportHost.style.transform = "";\n\t\t\tthis.#painterHost.style.width = \`\${totalWidth}px\`;\n\t\t\tthis.#painterHost.style.minHeight = \`\${maxHeight}px\`;\n\t\t\tthis.#painterHost.style.marginBottom = zoom !== 1 ? \`\${maxHeight * zoom - maxHeight}px\` : "";\n\t\t\tthis.#painterHost.style.transformOrigin = "top left";\n\t\t\tthis.#painterHost.style.transform = zoom === 1 ? "" : \`scale(\${zoom})\`;\n\t\t\tthis.#selectionOverlay.style.width = \`\${totalWidth}px\`;\n\t\t\tthis.#selectionOverlay.style.height = \`\${maxHeight}px\`;\n\t\t\tthis.#selectionOverlay.style.transformOrigin = "top left";\n\t\t\tthis.#selectionOverlay.style.transform = zoom === 1 ? "" : \`scale(\${zoom})\`;\n\t\t\treturn;\n\t\t}`,
    to: `\t\tif (layoutMode === "horizontal") {\n\t\t\tconst scaledWidth$1 = totalWidth * zoom;\n\t\t\tconst scaledHeight$1 = maxHeight * zoom;\n\t\t\tthis.#viewportHost.style.width = \`\${scaledWidth$1}px\`;\n\t\t\tthis.#viewportHost.style.minWidth = \`\${scaledWidth$1}px\`;\n\t\t\tthis.#viewportHost.style.minHeight = \`\${scaledHeight$1}px\`;\n\t\t\tthis.#viewportHost.style.height = \`\${scaledHeight$1}px\`;\n\t\t\tthis.#viewportHost.style.overflow = "";\n\t\t\tthis.#viewportHost.style.transform = "";\n\t\t\tthis.#painterHost.style.width = \`\${totalWidth}px\`;\n\t\t\tthis.#painterHost.style.minHeight = \`\${maxHeight}px\`;\n\t\t\tthis.#painterHost.style.marginBottom = zoom !== 1 ? \`\${maxHeight * zoom - maxHeight}px\` : "";\n\t\t\tthis.#painterHost.style.transformOrigin = "top left";\n\t\t\tthis.#painterHost.style.transform = zoom === 1 ? "" : \`scale(\${zoom})\`;\n\t\t\tthis.#selectionOverlay.style.width = \`\${totalWidth}px\`;\n\t\t\tthis.#selectionOverlay.style.height = \`\${maxHeight}px\`;\n\t\t\tthis.#selectionOverlay.style.transformOrigin = "top left";\n\t\t\tthis.#selectionOverlay.style.transform = zoom === 1 ? "" : \`scale(\${zoom})\`;\n\t\t\treturn;\n\t\t}\n\t\tif (layoutMode === "book") {\n\t\t\tconst spreadCount = Math.max(1, Math.ceil((Array.isArray(pages) ? pages.length : 1) / 2));\n\t\t\tconst bookWidth = maxWidth * 2 + pageGap;\n\t\t\tconst bookHeight = spreadCount * maxHeight + Math.max(0, spreadCount - 1) * pageGap;\n\t\t\tconst scaledWidth = bookWidth * zoom;\n\t\t\tconst scaledHeight = bookHeight * zoom;\n\t\t\tthis.#viewportHost.style.width = \`\${scaledWidth}px\`;\n\t\t\tthis.#viewportHost.style.minWidth = \`\${scaledWidth}px\`;\n\t\t\tthis.#viewportHost.style.minHeight = \`\${scaledHeight}px\`;\n\t\t\tthis.#viewportHost.style.height = \`\${scaledHeight}px\`;\n\t\t\tthis.#viewportHost.style.overflow = "";\n\t\t\tthis.#viewportHost.style.transform = "";\n\t\t\tthis.#painterHost.style.width = \`\${bookWidth}px\`;\n\t\t\tthis.#painterHost.style.minHeight = \`\${bookHeight}px\`;\n\t\t\tthis.#painterHost.style.marginBottom = zoom !== 1 ? \`\${bookHeight * zoom - bookHeight}px\` : "";\n\t\t\tthis.#painterHost.style.transformOrigin = "top left";\n\t\t\tthis.#painterHost.style.transform = zoom === 1 ? "" : \`scale(\${zoom})\`;\n\t\t\tthis.#selectionOverlay.style.width = \`\${bookWidth}px\`;\n\t\t\tthis.#selectionOverlay.style.height = \`\${bookHeight}px\`;\n\t\t\tthis.#selectionOverlay.style.transformOrigin = "top left";\n\t\t\tthis.#selectionOverlay.style.transform = zoom === 1 ? "" : \`scale(\${zoom})\`;\n\t\t\treturn;\n\t\t}`,
    // 旧版补丁的 horizontal/book 分支把 viewportHost.height 留空（auto），
    // 靠 painterHost 负 marginBottom 补偿缩放高度；负 margin 在本应用的
    // DOM 链（transform + overflow 传播）中不收缩祖先滚动区，会留下数千 px
    // 的可滚动空白。新版显式设置缩放后高度（与宽度对称）。
    legacy: [
      `\t\tif (layoutMode === "horizontal") {\n\t\t\tconst scaledWidth$1 = totalWidth * zoom;\n\t\t\tconst scaledHeight$1 = maxHeight * zoom;\n\t\t\tthis.#viewportHost.style.width = \`\${scaledWidth$1}px\`;\n\t\t\tthis.#viewportHost.style.minWidth = \`\${scaledWidth$1}px\`;\n\t\t\tthis.#viewportHost.style.minHeight = \`\${scaledHeight$1}px\`;\n\t\t\tthis.#viewportHost.style.height = "";\n\t\t\tthis.#viewportHost.style.overflow = "";\n\t\t\tthis.#viewportHost.style.transform = "";\n\t\t\tthis.#painterHost.style.width = \`\${totalWidth}px\`;\n\t\t\tthis.#painterHost.style.minHeight = \`\${maxHeight}px\`;\n\t\t\tthis.#painterHost.style.marginBottom = zoom !== 1 ? \`\${maxHeight * zoom - maxHeight}px\` : "";\n\t\t\tthis.#painterHost.style.transformOrigin = "top left";\n\t\t\tthis.#painterHost.style.transform = zoom === 1 ? "" : \`scale(\${zoom})\`;\n\t\t\tthis.#selectionOverlay.style.width = \`\${totalWidth}px\`;\n\t\t\tthis.#selectionOverlay.style.height = \`\${maxHeight}px\`;\n\t\t\tthis.#selectionOverlay.style.transformOrigin = "top left";\n\t\t\tthis.#selectionOverlay.style.transform = zoom === 1 ? "" : \`scale(\${zoom})\`;\n\t\t\treturn;\n\t\t}\n\t\tif (layoutMode === "book") {\n\t\t\tconst spreadCount = Math.max(1, Math.ceil((Array.isArray(pages) ? pages.length : 1) / 2));\n\t\t\tconst bookWidth = maxWidth * 2 + pageGap;\n\t\t\tconst bookHeight = spreadCount * maxHeight + Math.max(0, spreadCount - 1) * pageGap;\n\t\t\tconst scaledWidth = bookWidth * zoom;\n\t\t\tconst scaledHeight = bookHeight * zoom;\n\t\t\tthis.#viewportHost.style.width = \`\${scaledWidth}px\`;\n\t\t\tthis.#viewportHost.style.minWidth = \`\${scaledWidth}px\`;\n\t\t\tthis.#viewportHost.style.minHeight = \`\${scaledHeight}px\`;\n\t\t\tthis.#viewportHost.style.height = "";\n\t\t\tthis.#viewportHost.style.overflow = "";\n\t\t\tthis.#viewportHost.style.transform = "";\n\t\t\tthis.#painterHost.style.width = \`\${bookWidth}px\`;\n\t\t\tthis.#painterHost.style.minHeight = \`\${bookHeight}px\`;\n\t\t\tthis.#painterHost.style.marginBottom = zoom !== 1 ? \`\${bookHeight * zoom - bookHeight}px\` : "";\n\t\t\tthis.#painterHost.style.transformOrigin = "top left";\n\t\t\tthis.#painterHost.style.transform = zoom === 1 ? "" : \`scale(\${zoom})\`;\n\t\t\tthis.#selectionOverlay.style.width = \`\${bookWidth}px\`;\n\t\t\tthis.#selectionOverlay.style.height = \`\${bookHeight}px\`;\n\t\t\tthis.#selectionOverlay.style.transformOrigin = "top left";\n\t\t\tthis.#selectionOverlay.style.transform = zoom === 1 ? "" : \`scale(\${zoom})\`;\n\t\t\treturn;\n\t\t}`,
    ],
  },
  {
    label: 'size the vertical viewport host to the scaled height in #applyZoom',
    // vertical 默认分支与旧版 horizontal/book 同样把 height 留空：缩小时
    // 未缩放内容高度经 overflow:visible 链传播到滚动容器，页面下方出现
    // 数千 px 的可滚动空白（「下拉到不存在的空页面」）。显式设置高度。
    from: `\t\tthis.#viewportHost.style.minHeight = \`\${scaledHeight}px\`;\n\t\tthis.#viewportHost.style.height = "";\n\t\tthis.#viewportHost.style.overflow = "";\n\t\tthis.#viewportHost.style.transform = "";\n\t\tthis.#painterHost.style.width = \`\${maxWidth}px\`;`,
    to: `\t\tthis.#viewportHost.style.minHeight = \`\${scaledHeight}px\`;\n\t\tthis.#viewportHost.style.height = \`\${scaledHeight}px\`;\n\t\tthis.#viewportHost.style.overflow = "";\n\t\tthis.#viewportHost.style.transform = "";\n\t\tthis.#painterHost.style.width = \`\${maxWidth}px\`;`,
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

// Vite 依赖预打包缓存里是打补丁前的 superdoc；补丁改写 node_modules 后
// lockfile 哈希不变，dev server 重启也不会重新预打包（页面继续跑旧引擎）。
// 清掉缓存，下次 dev 启动强制重新预打包。生产 build 每次从 node_modules
// 重新打包，不受影响。
for (const cacheDir of [
  path.join(root, 'node_modules', '.vite'),
  path.join(root, 'node_modules', '.vite-temp'),
]) {
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true })
    console.log(`cleared stale Vite dependency cache: ${path.relative(root, cacheDir)}`)
  }
}

console.log('superdoc Word layout patch applied (idempotent)')
