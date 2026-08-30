# Local GitHub API credentials

This repository never stores a GitHub personal access token (PAT). The local
Git Credential Manager is the credential source for GitHub operations and API
checks, so credentials are kept outside the working tree and are not uploaded
by Git.

## Configure or rotate a token

Run the helper below in a local PowerShell terminal. It reads the token as a
hidden input and stores it in the operating system credential manager:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\store-github-credential.ps1
```

Use a least-privilege fine-grained token. Do not paste a PAT into source files,
`.env` files, issue comments, chat messages, or command arguments. Revoke any
token that has been exposed and create a replacement before storing it.

## Use from an AI or script

Read the credential only into process memory and never print the password. The
portable Git credential protocol works on Windows, macOS, and Linux:

```powershell
$credential = "protocol=https`nhost=github.com`n`n" | git credential fill
```

Use the returned password to authorize the request in memory, then discard it.
The repository's release scripts already prefer `GH_TOKEN`/`GITHUB_TOKEN` when
running in GitHub Actions; local automation should obtain the value through the
credential helper instead of adding a second plaintext secret store.

The existing `.gitignore` intentionally excludes `.env.*`, local auth JSON,
private keys, and other user-data files. Keep those exclusions intact.
