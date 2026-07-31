import { OnlyOfficeEditor } from '@/components/editor/OnlyOfficeEditor'
import {
  LIGHTWEIGHT_OFFICE_ENABLED,
  LightweightDocumentEditor,
} from '@/lightweight-office'
import { DocumentZoom } from './DocumentZoom'

/** 模块 2：文档预览 / 编辑（按优先级选择后端） */
export function DocumentEditorModule() {
  const Editor = LIGHTWEIGHT_OFFICE_ENABLED
    ? LightweightDocumentEditor
    : OnlyOfficeEditor

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
      {/* 缩放仅作用于中间文档区，左右侧栏不受影响 */}
      <DocumentZoom>
        <Editor />
      </DocumentZoom>
    </div>
  )
}