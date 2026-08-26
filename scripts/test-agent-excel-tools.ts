import assert from 'node:assert/strict'
import { executeTool } from '../electron/services/agent-orchestrator'
import type { AgentConfig, AgentCollaborationEvent } from '../src/types/agent'
import type { AgentEditCommand } from '../electron/services/onlyoffice.service'

const agent: AgentConfig = {
  id: 'excel-agent',
  name: 'Excel Agent',
  role: 'Spreadsheet specialist',
  systemPrompt: '',
  providerId: 'test-provider',
  model: 'test-model',
  color: '#16a34a',
  enabled: true,
}

async function main(): Promise<void> {
  const commands: AgentEditCommand[] = []
  const events: AgentCollaborationEvent[] = []
  const onEdit = async (command: AgentEditCommand) => {
    commands.push(command)
    return { success: true, action: command.action }
  }
  const context = {
    runId: 'excel-tool-run',
    agent,
    onEvent: (event: AgentCollaborationEvent) => events.push(event),
  }

  const search = await executeTool('search_excel_functions', {
    query: '条件求和',
    category: 'aggregate-statistical',
    limit: 10,
  }, onEdit, context) as any
  assert.equal(search.success, true)
  assert.equal(search.catalogVersion, 'excel-curated-v1')
  assert.equal(search.functions[0].name, 'SUMIF')
  assert.equal(search.functions[0].verified, true)
  assert.equal(commands.length, 0, 'catalog search must not mutate the document')

  const invalidCategory = await executeTool('search_excel_functions', {
    category: 'unknown-category',
  }, onEdit, context) as any
  assert.equal(invalidCategory.success, false)
  assert.equal(invalidCategory.error, 'INVALID_EXCEL_FUNCTION_CATEGORY')

  await executeTool('read_excel_range', {
    sheet: 'Sheet1',
    range: 'A1:D20',
  }, onEdit, context)
  await executeTool('set_excel_formula', {
    sheet: 'Sheet1',
    target: 'D2:D100',
    formula: '=SUM(A2:C2)',
  }, onEdit, context)

  assert.equal(commands[0].action, 'readExcelRange')
  assert.equal(commands[0].sheet, 'Sheet1')
  assert.equal(commands[0].range, 'A1:D20')
  assert.equal(commands[1].action, 'setExcelFormula')
  assert.equal(commands[1].target, 'D2:D100')
  assert.equal(commands[1].formula, '=SUM(A2:C2)')
  assert.ok(commands.every((command) => command.operationId && command.runId === 'excel-tool-run'))
  assert.equal(events.length, 0, 'the document bridge is the only source of actual operation events')

  console.log('PASS Agent Excel function search, range read, and formula-write protocol mapping')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
