import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

export interface RGB {
  r: number
  g: number
  b: number
}

export interface HSV {
  h: number // 0 - 360
  s: number // 0 - 1
  v: number // 0 - 1
}

export function hsvToRgb(h: number, s: number, v: number): RGB {
  const normH = ((h % 360) + 360) % 360
  const normS = Math.max(0, Math.min(1, s))
  const normV = Math.max(0, Math.min(1, v))

  const c = normV * normS
  const x = c * (1 - Math.abs(((normH / 60) % 2) - 1))
  const m = normV - c

  let rPrime = 0
  let gPrime = 0
  let bPrime = 0

  if (normH < 60) {
    rPrime = c
    gPrime = x
    bPrime = 0
  } else if (normH < 120) {
    rPrime = x
    gPrime = c
    bPrime = 0
  } else if (normH < 180) {
    rPrime = 0
    gPrime = c
    bPrime = x
  } else if (normH < 240) {
    rPrime = 0
    gPrime = x
    bPrime = c
  } else if (normH < 300) {
    rPrime = x
    gPrime = 0
    bPrime = c
  } else {
    rPrime = c
    gPrime = 0
    bPrime = x
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  }
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const normR = Math.max(0, Math.min(255, r)) / 255
  const normG = Math.max(0, Math.min(255, g)) / 255
  const normB = Math.max(0, Math.min(255, b)) / 255

  const max = Math.max(normR, normG, normB)
  const min = Math.min(normR, normG, normB)
  const delta = max - min

  let h = 0
  if (delta > 0) {
    if (max === normR) {
      h = 60 * (((normG - normB) / delta) % 6)
    } else if (max === normG) {
      h = 60 * ((normB - normR) / delta + 2)
    } else {
      h = 60 * ((normR - normG) / delta + 4)
    }
  }
  if (h < 0) h += 360

  const s = max === 0 ? 0 : delta / max
  const v = max

  return { h, s, v }
}

export function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

export function hexToRgb(hex: string): RGB | null {
  const cleaned = hex.trim().replace(/^#/, '')
  if (cleaned.length === 3) {
    const r = Number.parseInt(cleaned[0] + cleaned[0], 16)
    const g = Number.parseInt(cleaned[1] + cleaned[1], 16)
    const b = Number.parseInt(cleaned[2] + cleaned[2], 16)
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return { r, g, b }
  } else if (cleaned.length === 6) {
    const r = Number.parseInt(cleaned.slice(0, 2), 16)
    const g = Number.parseInt(cleaned.slice(2, 4), 16)
    const b = Number.parseInt(cleaned.slice(4, 6), 16)
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return { r, g, b }
  }
  return null
}

const WHEEL_SIZE = 148
const WHEEL_RADIUS = WHEEL_SIZE / 2 - 4

export interface ExcelCircularColorPickerProps {
  initialColor?: string
  onSelectColor?: (color: string) => void
  onConfirm?: (color: string) => void
  onReset?: () => void
}

export function ExcelCircularColorPicker({
  initialColor = '#7092BE',
  onSelectColor,
  onConfirm,
  onReset,
}: ExcelCircularColorPickerProps) {
  const initialRgb = useMemo(() => {
    return hexToRgb(initialColor) || { r: 112, g: 146, b: 190 }
  }, [initialColor])

  const initialHsv = useMemo(() => {
    return rgbToHsv(initialRgb.r, initialRgb.g, initialRgb.b)
  }, [initialRgb])

  const [hsv, setHsv] = useState<HSV>(initialHsv)
  const [hexInput, setHexInput] = useState<string>(() => rgbToHex(initialRgb))
  const [rgbState, setRgbState] = useState<RGB>(initialRgb)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sliderRef = useRef<HTMLDivElement>(null)
  const isDraggingWheel = useRef(false)
  const isDraggingSlider = useRef(false)

  const redInputId = useId()
  const greenInputId = useId()
  const blueInputId = useId()

  const currentRgb = useMemo(() => hsvToRgb(hsv.h, hsv.s, hsv.v), [hsv])
  const currentHex = useMemo(() => rgbToHex(currentRgb), [currentRgb])

  // Sync internal RGB state and Hex input when HSV changes
  useEffect(() => {
    setRgbState(currentRgb)
    setHexInput(currentHex)
    onSelectColor?.(currentHex)
  }, [currentRgb, currentHex, onSelectColor])

  // Render the circular color wheel canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = WHEEL_SIZE * dpr
    canvas.height = WHEEL_SIZE * dpr

    const imgData = ctx.createImageData(WHEEL_SIZE * dpr, WHEEL_SIZE * dpr)
    const data = imgData.data
    const cx = (WHEEL_SIZE * dpr) / 2
    const cy = (WHEEL_SIZE * dpr) / 2
    const rMax = WHEEL_RADIUS * dpr

    for (let y = 0; y < WHEEL_SIZE * dpr; y++) {
      for (let x = 0; x < WHEEL_SIZE * dpr; x++) {
        const dx = x - cx
        const dy = y - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        const index = (y * WHEEL_SIZE * dpr + x) * 4

        if (dist <= rMax) {
          let angle = Math.atan2(dy, dx) * (180 / Math.PI)
          if (angle < 0) angle += 360
          const sat = dist / rMax
          const rgb = hsvToRgb(angle, sat, 1)

          let alpha = 255
          if (dist > rMax - 1) {
            alpha = Math.max(0, Math.min(255, Math.round((rMax - dist) * 255)))
          }

          data[index] = rgb.r
          data[index + 1] = rgb.g
          data[index + 2] = rgb.b
          data[index + 3] = alpha
        } else {
          data[index + 3] = 0
        }
      }
    }

    ctx.putImageData(imgData, 0, 0)
  }, [])

  // Handle color selection on the wheel
  const handleWheelCoord = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = clientX - cx
    const dy = clientY - cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    const clampedDist = Math.min(dist, WHEEL_RADIUS)

    let angle = Math.atan2(dy, dx) * (180 / Math.PI)
    if (angle < 0) angle += 360
    const sat = clampedDist / WHEEL_RADIUS

    setHsv((prev) => ({
      ...prev,
      h: angle,
      s: sat,
      // If brightness was 0 (pure black), boost to 0.85 when picking a new hue on the wheel
      v: prev.v < 0.1 ? 0.85 : prev.v,
    }))
  }, [])

  // Handle brightness slider interaction
  const handleSliderCoord = useCallback((clientY: number) => {
    const slider = sliderRef.current
    if (!slider) return
    const rect = slider.getBoundingClientRect()
    const y = clientY - rect.top
    const ratio = Math.max(0, Math.min(1, y / rect.height))
    const v = 1 - ratio

    setHsv((prev) => ({
      ...prev,
      v,
    }))
  }, [])

  // Wheel pointer events
  const onWheelPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    isDraggingWheel.current = true
    handleWheelCoord(event.clientX, event.clientY)

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingWheel.current) return
      e.preventDefault()
      e.stopPropagation()
      handleWheelCoord(e.clientX, e.clientY)
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!isDraggingWheel.current) return
      isDraggingWheel.current = false
      e.preventDefault()
      e.stopPropagation()
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
    }

    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
  }

  // Slider pointer events
  const onSliderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    isDraggingSlider.current = true
    handleSliderCoord(event.clientY)

    const onPointerMove = (e: PointerEvent) => {
      if (!isDraggingSlider.current) return
      e.preventDefault()
      e.stopPropagation()
      handleSliderCoord(e.clientY)
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!isDraggingSlider.current) return
      isDraggingSlider.current = false
      e.preventDefault()
      e.stopPropagation()
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
    }

    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
  }

  // Handle Hex input change
  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setHexInput(val)
    const rgb = hexToRgb(val)
    if (rgb) {
      setRgbState(rgb)
      setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b))
    }
  }

  const handleHexBlur = () => {
    setHexInput(currentHex)
  }

  // Handle Channel input changes (R, G, B)
  const handleChannelChange = (channel: 'r' | 'g' | 'b', rawVal: string) => {
    const num = Number.parseInt(rawVal, 10)
    const clamped = Number.isNaN(num) ? 0 : Math.max(0, Math.min(255, num))
    const nextRgb = {
      ...rgbState,
      [channel]: clamped,
    }
    setRgbState(nextRgb)
    setHsv(rgbToHsv(nextRgb.r, nextRgb.g, nextRgb.b))
  }

  // Calculate wheel handle indicator coordinates
  const wheelHandlePos = useMemo(() => {
    const cx = WHEEL_SIZE / 2
    const cy = WHEEL_SIZE / 2
    const r = hsv.s * WHEEL_RADIUS
    const rad = (hsv.h * Math.PI) / 180
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    }
  }, [hsv.h, hsv.s])

  // Pure hue RGB for the brightness slider top gradient
  const pureRgb = useMemo(() => hsvToRgb(hsv.h, hsv.s, 1), [hsv.h, hsv.s])

  // Slider thumb position (0 at top = 1.0, height at bottom = 0.0)
  const sliderThumbY = useMemo(() => {
    return (1 - hsv.v) * WHEEL_SIZE
  }, [hsv.v])

  return (
    <div
      className="excel-circular-color-picker"
      data-selected-color={currentHex}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="region"
      aria-label="颜色选择器"
    >
      {/* Top action bar with Reset and Confirm buttons */}
      <div className="excel-color-header">
        <button
          type="button"
          className="excel-color-reset-btn"
          onClick={() => onReset?.()}
          tabIndex={0}
        >
          重置颜色
        </button>
        <button
          type="button"
          className="excel-color-confirm-btn"
          onClick={() => onConfirm?.(currentHex)}
          tabIndex={0}
        >
          确定
        </button>
      </div>

      {/* Main color picker body: Circular Wheel | Preview Bar | Brightness Slider | Values Panel */}
      <div className="excel-color-body">
        {/* 1. Circular Color Wheel */}
        <div className="excel-color-wheel-wrap" onPointerDown={onWheelPointerDown}>
          <div className="excel-color-wheel-disk" />
          <canvas
            ref={canvasRef}
            className="excel-color-wheel-canvas"
            style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
          />
          {/* Wheel Selector Ring */}
          <div
            className="excel-color-wheel-handle"
            style={{
              left: `${wheelHandlePos.x}px`,
              top: `${wheelHandlePos.y}px`,
            }}
          />
        </div>

        {/* 2. Color Preview Bar */}
        <div
          className="excel-color-preview-bar"
          style={{
            height: WHEEL_SIZE,
            backgroundColor: currentHex,
          }}
          title={currentHex}
        />

        {/* 3. Brightness Slider */}
        <div
          ref={sliderRef}
          className="excel-color-slider"
          style={{
            height: WHEEL_SIZE,
            background: `linear-gradient(to bottom, rgb(${pureRgb.r}, ${pureRgb.g}, ${pureRgb.b}), #000000)`,
          }}
          onPointerDown={onSliderPointerDown}
        >
          {/* Slider Thumb */}
          <div
            className="excel-color-slider-thumb"
            style={{
              top: `${sliderThumbY}px`,
            }}
          />
        </div>

        {/* 4. Values & Inputs Panel */}
        <div className="excel-color-values-panel" style={{ height: WHEEL_SIZE }}>
          {/* Hex Input */}
          <div className="excel-color-row">
            <input
              type="text"
              className="excel-color-hex-input"
              value={hexInput}
              onChange={handleHexChange}
              onBlur={handleHexBlur}
              aria-label="Hex 颜色代码"
              spellCheck={false}
            />
          </div>

          {/* Mode Selector */}
          <div className="excel-color-mode-select" title="颜色模式">
            <span>RGB</span>
            <span className="excel-color-chevron">⌵</span>
          </div>

          {/* Red Channel */}
          <div className="excel-color-channel-row">
            <input
              id={redInputId}
              type="number"
              min={0}
              max={255}
              className="excel-color-channel-input"
              value={rgbState.r}
              onChange={(e) => handleChannelChange('r', e.target.value)}
              aria-label="红色通道"
            />
            <label htmlFor={redInputId} className="excel-color-channel-label">红色</label>
          </div>

          {/* Green Channel */}
          <div className="excel-color-channel-row">
            <input
              id={greenInputId}
              type="number"
              min={0}
              max={255}
              className="excel-color-channel-input"
              value={rgbState.g}
              onChange={(e) => handleChannelChange('g', e.target.value)}
              aria-label="绿色通道"
            />
            <label htmlFor={greenInputId} className="excel-color-channel-label">绿色</label>
          </div>

          {/* Blue Channel */}
          <div className="excel-color-channel-row">
            <input
              id={blueInputId}
              type="number"
              min={0}
              max={255}
              className="excel-color-channel-input"
              value={rgbState.b}
              onChange={(e) => handleChannelChange('b', e.target.value)}
              aria-label="蓝色通道"
            />
            <label htmlFor={blueInputId} className="excel-color-channel-label">蓝色</label>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Mount root registry so roots can be properly cleaned up */
const activeRoots = new WeakMap<HTMLElement, Root>()

/**
 * Decorate a FortuneSheet custom color popup container with the ExcelCircularColorPicker.
 */
export function mountExcelCircularColorPicker(
  container: HTMLElement,
  options?: {
    initialColor?: string
    onSelectColor?: (color: string) => void
    onConfirm?: (color: string) => void
    onReset?: () => void
  },
): void {
  if (container.dataset.excelCircularColorPickerMounted === 'true') {
    return
  }
  container.dataset.excelCircularColorPickerMounted = 'true'

  // Look for native input[type="color"] to get the initial color
  const nativeInput = container.querySelector<HTMLInputElement>('input[type="color"]')
  let initialColor = options?.initialColor
  if (!initialColor) {
    const comboContainer = container.closest('.fortune-toobar-combo-container')
    const underlineBar = comboContainer?.parentElement?.querySelector<HTMLElement>(
      ':scope > div[style*="background-color"], :scope > div[style*="backgroundColor"]',
    ) || (comboContainer?.previousElementSibling as HTMLElement | null)
    if (underlineBar && underlineBar.style.backgroundColor) {
      initialColor = underlineBar.style.backgroundColor
    }
  }
  if (!initialColor && nativeInput?.value && nativeInput.value !== '#000000') {
    initialColor = nativeInput.value
  }
  if (!initialColor) {
    initialColor = '#7092BE'
  }

  // Hide the old FortuneSheet custom-color UI and palette without removing DOM nodes
  const oldCustomColor = container.querySelector<HTMLElement>('.custom-color')
  const oldColorPicker = container.querySelector<HTMLElement>('.fortune-toolbar-color-picker')
  const oldReset = container.querySelector<HTMLElement>('.color-reset')
  const oldConfirm = container.querySelector<HTMLElement>('.button-primary')

  if (oldCustomColor) oldCustomColor.style.display = 'none'
  if (oldColorPicker) oldColorPicker.style.display = 'none'
  if (oldReset) oldReset.style.display = 'none'

  // Create a mount point
  let mountPoint = container.querySelector<HTMLElement>('.excel-circular-color-picker-mount')
  if (!mountPoint) {
    mountPoint = document.createElement('div')
    mountPoint.className = 'excel-circular-color-picker-mount'
    container.appendChild(mountPoint)
  }

  const handleSelect = (color: string) => {
    if (nativeInput) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set
      nativeSetter?.call(nativeInput, color)
      nativeInput.dispatchEvent(new Event('input', { bubbles: true }))
      nativeInput.dispatchEvent(new Event('change', { bubbles: true }))
    }
    options?.onSelectColor?.(color)
  }

  const handleConfirm = (color: string) => {
    handleSelect(color)
    if (options?.onConfirm) {
      options.onConfirm(color)
    } else if (oldConfirm) {
      oldConfirm.click()
    }
  }

  const handleReset = () => {
    if (options?.onReset) {
      options.onReset()
    } else if (oldReset) {
      oldReset.click()
    }
  }

  const root = createRoot(mountPoint)
  activeRoots.set(container, root)

  root.render(
    <ExcelCircularColorPicker
      initialColor={initialColor}
      onSelectColor={handleSelect}
      onConfirm={handleConfirm}
      onReset={handleReset}
    />,
  )
}

/**
 * Unmount ExcelCircularColorPicker if the container is removed.
 */
export function unmountExcelCircularColorPicker(container: HTMLElement): void {
  const root = activeRoots.get(container)
  if (root) {
    root.unmount()
    activeRoots.delete(container)
    delete container.dataset.excelCircularColorPickerMounted
  }
}
