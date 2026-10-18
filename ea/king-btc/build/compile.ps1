$ErrorActionPreference = "Stop"
$package = (Resolve-Path "$PSScriptRoot\..").Path
$mt5Root = Join-Path $env:RUNNER_TEMP "KingBTC-MT5"
$installer = Join-Path $env:RUNNER_TEMP "kingbtc-mt5setup.exe"
$download = "https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/mt5setup.exe"
Invoke-WebRequest $download -OutFile $installer
$signature = Get-AuthenticodeSignature $installer
if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "MetaQuotes") {
    throw "Installer signature is invalid or publisher is not MetaQuotes"
}
$install = Start-Process $installer -ArgumentList @("/auto", "/path:""$mt5Root""") -PassThru
if (-not $install.WaitForExit(300000)) { $install.Kill(); throw "MT5 installation timed out" }
$editor = Join-Path $mt5Root "metaeditor64.exe"
if (-not (Test-Path $editor)) { throw "MetaEditor not installed at expected path" }
if (-not (Test-Path "$mt5Root\MQL5\Include\Trade\Trade.mqh")) { throw "Standard MQL5 trade library missing" }
$source = Join-Path $package "King_of_Scalper_BTC.mq5"
$binary = [IO.Path]::ChangeExtension($source, ".ex5")
$log = [IO.Path]::ChangeExtension($source, ".log")
Remove-Item $binary,$log -Force -ErrorAction SilentlyContinue
$compile = Start-Process $editor -ArgumentList @("/portable", "/compile:""$source""", "/include:""$mt5Root\MQL5""", "/log") -PassThru
if (-not $compile.WaitForExit(180000)) { $compile.Kill(); throw "MetaEditor compilation timed out" }
if (-not (Test-Path $log)) { throw "Compiler log missing" }
$compilerLog = Get-Content $log -Raw
Write-Output $compilerLog
if ($compilerLog -notmatch "0 errors, 0 warnings") { throw "Compiler did not report zero errors and zero warnings" }
if (-not (Test-Path $binary) -or (Get-Item $binary).Length -eq 0) { throw "Compiled EX5 missing/empty" }
$build = (Get-Item $editor).VersionInfo.FileVersion
$hash = (Get-FileHash $binary -Algorithm SHA256).Hash.ToLower()
$bytes = (Get-Item $binary).Length
$report = @"
# Build evidence

- MetaEditor version: $build
- Compiler: official MetaQuotes distribution, valid Authenticode signature.
- Compilation: zero errors, zero warnings (see King_of_Scalper_BTC.log).
- EX5 size: $bytes bytes.
- EX5 SHA-256: $hash
- Source commit: $env:GITHUB_SHA
- Shared sizing-header numeric assertions: separate numeric-tests workflow job.
- Broker execution, MT5 runtime behavior, historical profitability and win rate: NOT TESTED.
- No account credentials were used; no trading account was connected.

Do not interpret compilation or numeric checks as a validated trading strategy.
"@
Set-Content (Join-Path $package "BUILD_REPORT.md") $report -Encoding utf8
$delivery = Join-Path $env:RUNNER_TEMP "King_of_Scalper_BTC"
New-Item -ItemType Directory -Path $delivery -Force | Out-Null
foreach ($name in @("King_of_Scalper_BTC.mq5","King_BTC_Risk.mqh","King_of_Scalper_BTC.ex5","King_of_Scalper_BTC_Demo.set","King_of_Scalper_BTC.log","README.md","TEST_REPORT.md","BUILD_REPORT.md")) {
    Copy-Item (Join-Path $package $name) $delivery
}
Compress-Archive -Path "$delivery\*" -DestinationPath (Join-Path $package "King_of_Scalper_BTC_Package.zip") -Force
