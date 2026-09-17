# WPS Agent Editor

[简体中文](./README.md) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | **한국어** | [Español](./README_es.md) | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

WPS Agent Editor 2는 Tauri v2, React 및 Rust를 기반으로 구축된 크로스 플랫폼 문서 편집기이자 멀티 에이전트 워크벤치입니다. 데스크톱 애플리케이션은 네이티브 시스템 WebView를 사용하며 번들된 Electron, Chromium, Node.js 또는 OnlyOffice Document Server를 완전히 제거했습니다.

## 내장 기능

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer; 일반적인 PPTX 편집은 Rust OOXML 백엔드에서 처리
- **텍스트 및 Markdown**: 내장 에디터
- **코드**: Monaco; 실행 및 디버깅은 로컬에 설치된 언어 툴체인을 사용
- **Agent**: OpenAI, Anthropic, Google, Ollama 및 OpenAI 호환 공급자(Provider)

기존 레거시 `.doc`, `.ppt` 및 복합 미디어 변환에는 시스템에 설치된 WPS, Microsoft Office 또는 LibreOffice가 필요합니다. JavaScript/TypeScript 실행에는 시스템 Node.js가 필요하며, 기타 언어 역시 시스템 툴체인을 사용합니다. 누락된 종속성은 런타임 중 대용량 구성 요소를 무단으로 다운로드하지 않고 식별 가능한 `dependency-missing` 오류를 반환합니다.

## 개발

요구 사항:

- Node.js 22+
- Rust stable 및 해당 컴파일 타깃
- [Tauri v2 플랫폼 필수 구성 요소](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

브라우저 UI만 실행:

```bash
npm run dev:web
```

검증 및 테스트:

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

## 배포 대상

Release 빌드는 다음 데스크톱 바이너리를 생성합니다:

- **Windows 10+**: x86_64 및 ARM64 NSIS 설치 프로그램
- **macOS**: Intel 및 Apple Silicon DMG
- **Linux**: x86_64 및 ARM64 AppImage

각 주요 다운로드 패키지의 CI 상한선은 100 MiB입니다. 태그는 `package.json`, Cargo 및 `tauri.conf.json`의 버전과 일치해야 합니다. 안정화 릴리스의 경우 Windows Authenticode, macOS Developer ID/공증 및 Tauri updater Ed25519 서명 키가 추가로 요구됩니다.

Pull Request는 6개 네이티브 타깃에 대해 단기 보존되는 미서명 테스트 패키지를 생성합니다. `v*-rc.*` 태그는 체크섬, SBOM, AGPL 대응 소스코드 아카이브 및 GitHub 빌드 증명을 포함한 공개 미서명 릴리스 후보(RC)를 빌드하지만, updater 메타데이터를 생성하지 않으며 자동 업데이트 채널에 진입하지 않습니다. 프로덕션 태그 빌드는 플랫폼별 서명, 파일 연결, 핵심 문서, Agent 스트리밍 응답, 설치, 실행, 콘텐츠 검사, 제거 스모크 테스트를 통과한 후에만 단일 finalize 작업에 진입합니다. finalize 작업은 updater 메타데이터, 거부 테스트 픽스처, 체크섬, SBOM, 소스 아카이브 및 빌드 증명을 통합 생성하고 먼저 prerelease로 게시합니다.

`Signed staging release smoke`는 정확한 태그를 사용하여 6개 플랫폼에서 서명 변조 거부, 손상된 설치 복구, 실제 업그레이드, 재부팅, 실행 상태 점검, 실패 롤백 및 외부 버전/해시 일치 여부를 검증합니다. 또한 각 대상 플랫폼은 이전 버전을 재설치하고, 업데이트 후 실행 실패를 주입하여 프로세스 외부에서 이전 페이로드가 정상 복원 및 재시작되는지 확인합니다. 워크플로는 기본적으로 검증만 수행하며, 명시적으로 `promote`를 선택하고 전체 매트릭스가 통과한 경우에만 최소 권한 격리 작업이 prerelease를 안정화 릴리스로 승격합니다. `v2.0.0` 이후에는 이전에 릴리스된 태그를 반드시 제공해야 하며 업그레이드 검증을 생략할 수 없습니다. 전체 RC, 서명 자격 증명 및 안정화 버전 프로세스는 [RELEASING.md](./RELEASING.md)를 참조하십시오.

## v2 데이터 전략

v2는 새로운 `v2/` 애플리케이션 데이터 디렉터리에 설정을 저장합니다. 기존 Electron 설정 및 사용자 문서는 읽거나 이전하거나 삭제하지 않습니다. API 키는 다시 입력해야 하며 시스템 자격 증명 보관함(Credential Vault)에만 안전하게 보관됩니다. 업데이트 전 `v2/updater-health/`에 제한된 백업과 원자적 트랜잭션 상태가 생성됩니다. 새 버전은 React가 마운트되고 네이티브 IPC 왕복을 완료해야만 정상 상태로 확인되며, 그렇지 않으면 독립된 이전 버전 guardian 프로세스가 이전 설치 페이로드로 롤백합니다.

## Codex 대화 마이그레이션

Agent 패널을 처음 실행할 때 현재 사용자의 `CODEX_HOME`(설정되지 않은 경우 `~/.codex`)에 있는 활성 및 아카이브된 JSONL 세션을 검색하여 멱등성(idempotent) 방식으로 `v2/conversations/`에 동기화합니다. 기록 패널의 다운로드 버튼을 통해 언제든지 다시 검색할 수 있습니다. 이미 동기화된 파일은 중복 가져오기되지 않으며, 새로 추가되거나 변경된 대화는 증분 업데이트됩니다.

가져오기는 재개 가능한 사용자, 어시스턴트, 시스템 메시지만 유지하며 제목, 프로젝트 경로, 원래 공급자/모델 및 아카이브 상태를 보존합니다. 개발자 지침, 내부 추론(Reasoning), 도구 호출 출력, Codex 자격 증명 파일 및 첨부 파일 원본 데이터는 읽거나 대화 컨텍스트에 포함되지 않습니다. 메시지 본문에 수동으로 붙여넣은 민감한 정보는 그대로 유지되므로 공유 전에 직접 확인하십시오. 대화 기록을 선택한 후 구성된 OpenAI, Anthropic, Google, Ollama 또는 OpenAI 호환 공급자로 즉시 전환하여 작업을 계속할 수 있습니다. 긴 기록은 전송 시 휴대용 컨텍스트 창으로 자동 압축되지만 원본 로컬 기록은 손상 없이 보존됩니다.

Codex의 shell/process 세션, 승인 상태 및 실행 중인 도구는 마이그레이션되지 않습니다. 외부 모델은 가져온 가시적인 메시지와 현재 앱에서 사용 가능한 도구를 기반으로 작업을 계속 실행합니다.

## 라이선스

본 프로젝트는 GNU Affero General Public License v3.0 only에 따라 배포됩니다. [LICENSE](./LICENSE) 및 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)를 참조하십시오. 바이너리를 배포할 때는 해당 버전에 해당하는 전체 소스코드를 함께 제공해야 합니다.
