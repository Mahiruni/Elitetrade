# EliteTrade — fail-closed MetaEditor compiler wrapper.
# Compiles source ONLY; never launches a trading strategy or logs in to a broker.
[CmdletBinding()]
param(
    [string]$Source = 'MQL5/EliteTrade_SweepResearch_v1.mq5',
    [string]$EvidenceDir = 'build-evidence',
    [string]$MetaEditorPath = '',
    [string]$Mql5Root = '',
    [string]$InstallerUrl = 'https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Wait-ForFile([string]$Path, [int]$Seconds = 150) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        if ($timer.Elapsed.TotalSeconds -gt $Seconds) {
            throw "Expected file was not created: $Path"
        }
        Start-Sleep -Seconds 3
    }
}

$sourceFile = (Resolve-Path -LiteralPath $Source -ErrorAction Stop).Path
$evidence = [IO.Path]::GetFullPath($EvidenceDir)
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant()

if ([string]::IsNullOrWhiteSpace($MetaEditorPath)) {
    $tmp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
    if ([string]::IsNullOrWhiteSpace($tmp)) { throw 'No safe temporary directory found.' }
    $root = Join-Path $tmp 'EliteTradeMT5'
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    $setupFile = Join-Path $tmp 'elitetrade-mt5setup.exe'

    $installerHost = ([uri]$InstallerUrl).Host
    if ($installerHost -notin @('download.mql5.com', 'www.metatrader5.com')) {
        throw 'Installer must come from an allowlisted MetaQuotes download host.'
    }
    Write-Host 'Downloading official MetaTrader installer. No broker login is performed.'
    Invoke-WebRequest -Uri $InstallerUrl -OutFile $setupFile -MaximumRedirection 5
    $signature = Get-AuthenticodeSignature -LiteralPath $setupFile
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch 'MetaQuotes') {
        throw "Installer signature not validated as MetaQuotes: $($signature.Status)"
    }
    $args = @('/auto', ('/path:"' + $root + '"'))
    $setup = Start-Process -FilePath $setupFile -ArgumentList $args -Wait -PassThru
    $MetaEditorPath = Join-Path $root 'metaeditor64.exe'
    $installSummary = @(
        'Official MetaQuotes installer status (no broker credentials):',
        "Exit code: $($setup.ExitCode)",
        "Installer bytes: $((Get-Item -LiteralPath $setupFile).Length)",
        "MetaEditor present: $(Test-Path -LiteralPath $MetaEditorPath)",
        "Terminal present: $(Test-Path -LiteralPath (Join-Path $root 'terminal64.exe'))",
        'Install-directory entries:'
    )
    $installSummary += @(Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue | Select-Object -First 30 -ExpandProperty Name)
    $installSummary | Set-Content -LiteralPath (Join-Path $evidence 'installer-diagnostics.txt') -Encoding UTF8
    if ($setup.ExitCode -ne 0) {
        throw "MetaTrader installation failed: exit code $($setup.ExitCode). Check installer-diagnostics artifact."
    }
    Wait-ForFile $MetaEditorPath 150
    $Mql5Root = Join-Path $root 'MQL5'
    $terminalPath = Join-Path $root 'terminal64.exe'
    # The portable terminal can initialize the standard MQL5 library in this folder.
    # It is stopped before compilation, never given credentials, and never configured to trade.
    $stdLibFile = Join-Path $Mql5Root 'Include/Trade/Trade.mqh'
    if (-not (Test-Path -LiteralPath $stdLibFile)) {
        Write-Host 'Attempting to initialize the MQL5 standard library.'
        if (-not (Test-Path -LiteralPath $terminalPath)) { throw 'MT5 terminal.exe missing after setup.' }
        $terminal = Start-Process -FilePath $terminalPath -ArgumentList '/portable' -PassThru
        try { Wait-ForFile $stdLibFile 90 }
        finally {
            if (-not $terminal.HasExited) { Stop-Process -Id $terminal.Id -Force -ErrorAction SilentlyContinue }
        }
    }
}

$meta = (Resolve-Path -LiteralPath $MetaEditorPath).Path
if ([string]::IsNullOrWhiteSpace($Mql5Root)) {
    $Mql5Root = Join-Path (Split-Path -Path $meta -Parent) 'MQL5'
}
$Mql5Root = [IO.Path]::GetFullPath($Mql5Root)
$stdlib = Join-Path $Mql5Root 'Include/Trade/Trade.mqh'
if (-not (Test-Path -LiteralPath $stdlib -PathType Leaf)) {
    throw "MQL5 standard library unavailable: $stdlib. Specify -Mql5Root or install/initialize MetaTrader."
}

$expertFolder = Join-Path $Mql5Root 'Experts/EliteTradeResearch'
New-Item -ItemType Directory -Force -Path $expertFolder | Out-Null
$destination = Join-Path $expertFolder ([IO.Path]::GetFileName($sourceFile))
Copy-Item -LiteralPath $sourceFile -Destination $destination -Force
$binary = [IO.Path]::ChangeExtension($destination, '.ex5')
$compilerLog = [IO.Path]::ChangeExtension($destination, '.log')
# IMPORTANT: reject a stale executable even if MetaEditor reports failure.
Remove-Item -LiteralPath $binary -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $compilerLog -ErrorAction SilentlyContinue

Write-Host "Compiling: $destination"
$arguments = @('/compile:"' + $destination + '"', '/include:"' + $Mql5Root + '"', '/log')
$build = Start-Process -FilePath $meta -ArgumentList $arguments -Wait -PassThru

$logCopy = Join-Path $evidence 'metaeditor-compilation.log'
if (Test-Path -LiteralPath $compilerLog) {
    Copy-Item -LiteralPath $compilerLog -Destination $logCopy -Force
    $logText = Get-Content -LiteralPath $compilerLog -Raw
    if ($logText -match '(?mi)\b[1-9][0-9]*\s+errors?\b' -or
        $logText -match '(?mi)^.*:\s*error\s*[:(]') {
        throw "MetaEditor reported errors; check $logCopy"
    }
} else {
    throw 'MetaEditor did not produce a compilation log. Build is unverified.'
}
if ($build.ExitCode -ne 0) { throw "MetaEditor exit code $($build.ExitCode)." }
if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
    throw 'MetaEditor did not create an EX5 file. Build is unverified.'
}
if ((Get-Item -LiteralPath $binary).Length -lt 1024) {
    throw 'EX5 is unexpectedly small; refusing artifact.'
}

$binaryCopy = Join-Path $evidence ([IO.Path]::GetFileName($binary))
Copy-Item -LiteralPath $binary -Destination $binaryCopy -Force
$binaryHash = (Get-FileHash -LiteralPath $binaryCopy -Algorithm SHA256).Hash.ToLowerInvariant()
$record = [ordered]@{
    label = 'CLOUD_COMPILATION_ONLY_NOT_MT5_TESTED'
    source_sha256 = $sourceHash
    binary_sha256 = $binaryHash
    source_name = [IO.Path]::GetFileName($sourceFile)
    compiled_name = [IO.Path]::GetFileName($binaryCopy)
    created_utc = (Get-Date).ToUniversalTime().ToString('o')
    github_sha = $env:GITHUB_SHA
    broker_connected = $false
    strategy_tested = $false
    original_equivalence_proven = $false
}
$record | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $evidence 'build-manifest.json') -Encoding utf8
Write-Host "Compilation artifact: $binaryCopy"
Write-Host "Compiled binary SHA256: $binaryHash"