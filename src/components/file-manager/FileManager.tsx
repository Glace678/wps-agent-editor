import { useEffect, useCallback } from 'react'
import { FolderOpen, Home, PanelLeftClose, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useFileStore } from '@/stores/file.store'
import { useTranslation } from '@/lib/i18n/runtime'
import { useEditorStore } from '@/stores/editor.store'
import { FileTree } from './FileTree'
import { RecentFiles } from './RecentFiles'
import { FileSearch } from './FileSearch'

interface FileManagerProps {
  /** 折叠左侧文件管理器侧栏 */
  onCollapse?: () => void
}

export function FileManager({ onCollapse }: FileManagerProps) {
  const { t } = useTranslation()
  const {
    currentDir, entries, recentFiles, searchQuery, searchResults, isSearching, loading,
    setCurrentDir, setEntries, setRecentFiles, setSearchQuery, setSearchResults, setIsSearching, setLoading,
  } = useFileStore()
  const { setCurrentFile } = useEditorStore()

  const loadDir = useCallback(async (dir: string) => {
    setLoading(true)
    try {
      const list = await window.api.file.list(dir)
      setEntries(list)
      setCurrentDir(dir)
    } finally {
      setLoading(false)
    }
  }, [setCurrentDir, setEntries, setLoading])

  const openFile = useCallback(async (filePath: string) => {
    console.log('[FileManager] 打开文件:', filePath)
    await window.api.file.open(filePath)
    setCurrentFile(filePath)
    const recent = await window.api.file.getRecent()
    setRecentFiles(recent)
  }, [setCurrentFile, setRecentFiles])

  useEffect(() => {
    async function init() {
      const home = await window.api.file.getHome()
      const recent = await window.api.file.getRecent()
      setRecentFiles(recent)
      const savedDir = localStorage.getItem('last-browse-dir')
      const targetDir = savedDir || (home + (window.api.platform === 'win32' ? '\\Documents' : '/Documents'))
      await loadDir(targetDir)
    }
    init()
  }, [loadDir, setRecentFiles])

  useEffect(() => {
    if (currentDir) {
      localStorage.setItem('last-browse-dir', currentDir)
    }
  }, [currentDir])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const results = await window.api.file.search(currentDir, searchQuery)
        setSearchResults(results)
      } finally {
        setIsSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, currentDir, setSearchResults, setIsSearching])

  const goUp = () => {
    const sep = window.api.platform === 'win32' ? '\\' : '/'
    const parts = currentDir.split(sep)
    if (parts.length > 1) {
      parts.pop()
      loadDir(parts.join(sep) || sep)
    }
  }

  return (
    <TooltipProvider delayDuration={450}>
      <aside className="flex h-full min-h-0 w-full flex-col">
        <div className="flex items-center justify-between gap-1 px-2 py-2">
          <div className="flex min-w-0 items-center gap-0.5">
            {onCollapse && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={onCollapse}
                    aria-label={t('appShell.collapseFileManager')}
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                  {t('appShell.collapseFileManager')}
                </TooltipContent>
              </Tooltip>
            )}
            <span className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('appShell.fileManager')}
            </span>
          </div>
          <div className="flex shrink-0 gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => loadDir(currentDir)}
                  aria-label={t('appShell.refresh')}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                {t('appShell.refresh')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={async () => {
                  const home = await window.api.file.getHome()
                  loadDir(home)
                }} aria-label={t('appShell.homeDirectory')}>
                  <Home className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                {t('appShell.homeDirectory')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={async () => {
                  const folder = await window.api.file.selectFolder()
                  if (folder) loadDir(folder)
                }} aria-label={t('appShell.openFolder')}>
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                {t('appShell.openFolder')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

      <FileSearch
        query={searchQuery}
        onQueryChange={setSearchQuery}
        results={searchResults}
        onOpen={openFile}
        isSearching={isSearching}
      />

      <Separator />

      <Tabs defaultValue="browse" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabsList className="mx-3 mt-2 mb-1 grid w-auto shrink-0 grid-cols-2">
          <TabsTrigger value="browse" className="text-xs">{t('appShell.browse')}</TabsTrigger>
          <TabsTrigger value="recent" className="text-xs">{t('appShell.recent')}</TabsTrigger>
        </TabsList>

        {/*
          仅在 active 时使用 display:flex。
          若写死 flex，会覆盖 Radix 的 hidden，导致「浏览/最近」同时占位，
          「最近」上方出现一大块黑色空白。
        */}
        <TabsContent
          value="browse"
          className="m-0 mt-0 p-0 min-h-0 flex-1 flex-col overflow-hidden data-[state=active]:flex"
        >
          <div className="shrink-0 px-3 py-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="block max-w-full truncate text-left text-xs text-primary hover:underline"
                  onClick={goUp}
                >
                  {currentDir}
                </button>
              </TooltipTrigger>
              {/* 路径可能很长：不加 whitespace-nowrap，让基础样式 max-w-xs break-words 换行 */}
              <TooltipContent side="bottom" className="rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-left text-[12px] leading-normal text-white shadow-none">
                {currentDir}
              </TooltipContent>
            </Tooltip>
          </div>
          {/*
            浏览列表用原生滚动；悬停完整名称由 FileHoverCard portal 到 body，
            避免 ScrollArea overflow 裁切弹层。
          */}
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <FileTree
              entries={entries}
              currentDir={currentDir}
              onOpenFile={openFile}
              onOpenDir={loadDir}
            />
          </div>
        </TabsContent>

        <TabsContent
          value="recent"
          className="m-0 mt-0 p-0 min-h-0 flex-1 flex-col overflow-hidden data-[state=active]:flex"
        >
          {/*
            最近列表用原生滚动，避免 Radix ScrollArea 的 overflow:hidden
            在列表边缘裁切悬停高亮/描边。弹层本身已 portal 到 body。
          */}
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <RecentFiles files={recentFiles} onOpen={openFile} />
          </div>
        </TabsContent>
      </Tabs>
    </aside>
    </TooltipProvider>
  )
}
