import { TopBar } from './TopBar'
import { ResizableThreeColumnLayout } from './resize/ResizableThreeColumnLayout'
import {
  AgentAssistantModule,
  DocumentEditorModule,
  FileManagerModule,
} from './modules'

export function AppLayout() {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <ResizableThreeColumnLayout
        left={({ collapseLeft }) => <FileManagerModule onCollapse={collapseLeft} />}
        center={<DocumentEditorModule />}
        right={({ collapseRight }) => <AgentAssistantModule onCollapse={collapseRight} />}
      />
    </div>
  )
}
