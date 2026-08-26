import assert from 'node:assert';
import {
  insertHtmlTableAtSelection,
  findTableRegions,
  replaceTableInSource,
  removeTableFromSource,
  renderPlainTextTableDocument,
  buildHtmlTable,
  shouldRecoverSyntaxEditMode,
} from '../src/lightweight-office/editors/notepad-tables';

console.log('--- Running Multi-Table Test Suite ---');

// SCENARIO 1: Document with 0 tables - inserting 1st table
{
  const doc = '# Empty doc\n\nSome paragraph text here.';
  const pos = doc.indexOf('Some paragraph');
  const res = insertHtmlTableAtSelection(doc, pos, pos, 2, 2, 'data-notepad-new-table="true"');
  
  assert(res.source.includes('data-notepad-new-table="true"'), 'New table has unique identifier');
  const tables = findTableRegions(res.source);
  assert.strictEqual(tables.length, 1, 'Exactly 1 table region detected');
  assert.strictEqual(tables[0].start, res.tableStart, 'Table starts at insertion tableStart');
  console.log('✔ Scenario 1 Passed: Single table insertion');
}

// SCENARIO 2: Document with 1 existing table - inserting 2nd table AFTER existing table
{
  const docWithTable = '# Title\n\n<table class="notepad-md-table"><tbody><tr><td>T1</td></tr></tbody></table>\n\nMiddle text here.\n\nEnd of doc.';
  const insertPos = docWithTable.indexOf('Middle text');
  const res = insertHtmlTableAtSelection(docWithTable, insertPos, insertPos, 3, 3, 'data-notepad-new-table="true"');
  
  const tables = findTableRegions(res.source);
  assert.strictEqual(tables.length, 2, 'Exactly 2 tables detected');
  
  // The new table should be the 2nd table (index 1)
  const newTableIndex = tables.findIndex(t => t.start === res.tableStart);
  assert.strictEqual(newTableIndex, 1, 'New table is located at index 1');
  
  // Verify Table 1 (first table) is still completely intact
  const firstTableSource = res.source.slice(tables[0].start, tables[0].end);
  assert(firstTableSource.includes('<td>T1</td>'), 'First table content preserved');
  console.log('✔ Scenario 2 Passed: Inserting 2nd table after existing table');
}

// SCENARIO 3: Document with 1 existing table - inserting 2nd table BEFORE existing table
{
  const docWithTable = '# Top Section\n\nIntro text\n\n<table class="notepad-md-table"><tbody><tr><td>Existing</td></tr></tbody></table>\n\nBottom text';
  const insertPos = docWithTable.indexOf('Intro text');
  const res = insertHtmlTableAtSelection(docWithTable, insertPos, insertPos, 2, 4, 'data-notepad-new-table="true"');
  
  const tables = findTableRegions(res.source);
  assert.strictEqual(tables.length, 2, 'Exactly 2 tables detected');
  
  // The new table should be the 1st table (index 0)
  const newTableIndex = tables.findIndex(t => t.start === res.tableStart);
  assert.strictEqual(newTableIndex, 0, 'New table is located at index 0');
  
  // The existing table is now table index 1
  const secondTableSource = res.source.slice(tables[1].start, tables[1].end);
  assert(secondTableSource.includes('<td>Existing</td>'), 'Existing table preserved at index 1');
  console.log('✔ Scenario 3 Passed: Inserting 2nd table before existing table');
}

// SCENARIO 4: Document with multiple tables - inserting a 3rd table in the middle
{
  const multiDoc = '# Header\n\n<table class="notepad-md-table"><tbody><tr><td>Table A</td></tr></tbody></table>\n\nBetween A and B\n\n<table class="notepad-md-table"><tbody><tr><td>Table B</td></tr></tbody></table>\n\nAfter B';
  const insertPos = multiDoc.indexOf('Between A and B');
  const res = insertHtmlTableAtSelection(multiDoc, insertPos, insertPos, 2, 2, 'data-notepad-new-table="true"');
  
  const tables = findTableRegions(res.source);
  assert.strictEqual(tables.length, 3, 'Exactly 3 tables detected');
  
  const newTableIndex = tables.findIndex(t => t.start === res.tableStart);
  assert.strictEqual(newTableIndex, 1, 'New table is located at middle index 1');
  
  assert(res.source.slice(tables[0].start, tables[0].end).includes('Table A'), 'Table A intact');
  assert(res.source.slice(tables[1].start, tables[1].end).includes('data-notepad-new-table="true"'), 'Table in middle is new table');
  assert(res.source.slice(tables[2].start, tables[2].end).includes('Table B'), 'Table B intact');
  console.log('✔ Scenario 4 Passed: Inserting table in the middle of existing tables');
}

// SCENARIO 5: Editing Table B in a multi-table document without corrupting Table A or Table C
{
  const multiDoc = '<table class="notepad-md-table"><tbody><tr><td>Table A</td></tr></tbody></table>\n\n<table class="notepad-md-table"><tbody><tr><td>Table B</td></tr></tbody></table>\n\n<table class="notepad-md-table"><tbody><tr><td>Table C</td></tr></tbody></table>';
  
  const updatedDoc = replaceTableInSource(
    multiDoc,
    1,
    '<table class="notepad-md-table"><tbody><tr><td>Table B MODIFIED</td></tr></tbody></table>'
  );
  
  const tables = findTableRegions(updatedDoc);
  assert.strictEqual(tables.length, 3, 'Still 3 tables');
  assert(updatedDoc.slice(tables[0].start, tables[0].end).includes('Table A'), 'Table A unchanged');
  assert(updatedDoc.slice(tables[1].start, tables[1].end).includes('Table B MODIFIED'), 'Table B correctly updated');
  assert(updatedDoc.slice(tables[2].start, tables[2].end).includes('Table C'), 'Table C unchanged');
  console.log('✔ Scenario 5 Passed: Isolated multi-table editing');
}

// SCENARIO 6: Removing Table B in a multi-table document
{
  const multiDoc = '<table class="notepad-md-table"><tbody><tr><td>Table A</td></tr></tbody></table>\n\nMiddle text\n\n<table class="notepad-md-table"><tbody><tr><td>Table B</td></tr></tbody></table>\n\nEnd text';
  
  const docAfterRemoval = removeTableFromSource(multiDoc, 0);
  const tables = findTableRegions(docAfterRemoval);
  assert.strictEqual(tables.length, 1, 'Only 1 table left');
  assert(docAfterRemoval.slice(tables[0].start, tables[0].end).includes('Table B'), 'Remaining table is Table B');
  assert(docAfterRemoval.includes('Middle text'), 'Middle text preserved');
  console.log('✔ Scenario 6 Passed: Removing specific table by index');
}

// SCENARIO 7: Plain text multi-table rendering has data-notepad-table-index tags
{
  const txtDoc = 'Line 1\n<table class="notepad-md-table"><tbody><tr><td>T1</td></tr></tbody></table>\nLine 2\n<table class="notepad-md-table"><tbody><tr><td>T2</td></tr></tbody></table>\nLine 3';
  const html = renderPlainTextTableDocument(txtDoc);
  assert(html.includes('data-notepad-table-index="0"'), 'First table tagged with index 0');
  assert(html.includes('data-notepad-table-index="1"'), 'Second table tagged with index 1');
  console.log('✔ Scenario 7 Passed: Plain text data-notepad-table-index tagging');
}

// SCENARIO 8: Markdown formatted view mode persistence
{
  assert.strictEqual(shouldRecoverSyntaxEditMode('', 'formatted', 'markdown'), false);
  assert.strictEqual(shouldRecoverSyntaxEditMode('# Title', 'formatted', 'markdown'), false);
  assert.strictEqual(shouldRecoverSyntaxEditMode('No table here', 'formatted', 'markdown'), false);
  assert.strictEqual(shouldRecoverSyntaxEditMode('No table here', 'formatted', 'plain'), true);
  console.log('✔ Scenario 8 Passed: Markdown formatted view mode persistence');
}

console.log('\n========================================');
console.log('ALL 8 MULTI-TABLE SCENARIOS PASSED WITH 100% SUCCESS!');
console.log('========================================\n');
