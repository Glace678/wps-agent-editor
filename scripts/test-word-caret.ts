import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

// 1. 验证 word-editor.css 中 WPS / Office 风格光标样式规则与动画
{
  const css = read('src/lightweight-office/word-editor.css')

  assert.match(
    css,
    /\.word-editor-panel\s+\.ProseMirror\s*\{[^}]*caret-color:\s*#000000\s*!important/i,
    'ProseMirror must have pure black caret-color: #000000 !important default',
  )

  assert.match(
    css,
    /\.word-editor-panel\[data-wps-caret-active=['"]true['"]\]\s+\.ProseMirror\s*\{[^}]*caret-color:\s*transparent\s*!important/i,
    'ProseMirror must set caret-color to transparent when custom WPS caret is active to prevent dual carets',
  )

  assert.match(
    css,
    /\.wps-word-caret\s*\{[^}]*background-color:\s*#000000/i,
    'wps-word-caret must use pure black #000000 background color',
  )

  assert.match(
    css,
    /@keyframes\s+wps-word-caret-blink/i,
    'wps-word-caret-blink keyframe animation must be defined',
  )

  assert.match(
    css,
    /\.wps-word-caret--typing\s*\{[^}]*opacity:\s*1\s*!important/i,
    'wps-word-caret--typing must stay solid opaque during typing',
  )
}

// 2. 验证 WordCaret 组件实现
{
  const component = read('src/lightweight-office/components/WordCaret.tsx')

  assert.match(
    component,
    /export\s+function\s+WordCaret/i,
    'WordCaret must be exported as a React functional component',
  )

  assert.match(
    component,
    /wps-word-caret/i,
    'WordCaret must render wps-word-caret class name',
  )

  assert.match(
    component,
    /data-wps-caret-active/i,
    'WordCaret must manage data-wps-caret-active attribute on editor root',
  )
}

// 3. 验证 WordEditor 集成
{
  const editor = read('src/lightweight-office/editors/WordEditor.tsx')

  assert.match(
    editor,
    /import\s*\{\s*WordCaret\s*\}\s*from\s*'\.\.\/components\/WordCaret'/i,
    'WordEditor must import WordCaret',
  )

  assert.match(
    editor,
    /<WordCaret\s+editorRootRef=\{editorRootRef\}/i,
    'WordEditor must render WordCaret with editorRootRef',
  )
}

console.log('PASS WPS/Office Word Caret assertions passed')
