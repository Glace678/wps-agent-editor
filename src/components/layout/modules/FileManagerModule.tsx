import { FileManager } from '@/components/file-manager/FileManager'

interface FileManagerModuleProps {
  onCollapse?: () => void
}

/** 模块 1：文件管理器 */
export function FileManagerModule({ onCollapse }: FileManagerModuleProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-sidebar">
      <FileManager onCollapse={onCollapse} />
    </div>
  )
}