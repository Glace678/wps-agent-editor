# WPS Agent Editor

[简体中文](./README.md#zh-cn) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | **한국어** | [Español](./README_es.md) | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

**WPS Agent Editor 2**는 **Tauri v2**, **React**, **Rust**를 기반으로 개발된 차세대 크로스 플랫폼 문서 편집기이자 멀티 에이전트 AI 워크벤치입니다. 운영체제 내장 WebView를 활용하여 Electron, Chromium, Node.js, OnlyOffice Document Server와 같은 무거운 런타임 번들링을 완전히 배제했습니다.

---

## 멀티 AI 대화 및 멀티 에이전트 협업 엔진

WPS Agent Editor는 다양한 최첨단 AI 모델을 하나의 체계적인 문서 처리 팀으로 조율하는 강력한 협업 엔진을 제공합니다:

- **광범위한 AI 공급자 지원**: OpenAI(GPT-4o, o1), Anthropic(Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama(로컬 오프라인 모델), Volcengine(Doubao) 및 표준 OpenAI 호환 API를 기본 지원합니다.
- **두 가지 협업 워크플로**:
  - **총괄 지휘 모드 (Directed Mode)**: 총괄 Agent(Director)가 복잡한 업무를 분석하고, 세부 하위 작업(`delegate_task`)을 각 분야 전문 모델(데이터 분석, 기술 문서 작성, 코드 리뷰 등)에 위임한 후 결과를 종합하여 최종 결과물을 도출합니다.
  - **병렬 협업 모드 (Parallel Mode)**: 여러 AI 모델이 동일한 문서의 서로 다른 섹션을 동시에 작성, 교정 및 검증하며 실시간 스트리밍 및 핸드오프(Handoff)를 지원합니다.
- **시각화된 협업 타임라인**: 작업 생성 및 할당, 모델 간 대화, 추론 사고 과정(Reasoning), 도구 실행 및 작업 인계를 이벤트 스트림으로 한눈에 추적합니다.
- **지능형 컨텍스트 압축 및 Codex 마이그레이션**: 장문 대화는 전송 시 자동으로 휴대용 컨텍스트 창으로 압축됩니다. `CODEX_HOME`(`~/.codex`)의 로컬 JSONL 기록을 멱등성 있게 원클릭 동기화할 수 있습니다.

---

## 지능형 문서 협업 처리 기능

대화형 AI와 문서 엔진을 직접 연결하여 실질적인 문서 조작을 수행합니다:

- **원자적 문서 조작 (Atomic Operations)**: 텍스트 답변 생성에 그치지 않고, 삽입, 서식 지정, 교체, 주석 달기 등의 정밀 명령을 문서 엔진에 직접 전달합니다.
- **커서 및 선택 영역 실시간 추적**: 사용자와 Agent의 커서 위치, 선택한 텍스트 범위, 수정 구역을 실시간으로 감지합니다.
- **리비전 추적 및 충돌 해결**: 내장된 리비전 제어로 동시 편집 충돌을 사전에 방지하고 트랜잭션 상태를 유지하여 원클릭 실행 취소(Undo)를 지원합니다.
- **사용자 승인 워크플로 (Human-in-the-Loop)**: 민감하거나 중요한 문서 수정에 대해 사용자 승인(`approval-required`) 단계를 설정할 수 있습니다.

---

## 지원 파일 형식 목록

| 구분 | 확장자 | 지원 엔진 및 핵심 기능 |
| :--- | :--- | :--- |
| **Word 문서** | `.docx`, `.doc`, `.odt` | **SuperDoc** 리치 텍스트 엔진. 서식 스타일, 표, 이미지 완벽 지원. 구형 포맷 자동 변환. |
| **스프레드시트** | `.xlsx`, `.xls`, `.csv`, `.ods` | **Fortune Sheet** 탑재. 방대한 함수 수식, 멀티 시트 탭, 서식 및 초고속 계산 지원. |
| **프레젠테이션** | `.pptx`, `.ppt`, `.odp` | **pptx-renderer**를 통한 고해상도 렌더링 및 **Rust OOXML** 고속 백엔드 슬라이드 편집. |
| **PDF 문서** | `.pdf` | **PDF.js** 및 **MuPDF** 듀얼 엔진. 초고속 열람 및 영구 저장 가능한 편집용 주석(형광펜, 펜, 텍스트) 지원. |
| **텍스트 및 Markdown** | `.md`, `.markdown`, `.txt`, `.log` | 실시간 미리보기 및 즉시 로딩을 지원하는 내장 경량 에디터. |
| **소스 코드** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat` 등 | **Monaco Editor** 탑재. 구문 강조, 코드 완성, 로컬 도구 체인을 통한 실행 및 디버깅 지원. |
| **이미지 미리보기** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | 고성능 네이티브 이미지 뷰어. |

*참고: 구형 `.doc`, `.ppt` 변환은 시스템에 설치된 WPS, Microsoft Office 또는 LibreOffice를 사용합니다. 코드 실행은 로컬 툴체인(Node.js, Python, Cargo 등)을 활용합니다. 종속성 부재 시 명확한 `dependency-missing` 알림을 제공하며 불필요한 대용량 다운로드를 수행하지 않습니다.*

---

## 개발 환경 설정

### 요구 사항
- Node.js 22+
- Rust stable 및 컴파일 타깃
- [Tauri v2 필수 구성 요소](https://v2.tauri.app/start/prerequisites/)

### 빠른 시작
```bash
# 종속성 설치
npm ci

# 데스크톱 앱 개발 모드 실행
npm run dev

# 브라우저 UI 전용 실행
npm run dev:web
```

### 검증 및 테스트
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

---

## 배포 타깃 및 보안

Release 빌드는 가볍고 빠른 네이티브 데스크톱 바이너리를 생성합니다:
- **Windows 10+**: x86_64 및 ARM64 NSIS 설치 프로그램
- **macOS**: Intel 및 Apple Silicon DMG
- **Linux**: x86_64 및 ARM64 AppImage

CI 단계에서 주요 패키지 용량을 100 MiB 이내로 제한합니다. 위변조 방지 서명 및 복구 테스트를 거치며, 모든 API 키는 운영체제의 보안 자격 증명 보관함에 안전하게 저장됩니다.

---

## 라이선스

본 프로젝트는 **GNU Affero General Public License v3.0 only** (AGPL-3.0-only)에 따라 배포됩니다. 자세한 내용은 [LICENSE](./LICENSE) 및 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)를 확인하세요.
