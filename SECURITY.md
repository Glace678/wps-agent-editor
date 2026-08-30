# Security

## Supported version

Only the latest signed v2 stable release receives security updates.

## Release credentials

Release credentials must exist only as protected GitHub Actions secrets. Required values are the Tauri updater private/public key pair and private-key password, Windows PFX and password, Apple Developer ID certificate and password, signing identity, App Store Connect issuer/key/private key, and a temporary keychain password.

The base Tauri configuration has no updater endpoint and uses a non-production test public key so development and unsigned PR builds can initialize the updater plugin. The release workflow must replace both values with the protected production public key and the HTTPS release endpoint; it fails closed when that secret is absent.

Repository remotes must not contain embedded credentials. Any token previously present in a remote URL must be revoked at the provider, replaced, and removed from local Git configuration before pushing this migration. Secret scanning and push protection should be enabled on the hosting repository.

## Runtime guarantees

- Provider API keys are stored in the operating-system credential service. There is no plaintext fallback.
- Renderer code has no generic filesystem or shell permission.
- Local file access is grant-based and canonicalized in Rust.
- Remote navigation and remote script execution are denied by CSP.
- Updates are accepted only after Ed25519 signature verification.

The non-UI updater acceptance mode is disabled unless the process receives both the dedicated smoke flag and test environment gate. It accepts only an exact GitHub `owner/name`, derives HTTPS endpoints for an exact SemVer tag, and writes only to a random-token JSON file below the dedicated system temporary directory. The staging workflow uses this mode to exercise real Tauri signature rejection, rejected-install preservation, installation, restart, startup-health failure injection, and rollback; no repository-configurable executable hook is trusted. A rejected input that never enters the platform replacement transaction is reported as `invalidInstallPreserved`, while a separately installed update that fails startup health is reported as a verified rollback.

The rollback guardian runs from a copied old executable outside the installed payload. Its token-bound, schema-versioned state and backup live below `v2/updater-health/`; state writes are atomic, target and helper paths are scope-checked, and only one transaction may be active. The renderer confirms health only after it has mounted and completed native IPC. Until then, process exit or a five-minute deadline causes the guardian to terminate the failed update, atomically restore the previous payload, and relaunch it. Updates are refused when a complete bounded backup cannot be created; rollback never weakens updater Ed25519 or platform-signature verification.

Tag builds publish a signed prerelease. Build matrix jobs have read-only repository permissions and do not retain checkout credentials; only the finalize job may create that prerelease. A separately dispatched staging workflow must pass all native checks before its isolated promotion job can make the release stable.

Report vulnerabilities privately to the project maintainers rather than opening a public issue.
