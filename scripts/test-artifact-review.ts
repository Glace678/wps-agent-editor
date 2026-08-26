import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import type {
  ArtifactDraftManifest,
  ArtifactOperation,
  ArtifactProducerAdapter,
  ArtifactReviewState,
} from '../src/types/artifact-review'
import {
  ArtifactReviewController,
  orderArtifactOperations,
  validateArtifactDraftManifest,
} from '../src/lightweight-office/agent/artifact-review-controller'
import { ArtifactReviewHistoryService } from '../electron/services/artifact-review-history.service'
import { ArtifactDraftService } from '../electron/services/artifact-draft.service'
import { CodeArtifactWorkspaceService } from '../electron/services/code-artifact-workspace.service'
import { compareArtifactCandidate } from '../electron/services/artifact-diff.service'
import {
  findHistoryOperationConflicts,
  rebaseHistoryCandidate,
} from '../electron/services/artifact-history-rebase.service'

const hash = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex')

function operation(
  id: string,
  blockIndex: number,
  options: { dependsOn?: string[]; atomicGroupId?: string } = {},
): ArtifactOperation {
  return {
    id,
    type: 'replace',
    label: `Change ${id}`,
    location: { kind: 'word', page: Math.floor(blockIndex / 10) + 1, blockIndex },
    before: { text: `before-${id}` },
    after: { text: `after-${id}` },
    dependsOn: options.dependsOn,
    atomicGroupId: options.atomicGroupId,
    visual: 'replacement',
    executionRef: `receipt:${id}`,
  }
}

function manifest(operations: ArtifactOperation[]): ArtifactDraftManifest {
  return {
    protocolVersion: 1,
    draftId: 'draft-1',
    documentId: 'C:\\documents\\report.docx',
    sourceRevision: 3,
    sourceHash: 'a'.repeat(64),
    sourceName: 'report.docx',
    kind: 'word',
    candidateHandle: '12345678-1234-1234-1234-123456789012',
    candidateHash: 'b'.repeat(64),
    producer: { id: 'test-producer', version: '1.0.0', platform: 'win32' },
    operations,
    createdAt: Date.now(),
  }
}

function codePoint(value: string, offset: number) {
  const lines = value.slice(0, offset).split('\n')
  return { offset, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

function codeOperation(
  id: string,
  source: string,
  candidate: string,
  originalStart: number,
  originalEnd: number,
  candidateStart: number,
  candidateEnd: number,
): ArtifactOperation {
  const beforeText = source.slice(originalStart, originalEnd)
  const afterText = candidate.slice(candidateStart, candidateEnd)
  return {
    id,
    type: beforeText ? afterText ? 'replace' : 'delete' : 'insert',
    label: `Code ${id}`,
    location: {
      kind: 'code',
      originalRange: { start: codePoint(source, originalStart), end: codePoint(source, originalEnd) },
      candidateRange: { start: codePoint(candidate, candidateStart), end: codePoint(candidate, candidateEnd) },
      beforeDigest: hash(beforeText),
      afterDigest: hash(afterText),
      contextBeforeDigest: hash(source.slice(Math.max(0, originalStart - 96), originalStart)),
      contextAfterDigest: hash(source.slice(originalEnd, originalEnd + 96)),
    },
    ...(beforeText ? { before: { text: beforeText, digest: hash(beforeText) } } : {}),
    ...(afterText ? { after: { text: afterText, digest: hash(afterText) } } : {}),
    visual: beforeText ? afterText ? 'replacement' : 'deletion' : 'addition',
    executionRef: `code-recipe:${id}`,
  }
}

function codeManifest(operations: ArtifactOperation[], sourceName = 'source.ts'): ArtifactDraftManifest {
  return {
    ...manifest(operations),
    documentId: `C:\\workspace\\${sourceName}`,
    sourceName,
    kind: 'code',
    textMetadata: {
      encoding: 'utf-8', hasBom: false, eol: 'lf', languageId: 'typescript', dirty: false,
    },
  }
}

async function verifyValidationAndOrdering(): Promise<void> {
  const ordered = orderArtifactOperations([
    operation('later', 20),
    operation('first', 1),
    operation('dependent', 2, { dependsOn: ['later'] }),
  ])
  assert.deepEqual(ordered.map(({ id }) => id), ['first', 'later', 'dependent'])
  assert.throws(() => orderArtifactOperations([
    operation('a', 1, { dependsOn: ['b'] }),
    operation('b', 2, { dependsOn: ['a'] }),
  ]), /DEPENDENCY_CYCLE/)
  assert.throws(() => validateArtifactDraftManifest({
    ...manifest([operation('bad', 1)]),
    kind: 'pdf',
  }), /LOCATION_KIND_MISMATCH/)
  assert.throws(() => validateArtifactDraftManifest(manifest([
    { ...operation('missing-ref', 1), executionRef: '' },
  ])), /EXECUTION_REF_REQUIRED/)
  assert.throws(() => validateArtifactDraftManifest(manifest([
    { ...operation('bad-type', 1), type: 'explode' as ArtifactOperation['type'] },
  ])), /OPERATION_TYPE_INVALID/)
  assert.throws(() => validateArtifactDraftManifest(manifest([
    { ...operation('bad-dependencies', 1), dependsOn: 'other' as unknown as string[] },
  ])), /DEPENDENCIES_INVALID/)
  assert.throws(() => validateArtifactDraftManifest({
    ...manifest([operation('placeholder', 1)]),
    kind: 'excel',
    operations: [{
      ...operation('bad-range', 1),
      location: { kind: 'excel', sheetName: 'Sheet1', range: 'XFE1' },
    }],
  }), /EXCEL_RANGE_INVALID/)
  assert.throws(() => validateArtifactDraftManifest(manifest([{
    ...operation('bad-rect', 1),
    location: { kind: 'word', page: 1, rect: { x: 0.8, y: 0.1, width: 0.3, height: 0.2 } },
  }])), /LOCATION_RECT_OVERFLOW/)

  const codeSource = 'const before = 1\n'
  const codeCandidate = 'const after = 1\n'
  const beforeStart = codeSource.indexOf('before')
  const afterStart = codeCandidate.indexOf('after')
  const validCodeOperation = codeOperation(
    'code-valid', codeSource, codeCandidate,
    beforeStart, beforeStart + 'before'.length,
    afterStart, afterStart + 'after'.length,
  )
  assert.doesNotThrow(() => validateArtifactDraftManifest(codeManifest([validCodeOperation])))
  assert.throws(() => validateArtifactDraftManifest(codeManifest([
    validCodeOperation,
    {
      ...validCodeOperation,
      id: 'code-overlap',
      executionRef: 'code-recipe:overlap',
      location: {
        ...validCodeOperation.location,
        kind: 'code',
        originalRange: {
          start: codePoint(codeSource, beforeStart + 1),
          end: codePoint(codeSource, beforeStart + 3),
        },
      },
    },
  ])), /CODE_RANGE_OVERLAP/)
}

async function verifyDecisionsAndCommandStack(): Promise<void> {
  const operations = [
    operation('a', 1),
    operation('b', 2, { dependsOn: ['a'], atomicGroupId: 'pair' }),
    operation('c', 3, { atomicGroupId: 'pair' }),
    operation('d', 20),
  ]
  const rebuilds: string[][] = []
  let saved = false
  const controller = new ArtifactReviewController(manifest(operations), {
    rebuildCandidate: async (_draft, enabled) => {
      rebuilds.push(enabled)
      return {
        candidateHandle: '22345678-1234-1234-1234-123456789012',
        candidateHash: hash(enabled.join('|')),
      }
    },
    saveDraft: async () => { saved = true },
  })

  let state = await controller.reject('a')
  assert.deepEqual(state.enabledOperationIds, ['d'])
  assert.equal(state.decisions.a.decision, 'rejected')
  assert.equal(state.decisions.b.reason, 'dependency')
  assert.equal(state.decisions.c.reason, 'dependency')
  assert.deepEqual(rebuilds.at(-1), ['d'])

  state = await controller.undo()
  assert.equal(state.paused, true)
  assert.equal(state.followAgent, false)
  assert.deepEqual(state.enabledOperationIds, ['a', 'b', 'c', 'd'])
  assert.equal(state.decisions.a.decision, 'pending')
  assert.equal(state.canRedo, true)

  state = await controller.redo()
  assert.deepEqual(state.enabledOperationIds, ['d'])
  assert.equal(state.canUndo, true)
  await controller.locate('d')
  assert.equal(controller.getState().paused, false)
  assert.equal(controller.getState().followAgent, true)

  state = await controller.acceptAll()
  assert.deepEqual(state.enabledOperationIds, ['a', 'b', 'c', 'd'])
  assert.equal(state.accepted, 4)
  assert.equal(state.canSave, true)
  state = await controller.save()
  assert.equal(saved, true)
  assert.equal(state.phase, 'saved')
}

async function verifyAtomicAcceptanceAndConflict(): Promise<void> {
  const operations = [
    operation('root', 1),
    operation('child', 2, { dependsOn: ['root'], atomicGroupId: 'pair' }),
    operation('peer', 3, { atomicGroupId: 'pair' }),
  ]
  const controller = new ArtifactReviewController(manifest(operations), {
    rebuildCandidate: async (_draft, enabled) => ({
      candidateHandle: '32345678-1234-1234-1234-123456789012',
      candidateHash: hash(enabled.join('|')),
    }),
  })
  await controller.reject('root')
  const accepted = await controller.accept('child')
  assert.equal(accepted.decisions.root.decision, 'accepted')
  assert.equal(accepted.decisions.child.decision, 'accepted')
  assert.equal(accepted.decisions.peer.decision, 'accepted')
  assert.deepEqual(accepted.enabledOperationIds, ['root', 'child', 'peer'])
  controller.markConflict('peer', 'Target changed after the Agent task')
  assert.equal(controller.getState().canSave, false)
  await assert.rejects(() => controller.save(), /ARTIFACT_REVIEW_INCOMPLETE/)
}

function reviewStateFor(manifestValue: ArtifactDraftManifest, candidateHash: string): ArtifactReviewState {
  return {
    draftId: manifestValue.draftId,
    documentId: manifestValue.documentId,
    sourceName: manifestValue.sourceName,
    kind: manifestValue.kind,
    phase: 'ready-to-save',
    currentOperationId: manifestValue.operations[0].id,
    currentIndex: 0,
    decided: 1,
    total: 1,
    accepted: 1,
    rejected: 0,
    conflicts: 0,
    decisions: { [manifestValue.operations[0].id]: { decision: 'accepted', reason: 'user', decidedAt: Date.now() } },
    enabledOperationIds: [manifestValue.operations[0].id],
    candidateHandle: manifestValue.candidateHandle,
    candidateHash,
    paused: false,
    followAgent: true,
    canUndo: true,
    canRedo: false,
    canSave: true,
  }
}

async function verifyPersistentHistory(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-artifact-history-'))
  try {
    const sourceData = Buffer.from('source document bytes')
    const history = new ArtifactReviewHistoryService({ root, maxTasksPerFile: 2, globalBudget: 1024 * 1024 })
    for (let index = 0; index < 3; index += 1) {
      const finalData = Buffer.from(`candidate document bytes ${index}`)
      const value = {
        ...manifest([operation(`history-${index}`, index)]),
        draftId: `draft-${index}`,
        sourceHash: hash(sourceData),
        candidateHash: hash(finalData),
      }
      await history.writeRevision({
        manifest: value,
        state: reviewStateFor(value, hash(finalData)),
        sourceData,
        finalData,
        adapterReceipt: `adapter-receipt-${index}`,
      })
    }
    const reloaded = new ArtifactReviewHistoryService({ root, maxTasksPerFile: 2, globalBudget: 1024 * 1024 })
    const records = await reloaded.list('C:\\documents\\report.docx')
    assert.equal(records.length, 2)
    assert.equal(records[0].draftId, 'draft-2')
    const finalBlob = await reloaded.readBlob(records[0].finalBlobHash)
    assert.equal(finalBlob.toString(), 'candidate document bytes 2')
    const reopened = await reloaded.read(records[0].documentId, records[0].revisionId)
    assert.equal(reopened?.adapterReceipt, 'adapter-receipt-2')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function createWordFixture(text: string | string[]): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  const paragraphs = (Array.isArray(text) ? text : [text])
    .map((value) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`)
    .join('')
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function verifyDraftSessionRestoration(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-artifact-session-'))
  const sourcePath = path.join(root, 'report.docx')
  const serviceRoot = path.join(root, 'drafts')
  const historyRoot = path.join(root, 'history')
  try {
    const source = await createWordFixture('before-a')
    const candidate = await createWordFixture('after-a')
    await fs.writeFile(sourcePath, source)
    const draftOperation: ArtifactOperation = {
      ...operation('persisted', 0),
      location: { kind: 'word', blockIndex: 0, search: 'before-a' },
      before: { text: 'before-a' },
      after: { text: 'after-a' },
    }
    const adapter: ArtifactProducerAdapter = {
      identity: { id: 'session-test', version: '1.0.0', platform: 'test' },
      capabilities: {
        kinds: ['word'],
        operationTypes: ['replace'],
        canRebuild: true,
        canRebase: true,
        canPersistExecutionRefs: true,
        protocolVersion: 1,
      },
      openDraft: async () => {},
      buildCandidate: async (value) => ({
        candidateHandle: value.candidateHandle,
        candidateHash: value.candidateHash,
        adapterReceipt: 'session-test',
      }),
      rebuildCandidate: async (value) => ({
        candidateHandle: value.candidateHandle,
        candidateHash: value.candidateHash,
        adapterReceipt: 'session-test',
      }),
      rebaseOperations: async (value) => ({ operations: value.operations, conflicts: [] }),
      closeDraft: async () => {},
    }
    const makeService = () => new ArtifactDraftService({
      root: serviceRoot,
      history: new ArtifactReviewHistoryService({ root: historyRoot }),
    })
    const first = makeService()
    first.registerAdapter(adapter)
    const staged = await first.stageCandidate({
      data: candidate,
      kind: 'word',
      producer: adapter.identity,
      adapterReceipt: 'initial-session-receipt',
    })
    const created = await first.createDraft({
      sourcePath,
      kind: 'word',
      candidateHandle: staged.candidateHandle,
      sourceRevision: 0,
      producer: adapter.identity,
      operations: [draftOperation],
    })

    const restoredService = makeService()
    restoredService.registerAdapter(adapter)
    const restored = await restoredService.findDraftByDocument(sourcePath)
    assert.equal(restored?.manifest.draftId, created.manifest.draftId)
    assert.equal(restored?.reviewState?.phase, 'reviewing')
    const payload = await restoredService.getPayload(created.manifest.draftId)
    assert.equal(hash(Buffer.from(payload.originalData)), created.manifest.sourceHash)
    assert.equal(hash(Buffer.from(payload.candidateData)), created.manifest.candidateHash)

    await fs.writeFile(sourcePath, await createWordFixture('external edit'))
    const conflictedService = makeService()
    conflictedService.registerAdapter(adapter)
    const conflicted = await conflictedService.findDraftByDocument(sourcePath)
    assert.equal(conflicted?.reviewState?.phase, 'conflicted')
    assert.equal(conflicted?.reviewState?.decisions.persisted.decision, 'conflict')
    assert.equal(conflicted?.reviewState?.canSave, false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function verifyHistoryReopenAndWithdrawal(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-artifact-history-reopen-'))
  const sourcePath = path.join(root, 'report.docx')
  const serviceRoot = path.join(root, 'drafts')
  const historyRoot = path.join(root, 'history')
  try {
    const before = await createWordFixture(['before-history', 'user-base'])
    const after = await createWordFixture(['after-history', 'user-base'])
    await fs.writeFile(sourcePath, before)
    const producer = { id: 'history-replay-test', version: '1.0.0', platform: 'test' }
    const makeService = () => {
      const service = new ArtifactDraftService({
        root: serviceRoot,
        history: new ArtifactReviewHistoryService({ root: historyRoot }),
      })
      const adapter: ArtifactProducerAdapter = {
        identity: producer,
        capabilities: {
          kinds: ['word'], operationTypes: ['replace'], canRebuild: true, canRebase: true,
          canPersistExecutionRefs: true, protocolVersion: 1,
        },
        openDraft: async () => {},
        buildCandidate: async (value) => ({
          candidateHandle: value.candidateHandle, candidateHash: value.candidateHash, adapterReceipt: 'history-build',
        }),
        rebuildCandidate: async (value, enabled, context) => {
          const data = enabled.length === 0 ? Buffer.from(context?.replayBaseData ?? []) : after
          return service.stageCandidate({ data, kind: 'word', producer, adapterReceipt: 'history-rebuild' })
        },
        rebaseOperations: async (value) => ({ operations: value.operations, conflicts: [] }),
        closeDraft: async () => {},
      }
      service.registerAdapter(adapter)
      return service
    }
    const first = makeService()
    const staged = await first.stageCandidate({ data: after, kind: 'word', producer, adapterReceipt: 'history-initial' })
    const created = await first.createDraft({
      sourcePath,
      kind: 'word',
      candidateHandle: staged.candidateHandle,
      sourceRevision: 0,
      producer,
      operations: [{
        ...operation('history-withdraw', 0),
        location: { kind: 'word', blockIndex: 0, search: 'before-history' },
        before: { text: 'before-history' },
        after: { text: 'after-history' },
      }],
    })
    await first.command(created.manifest.draftId, { type: 'accept-all' })
    await first.command(created.manifest.draftId, { type: 'save' })
    assert.equal(hash(await fs.readFile(sourcePath)), hash(after))

    const second = makeService()
    const records = await second.listHistory(sourcePath)
    assert.equal(records.length, 1)
    const reopened = await second.reopenHistory(sourcePath, records[0].revisionId)
    assert.equal(reopened.manifest.reviewMode, 'history-withdrawal')
    assert.equal(reopened.reviewState?.decisions['history-withdraw'].decision, 'pending')
    const withdrawn = await second.command(reopened.manifest.draftId, {
      type: 'reject', operationId: 'history-withdraw',
    })
    assert.equal(withdrawn.rejected, 1)
    assert.equal(withdrawn.canSave, true)
    await second.command(reopened.manifest.draftId, { type: 'save' })
    assert.equal(hash(await fs.readFile(sourcePath)), hash(before))
    assert.equal((await second.listHistory(sourcePath)).length, 2)

    await fs.writeFile(sourcePath, await createWordFixture(['after-history', 'user-later']))
    const unrelated = await second.reopenHistory(sourcePath, records[0].revisionId)
    assert.equal(unrelated.reviewState?.decisions['history-withdraw'].decision, 'pending')
    await second.command(unrelated.manifest.draftId, { type: 'reject', operationId: 'history-withdraw' })
    await second.command(unrelated.manifest.draftId, { type: 'save' })
    const unrelatedResult = await (await JSZip.loadAsync(await fs.readFile(sourcePath)))
      .file('word/document.xml')?.async('string')
    assert.match(unrelatedResult ?? '', /before-history/)
    assert.match(unrelatedResult ?? '', /user-later/)

    await fs.writeFile(sourcePath, await createWordFixture(['same-target-user-edit', 'user-later']))
    const conflicted = await second.reopenHistory(sourcePath, records[0].revisionId)
    assert.equal(conflicted.reviewState?.phase, 'conflicted')
    assert.equal(conflicted.reviewState?.canSave, true, 'conflicted history operations are locked and kept')
    await assert.rejects(
      second.command(conflicted.manifest.draftId, { type: 'reject', operationId: 'history-withdraw' }),
      /ARTIFACT_OPERATION_CONFLICT/,
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function excelFixture(a1: string, b1: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sheet1')
  sheet.getCell('A1').value = a1
  sheet.getCell('B1').value = b1
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

async function presentationFixture(slide1: string, slide2: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('ppt/slides/slide1.xml', slide1)
  zip.file('ppt/slides/slide2.xml', slide2)
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function verifyFormatAwareHistoryRebase(): Promise<void> {
  const finalExcel = await excelFixture('after', 'user-base')
  const currentExcel = await excelFixture('after', 'user-later')
  const desiredExcel = await excelFixture('before', 'user-base')
  const excelOperation: ArtifactOperation = {
    id: 'excel-a1', type: 'replace', label: 'Sheet1!A1',
    location: { kind: 'excel', sheetName: 'Sheet1', range: 'A1' },
    before: { text: 'before' }, after: { text: 'after' }, visual: 'replacement', executionRef: 'excel-ref',
  }
  assert.deepEqual(
    await findHistoryOperationConflicts('excel', finalExcel, currentExcel, [excelOperation]),
    [],
  )
  const mergedExcel = await rebaseHistoryCandidate('excel', finalExcel, currentExcel, desiredExcel)
  const mergedWorkbook = new ExcelJS.Workbook()
  await mergedWorkbook.xlsx.load(mergedExcel as unknown as ExcelJS.Buffer)
  assert.equal(mergedWorkbook.getWorksheet('Sheet1')?.getCell('A1').value, 'before')
  assert.equal(mergedWorkbook.getWorksheet('Sheet1')?.getCell('B1').value, 'user-later')
  assert.deepEqual(
    await findHistoryOperationConflicts('excel', finalExcel, await excelFixture('user-edit', 'user-later'), [excelOperation]),
    ['excel-a1'],
  )

  const finalPpt = await presentationFixture('agent-final', 'user-base')
  const currentPpt = await presentationFixture('agent-final', 'user-later')
  const desiredPpt = await presentationFixture('source', 'user-base')
  const slideOperation: ArtifactOperation = {
    id: 'slide-1', type: 'replace', label: 'Slide 1',
    location: { kind: 'presentation', slideIndex: 0 },
    before: { text: 'source' }, after: { text: 'agent-final' }, visual: 'replacement', executionRef: 'slide-ref',
  }
  assert.deepEqual(
    await findHistoryOperationConflicts('presentation', finalPpt, currentPpt, [slideOperation]),
    [],
  )
  const mergedPpt = await JSZip.loadAsync(await rebaseHistoryCandidate('presentation', finalPpt, currentPpt, desiredPpt))
  assert.equal(await mergedPpt.file('ppt/slides/slide1.xml')?.async('string'), 'source')
  assert.equal(await mergedPpt.file('ppt/slides/slide2.xml')?.async('string'), 'user-later')
  assert.deepEqual(
    await findHistoryOperationConflicts('pdf', Buffer.from('a'), Buffer.from('b'), [{
      ...operation('pdf-page', 0),
      location: { kind: 'pdf', pageNumber: 1 },
    }]),
    ['pdf-page'],
  )
}

function pdfFixture(text: string): Buffer {
  const stream = `BT /F1 12 Tf 40 120 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'ascii')
}

async function verifyFourFormatDifferenceMapping(): Promise<void> {
  const wordBefore = await createWordFixture('word-before')
  const wordAfter = await createWordFixture('word-after')
  const wordOperation: ArtifactOperation = {
    id: 'word-diff', type: 'replace', label: 'Word replacement',
    location: { kind: 'word', search: 'word-before' },
    before: { text: 'word-before' }, after: { text: 'word-after' },
    visual: 'replacement', executionRef: 'word-diff-ref',
  }
  assert.equal((await compareArtifactCandidate('word', wordBefore, wordAfter, [wordOperation])).observations.length, 1)

  const excelBefore = await excelFixture('excel-before', 'stable')
  const excelAfter = await excelFixture('excel-after', 'stable')
  const excelOperation: ArtifactOperation = {
    id: 'excel-diff', type: 'replace', label: 'Excel replacement',
    location: { kind: 'excel', sheetName: 'Sheet1', range: 'A1' },
    before: { text: 'excel-before' }, after: { text: 'excel-after' },
    visual: 'replacement', executionRef: 'excel-diff-ref',
  }
  assert.equal((await compareArtifactCandidate('excel', excelBefore, excelAfter, [excelOperation])).observations.length, 1)

  const pdfBefore = pdfFixture('pdf-before')
  const pdfAfter = pdfFixture('pdf-after')
  const pdfOperation: ArtifactOperation = {
    id: 'pdf-diff', type: 'replace', label: 'PDF replacement',
    location: { kind: 'pdf', pageNumber: 1, rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.2 } },
    before: { text: 'pdf-before' }, after: { text: 'pdf-after' },
    visual: 'replacement', executionRef: 'pdf-diff-ref',
  }
  assert.equal((await compareArtifactCandidate('pdf', pdfBefore, pdfAfter, [pdfOperation])).observations.length, 1)

  const pptBefore = await presentationFixture('<slide>before</slide>', '<slide>stable</slide>')
  const pptAfterZip = await JSZip.loadAsync(await presentationFixture('<slide>after</slide>', '<slide>stable</slide>'))
  pptAfterZip.folder('ppt/media')
  const pptAfter = await pptAfterZip.generateAsync({ type: 'nodebuffer' })
  const pptOperation: ArtifactOperation = {
    id: 'ppt-diff', type: 'replace', label: 'Slide replacement',
    location: { kind: 'presentation', slideIndex: 0, nodeId: 'title' },
    before: { text: 'before' }, after: { text: 'after' },
    visual: 'replacement', executionRef: 'ppt-diff-ref',
  }
  assert.equal((await compareArtifactCandidate('presentation', pptBefore, pptAfter, [pptOperation])).observations.length, 1)
  await assert.rejects(
    compareArtifactCandidate('presentation', pptBefore, pptAfter, [{ ...pptOperation, location: { kind: 'presentation', slideIndex: 1 } }]),
    /ARTIFACT_UNDECLARED_DIFFERENCE/,
  )
}

async function verifyCodeDifferenceMappingAndHistory(): Promise<void> {
  const replacementSource = 'const color = "red";\nconst stable = true;\n'
  const replacementCandidate = 'const color = "green";\nconst stable = true;\n'
  const replacementStart = replacementSource.indexOf('red')
  const replacementCandidateStart = replacementCandidate.indexOf('green')
  const replacement = codeOperation(
    'code-replacement', replacementSource, replacementCandidate,
    replacementStart, replacementStart + 3,
    replacementCandidateStart, replacementCandidateStart + 5,
  )
  const replacementDiff = await compareArtifactCandidate(
    'code', Buffer.from(replacementSource), Buffer.from(replacementCandidate), [replacement],
  )
  assert.equal(replacementDiff.observations.length, 1)
  assert.equal(replacementDiff.observations[0].scope, 'code')

  const additionSource = 'const first = 1;\n'
  const additionText = 'const second = 2;\n'
  const additionCandidate = additionSource + additionText
  const addition = codeOperation(
    'code-addition', additionSource, additionCandidate,
    additionSource.length, additionSource.length,
    additionSource.length, additionCandidate.length,
  )
  assert.equal((await compareArtifactCandidate(
    'code', Buffer.from(additionSource), Buffer.from(additionCandidate), [addition],
  )).observations.length, 1)

  const deletionSource = 'const removeMe = true;\nconst keepMe = true;\n'
  const deletedText = 'const removeMe = true;\n'
  const deletionCandidate = deletionSource.slice(deletedText.length)
  const deletion = codeOperation(
    'code-deletion', deletionSource, deletionCandidate,
    0, deletedText.length,
    0, 0,
  )
  assert.equal((await compareArtifactCandidate(
    'code', Buffer.from(deletionSource), Buffer.from(deletionCandidate), [deletion],
  )).observations.length, 1)
  await assert.rejects(
    compareArtifactCandidate('code', Buffer.from(additionSource), Buffer.from(additionCandidate), [replacement]),
    /ARTIFACT_(UNDECLARED_DIFFERENCE|OPERATION_WITHOUT_DIFFERENCE|CODE_DIGEST_MISMATCH)/,
  )

  const recordedFinal = '// initial header\nconst value = "agent";\nconst untouched = 2;\n'
  const current = '// user changed header later\nconst value = "agent";\nconst untouched = 2;\n'
  const desired = '// initial header\nconst value = "before";\nconst untouched = 2;\n'
  const finalStart = recordedFinal.indexOf('agent')
  const desiredStart = desired.indexOf('before')
  const historyOperation = codeOperation(
    'code-history', desired, recordedFinal,
    desiredStart, desiredStart + 'before'.length,
    finalStart, finalStart + 'agent'.length,
  )
  assert.deepEqual(
    await findHistoryOperationConflicts('code', Buffer.from(recordedFinal), Buffer.from(current), [historyOperation]),
    [],
  )
  const bom = Buffer.from([0xef, 0xbb, 0xbf])
  const rebased = await rebaseHistoryCandidate(
    'code', Buffer.concat([bom, Buffer.from(recordedFinal)]), Buffer.concat([bom, Buffer.from(current)]), Buffer.concat([bom, Buffer.from(desired)]),
  )
  assert.deepEqual([...rebased.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.equal(rebased.subarray(3).toString(), '// user changed header later\nconst value = "before";\nconst untouched = 2;\n')
  const conflicting = '// user changed header later\nconst value = "user";\nconst untouched = 2;\n'
  assert.deepEqual(
    await findHistoryOperationConflicts('code', Buffer.from(recordedFinal), Buffer.from(conflicting), [historyOperation]),
    ['code-history'],
  )
}

async function verifyCodeWorkspaceHandles(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-code-workspace-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-code-outside-'))
  try {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'node_modules', 'ignored'), { recursive: true })
    const activePath = path.join(root, 'src', 'active.ts')
    const configPath = path.join(root, 'config.json')
    await fs.writeFile(activePath, 'export const disk = true\n')
    await fs.writeFile(configPath, '{"enabled":true}\n')
    await fs.writeFile(path.join(root, '.env'), 'API_URL=https://example.invalid\n')
    await fs.writeFile(path.join(root, '.env.local'), 'API_KEY=never-index-this\n')
    await fs.writeFile(path.join(root, 'credentials.json'), '{"token":"never-index-this"}\n')
    await fs.writeFile(path.join(root, 'server.pem'), 'never-index-this\n')
    await fs.writeFile(path.join(root, 'notes.md'), '# excluded\n')
    await fs.writeFile(path.join(root, 'debug.log'), 'excluded\n')
    await fs.writeFile(path.join(root, 'node_modules', 'ignored', 'package.js'), 'ignored\n')
    const service = new CodeArtifactWorkspaceService()
    const inspected = await service.inspectWorkspace({
      workspaceRoot: root,
      activeSnapshot: {
        sourcePath: activePath,
        data: Buffer.from('export const memory = true\n'),
        revision: 7,
        metadata: {
          encoding: 'utf-8', hasBom: false, eol: 'lf', languageId: 'typescript', dirty: true,
        },
      },
    })
    assert.equal(inspected.truncated, false)
    assert.deepEqual(inspected.artifacts.map(({ relativePath }) => relativePath).sort(), ['config.json', 'src/active.ts'])
    assert.doesNotMatch(JSON.stringify(inspected.artifacts), /never-index-this|\.env|credentials\.json|server\.pem/)
    assert.ok(inspected.artifacts.every(({ artifactId, relativePath }) => artifactId && !path.isAbsolute(relativePath)))
    const active = inspected.artifacts.find(({ relativePath }) => relativePath === 'src/active.ts')!
    assert.equal(active.dirty, true)
    assert.equal(active.revision, 7)
    const read = await service.readArtifact({
      artifactId: active.artifactId, workspaceRoot: root, startOffset: 7, endOffset: 19,
    })
    assert.equal(read.content, 'const memory')
    await assert.rejects(
      service.resolveArtifact({ artifactId: 'not-a-handle', workspaceRoot: root }),
      /CODE_ARTIFACT_HANDLE_INVALID/,
    )
    await assert.rejects(
      service.readArtifact({ artifactId: active.artifactId, workspaceRoot: outside }),
      /CODE_ARTIFACT_WORKSPACE_MISMATCH/,
    )
    await fs.writeFile(configPath, '{"enabled":false}\n')
    const config = inspected.artifacts.find(({ relativePath }) => relativePath === 'config.json')!
    await assert.rejects(
      service.resolveArtifact({ artifactId: config.artifactId, workspaceRoot: root }),
      /CODE_ARTIFACT_DISK_CHANGED/,
    )
    const outsidePath = path.join(outside, 'outside.ts')
    await fs.writeFile(outsidePath, 'export {}\n')
    await assert.rejects(service.inspectWorkspace({
      workspaceRoot: root,
      activeSnapshot: {
        sourcePath: outsidePath,
        data: Buffer.from('export {}\n'),
        revision: 0,
        metadata: { encoding: 'utf-8', hasBom: false, eol: 'lf', languageId: 'typescript', dirty: false },
      },
    }), /CODE_ACTIVE_ARTIFACT_OUTSIDE_WORKSPACE/)
    await assert.rejects(service.inspectWorkspace({
      workspaceRoot: root,
      activeSnapshot: {
        sourcePath: path.join(root, '.env'),
        data: Buffer.from('API_KEY=still-never-index-this\n'),
        revision: 0,
        metadata: { encoding: 'utf-8', hasBom: false, eol: 'lf', languageId: 'plaintext', dirty: true },
      },
    }), /CODE_ACTIVE_ARTIFACT_SENSITIVE/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
}

async function verifyCrossFileDependencyCascade(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-code-cross-file-'))
  const draftRoot = path.join(root, 'drafts')
  const historyRoot = path.join(root, 'history')
  const batchId = 'code-cross-file-batch'
  try {
    const specs = [
      { relativePath: 'a.ts', operationId: 'edit-a', before: 'beforeA', after: 'afterA' },
      { relativePath: 'b.ts', operationId: 'edit-b', before: 'beforeB', after: 'afterB' },
      { relativePath: 'c.ts', operationId: 'edit-c', before: 'beforeC', after: 'afterC' },
    ].map((spec) => {
      const source = `export const value = '${spec.before}'\n`
      const candidate = source.replace(spec.before, spec.after)
      const originalStart = source.indexOf(spec.before)
      const candidateStart = candidate.indexOf(spec.after)
      return {
        ...spec,
        source,
        candidate,
        sourcePath: path.join(root, spec.relativePath),
        operation: codeOperation(
          spec.operationId,
          source,
          candidate,
          originalStart,
          originalStart + spec.before.length,
          candidateStart,
          candidateStart + spec.after.length,
        ),
      }
    })
    await Promise.all(specs.map((spec) => fs.writeFile(spec.sourcePath, spec.source)))
    const producer = { id: 'code-cross-file-test', version: '1.0.0', platform: 'test' }
    const service = new ArtifactDraftService({
      root: draftRoot,
      history: new ArtifactReviewHistoryService({ root: historyRoot }),
    })
    const specByPath = new Map(specs.map((spec) => [spec.sourcePath, spec]))
    const adapter: ArtifactProducerAdapter = {
      identity: producer,
      capabilities: {
        kinds: ['code'], operationTypes: ['replace'], canRebuild: true, canRebase: true,
        canPersistExecutionRefs: true, protocolVersion: 1,
      },
      openDraft: async () => {},
      buildCandidate: async (value) => ({
        candidateHandle: value.candidateHandle,
        candidateHash: value.candidateHash,
        adapterReceipt: 'code-cross-file-build',
      }),
      rebuildCandidate: async (value, enabledOperationIds) => {
        const spec = specByPath.get(value.documentId)
        if (!spec) throw new Error('TEST_CODE_SPEC_MISSING')
        return service.stageCandidate({
          data: Buffer.from(enabledOperationIds.includes(spec.operationId) ? spec.candidate : spec.source),
          kind: 'code',
          producer,
          adapterReceipt: `code-cross-file-rebuild:${enabledOperationIds.join(',')}`,
        })
      },
      rebaseOperations: async (value) => ({ operations: value.operations, conflicts: [] }),
      closeDraft: async () => {},
    }
    service.registerAdapter(adapter)
    const draftRequests = [] as Parameters<typeof service.createDraft>[0][]
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index]
      const staged = await service.stageCandidate({
        data: Buffer.from(spec.candidate),
        kind: 'code',
        producer,
        adapterReceipt: `code-cross-file-initial:${spec.operationId}`,
      })
      draftRequests.push({
        sourcePath: spec.sourcePath,
        kind: 'code',
        candidateHandle: staged.candidateHandle,
        sourceRevision: 0,
        producer,
        operations: [spec.operation],
        textMetadata: {
          encoding: 'utf-8', hasBom: false, eol: 'lf', languageId: 'typescript', dirty: false,
        },
        batchId,
        relativePath: spec.relativePath,
        ...(index > 0 ? {
          crossFileDependencies: [{
            operationId: spec.operationId,
            dependsOnRelativePath: specs[index - 1].relativePath,
            dependsOnOperationId: specs[index - 1].operationId,
          }],
        } : {}),
      })
    }
    const created = await service.createDraftBatch({ requests: draftRequests })

    await service.command(created[0].manifest.draftId, { type: 'reject', operationId: specs[0].operationId })
    for (let index = 1; index < created.length; index += 1) {
      const dependent = service.getDraft(created[index].manifest.draftId)
      assert.equal(dependent?.reviewState?.decisions[specs[index].operationId].decision, 'rejected')
      assert.equal(dependent?.reviewState?.decisions[specs[index].operationId].reason, 'dependency')
      assert.equal(
        Buffer.from((await service.getPayload(created[index].manifest.draftId)).candidateData).toString(),
        specs[index].source,
      )
    }
    for (const item of created.reverse()) {
      await service.command(item.manifest.draftId, { type: 'discard' })
    }

    const failedBatchId = 'code-cross-file-failed-batch'
    const stagedA = await service.stageCandidate({
      data: Buffer.from(specs[0].candidate), kind: 'code', producer, adapterReceipt: 'failed-batch-a',
    })
    const stagedB = await service.stageCandidate({
      data: Buffer.from(`${specs[1].candidate}// undeclared\n`),
      kind: 'code', producer, adapterReceipt: 'failed-batch-b',
    })
    const metadata = {
      encoding: 'utf-8' as const,
      hasBom: false,
      eol: 'lf' as const,
      languageId: 'typescript',
      dirty: false,
    }
    const events: string[] = []
    service.setEventSink(({ type }) => events.push(type))
    await assert.rejects(service.createDraftBatch({ requests: [{
      sourcePath: specs[0].sourcePath,
      kind: 'code',
      candidateHandle: stagedA.candidateHandle,
      sourceRevision: 0,
      producer,
      operations: [specs[0].operation],
      textMetadata: metadata,
      batchId: failedBatchId,
      relativePath: specs[0].relativePath,
    }, {
      sourcePath: specs[1].sourcePath,
      kind: 'code',
      candidateHandle: stagedB.candidateHandle,
      sourceRevision: 0,
      producer,
      operations: [specs[1].operation],
      textMetadata: metadata,
      batchId: failedBatchId,
      relativePath: specs[1].relativePath,
      crossFileDependencies: [{
        operationId: specs[1].operationId,
        dependsOnRelativePath: specs[0].relativePath,
        dependsOnOperationId: specs[0].operationId,
      }],
    }] }), /ARTIFACT_(CODE_REPLAY_MISMATCH|UNDECLARED_DIFFERENCE)/)
    assert.deepEqual(events, [], 'failed batches never publish a partially opened draft')
    assert.equal(await service.findDraftByDocument(specs[0].sourcePath), null)
    await assert.rejects(service.createDraft({
      sourcePath: specs[0].sourcePath,
      kind: 'code',
      candidateHandle: stagedA.candidateHandle,
      sourceRevision: 0,
      producer,
      operations: [specs[0].operation],
      textMetadata: metadata,
    }), /ARTIFACT_CANDIDATE_HANDLE_UNKNOWN/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  await verifyValidationAndOrdering()
  await verifyDecisionsAndCommandStack()
  await verifyAtomicAcceptanceAndConflict()
  await verifyPersistentHistory()
  await verifyDraftSessionRestoration()
  await verifyHistoryReopenAndWithdrawal()
  await verifyFormatAwareHistoryRebase()
  await verifyFourFormatDifferenceMapping()
  await verifyCodeDifferenceMappingAndHistory()
  await verifyCodeWorkspaceHandles()
  await verifyCrossFileDependencyCascade()
  console.log('PASS artifact schema, decisions, history, rebase, and five-format difference mapping')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
