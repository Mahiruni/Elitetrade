param(
    [string]$Source = (Join-Path $PSScriptRoot 'EliteTrade_SweepBreakout_Experimental_v1.mq5'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'build'),
    [string]$InstallDirectory = (Join-Path $env:TEMP 'EliteTrade-MT5-Compiler')
)
$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$outputPath = (Resolve-Path -LiteralPath $OutputDirectory).Path
$editor = Join-Path $InstallDirectory 'metaeditor64.exe'
if (-not (Test-Path -LiteralPath $editor)) {
    $installer = Join-Path $outputPath 'mt5setup.exe'
    Invoke-WebRequest -Uri 'https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe' -OutFile $installer
    $signature = Get-AuthenticodeSignature -FilePath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'MetaQuotes') {
        throw 'The official MT5 installer does not have a valid MetaQuotes Authenticode signature.'
    }
    $setup = Start-Process -FilePath $installer -ArgumentList @('/auto', "/path:`"$InstallDirectory`"") -PassThru
    if (-not $setup.WaitForExit(300000)) { throw 'The MetaTrader installation did not finish within five minutes.' }
    if (-not (Test-Path -LiteralPath $editor)) { throw 'MetaEditor was not installed at the requested path.' }
}
# The installer may start an empty terminal. Stop only this dedicated build installation.
Get-CimInstance Win32_Process -Filter "Name = 'terminal64.exe'" | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($InstallDirectory, [System.StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$compileDir = Join-Path $InstallDirectory 'MQL5\Experts\EliteTradeExperimental'
New-Item -ItemType Directory -Force -Path $compileDir | Out-Null
$compileSource = Join-Path $compileDir (Split-Path -Leaf $sourcePath)
Copy-Item -LiteralPath $sourcePath -Destination $compileSource -Force
$compiled = [System.IO.Path]::ChangeExtension($compileSource, '.ex5')
$logPath = [System.IO.Path]::ChangeExtension($compileSource, '.log')
if (Test-Path -LiteralPath $compiled) { Remove-Item -LiteralPath $compiled }
if (Test-Path -LiteralPath $logPath) { Remove-Item -LiteralPath $logPath }
$compiler = Start-Process -FilePath $editor -ArgumentList @("/compile:`"$compileSource`"", '/log') -PassThru
if (-not $compiler.WaitForExit(120000)) { throw 'MetaEditor compilation timed out.' }
if (-not (Test-Path -LiteralPath $logPath)) { throw 'MetaEditor did not produce a compilation log.' }
$bytes = [System.IO.File]::ReadAllBytes($logPath)
$text = if ($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) {
    [System.Text.Encoding]::Unicode.GetString($bytes)
} else { [System.Text.Encoding]::UTF8.GetString($bytes) }
$text | Set-Content -LiteralPath (Join-Path $outputPath 'compile.log') -Encoding utf8
Write-Output $text
if ($text -notmatch '\b0 errors, 0 warnings\b') { throw 'Compilation must report zero errors and zero warnings.' }
if (-not (Test-Path -LiteralPath $compiled) -or (Get-Item -LiteralPath $compiled).Length -lt 256) {
    throw 'No compiled EX5 was produced.'
}
Copy-Item -LiteralPath $compiled -Destination $outputPath -Force
Copy-Item -LiteralPath $sourcePath -Destination $outputPath -Force
$compiledOutput = Join-Path $outputPath (Split-Path -Leaf $compiled)
$manifest = [ordered]@{
    schemaVersion = 1
    name = 'EliteTrade SweepBreakout Experimental v1'
    sourceSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash.ToLowerInvariant()
    ex5Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $compiledOutput).Hash.ToLowerInvariant()
    metaEditorVersion = (Get-Item -LiteralPath $editor).VersionInfo.FileVersion
    compileErrors = 0
    compileWarnings = 0
    originalEX5Compared = $false
    strategyTesterRunPerformed = $false
    brokerTradingTestPerformed = $false
    equivalenceToOriginalVerified = $false
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputPath 'build-manifest.json') -Encoding utf8
Write-Output "Compiled EA: $compiledOutput"
