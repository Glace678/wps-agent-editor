param(
  [Parameter(Mandatory = $true)]
  [string]$Artifact,

  [Parameter(Mandatory = $true)]
  [ValidateSet('x86', 'x86_64', 'aarch64')]
  [string]$Arch,

  [string]$LogDirectory = 'smoke-logs',

  [switch]$AllowUnsigned
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$artifactPath = (Resolve-Path -LiteralPath $Artifact).Path
$logRoot = [IO.Path]::GetFullPath($LogDirectory)
[IO.Directory]::CreateDirectory($logRoot) | Out-Null
$reportPath = Join-Path $logRoot "windows-$Arch-install-smoke.json"
$tauriConfigPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\src-tauri\tauri.conf.json'))
$tauriConfig = Get-Content -Raw -LiteralPath $tauriConfigPath | ConvertFrom-Json
$associationGroups = @(
  $tauriConfig.bundle.fileAssociations |
    Group-Object -Property name |
    ForEach-Object {
      [pscustomobject]@{
        ProgId = $_.Name
        Extensions = @($_.Group | ForEach-Object { $_.ext })
      }
    }
)
if ($associationGroups.Count -eq 0) { throw 'Tauri config declares no Windows file associations' }

function Get-PeMachine([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $reader = $null
  try {
    $reader = [IO.BinaryReader]::new($stream)
    if ($reader.ReadUInt16() -ne 0x5A4D) { throw "$Path is not a PE executable" }
    $stream.Position = 0x3C
    $peOffset = $reader.ReadUInt32()
    $stream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550) { throw "$Path has an invalid PE header" }
    return $reader.ReadUInt16()
  }
  finally {
    if ($null -ne $reader) { $reader.Dispose() }
    $stream.Dispose()
  }
}

function Get-WaeUninstallEntries {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $entries = foreach ($root in $roots) {
    Get-ItemProperty -Path $root -ErrorAction SilentlyContinue |
      Where-Object {
        $null -ne $_.PSObject.Properties['DisplayName'] -and
          $_.DisplayName -eq 'WPS Agent Editor'
      }
  }
  return @($entries)
}

function Get-ExecutableFromEntry($Entry) {
  $candidates = @()
  if ($Entry.PSObject.Properties['DisplayIcon'] -and $Entry.DisplayIcon) {
    $displayIcon = [string]$Entry.DisplayIcon
    if ($displayIcon -match '^"([^"]+\.exe)"') { $candidates += $Matches[1] }
    elseif ($displayIcon -match '^([^,]+\.exe)(?:,|$)') { $candidates += $Matches[1].Trim() }
  }
  if ($Entry.PSObject.Properties['InstallLocation'] -and $Entry.InstallLocation) {
    $location = ([string]$Entry.InstallLocation).Trim().Trim('"')
    $candidates += (Join-Path $location 'WPS Agent Editor.exe')
    $candidates += (Join-Path $location 'wps-agent-editor.exe')
    $candidates += (Join-Path $location 'wps_agent_editor.exe')
    if (Test-Path -LiteralPath $location -PathType Container) {
      $candidates += Get-ChildItem -LiteralPath $location -Filter '*.exe' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '(?i)uninstall|esbuild' } |
        Sort-Object @{ Expression = { if ($_.Name -match '(?i)wps.*agent.*editor') { 0 } else { 1 } } }, Name |
        Select-Object -ExpandProperty FullName
    }
  }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return [IO.Path]::GetFullPath($candidate)
    }
  }
  return $null
}

function Get-RegistryDefaultValue([string]$LiteralPath) {
  if (-not (Test-Path -LiteralPath $LiteralPath -PathType Container)) { return $null }
  $key = Get-Item -LiteralPath $LiteralPath
  try {
    return $key.GetValue('')
  }
  finally {
    $key.Close()
  }
}

function Invoke-Uninstaller([string]$CommandLine) {
  $command = $CommandLine.Trim()
  if ($command -match '^"([^"]+\.exe)"\s*(.*)$') {
    $program = $Matches[1]
    $arguments = $Matches[2]
  }
  elseif ($command -match '^(.+?\.exe)\s*(.*)$') {
    $program = $Matches[1].Trim()
    $arguments = $Matches[2]
  }
  else {
    throw "Cannot safely parse uninstall command: $CommandLine"
  }
  if ($arguments -notmatch '(?i)(?:^|\s)/S(?:\s|$)') {
    $arguments = "$arguments /S".Trim()
  }
  $process = Start-Process -FilePath $program -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Uninstaller exited with code $($process.ExitCode)" }
}

$authenticode = Get-AuthenticodeSignature -LiteralPath $artifactPath
if (-not $AllowUnsigned -and $authenticode.Status -ne [Management.Automation.SignatureStatus]::Valid) {
  throw "Installer Authenticode verification failed: $($authenticode.Status) $($authenticode.StatusMessage)"
}
if (-not $AllowUnsigned -and -not $authenticode.SignerCertificate) {
  throw 'Installer does not expose an Authenticode signer certificate'
}

$existingEntries = @(Get-WaeUninstallEntries)
if ($existingEntries.Count -ne 0) {
  throw 'The runner already has WPS Agent Editor installed; refusing to produce an ambiguous smoke result'
}

$installer = Start-Process -FilePath $artifactPath -ArgumentList '/S' -Wait -PassThru
if ($installer.ExitCode -ne 0) { throw "NSIS installer exited with code $($installer.ExitCode)" }

$entry = $null
for ($attempt = 0; $attempt -lt 30 -and $null -eq $entry; $attempt += 1) {
  $entry = Get-WaeUninstallEntries | Select-Object -First 1
  if ($null -eq $entry) { Start-Sleep -Seconds 1 }
}
if ($null -eq $entry) { throw 'NSIS completed but no WPS Agent Editor uninstall registration was created' }

$executable = Get-ExecutableFromEntry $entry
if (-not $executable) { throw 'The installed application executable could not be resolved from its uninstall registration' }
$expectedMachines = @{ x86 = 0x014C; x86_64 = 0x8664; aarch64 = 0xAA64 }
$actualMachine = Get-PeMachine $executable
if ($actualMachine -ne $expectedMachines[$Arch]) {
  throw ('Installed executable architecture mismatch: expected {0} (0x{1:X4}), received PE machine 0x{2:X4}' -f $Arch, $expectedMachines[$Arch], $actualMachine)
}
$installedSignature = Get-AuthenticodeSignature -LiteralPath $executable
if (-not $AllowUnsigned -and $installedSignature.Status -ne [Management.Automation.SignatureStatus]::Valid) {
  throw "Installed executable Authenticode verification failed: $($installedSignature.Status)"
}
$associationCount = 0
$expectedOpenCommand = '"{0}" "%1"' -f $executable
foreach ($group in $associationGroups) {
  $commandKey = "HKCU:\Software\Classes\$($group.ProgId)\shell\open\command"
  $actualOpenCommand = Get-RegistryDefaultValue $commandKey
  if ($actualOpenCommand -ne $expectedOpenCommand) {
    throw "File association command mismatch for $($group.ProgId): expected '$expectedOpenCommand', received '$actualOpenCommand'"
  }
  foreach ($extension in $group.Extensions) {
    $extensionKey = "HKCU:\Software\Classes\.$extension"
    $actualProgId = Get-RegistryDefaultValue $extensionKey
    if ($actualProgId -ne $group.ProgId) {
      throw "File association mismatch for .${extension}: expected '$($group.ProgId)', received '$actualProgId'"
    }
    $associationCount += 1
  }
}
& node (Join-Path $PSScriptRoot 'inspect-installed-smoke.mjs') --root (Split-Path -Parent $executable)
if ($LASTEXITCODE -ne 0) { throw "Installed-content inspection exited with code $LASTEXITCODE" }
& node (Join-Path $PSScriptRoot 'run-installed-core-smoke.mjs') `
  --platform windows `
  --executable $executable `
  --report (Join-Path $logRoot "windows-$Arch-core-smoke.json")
if ($LASTEXITCODE -ne 0) { throw "Installed core document/Agent smoke exited with code $LASTEXITCODE" }

$application = Start-Process -FilePath $executable -PassThru
Start-Sleep -Seconds 12
$application.Refresh()
if ($application.HasExited) {
  throw "Installed application exited during the 12-second startup observation (exit code $($application.ExitCode))"
}
$observedPid = $application.Id
Stop-Process -Id $application.Id -Force
$application.WaitForExit(15000) | Out-Null

$uninstallCommand = if (
  $entry.PSObject.Properties['QuietUninstallString'] -and
  $entry.QuietUninstallString
) {
  [string]$entry.QuietUninstallString
} elseif ($entry.PSObject.Properties['UninstallString']) {
  [string]$entry.UninstallString
} else {
  $null
}
if (-not $uninstallCommand) { throw 'Uninstall registration contains no uninstall command' }
Invoke-Uninstaller $uninstallCommand

for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  $remainingEntries = @(Get-WaeUninstallEntries)
  if ($remainingEntries.Count -eq 0 -and -not (Test-Path -LiteralPath $executable)) { break }
  Start-Sleep -Seconds 1
}
$remainingEntries = @(Get-WaeUninstallEntries)
if ($remainingEntries.Count -ne 0) { throw 'Silent uninstall left the WPS Agent Editor uninstall registration behind' }
if (Test-Path -LiteralPath $executable) { throw "Silent uninstall left the installed executable behind: $executable" }
$associationCleanupCount = 0
foreach ($group in $associationGroups) {
  $commandKey = "HKCU:\Software\Classes\$($group.ProgId)\shell\open\command"
  if (Test-Path -LiteralPath $commandKey -PathType Container) {
    throw "Silent uninstall left the file association command behind: $($group.ProgId)"
  }
  foreach ($extension in $group.Extensions) {
    $extensionKey = "HKCU:\Software\Classes\.$extension"
    $actualProgId = Get-RegistryDefaultValue $extensionKey
    if ($actualProgId -eq $group.ProgId) {
      throw "Silent uninstall left the .$extension file association behind"
    }
    $associationCleanupCount += 1
  }
}

$report = [ordered]@{
  schemaVersion = 1
  platform = 'windows'
  arch = $Arch
  installer = [IO.Path]::GetFileName($artifactPath)
  peMachine = ('0x{0:X4}' -f $actualMachine)
  authenticodeStatus = [string]$authenticode.Status
  signatureRequired = -not [bool]$AllowUnsigned
  signerSubject = if ($authenticode.SignerCertificate) { $authenticode.SignerCertificate.Subject } else { $null }
  installedExecutable = $executable
  fileAssociationCount = $associationCount
  fileAssociationsVerified = $true
  observedPid = $observedPid
  startupObservationSeconds = 12
  fileAssociationCleanupCount = $associationCleanupCount
  fileAssociationCleanupVerified = $true
  uninstallVerified = $true
}
[IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 4) + [Environment]::NewLine)
Write-Host "Windows install/start/uninstall smoke passed: $reportPath"
