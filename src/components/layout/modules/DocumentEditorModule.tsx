import { LightweightDocumentEditor } from '@/lightweight-office'
import { DocumentZoom } from './DocumentZoom'

/** 模块 2：内置轻量文档预览与编辑。 */
export function DocumentEditorModule() {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
      {/* 缩放仅作用于中间文档区，左右侧栏不受影响 */}
      <DocumentZoom>
        <LightweightDocumentEditor />
      </DocumentZoom>
    </div>
  )
}
