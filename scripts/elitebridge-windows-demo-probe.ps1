# EliteBridge — read-only Windows MT5 DEMO diagnostics
# Local only. DOES NOT enroll device, transmit packets, or place orders.
# Run with PowerShell from the cloned EliteTrade repo, on a Windows x64 PC.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT -or
    -not [System.Environment]::Is64BitOperatingSystem) {
  throw "WINDOWS_64BIT_MT5_TERMINAL_REQUIRED"
}
foreach ($bin in @('python','node')) {
  if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) {
    throw "Missing $bin. Install Python 3.11+ (64-bit) and Node.js 24 on Windows first."
  }
}
if (-not (Test-Path 'companion\mt5_readonly_probe.py') -or
    -not (Test-Path 'scripts\elitebridge-mt5-probe.mjs')) {
  throw "Run this script from the root of the EliteTrade repository."
}
Write-Host "EliteBridge local MT5 DEMO read-only probe"
Write-Host "Launch your already-authenticated MetaTrader 5 DEMO terminal before continuing."
Write-Host "Never enter your trading password or MetaApi token into this script."
$login = Read-Host 'Expected MT5 DEMO account login (numbers only)'
$server = Read-Host 'Expected broker server name (exactly as shown in MT5)'
$symbol = Read-Host 'Symbol (default XAUUSDm)'
if ([string]::IsNullOrWhiteSpace($symbol)) { $symbol = 'XAUUSDm' }
if ($login -notmatch '^[1-9][0-9]{0,15}$' -or
    $server.Length -lt 2 -or $server.Length -gt 128 -or
    $symbol -notmatch '^[A-Za-z0-9._-]{3,30}$') {
  throw "INVALID_LOCAL_DEMO_CONFIGURATION"
}
try {
  # These GUIDs are temporary LAB scope only; not registered in Supabase.
  $env:ELITEBRIDGE_ACCOUNT_ID = [guid]::NewGuid().ToString()
  $env:ELITEBRIDGE_DEVICE_ID = [guid]::NewGuid().ToString()
  $env:ELITEBRIDGE_MT5_EXPECT_LOGIN = $login
  $env:ELITEBRIDGE_MT5_EXPECT_SERVER = $server
  $env:ELITEBRIDGE_MT5_SYMBOL = $symbol
  & node 'scripts/elitebridge-mt5-probe.mjs'
  if ($LASTEXITCODE -ne 0) { throw "LOCAL_MT5_PROBE_FAILED" }
  Write-Host "Successful local proof does NOT mean cloud pairing or independent broker verification."
} finally {
  foreach ($name in @('ELITEBRIDGE_ACCOUNT_ID','ELITEBRIDGE_DEVICE_ID',
      'ELITEBRIDGE_MT5_EXPECT_LOGIN','ELITEBRIDGE_MT5_EXPECT_SERVER',
      'ELITEBRIDGE_MT5_SYMBOL')) {
    [System.Environment]::SetEnvironmentVariable($name,$null,'Process')
  }
}
