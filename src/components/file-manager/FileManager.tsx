import { useEffect, useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, FolderOpen, Home, PanelLeftClose, RefreshCw } from 'lucide-react'
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

const MAIN_DIRECTORY_KEY = 'wps-main-directory'
const RECENT_DIRECTORIES_KEY = 'wps-recent-directories'
const RECENT_DIRECTORIES_MAX = 10

function loadMainDirectory(): string | null {
  try {
    return localStorage.getItem(MAIN_DIRECTORY_KEY)
  } catch {
    return null
  }
}

function loadRecentDirectories(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_DIRECTORIES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function saveRecentDirectories(directories: string[]): void {
  try {
    localStorage.setItem(RECENT_DIRECTORIES_KEY, JSON.stringify(directories))
  } catch {
    // ignore
  }
}

function sameDirectoryPath(left: string, right: string): boolean {
  return window.api.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

const homeMenuContentClass =
  'z-[10000] min-w-[240px] max-w-[320px] rounded-[4px] border border-black/15 bg-card p-1 text-[13px] text-card-foreground shadow-xl dark:border-white/15'

const homeMenuItemClass =
  'flex h-8 cursor-default select-none items-center gap-2 rounded-[3px] px-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-black/[0.07] dark:data-[highlighted]:bg-white/[0.08]'

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
  const loadRequestRef = useRef(0)
  const [systemHome, setSystemHome] = useState<string | null>(null)
  const [mainDirectory, setMainDirectory] = useState<string | null>(loadMainDirectory)
  const [recentDirectories, setRecentDirectories] = useState<string[]>(loadRecentDirectories)
  const [homeMenuOpen, setHomeMenuOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.file.getHome().then((home) => {
      if (!cancelled) setSystemHome(home)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const recordRecentDirectory = useCallback((dir: string) => {
    setRecentDirectories((previous) => {
      const next = [dir, ...previous.filter((item) => !sameDirectoryPath(item, dir))]
        .slice(0, RECENT_DIRECTORIES_MAX)
      saveRecentDirectories(next)
      return next
    })
  }, [])

  const loadDir = useCallback(async (dir: string) => {
    const requestId = ++loadRequestRef.current
    setLoading(true)
    try {
      const list = await window.api.file.list(dir)
      if (requestId !== loadRequestRef.current) return
      setEntries(list)
      setCurrentDir(dir)
      recordRecentDirectory(dir)
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false)
    }
  }, [recordRecentDirectory, setCurrentDir, setEntries, setLoading])

  const openFile = useCallback(async (filePath: string) => {
    console.log('[FileManager] 打开文件:', filePath)
    await window.api.file.open(filePath)
    setCurrentFile(filePath)
    const recent = await window.api.file.getRecent()
    setRecentFiles(recent)
  }, [setCurrentFile, setRecentFiles])

  useEffect(() => {
    let cancelled = false
    const initialRequestId = loadRequestRef.current

    async function init() {
      const home = await window.api.file.getHome()
      const recent = await window.api.file.getRecent()
      if (cancelled) return
      setRecentFiles(recent)
      if (
        loadRequestRef.current !== initialRequestId
        || useFileStore.getState().currentDir
      ) return
      const savedDir = localStorage.getItem('last-browse-dir')
      const targetDir = savedDir || (home + (window.api.platform === 'win32' ? '\\Documents' : '/Documents'))
      await loadDir(targetDir)
    }
    void init()
    return () => {
      cancelled = true
    }
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

  const effectiveMainDirectory = mainDirectory ?? systemHome

  const applyMainDirectory = useCallback((dir: string) => {
    setMainDirectory(dir)
    try {
      localStorage.setItem(MAIN_DIRECTORY_KEY, dir)
    } catch {
      // ignore
    }
    setHomeMenuOpen(false)
    void loadDir(dir)
  }, [loadDir])

  const handleHomeClick = useCallback(() => {
    setHomeMenuOpen(false)
    if (effectiveMainDirectory) void loadDir(effectiveMainDirectory)
  }, [effectiveMainDirectory, loadDir])

  const handleHomeContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    setHomeMenuOpen(true)
  }, [])

  const chooseHomeFolder = useCallback(async () => {
    const folder = await window.api.file.selectFolder()
    if (folder) applyMainDirectory(folder)
  }, [applyMainDirectory])

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
                <DropdownMenu.Root open={homeMenuOpen} onOpenChange={setHomeMenuOpen} modal={false}>
                  <DropdownMenu.Trigger
                    asChild
                    onPointerDown={(event) => {
                      if (event.button === 0) event.preventDefault()
                    }}
                  >
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
