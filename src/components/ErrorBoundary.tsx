import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '@/lib/i18n/translate'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

/**
 * 兜底错误边界：任何渲染期异常若无人捕获，React 18 会卸载整棵组件树，
 * 窗口只剩 body 背景色（亮色=白、暗色=黑）。这里把崩溃转成可见的错误
 * 界面并保留堆栈，用户可以直接复制反馈，而不是面对一块空白。
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary] render crash:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const dark = document.documentElement.classList.contains('dark')
    const detail = error.stack || String(error)
    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          height: '100vh',
          padding: 24,
          background: dark ? '#161a1f' : '#f6f6f6',
          color: dark ? '#e8e8e8' : '#1f1f1f',
          fontFamily: 'system-ui, "Segoe UI", sans-serif',
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>{t('errorBoundary.title')}</h1>
        <p style={{ fontSize: 13, opacity: 0.75 }}>{t('errorBoundary.description')}</p>
        <pre
          style={{
            maxHeight: '40vh',
            maxWidth: 'min(720px, 90vw)',
            overflow: 'auto',
            padding: 12,
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: dark ? '#0d1014' : '#ffffff',
            border: dark ? '1px solid #2a2f36' : '1px solid #ddd',
          }}
          dir="ltr"
        >
          {detail}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '6px 18px',
            borderRadius: 6,
            fontSize: 13,
            cursor: 'pointer',
            color: '#ffffff',
            background: '#2563eb',
            border: 'none',
          }}
        >
          {t('errorBoundary.reload')}
        </button>
      </div>
    )
  }
}
