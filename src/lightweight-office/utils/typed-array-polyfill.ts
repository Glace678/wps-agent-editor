/**
 * pdfjs-dist 依赖若干较新的 TypedArray API，部分系统 WebView 尚未全部实现。
 * 缺失时常见错误：
 *   - a.toHex is not a function
 *   - getOrInsertComputed is not a function
 */

function polyfillUint8ArrayHex(): void {
  const proto = Uint8Array.prototype as Uint8Array & { toHex?: () => string }
  if (typeof proto.toHex !== 'function') {
    proto.toHex = function toHex(this: Uint8Array): string {
      let hex = ''
      for (let i = 0; i < this.length; i++) {
        const h = this[i]!.toString(16)
        hex += h.length === 1 ? `0${h}` : h
      }
      return hex
    }
  }

  const U8 = Uint8Array as typeof Uint8Array & {
    fromHex?: (hex: string) => Uint8Array
  }
  if (typeof U8.fromHex !== 'function') {
    U8.fromHex = function fromHex(hex: string): Uint8Array {
      if (typeof hex !== 'string') throw new TypeError('Uint8Array.fromHex requires a string')
      const clean = hex.replace(/^0x/i, '').replace(/\s+/g, '')
      if (clean.length % 2 !== 0) throw new TypeError('Invalid hex string length')
      // Reject any non-hex character instead of silently coercing it to a byte.
      if (clean.length > 0 && !/^[0-9a-f]+$/i.test(clean)) {
        throw new TypeError('Invalid hex string: unexpected character')
      }
      const out = new Uint8Array(clean.length / 2)
      for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
      }
      return out
    }
  }
}

function polyfillMapGetOrInsert(): void {
  const proto = Map.prototype as Map<unknown, unknown> & {
    getOrInsert?: (key: unknown, defaultValue: unknown) => unknown
    getOrInsertComputed?: (key: unknown, callbackFn: (key: unknown) => unknown) => unknown
  }

  if (typeof proto.getOrInsert !== 'function') {
    proto.getOrInsert = function getOrInsert(key, defaultValue) {
      if (this.has(key)) return this.get(key)
      this.set(key, defaultValue)
      return defaultValue
    }
  }

  if (typeof proto.getOrInsertComputed !== 'function') {
    proto.getOrInsertComputed = function getOrInsertComputed(key, callbackFn) {
      if (this.has(key)) return this.get(key)
      const value = callbackFn(key)
      this.set(key, value)
      return value
    }
  }
}

function polyfillMathSumPrecise(): void {
  const math = Math as Math & {
    sumPrecise?: (items: Iterable<number>) => number
  }
  if (typeof math.sumPrecise !== 'function') {
    // Kahan compensated summation: far more accurate than naive accumulation for
    // PDF path/transform sums that mix magnitudes or cancel out. NaN propagates
    // (matching the spec) instead of being silently coerced to 0.
    math.sumPrecise = function sumPrecise(items: Iterable<number>): number {
      let sum = 0
      let compensation = 0
      for (const value of items) {
        const x = Number(value)
        if (Number.isNaN(x)) return NaN
        const y = x - compensation
        const t = sum + y
        compensation = t - sum - y
        sum = t
      }
      return sum
    }
  }
}

/** 注入主线程 polyfill */
export function ensurePdfJsRuntimePolyfills(): void {
  polyfillUint8ArrayHex()
  polyfillMapGetOrInsert()
  polyfillMathSumPrecise()
}

/**
 * 生成可在 PDF Web Worker 内执行的 polyfill 源码字符串
 * （Worker 与主线程全局隔离，必须单独注入）
 */
export function getPdfWorkerPolyfillSource(): string {
  return `
(function () {
  if (typeof Uint8Array !== 'undefined' && typeof Uint8Array.prototype.toHex !== 'function') {
    Uint8Array.prototype.toHex = function toHex() {
      var hex = '';
      for (var i = 0; i < this.length; i++) {
        var h = this[i].toString(16);
        hex += h.length === 1 ? '0' + h : h;
      }
      return hex;
    };
  }
  if (typeof Uint8Array !== 'undefined' && typeof Uint8Array.fromHex !== 'function') {
    Uint8Array.fromHex = function fromHex(hex) {
      if (typeof hex !== 'string') throw new TypeError('Uint8Array.fromHex requires a string');
      var clean = String(hex).replace(/^0x/i, '').replace(/\\s+/g, '');
      if (clean.length % 2 !== 0) throw new TypeError('Invalid hex string length');
      if (clean.length > 0 && !/^[0-9a-f]+$/i.test(clean)) throw new TypeError('Invalid hex string: unexpected character');
      var out = new Uint8Array(clean.length / 2);
      for (var i = 0; i < out.length; i++) {
        out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    };
  }
  if (typeof Map !== 'undefined' && typeof Map.prototype.getOrInsert !== 'function') {
    Map.prototype.getOrInsert = function getOrInsert(key, defaultValue) {
      if (this.has(key)) return this.get(key);
      this.set(key, defaultValue);
      return defaultValue;
    };
  }
  if (typeof Map !== 'undefined' && typeof Map.prototype.getOrInsertComputed !== 'function') {
    Map.prototype.getOrInsertComputed = function getOrInsertComputed(key, callbackFn) {
      if (this.has(key)) return this.get(key);
      var value = callbackFn(key);
      this.set(key, value);
      return value;
    };
  }
  if (typeof Math !== 'undefined' && typeof Math.sumPrecise !== 'function') {
    Math.sumPrecise = function sumPrecise(items) {
      var sum = 0, compensation = 0;
      for (var n of items) {
        var x = Number(n);
        if (Number.isNaN(x)) return NaN;
        var y = x - compensation;
        var t = sum + y;
        compensation = t - sum - y;
        sum = t;
      }
      return sum;
    };
  }
})();
`
}

ensurePdfJsRuntimePolyfills()
