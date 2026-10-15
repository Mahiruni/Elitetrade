# EliteBridge VPS — READ-ONLY Windows environment and MT5 prerequisite audit.
# Does not configure RDP, firewall, automatic login, broker accounts or trading.
# .\scripts\elitebridge-windows-vps-preflight.ps1 -Mode Audit
# .\scripts\elitebridge-windows-vps-preflight.ps1 -Mode Ready
[CmdletBinding()]
param(
  [ValidateSet('Audit','Ready')]
  [string]$Mode = 'Audit'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$windows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
if (-not $windows -or -not [Environment]::Is64BitOperatingSystem) {
  throw 'ELITEBRIDGE_REQUIRES_WINDOWS_X64_VPS'
}

$rows = New-Object System.Collections.Generic.List[object]
function Add-Check([string]$Name,[bool]$OK,[string]$Advice) {
  $rows.Add([pscustomobject]@{
    Check = $Name
    State = if ($OK) { 'OK' } else { 'ACTION NEEDED' }
    Next = $Advice
  })
}

# Do not print broker login, account server, username, IP, secret env vars or
# terminal command-line details. Firewall is observed, not reconfigured.
try {
  $system = Get-CimInstance Win32_ComputerSystem
  $memoryGb = [math]::Round([double]$system.TotalPhysicalMemory / 1GB,1)
  $cores = [int]$system.NumberOfLogicalProcessors
} catch {
  $memoryGb = 0
  $cores = 0
}
Add-Check 'Windows x64' $true 'Desktop-enabled Windows Server 2022/2025 or supported Windows x64.'
Add-Check 'CPU >= 2 logical cores' ($cores -ge 2) 'Prefer 4 vCPU for reliable terminal + companion performance.'
Add-Check 'RAM >= 4 GB' ($memoryGb -ge 4) 'Prefer 8 GB RAM for 24/7 MT5 + Python + Node.js.'
try {
  $profiles = @(Get-NetFirewallProfile -ErrorAction Stop)
  $firewallOn = $profiles.Count -gt 0 -and @($profiles | Where-Object { -not $_.Enabled }).Count -eq 0
} catch { $firewallOn = $false }
Add-Check 'Windows firewall enabled' $firewallOn 'Enable Windows Defender Firewall and restrict RDP 3389 in provider firewall to your trusted IP/VPN.'
foreach ($command in @('git','node','python')) {
  $found = $null
  try { $found = Get-Command $command -ErrorAction SilentlyContinue } catch { }
  Add-Check ($command + ' installed') ($null -ne $found) ('Install supported 64-bit ' + $command + ' on the VPS.')
}
$python = Get-Command python -ErrorAction SilentlyContinue
$hasSdk = $false
if ($null -ne $python) {
  try {
    # No MT5 login, initialize(), password or network request is attempted.
    & python -I -c 'import importlib.util,sys; sys.exit(0 if importlib.util.find_spec("MetaTrader5") else 1)' 2>$null
    $hasSdk = $LASTEXITCODE -eq 0
  } catch { $hasSdk = $false }
}
Add-Check 'Official MetaTrader5 Python package' $hasSdk 'Install using: python -m pip install MetaTrader5 (on Windows x64).'
$mt5Process = @(Get-Process -Name 'terminal64' -ErrorAction SilentlyContinue)
Add-Check 'MT5 desktop process running' ($mt5Process.Count -gt 0) 'Install desktop MetaTrader 5 and sign in to your DEMO account using its normal UI.'
$repoRoot = Split-Path -Parent $PSScriptRoot
Add-Check 'EliteTrade companion checked out' (
  (Test-Path (Join-Path $repoRoot 'companion\mt5_readonly_probe.py')) -and
  (Test-Path (Join-Path $repoRoot 'scripts\elitebridge-mt5-probe.mjs'))
) 'Clone the approved EliteTrade repository to a private folder on your VPS.'

Write-Output 'EliteBridge · Windows VPS prerequisites (READ-ONLY)'
$rows | Format-Table -AutoSize | Out-String -Width 180 | Write-Output
Write-Output 'IMPORTANT: Passing checks proves only machine readiness, NOT broker authentication, enrolled keys or trade execution.'
Write-Output 'Keep Remote Desktop behind a VPN or provider IP allowlist with MFA; never paste an RDP/MT5 password into ChatGPT.'
$missing = @($rows | Where-Object { $_.State -ne 'OK' })
Write-Output ('PRECHECK: ' + ($rows.Count - $missing.Count) + '/' + $rows.Count + ' OK; ' + $missing.Count + ' need action.')
if ($Mode -eq 'Ready' -and $missing.Count -gt 0) { exit 2 }
