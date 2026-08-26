import { getDocKind } from '@/lightweight-office/utils/file-io'
import { useEditorStore } from '@/stores/editor.store'
import { TopBar } from './TopBar'
import { ResizableThreeColumnLayout } from './resize/ResizableThreeColumnLayout'
import { BottomPanel } from './BottomPanel'
import {
  AgentAssistantModule,
  DocumentEditorModule,
  FileManagerModule,
} from './modules'

function CodeBottomPanel() {
  const currentFile = useEditorStore((state) => state.currentFile)
  const codeFileActive = Boolean(currentFile && getDocKind(currentFile) === 'code')

  return (
    <div
      className={codeFileActive ? 'flex shrink-0 flex-col' : 'hidden'}
      aria-hidden={!codeFileActive}
    >
      <BottomPanel />
    </div>
  )
}

export function AppLayout() {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <ResizableThreeColumnLayout
        left={({ collapseLeft }) => <FileManagerModule onCollapse={collapseLeft} />}
        center={(
          <>
            <DocumentEditorModule />
            <CodeBottomPanel />
          </>
        )}
        right={({ collapseRight }) => <AgentAssistantModule onCollapse={collapseRight} />}
      />
    </div>
  )
}
