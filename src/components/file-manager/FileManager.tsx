import { desktopApi } from '@/platform'
import { useEffect, useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, FolderOpen, Home, PanelLeftClose } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useFileStore } from '@/stores/file.store'
import { useTranslation } from '@/lib/i18n/runtime'
import { useEditorStore } from '@/stores/editor.store'
import { useFileSessionStore } from '@/stores/file-session.store'
import { FileTree } from './FileTree'
import { RecentFiles } from './RecentFiles'
import { FileSearch } from './FileSearch'
import { isImageFile } from '@/lightweight-office/utils/file-io'

const DIRECTORY_BACK_HISTORY_MAX = 100

// 鼠标侧键中的「后退」键（X1）。X2（前进）为 4。
const MOUSE_BACK_BUTTON = 3

function sameDirectoryPath(left: string, right: string): boolean {
  return desktopApi.app.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

const homeMenuContentClass =
  'z-[10000] min-w-[240px] max-w-[320px] rounded-xl border border-border bg-popover p-1.5 text-[13px] text-popover-foreground shadow-lg'

const homeMenuItemClass =
  'flex h-7 cursor-default select-none items-center gap-2 rounded-md px-2.5 text-xs outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground'

interface FileManagerProps {
  /** 折叠左侧文件管理器侧栏 */
  onCollapse?: () => void
}

export function FileManager({ onCollapse }: FileManagerProps) {
  const { t } = useTranslation()
  const {
    currentDir, entries, recentFiles, searchQuery, searchResults, isSearching,
    setCurrentDir, setEntries, setRecentFiles, setSearchQuery, setSearchResults, setIsSearching,
  } = useFileStore()
  const { setCurrentFile } = useEditorStore()
  const sessionHydrated = useFileSessionStore((state) => state.hydrated)
  const mainDirectory = useFileSessionStore((state) => state.mainDirectory)
  const recentDirectories = useFileSessionStore((state) => state.recentDirectories)
  const setSessionMainDirectory = useFileSessionStore((state) => state.setMainDirectory)
  const visitSessionDirectory = useFileSessionStore((state) => state.visitDirectory)
  const loadRequestRef = useRef(0)
  const dirBackStackRef = useRef<string[]>([])
  const lastBackInputRef = useRef<{ source: 'native' | 'dom'; at: number } | null>(null)
  const [activeTab, setActiveTab] = useState<'browse' | 'recent'>('browse')
  const [systemHome, setSystemHome] = useState<string | null>(null)
  const [homeMenuOpen, setHomeMenuOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void desktopApi.files.getHome().then((home) => {
      if (!cancelled) setSystemHome(home.path)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const loadDir = useCallback(async (dir: string, options?: { recordHistory?: boolean }) => {
    const requestId = ++loadRequestRef.current
    const list = await desktopApi.files.list(dir)
    if (requestId !== loadRequestRef.current) return
    const previousDir = useFileStore.getState().currentDir
    if (
      options?.recordHistory !== false
      && previousDir
      && !sameDirectoryPath(previousDir, dir)
    ) {
      dirBackStackRef.current.push(previousDir)
      if (dirBackStackRef.current.length > DIRECTORY_BACK_HISTORY_MAX) {
        dirBackStackRef.current.shift()
      }
    }
    setEntries(list)
    setCurrentDir(dir)
    visitSessionDirectory(dir)
  }, [setCurrentDir, setEntries, visitSessionDirectory])

  const openFile = useCallback(async (filePath: string) => {
    console.log('[FileManager] 打开文件:', filePath)
    // 图片等文件交给系统默认应用打开（如系统“照片”或“画图”），
    // 不在内置编辑器中渲染。
    if (isImageFile(filePath)) {
      void desktopApi.files.openExternal(filePath)
      const recent = await desktopApi.files.getRecent()
      setRecentFiles(recent)
      return
    }
    // 立即切换文件渲染编辑器，最近文件/快照在后台记录
    await desktopApi.files.open(filePath)
    setCurrentFile(filePath)
    const recent = await desktopApi.files.getRecent()
    setRecentFiles(recent)
  }, [setCurrentFile, setRecentFiles])

  useEffect(() => {
    if (!sessionHydrated) return
    let cancelled = false
    const initialRequestId = loadRequestRef.current

    async function init() {
      const home = await desktopApi.files.getHome()
      const recent = await desktopApi.files.getRecent()
      if (cancelled) return
      setRecentFiles(recent)
      if (
        loadRequestRef.current !== initialRequestId
        || useFileStore.getState().currentDir
      ) return
      const session = useFileSessionStore.getState()
      const targetDir = [session.currentDirectory, session.mainDirectory, home.path]
        .find((directory): directory is string => (
          Boolean(directory && desktopApi.files.getGrantId(directory))
        )) ?? home.path
      await loadDir(targetDir, { recordHistory: false })
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [loadDir, sessionHydrated, setRecentFiles])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      setIsSearching(true)
      try {
        const results = await desktopApi.files.search(currentDir, searchQuery)
        setSearchResults(results)
      } finally {
        setIsSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, currentDir, setSearchResults, setIsSearching])

  const goUp = () => {
    const sep = desktopApi.app.platform === 'win32' ? '\\' : '/'
    const parts = currentDir.split(sep)
    if (parts.length > 1) {
      parts.pop()
      const parent = parts.join(sep) || sep
      if (desktopApi.files.getGrantId(parent)) void loadDir(parent)
    }
  }

  const goBackToPreviousDir = useCallback((source: 'native' | 'dom') => {
    const now = performance.now()
    const lastInput = lastBackInputRef.current
    if (lastInput && lastInput.source !== source && now - lastInput.at < 200) return
    lastBackInputRef.current = { source, at: now }

    const current = useFileStore.getState().currentDir
    let previousDir = dirBackStackRef.current.pop()
    while (previousDir && sameDirectoryPath(previousDir, current)) {
      previousDir = dirBackStackRef.current.pop()
    }
    if (!previousDir) return
    void loadDir(previousDir, { recordHistory: false })
  }, [loadDir])

  useEffect(() => {
    if (activeTab !== 'browse') return
    return desktopApi.files.onNavigateBack(() => goBackToPreviousDir('native'))
  }, [activeTab, goBackToPreviousDir])

  // DOM auxclick covers platforms/drivers which expose X1 as the fourth button.
  const handleBrowseTabAuxClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== MOUSE_BACK_BUTTON) return
    event.preventDefault()
    goBackToPreviousDir('dom')
  }, [goBackToPreviousDir])

  const effectiveMainDirectory = mainDirectory ?? systemHome

  const applyMainDirectory = useCallback((dir: string) => {
    setSessionMainDirectory(dir)
    setHomeMenuOpen(false)
    void loadDir(dir)
  }, [loadDir, setSessionMainDirectory])

  const handleHomeClick = useCallback(() => {
    setHomeMenuOpen(false)
    if (effectiveMainDirectory) void loadDir(effectiveMainDirectory)
  }, [effectiveMainDirectory, loadDir])

  const handleHomeContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    setHomeMenuOpen(true)
  }, [])

  const chooseHomeFolder = useCallback(async () => {
    const folder = await desktopApi.files.selectFolder()
    if (folder) applyMainDirectory(folder.path)
  }, [applyMainDirectory])

  return (
    <TooltipProvider delayDuration={450}>
      <aside className="flex h-full min-h-0 w-full flex-col">
        <div className="flex items-center justify-between gap-1 px-1.5 py-1.5">
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
                <TooltipContent side="bottom" className="whitespace-nowrap rounded-xl border bg-popover px-3.5 py-1.5 text-center text-[12px] font-medium text-popover-foreground shadow-md">
                  {t('appShell.collapseFileManager')}
                </TooltipContent>
              </Tooltip>
            )}
            <span className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('appShell.fileManager')}
            </span>
          </div>
          <div className="flex shrink-0 gap-1">
            <Tooltip open={homeMenuOpen ? false : undefined}>
              <DropdownMenu.Root open={homeMenuOpen} onOpenChange={setHomeMenuOpen} modal={false}>
                <DropdownMenu.Trigger
                  asChild
                  onPointerDown={(event) => {
                    if (event.button === 0) event.preventDefault()
                  }}
                >
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={handleHomeClick}
                      onContextMenu={handleHomeContextMenu}
                      aria-label={t('appShell.homeDirectory')}
                      data-testid="file-manager-home-button"
                    >
                      <Home className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    sideOffset={2}
                    align="start"
                    className={homeMenuContentClass}
                    data-testid="home-directory-menu"
                    onCloseAutoFocus={(event) => event.preventDefault()}
                  >
                    <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                      <Home className="h-3.5 w-3.5" />
                      <span className="truncate">{t('appShell.homeMenuTitle')}</span>
                    </div>
                    <DropdownMenu.Item
                      className={homeMenuItemClass}
                      disabled={!systemHome}
                      onSelect={() => { if (systemHome) applyMainDirectory(systemHome) }}
                      data-testid="home-menu-default"
                    >
                      <span className="flex w-4 shrink-0 items-center justify-center">
                        {Boolean(effectiveMainDirectory && systemHome && sameDirectoryPath(effectiveMainDirectory, systemHome))
                          && <Check className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{t('appShell.homeDefaultDirectory')}</span>
                    </DropdownMenu.Item>

                    <DropdownMenu.Separator className="my-1 h-px bg-border" />

                    <div className="px-2 py-1 text-xs text-muted-foreground">
                      {t('appShell.homeRecentDirectories')}
                    </div>
                    {recentDirectories.length === 0 ? (
                      <DropdownMenu.Item className={homeMenuItemClass} disabled data-testid="home-menu-no-recent">
                        {t('appShell.homeNoRecent')}
                      </DropdownMenu.Item>
                    ) : (
                      recentDirectories.slice(0, 8).map((dir, index) => (
                        <DropdownMenu.Item
                          key={dir}
                          className={homeMenuItemClass}
                          onSelect={() => applyMainDirectory(dir)}
                          data-testid={`home-menu-recent-${index}`}
                        >
                          <span className="flex w-4 shrink-0 items-center justify-center">
                            {Boolean(effectiveMainDirectory && sameDirectoryPath(effectiveMainDirectory, dir))
                              && <Check className="h-4 w-4" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate" title={dir}>{dir}</span>
                        </DropdownMenu.Item>
                      ))
                    )}

                    <DropdownMenu.Separator className="my-1 h-px bg-border" />

                    <DropdownMenu.Item
                      className={homeMenuItemClass}
                      onSelect={() => { void chooseHomeFolder() }}
                      data-testid="home-menu-choose-folder"
                    >
                      <span className="flex w-4 shrink-0 items-center justify-center">
                        <FolderOpen className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{t('appShell.homeChooseFolder')}</span>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <TooltipContent side="bottom" className="whitespace-nowrap rounded-xl border bg-popover px-3.5 py-1.5 text-center text-[12px] font-medium text-popover-foreground shadow-md">
                {t('appShell.homeDirectory')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={async () => {
                  const folder = await desktopApi.files.selectFolder()
                  if (folder) loadDir(folder.path)
                }} aria-label={t('appShell.openFolder')}>
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="whitespace-nowrap rounded-xl border bg-popover px-3.5 py-1.5 text-center text-[12px] font-medium text-popover-foreground shadow-md">
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

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'browse' | 'recent')} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabsList className="mx-1.5 mt-1.5 mb-1.5 grid h-9 w-auto shrink-0 grid-cols-2">
          <TabsTrigger value="browse" className="text-sm font-medium py-1">{t('appShell.browse')}</TabsTrigger>
          <TabsTrigger value="recent" className="text-sm font-medium py-1">{t('appShell.recent')}</TabsTrigger>
        </TabsList>

        {/*
          仅在 active 时使用 display:flex。
          若写死 flex，会覆盖 Radix 的 hidden，导致「浏览/最近」同时占位，
          「最近」上方出现一大块黑色空白。
        */}
        <TabsContent
          value="browse"
          className="m-0 mt-0 p-0 min-h-0 flex-1 flex-col overflow-hidden data-[state=active]:flex"
          onAuxClick={handleBrowseTabAuxClick}
        >
          <div className="shrink-0 px-1.5 py-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="block max-w-full truncate text-left text-sm text-primary hover:underline font-medium"
                  onClick={goUp}
                >
                  {currentDir}
                </button>
              </TooltipTrigger>
              {/* 路径可能很长：不加 whitespace-nowrap，让基础样式 max-w-xs break-words 换行 */}
              <TooltipContent side="bottom" className="rounded-xl border-0 bg-[#555] px-3 py-2 text-left text-[14.5px] font-medium leading-normal text-white shadow-md">
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
