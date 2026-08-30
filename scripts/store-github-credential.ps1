[CmdletBinding()]
param(
    [string]$Username = 'x-access-token',
    [string]$HostName = 'github.com'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git is required to store the GitHub credential.'
}

$secureToken = Read-Host "GitHub PAT for $HostName (hidden input)" -AsSecureString
$tokenPointer = [IntPtr]::Zero
try {
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        throw 'A non-empty GitHub PAT is required.'
    }

    $credential = "protocol=https`nhost=$HostName`nusername=$Username`npassword=$plainToken`n`n"
    $credential | git credential approve
    if ($LASTEXITCODE -ne 0) {
        throw 'Git Credential Manager did not accept the credential.'
    }
    Write-Output "Stored the GitHub credential for $HostName in the configured credential manager."
}
finally {
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    $plainToken = $null
    $credential = $null
}
