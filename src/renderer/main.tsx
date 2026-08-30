import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import '@/index.css'
import { initializeLanguage } from '@/lib/i18n/runtime'
import { syncNativeThemePreference } from '@/lib/theme'
import { AppErrorBoundary } from '@/components/ErrorBoundary'
initializeLanguage()
syncNativeThemePreference()

// 白屏排查依据：未捕获异常与 promise 拒绝统一落到控制台，
// 现场只需打开 DevTools 即可拿到堆栈。
window.addEventListener('error', (event) => {
  console.error('[renderer] uncaught error:', event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer] unhandled rejection:', event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)
