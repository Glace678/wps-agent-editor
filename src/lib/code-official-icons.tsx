import type { FC, SVGProps } from 'react'

export interface CodeOfficialIconProps extends SVGProps<SVGSVGElement> {
  className?: string
  size?: number
}

// 1. TypeScript
export const TypeScriptIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#3178C6" />
    <path
      d="M3.2 6.4h4.4v1.1H6v4.9H4.8V7.5H3.2V6.4zm5 3.5c.3.5.7.9 1.4.9.6 0 1-.3 1-.7 0-.5-.4-.7-1.3-1-1.2-.5-1.8-1-1.8-1.9 0-1.1.9-1.9 2.2-1.9.9 0 1.6.4 2 1.1l-.9.6c-.3-.4-.6-.7-1.1-.7-.5 0-.9.3-.9.7 0 .4.4.6 1.2.9 1.4.5 1.9 1.1 1.9 2 0 1.2-.9 2-2.3 2-1.1 0-1.9-.5-2.3-1.4l1-.6z"
      fill="#FFFFFF"
    />
  </svg>
)

// 2. TSX (TypeScript React)
export const TsxIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#1C2C3E" />
    <ellipse cx="8" cy="8" rx="6.2" ry="2.2" stroke="#61DAFB" strokeWidth="0.9" fill="none" transform="rotate(30 8 8)" />
    <ellipse cx="8" cy="8" rx="6.2" ry="2.2" stroke="#61DAFB" strokeWidth="0.9" fill="none" transform="rotate(90 8 8)" />
    <ellipse cx="8" cy="8" rx="6.2" ry="2.2" stroke="#61DAFB" strokeWidth="0.9" fill="none" transform="rotate(150 8 8)" />
    <circle cx="8" cy="8" r="1.2" fill="#61DAFB" />
    <rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1" fill="#3178C6" />
    <text x="12.2" y="14" fill="#FFFFFF" fontSize="4.2" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">TS</text>
  </svg>
)

// 3. JavaScript
export const JavaScriptIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#F7DF1E" />
    <path
      d="M4.5 7.2h1.4v4.3c0 .8-.3 1.2-1.1 1.2-.4 0-.8-.1-1.1-.3l.3-1c.2.1.4.2.6.2.3 0 .4-.1.4-.4V7.2zm3.8 2.8c.4.6.9 1 1.6 1 .6 0 1-.3 1-.7 0-.5-.4-.7-1.3-1.1-1.3-.5-1.9-1.1-1.9-2 0-1.1.9-2 2.2-2 1 0 1.7.4 2.1 1.1l-1 .7c-.3-.4-.6-.6-1.1-.6-.5 0-.8.3-.8.7 0 .4.3.6 1.1 1 1.4.6 2.1 1.2 2.1 2.2 0 1.3-1 2.1-2.4 2.1-1.2 0-2.1-.6-2.5-1.5l1.1-.9z"
      fill="#000000"
    />
  </svg>
)

// 4. JSX (React)
export const JsxIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#20232A" />
    <ellipse cx="8" cy="8" rx="6.4" ry="2.3" stroke="#61DAFB" strokeWidth="1" fill="none" transform="rotate(30 8 8)" />
    <ellipse cx="8" cy="8" rx="6.4" ry="2.3" stroke="#61DAFB" strokeWidth="1" fill="none" transform="rotate(90 8 8)" />
    <ellipse cx="8" cy="8" rx="6.4" ry="2.3" stroke="#61DAFB" strokeWidth="1" fill="none" transform="rotate(150 8 8)" />
    <circle cx="8" cy="8" r="1.3" fill="#61DAFB" />
  </svg>
)

// 5. Python
export const PythonIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path
      d="M7.9 1.5C5.4 1.5 5.5 2.6 5.5 2.6v1.1h2.5v.4H4.2S2.5 4 2.5 6.4c0 2.5 1.5 2.4 1.5 2.4h.9V7.6s-.1-1.4 1.4-1.4h2.4s1.3 0 1.3-1.3V2.8s.2-1.3-1.6-1.3zm-1.2.9a.4.4 0 110 .8.4.4 0 010-.8z"
      fill="#3776AB"
    />
    <path
      d="M8.1 14.5c2.5 0 2.4-1.1 2.4-1.1v-1.1H8v-.4h3.8s1.7.1 1.7-2.3c0-2.5-1.5-2.4-1.5-2.4h-.9v1.2s.1 1.4-1.4 1.4H7.8s-1.3 0-1.3 1.3v2.1s-.2 1.3 1.6 1.3zm1.2-.9a.4.4 0 110-.8.4.4 0 010 .8z"
      fill="#FFD43B"
    />
  </svg>
)

// 6. C++
export const CppIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M8 1l6 3.5v7L8 15l-6-3.5v-7L8 1z" fill="#00599C" />
    <path d="M6.2 5.5c-1.5 0-2.4 1.1-2.4 2.5s.9 2.5 2.4 2.5c.8 0 1.4-.4 1.8-.9l-.8-.6c-.2.3-.5.5-1 .5-.8 0-1.3-.6-1.3-1.5s.5-1.5 1.3-1.5c.5 0 .8.2 1 .5l.8-.6c-.4-.5-1-.9-1.8-.9z" fill="#FFFFFF" />
    <path d="M9.8 6.6h.7v1h1v.7h-1v1h-.7v-1h-1v-.7h1v-1zm3.1 0h.7v1h1v.7h-1v1h-.7v-1h-1v-.7h1v-1z" fill="#0086D6" />
    <path d="M9.8 6.6h.7v1h1v.7h-1v1h-.7v-1h-1v-.7h1v-1zm3.1 0h.7v1h1v.7h-1v1h-.7v-1h-1v-.7h1v-1z" fill="#FFFFFF" />
  </svg>
)

// 7. C
export const CIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M8 1l6 3.5v7L8 15l-6-3.5v-7L8 1z" fill="#659AD2" />
    <path d="M8.2 4.8c-2 0-3.2 1.4-3.2 3.2s1.2 3.2 3.2 3.2c1.1 0 1.9-.5 2.4-1.2l-1.1-.8c-.3.4-.7.7-1.3.7-1.1 0-1.8-.8-1.8-1.9s.7-1.9 1.8-1.9c.6 0 1 .3 1.3.7l1.1-.8c-.5-.7-1.3-1.2-2.4-1.2z" fill="#FFFFFF" />
  </svg>
)

// 8. C#
export const CSharpIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M8 1l6 3.5v7L8 15l-6-3.5v-7L8 1z" fill="#68217A" />
    <path d="M5.8 5.5c-1.4 0-2.2 1.1-2.2 2.5s.8 2.5 2.2 2.5c.7 0 1.3-.4 1.6-.9l-.8-.6c-.2.3-.5.5-.8.5-.7 0-1.2-.6-1.2-1.5s.5-1.5 1.2-1.5c.3 0 .6.2.8.5l.8-.6c-.3-.5-.9-.9-1.6-.9zm4.2 1.3l-.2 1.1h1.1l-.2 1h-1.1l-.2 1h1.1l-.2 1H9l.2-1H8.1l-.2 1H7l.2-1H6.1l.2-1H7.2l.2-1H6.3l.2-1H7.6l.2-1H8.7l-.2 1h.9l.2-1h1.1l-.2 1h.9zm-1.8 2.1l.2-1H7.5l-.2 1h.9z" fill="#FFFFFF" />
  </svg>
)

// 9. Java
export const JavaIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M6.2 12.8c1.6.1 3.5-.1 4.5-.6-1.2-.4-2.8-.5-4.5.6zm4.8-1.5c1.4-.4 2.1-.9 2.1-1.3 0-.7-1.1-1.1-2.5-1.4.3.4.4.7.4 1 0 .6-.7 1.2-1.8 1.6 1-.1 1.6 0 1.8.1zm-7.6 1.9c1.9.4 4.5.5 7.1-.1 1.3-.3 2.5-.8 3-1.4-.5-.1-1.2 0-2.1.2-2.8.6-5.5.4-7.2-.2-.5.5-.8 1-.8 1.5zm8.8-4.8c.8 0 1.3-.3 1.3-.7 0-.3-.3-.6-1-.9.4.5.4.9.4 1.1 0 .3-.3.5-.7.5z" fill="#5382A1" />
    <path d="M7.7 1.5c.6.9.7 1.8.3 2.7-.4.9-1.2 1.6-1.5 2.5-.3.8-.1 1.6.4 2.3-.4-.2-.8-.6-1-1.1-.3-.7-.2-1.5.2-2.2.4-.8 1.2-1.5 1.4-2.4.2-.7 0-1.3-.3-1.8.3 0 .4 0 .5 0zm2.5 1.8c.4.8.4 1.6.1 2.3-.3.8-1 1.4-1.3 2.1-.2.6 0 1.3.4 1.8-.4-.2-.7-.6-.8-1-.2-.6 0-1.3.3-1.9.3-.7 1-1.2 1.1-1.9.1-.5 0-1-.2-1.4.2 0 .3 0 .4 0z" fill="#EA2D2E" />
    <path d="M3.2 14.5c3.2.7 7.2.7 9.8 0-1.1.5-3.8.8-6.5.8-2.1 0-3.3-.4-3.3-.8z" fill="#5382A1" />
  </svg>
)

// 10. Kotlin
export const KotlinIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <defs>
      <linearGradient id="kt-grad" x1="16" y1="0" x2="0" y2="16" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#C711E1" />
        <stop offset="50%" stopColor="#7F52FF" />
        <stop offset="100%" stopColor="#00AFFF" />
      </linearGradient>
    </defs>
    <path d="M15 1H1v14h14L8 8l7-7z" fill="url(#kt-grad)" />
  </svg>
)

// 11. Go
export const GoIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#00ADD8" />
    <path d="M2 6.5h3.2v.9H3.1v1.8h1.4v-.8H3.8v-.8h1.5c.3 0 .5.2.5.5v2c0 .3-.2.5-.5.5H2.8c-.5 0-.8-.3-.8-.8v-2.5c0-.5.3-.8.8-.8zm5 0h2.4c.5 0 .8.3.8.8v2.5c0 .5-.3.8-.8.8H7c-.5 0-.8-.3-.8-.8V7.3c0-.5.3-.8.8-.8zm.3.9v2.5h1.8V7.4H7.3zM11.5 8h2.5v.8h-2.5V8zm.5 1.5h2v.8h-2v-.8zm-.5-3h2.5v.8h-2.5v-.8z" fill="#FFFFFF" />
  </svg>
)

// 12. Rust
export const RustIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <circle cx="8" cy="8" r="7.5" fill="#241C1A" />
    <circle cx="8" cy="8" r="6.2" stroke="#CE412B" strokeWidth="1.2" strokeDasharray="1.5 0.8" fill="none" />
    <circle cx="8" cy="8" r="5.2" fill="#CE412B" />
    <path d="M6 5h2.5c1 0 1.7.5 1.7 1.5 0 .8-.5 1.3-1.2 1.4L10.3 11H9l-1.1-2.8H7.2V11H6V5zm1.2 2.3h1.2c.4 0 .7-.2.7-.6s-.3-.6-.7-.6H7.2v1.2z" fill="#FFFFFF" />
  </svg>
)

// 13. Swift
export const SwiftIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#FA7343" />
    <path
      d="M13.5 12.8c-1.5-1.5-3.8-2.6-5.8-3.1 1.8-.4 3.7-.1 5.2.8-1.8-2.1-4.3-3.3-7-3.4 2.2-.6 4.6-.2 6.5.9-2.6-2.8-6.6-3.8-10.1-2.4 2.2.8 4 2.4 4.8 4.6C5.5 9 4.1 7.8 2.5 7c.8 1.8 2.2 3.3 3.9 4.2-1.9-.3-3.6-1.2-4.9-2.6 1.8 3.2 5.5 5.2 9.2 4.9 1-.1 2-.4 2.8-.7z"
      fill="#FFFFFF"
    />
  </svg>
)

// 14. Dart
export const DartIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M2.5 2.5l5.5 1.5L13.5 9l-4.5 4.5-6.5-2.5v-8.5z" fill="#0175C2" />
    <path d="M8 4L2.5 9.5 5 13.5l6-2 2.5-2.5L8 4z" fill="#00B4AB" />
    <path d="M2.5 2.5l5.5 5.5-3 5.5-2.5-2.5v-8.5z" fill="#02569B" />
  </svg>
)

// 15. Ruby
export const RubyIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M4 2l4-1 4 1 3 4-7 9-7-9 3-4z" fill="#CC342D" />
    <path d="M8 1l4 1 3 4-7 9V1z" fill="#B3241F" />
    <path d="M4 2l4-1v14L1 6l3-4z" fill="#E64A45" />
    <path d="M4 2l4 4-7 0 3-4z" fill="#FFFFFF" opacity="0.3" />
    <path d="M12 2l-4 4 7 0-3-4z" fill="#991B17" />
  </svg>
)

// 16. PHP
export const PhpIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <ellipse cx="8" cy="8" rx="7.5" ry="5.5" fill="#777BB4" />
    <ellipse cx="8" cy="8" rx="7" ry="5" fill="#4F5B93" />
    <path d="M4.5 9.5l.5-3h1.2c.6 0 1 .2 1 .7 0 .8-.5 1.3-1.2 1.3H5.2l-.3 1H4.5zm.9-1.6h.6c.3 0 .6-.2.6-.5 0-.3-.2-.4-.5-.4h-.5l-.2.9zm3 1.6l.9-5h.8l-.3 1.8h.1c.3-.4.7-.6 1.1-.6.7 0 1 .4 1 1.1l-.5 2.7h-.8l.4-2.5c.1-.4 0-.6-.4-.6-.4 0-.7.3-.8.7l-.4 2.4H8.4zm4.2 0l.5-3h1.2c.6 0 1 .2 1 .7 0 .8-.5 1.3-1.2 1.3h-.8l-.3 1h-.4zm.9-1.6h.6c.3 0 .6-.2.6-.5 0-.3-.2-.4-.5-.4h-.5l-.2.9z" fill="#FFFFFF" />
  </svg>
)

// 17. HTML5
export const HtmlIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M2.5 1.5l1.1 12.3 4.4 1.2 4.4-1.2 1.1-12.3H2.5z" fill="#E44D26" />
    <path d="M8 2.6v11.1l3.5-1 .9-10.1H8z" fill="#F16529" />
    <path d="M8 5.6H5.3l.1 1.4H8V5.6zm0 2.8H6.8l.1 1.4H8v1.4l-2-.5-.1-1.3H4.6l.2 2.3 3.2.9V8.4zm0-5.8v1.4h4.7l-.1-1.4H8zm0 2.8v1.4h3.1l-.3 3.4-2.8.8v1.4l4.2-1.2.5-5.8H8z" fill="#FFFFFF" />
  </svg>
)

// 18. CSS3
export const CssIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M2.5 1.5l1.1 12.3 4.4 1.2 4.4-1.2 1.1-12.3H2.5z" fill="#1572B6" />
    <path d="M8 2.6v11.1l3.5-1 .9-10.1H8z" fill="#33A9DC" />
    <path d="M8 5.6H5.3l.1 1.4H8V5.6zm0 2.8H6.8l.1 1.4H8v1.4l-2-.5-.1-1.3H4.6l.2 2.3 3.2.9V8.4zm0-5.8v1.4h4.7l-.1-1.4H8zm0 2.8v1.4h3.1l-.3 3.4-2.8.8v1.4l4.2-1.2.5-5.8H8z" fill="#FFFFFF" />
  </svg>
)

// 19. SCSS / Sass
export const ScssIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#CD6799" />
    <path
      d="M12.8 5.4c-.2-.5-.7-.8-1.3-.8-.8 0-1.4.5-1.4 1.2 0 1.2 1.7 1 1.7 2.1 0 .6-.5 1-1.2 1-.7 0-1.2-.4-1.4-.9l-.8.4c.3.8 1.1 1.3 2.2 1.3 1.2 0 2.1-.7 2.1-1.8 0-1.4-1.7-1.2-1.7-2.1 0-.4.3-.6.7-.6.5 0 .8.2 1 .5l.7-.4zm-5.4.9c-.3-.9-1.2-1.5-2.2-1.5-1.4 0-2.4 1.1-2.4 2.6 0 1.5 1 2.6 2.4 2.6 1 0 1.9-.6 2.2-1.5l-.9-.4c-.2.5-.7.9-1.3.9-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6c.6 0 1.1.4 1.3.9l.9-.4z"
      fill="#FFFFFF"
    />
  </svg>
)

// 20. Vue
export const VueIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M1.5 2.5h2.8L8 8.8l3.7-6.3h2.8L8 14 1.5 2.5z" fill="#42B883" />
    <path d="M4.3 2.5h2.5L8 4.7l1.2-2.2h2.5L8 9 4.3 2.5z" fill="#35495E" />
  </svg>
)

// 21. Svelte
export const SvelteIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#FF3E00" />
    <path
      d="M11.8 4.2c-.8-1-2.3-1.4-3.7-1-.6.2-1.2.5-1.7.9L4.8 5.7c-.8.8-1.2 1.8-1.1 2.9.1 1.1.8 2.1 1.8 2.6l1.2.6-1 .8c-.5.4-1.2.4-1.7.1-.4-.3-.6-.8-.7-1.3l-1.3.2c.2 1 .7 1.8 1.5 2.4.9.6 2 .7 3 .2.6-.3 1.2-.7 1.6-1.1l1.6-1.6c.8-.8 1.2-1.8 1.1-2.9-.1-1.1-.8-2.1-1.8-2.6l-1.2-.6 1-.8c.5-.4 1.2-.4 1.7-.1.4.3.6.8.7 1.3l1.3-.2c-.2-1-.7-1.9-1.5-2.5z"
      fill="#FFFFFF"
    />
  </svg>
)

// 22. JSON
export const JsonIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#292929" />
    <path
      d="M5.5 3.5c-.8 0-1.5.7-1.5 1.5v1.5c0 .6-.4 1-1 1 .6 0 1 .4 1 1V11c0 .8.7 1.5 1.5 1.5h.5V11h-.5c-.3 0-.5-.2-.5-.5V8.8c0-.7-.5-1.3-1.2-1.3.7 0 1.2-.6 1.2-1.3V4.5c0-.3.2-.5.5-.5h.5V3.5h-.5zm5 0c.8 0 1.5.7 1.5 1.5v1.5c0 .6.4 1 1 1-.6 0-1 .4-1 1V11c0 .8-.7 1.5-1.5 1.5h-.5V11h.5c.3 0 .5-.2.5-.5V8.8c0-.7.5-1.3 1.2-1.3-.7 0-1.2-.6-1.2-1.3V4.5c0-.3-.2-.5-.5-.5h-.5V3.5h.5z"
      fill="#CBCB41"
    />
  </svg>
)

// 23. YAML
export const YamlIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#CB171E" />
    <text x="8" y="11" fill="#FFFFFF" fontSize="6.5" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">YML</text>
  </svg>
)

// 24. Markdown
export const MarkdownIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#083FA1" />
    <path d="M2.5 5h1.5l1.8 2.2L7.6 5h1.5v6H7.8V7.8L6 10H5.6L3.8 7.8V11H2.5V5zm8.3 0h1.4v3.5h1.5l-2.2 2.5-2.2-2.5h1.5V5z" fill="#FFFFFF" />
  </svg>
)

// 25. SQL / Database
export const SqlIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#00758F" />
    <ellipse cx="8" cy="4.5" rx="5" ry="1.8" fill="#FFFFFF" />
    <path d="M3 4.5v3c0 1 2.2 1.8 5 1.8s5-.8 5-1.8v-3c0 1-2.2 1.8-5 1.8s-5-.8-5-1.8z" fill="#FFFFFF" opacity="0.9" />
    <path d="M3 8.5v3c0 1 2.2 1.8 5 1.8s5-.8 5-1.8v-3c0 1-2.2 1.8-5 1.8s-5-.8-5-1.8z" fill="#FFFFFF" opacity="0.9" />
  </svg>
)

// 26. GraphQL
export const GraphQlIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M8 1.5l5.5 3.2v6.6L8 14.5 2.5 11.3V4.7L8 1.5z" stroke="#E10098" strokeWidth="1.1" fill="none" />
    <path d="M8 1.5v13M2.5 4.7l11 6.6M13.5 4.7l-11 6.6" stroke="#E10098" strokeWidth="0.8" />
    <circle cx="8" cy="1.5" r="1.3" fill="#E10098" />
    <circle cx="13.5" cy="4.7" r="1.3" fill="#E10098" />
    <circle cx="13.5" cy="11.3" r="1.3" fill="#E10098" />
    <circle cx="8" cy="14.5" r="1.3" fill="#E10098" />
    <circle cx="2.5" cy="11.3" r="1.3" fill="#E10098" />
    <circle cx="2.5" cy="4.7" r="1.3" fill="#E10098" />
  </svg>
)

// 27. Shell / Bash
export const ShellIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#20252C" />
    <path d="M3.5 5l3 3-3 3M8 11.5h4.5" stroke="#4EAA25" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// 28. PowerShell
export const PowerShellIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#012456" />
    <path d="M3.5 5l3 3-3 3M8 11.5h4.5" stroke="#5391FE" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// 29. Docker
export const DockerIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#2496ED" />
    <path d="M3.5 8h1.2v1.2H3.5V8zm1.5 0h1.2v1.2H5V8zm1.5 0h1.2v1.2H6.5V8zm1.5 0h1.2v1.2H8V8zm-3-1.5h1.2v1.2H5V6.5zm1.5 0h1.2v1.2H6.5V6.5zm1.5 0h1.2v1.2H8V6.5zm0-1.5h1.2v1.2H8V5z" fill="#FFFFFF" />
    <path d="M14.5 9.2c-.3 0-1.2.1-1.6.6-.5-.3-1.2-.4-1.9-.3-.5-1-1.5-1.5-1.5-1.5H2c-.2.7 0 2.8 1.8 4 1.8 1.2 5.2 1.2 7.7 0 1.8-.9 2.7-2.8 3-2.8z" fill="#FFFFFF" />
  </svg>
)

// 30. Lua
export const LuaIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <circle cx="8" cy="8" r="6" fill="#000080" />
    <circle cx="11.8" cy="4.2" r="1.8" fill="#000080" />
    <circle cx="11.8" cy="4.2" r="1" fill="#FFFFFF" />
    <ellipse cx="8" cy="8" rx="7.5" ry="3.5" stroke="#FFFFFF" strokeWidth="0.8" fill="none" transform="rotate(-30 8 8)" />
    <circle cx="8" cy="8" r="3.5" fill="#FFFFFF" />
  </svg>
)

// 31. R
export const RIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <ellipse cx="8" cy="8" rx="7.5" ry="5.5" fill="#BCC0C4" />
    <ellipse cx="8" cy="8" rx="6.2" ry="4.2" fill="#FFFFFF" />
    <path d="M5.5 4.5h3.2c1.6 0 2.8.9 2.8 2.3 0 1.1-.7 1.9-1.7 2.2L12 12H9.8L7.8 9.3H6.8V12H5.5V4.5zm1.3 3.6h1.8c.8 0 1.4-.4 1.4-1.1 0-.7-.6-1.1-1.4-1.1H6.8v2.2z" fill="#276DC3" />
  </svg>
)

// 32. Julia
export const JuliaIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <circle cx="8" cy="4.5" r="2.8" fill="#9558B2" />
    <circle cx="4.5" cy="10.8" r="2.8" fill="#CB3C33" />
    <circle cx="11.5" cy="10.8" r="2.8" fill="#389826" />
  </svg>
)

// 33. Elixir
export const ElixirIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#4E2A8E" />
    <path d="M8 2.5c-.3.4-3.5 4.2-3.5 7.5 0 2.2 1.6 3.8 3.5 3.8s3.5-1.6 3.5-3.8c0-3.3-3.2-7.1-3.5-7.5zm0 10c-1.4 0-2.5-1.1-2.5-2.5 0-1.7 1.8-4.2 2.5-5.1.7.9 2.5 3.4 2.5 5.1 0 1.4-1.1 2.5-2.5 2.5z" fill="#FFFFFF" />
  </svg>
)

// 34. Clojure
export const ClojureIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <circle cx="8" cy="8" r="7.5" fill="#5881D8" />
    <path d="M8 0.5a7.5 7.5 0 010 15 3.75 3.75 0 010-7.5 3.75 3.75 0 000-7.5z" fill="#63B132" />
  </svg>
)

// 35. Scala
export const ScalaIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M3 2l10 2.5v2.5L3 4.5V2z" fill="#DC322F" />
    <path d="M3 6.5l10 2.5v2.5L3 9V6.5z" fill="#DC322F" />
    <path d="M3 11l10 2.5V16L3 13.5V11z" fill="#DC322F" />
  </svg>
)

// 36. Solidity
export const SolidityIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M5.5 1.5L8 6 10.5 1.5 8 3.5 5.5 1.5z" fill="#363636" />
    <path d="M5.5 1.5L8 6l-2.5 4.5L3 6l2.5-4.5z" fill="#555555" />
    <path d="M10.5 1.5L13 6l-2.5 4.5L8 6l2.5-4.5z" fill="#888888" />
    <path d="M5.5 10.5L8 6l2.5 4.5L8 8.5l-2.5 2z" fill="#363636" />
    <path d="M5.5 10.5L8 15l-2.5-2L3 6l2.5 4.5z" fill="#555555" />
    <path d="M10.5 10.5L13 6l-2.5 7L8 15l2.5-4.5z" fill="#888888" />
  </svg>
)

// 37. Terraform / HCL
export const TerraformIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <path d="M6 1.5l3.5 2v3.8L6 5.3V1.5z" fill="#5C4EE5" />
    <path d="M10 3.8l3.5 2V9.6L10 7.6V3.8z" fill="#844FBA" />
    <path d="M2 3.8l3.5 2V9.6L2 7.6V3.8z" fill="#5C4EE5" />
    <path d="M6 6.2l3.5 2v3.8L6 10V6.2z" fill="#4040B2" />
  </svg>
)

// 38. XML / SVG
export const XmlIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#E65100" />
    <path d="M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3M9 4l-2 8" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// 39. Config / INI / TOML / ENV
export const ConfigIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#4B5563" />
    <path d="M3 5h10M3 8h10M3 11h10M5 3.5v3M10 6.5v3M7 9.5v3" stroke="#FFFFFF" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

// 40. Generic Code fallback
export const GenericCodeIcon: FC<CodeOfficialIconProps> = ({ className, size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className} {...props}>
    <rect width="16" height="16" rx="2.5" fill="#007ACC" />
    <path d="M5.5 5.5L3 8l2.5 2.5M10.5 5.5L13 8l-2.5 2.5M9 4.5l-2 7" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const EXTENSION_OFFICIAL_ICONS: Record<string, FC<CodeOfficialIconProps>> = {
  ts: TypeScriptIcon,
  mts: TypeScriptIcon,
  cts: TypeScriptIcon,
  tsx: TsxIcon,
  js: JavaScriptIcon,
  mjs: JavaScriptIcon,
  cjs: JavaScriptIcon,
  jsx: JsxIcon,
  py: PythonIcon,
  pyw: PythonIcon,
  pyi: PythonIcon,
  cpp: CppIcon,
  cc: CppIcon,
  cxx: CppIcon,
  hpp: CppIcon,
  hxx: CppIcon,
  hh: CppIcon,
  ipp: CppIcon,
  tpp: CppIcon,
  inl: CppIcon,
  cu: CppIcon,
  cuh: CppIcon,
  c: CIcon,
  h: CIcon,
  cs: CSharpIcon,
  java: JavaIcon,
  groovy: JavaIcon,
  kt: KotlinIcon,
  kts: KotlinIcon,
  go: GoIcon,
  rs: RustIcon,
  swift: SwiftIcon,
  dart: DartIcon,
  rb: RubyIcon,
  php: PhpIcon,
  html: HtmlIcon,
  htm: HtmlIcon,
  xhtml: HtmlIcon,
  css: CssIcon,
  scss: ScssIcon,
  sass: ScssIcon,
  less: ScssIcon,
  vue: VueIcon,
  svelte: SvelteIcon,
  json: JsonIcon,
  jsonc: JsonIcon,
  yaml: YamlIcon,
  yml: YamlIcon,
  md: MarkdownIcon,
  markdown: MarkdownIcon,
  sql: SqlIcon,
  mysql: SqlIcon,
  pgsql: SqlIcon,
  graphql: GraphQlIcon,
  gql: GraphQlIcon,
  sh: ShellIcon,
  bash: ShellIcon,
  zsh: ShellIcon,
  fish: ShellIcon,
  ps1: PowerShellIcon,
  bat: ShellIcon,
  cmd: ShellIcon,
  dockerfile: DockerIcon,
  lua: LuaIcon,
  r: RIcon,
  jl: JuliaIcon,
  ex: ElixirIcon,
  exs: ElixirIcon,
  clj: ClojureIcon,
  cljs: ClojureIcon,
  scala: ScalaIcon,
  sol: SolidityIcon,
  tf: TerraformIcon,
  hcl: TerraformIcon,
  xml: XmlIcon,
  svg: XmlIcon,
  toml: ConfigIcon,
  ini: ConfigIcon,
  cfg: ConfigIcon,
  conf: ConfigIcon,
  properties: ConfigIcon,
  proto: ConfigIcon,
  wgsl: GenericCodeIcon,
}

const FILENAME_OFFICIAL_ICONS: Record<string, FC<CodeOfficialIconProps>> = {
  dockerfile: DockerIcon,
  makefile: ShellIcon,
  'cmakelists.txt': ConfigIcon,
  jenkinsfile: JavaIcon,
  rakefile: RubyIcon,
  gemfile: RubyIcon,
  podfile: RubyIcon,
}

export function getCodeOfficialIcon(filePath: string): FC<CodeOfficialIconProps> {
  const filename = filePath.split(/[/\\]/).pop()?.toLowerCase() ?? ''
  if (!filename) return GenericCodeIcon
  if (FILENAME_OFFICIAL_ICONS[filename]) return FILENAME_OFFICIAL_ICONS[filename]
  if (filename === '.env' || filename.startsWith('.env.')) return ConfigIcon
  const dot = filename.lastIndexOf('.')
  if (dot >= 0 && dot < filename.length - 1) {
    const ext = filename.slice(dot + 1)
    if (EXTENSION_OFFICIAL_ICONS[ext]) return EXTENSION_OFFICIAL_ICONS[ext]
  }
  return GenericCodeIcon
}

export function CodeOfficialIcon({
  filePath,
  className,
  size = 16,
  ...props
}: CodeOfficialIconProps & { filePath: string }) {
  const IconComponent = getCodeOfficialIcon(filePath)
  return <IconComponent className={className} size={size} {...props} />
}
