# EliteTrade Phase 4: Windows Strategy Tester orchestration. No live chart EA is started.
# NEVER archive the plaintext ini, account login, password, journals, or reports.
[CmdletBinding()]
param(
    [ValidateSet('signal','execution')][string]$Mode = 'signal',
    [string]$Symbol = 'XAUUSD',
    [string]$FromDate = '2026.01.01',
    [string]$ToDate = '2026.04.01',
    [string]$OutputDir = 'phase4-safe-output'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$expectedHash = '16627b5419bd777662472479f4fed23f187ca6c3853e4352d0c01d0bc2168528'
$evidenceRun = '38734987113'
$artifactName = 'elitetrade-research-ea-ex5-unverified-runtime'
$root = Join-Path $env:RUNNER_TEMP 'EliteTradePhase4MT5'
$staging = Join-Path $env:RUNNER_TEMP 'EliteTradePhase4PrivateEvidence'
$protectedIni = Join-Path $env:RUNNER_TEMP 'elitetrade-private-tester.ini'
$safe = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $safe -Force | Out-Null
$runState = 'NOT_STARTED'
$reportCreated = $false
$eventFound = $false
$decisionFound = $false
$terminalExitCode = $null

function Publish-Status([string]$state) {
    $status = [ordered]@{
        project = 'ELITETRADE_PHASE4_RESEARCH_ONLY'
        result = $state
        mode = $Mode
        symbol = $Symbol
        requested_model = 4
        requested_timeframe = 'M1'
        real_tick_history_validated = $false
        original_ex5_compared = $false
        profitability_established = $false
        live_trading_performed = $false
        expected_ex5_sha256 = $expectedHash
        tester_report_created = $reportCreated
        terminal_exit_code = $terminalExitCode
        deal_capture_found = $eventFound
        decision_capture_found = $decisionFound
        created_utc = (Get-Date).ToUniversalTime().ToString('o')
    }
    $status | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $safe 'safe-status.json') -Encoding utf8
}

try {
    if ($env:GITHUB_REF -ne 'refs/heads/research/cloud-compile-ea-20261015') {
        throw 'Research-branch gate refused the test.'
    }
    if ([string]::IsNullOrEmpty($env:GH_TOKEN)) { throw 'Artifact read token missing.' }
    if ([string]::IsNullOrEmpty($env:MT5_DEMO_LOGIN) -or
        [string]::IsNullOrEmpty($env:MT5_DEMO_PASSWORD) -or
        [string]::IsNullOrEmpty($env:MT5_DEMO_SERVER) -or
        [string]::IsNullOrEmpty($env:MT5_EVIDENCE_PASSPHRASE)) {
        throw 'Missing dedicated demo account or evidence encryption secrets.'
    }
    if ($Mode -eq 'execution' -and
        $env:ELITETRADE_SIMULATION_CONFIRMATION -ne 'TESTER_ONLY_NO_LIVE_ORDERS') {
        throw 'Execution-mode safety lock is closed.'
    }
    if ($env:MT5_EVIDENCE_PASSPHRASE.Length -lt 20) {
        throw 'Evidence encryption secret must be >=20 characters.'
    }

    # Download only the known, previously verified independent compiled EX5.
    $download = Join-Path $env:RUNNER_TEMP 'EliteTradeVerifiedEX5'
    New-Item -ItemType Directory -Path $download -Force | Out-Null
    & gh run download $evidenceRun --repo 'Mahiruni/Elitetrade' -n $artifactName -D $download
    if ($LASTEXITCODE -ne 0) { throw 'The verified compiled artifact could not be downloaded.' }
    $matched = @(Get-ChildItem -LiteralPath $download -Recurse -File -Filter 'EliteTrade_SweepResearch_v1.ex5')
    if ($matched.Count -ne 1) { throw 'Expected exactly one compiled research EA binary.' }
    $actualHash = (Get-FileHash -LiteralPath $matched[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) { throw 'EX5 hash did not match the previously verified compile.' }
    Write-Host 'Verified exact candidate EX5 fingerprint.'

    # Obtain official signed MetaTrader, not a third-party installer.
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $installer = Join-Path $env:RUNNER_TEMP 'elite-official-mt5setup.exe'
    Invoke-WebRequest -Uri 'https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe' -OutFile $installer -MaximumRedirection 4
    $auth = Get-AuthenticodeSignature -LiteralPath $installer
    if ($auth.Status -ne 'Valid' -or $auth.SignerCertificate.Subject -notmatch 'MetaQuotes') {
        throw 'The MT5 installer is not signed by MetaQuotes.'
    }
    $setup = Start-Process -FilePath $installer -ArgumentList @('/auto', ('/path:"' + $root + '"')) -Wait -PassThru
    if ($setup.ExitCode -ne 0) { Write-Warning 'MT5 installer returned a nonzero status. Validating installed files.' }
    $terminal = Join-Path $root 'terminal64.exe'
    if (-not (Test-Path -LiteralPath $terminal -PathType Leaf)) { throw 'MT5 terminal not installed.' }
    $terminalSig = Get-AuthenticodeSignature -LiteralPath $terminal
    if ($terminalSig.Status -ne 'Valid' -or $terminalSig.SignerCertificate.Subject -notmatch 'MetaQuotes') {
        throw 'MetaTrader terminal signature did not validate.'
    }
    Write-Host 'Official signed MetaTrader terminal validated.'

    $expertDir = Join-Path $root 'MQL5\Experts\EliteTradeResearch'
    $presetDir = Join-Path $root 'MQL5\Profiles\Tester'
    $reportsDir = Join-Path $root 'reports'
    foreach($dir in @($expertDir,$presetDir,$reportsDir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Copy-Item -LiteralPath $matched[0].FullName -Destination (Join-Path $expertDir 'EliteTrade_SweepResearch_v1.ex5') -Force
    $presetFrom = if ($Mode -eq 'signal') { 'research/phase3/configs/signal_only.set' } else { 'research/phase3/configs/execution.set' }
    $presetName = 'phase4-' + $Mode + '.set'
    Copy-Item -LiteralPath $presetFrom -Destination (Join-Path $presetDir $presetName) -Force

    # Python reads secrets from the runner environment and writes a temporary file.
    # The file is NEVER uploaded, printed or committed. For full capture confidentiality
    # no unencrypted report, CSV or journal is included in any Actions artifact.
    & python research/phase4/scripts/tester_config.py --mode $Mode --symbol $Symbol --from-date $FromDate --to-date $ToDate --output $protectedIni
    if ($LASTEXITCODE -ne 0) { throw 'Tester config validation failed.' }
    if (-not (Test-Path -LiteralPath $protectedIni -PathType Leaf)) { throw 'Tester config absent.' }

    $runState = 'LAUNCHED_TERMINAL'
    Write-Host 'Starting temporary MT5 Strategy Tester (never attaches EA to a live chart).'
    $t0 = Get-Date
    $process = Start-Process -FilePath $terminal -ArgumentList @('/portable', ('/config:"' + $protectedIni + '"')) -PassThru
    try {
        Wait-Process -Id $process.Id -Timeout 540 -ErrorAction Stop
    } catch {
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
        throw 'MT5 Strategy Tester failed to finish within the time limit.'
    }

    $terminalExitCode = $process.ExitCode
    $runState = 'TERMINAL_RETURNED_REPORT_SEARCH'
    # MT5 may write command-line reports under the terminal data root instead of its installation subfolder.
    # Collect metadata only; no plaintext account details or journals go to CI artifacts.
    $reportCandidates = @()
    $reportSearchRoots = @($reportsDir, $root, (Join-Path $env:APPDATA 'MetaQuotes\Terminal'))
    foreach ($searchRoot in $reportSearchRoots) {
        if (-not (Test-Path -LiteralPath $searchRoot -PathType Container)) { continue }
        $reportCandidates += @(Get-ChildItem -LiteralPath $searchRoot -Recurse -File -Filter 'phase4-test*' -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^phase4-test(\.|\[)' -and $_.Extension -in @('.htm','.html') -and $_.LastWriteTime -ge $t0.AddSeconds(-5) })
    }
    $reportFile = @($reportCandidates | Sort-Object -Property LastWriteTime -Descending | Select-Object -First 1)
    if ($reportFile.Count -ne 1 -or $reportFile[0].Length -lt 1024) {
        throw 'No fresh completed Strategy Tester report; broker history or tester execution remains unverified.'
    }
    $reportCreated = $true
    $runState = 'MT5_REPORT_CREATED_TICK_PROVENANCE_UNVERIFIED'

    # Staging is local to the Windows runner and is only uploaded *encrypted*.
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    Copy-Item -LiteralPath $reportFile[0].FullName -Destination (Join-Path $staging 'mt5-report.htm')
    $commonEvidence = Join-Path $env:APPDATA 'MetaQuotes\Terminal\Common\Files\EliteTradeEvidence'
    $candidateDirs = @($commonEvidence, (Join-Path $root 'MQL5\Files\EliteTradeEvidence'))
    $candidateDirs += @(Get-ChildItem -LiteralPath (Join-Path $root 'Tester') -Directory -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'EliteTradeEvidence' } | Select-Object -ExpandProperty FullName)
    foreach ($folder in $candidateDirs) {
        if (-not (Test-Path -LiteralPath $folder -PathType Container)) { continue }
        $pairs = @(Get-ChildItem -LiteralPath $folder -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^candidate-' -and $_.LastWriteTime -ge $t0.AddSeconds(-5) })
        foreach($csv in $pairs) {
            if ($csv.Name.EndsWith('-events.csv')) {
                Copy-Item -LiteralPath $csv.FullName -Destination (Join-Path $staging 'events.csv') -Force
                $eventFound = $true
            } elseif ($csv.Name.EndsWith('-decisions.csv')) {
                Copy-Item -LiteralPath $csv.FullName -Destination (Join-Path $staging 'decisions.csv') -Force
                $decisionFound = $true
            }
        }
    }
    # Reject a report-only capture. More checks occur with Phase 3 offline evaluator.
    if (-not $decisionFound -or -not $eventFound) {
        throw 'MT5 report exists, but complete EA CSV capture was not located.'
    }
    $runState = 'MT5_REPORT_AND_CSV_CAPTURE_PRESENT_UNVERIFIED_TICK_PROVENANCE'
    Write-Host 'MT5 report and transaction CSV found. Historical tick provenance has NOT been verified.'
} catch {
    # Do not serialize exception text; it might contain a broker account or server.
    Write-Warning 'Phase 4 did not complete all evidence gates. See safe-status.json.'
    $runState = 'BLOCKED_AFTER_' + $runState
} finally {
    # Always encrypt any captured raw report/CSV before archiving.
    if (Test-Path -LiteralPath $staging -PathType Container) {
        $files = @(Get-ChildItem -LiteralPath $staging -File)
        if ($files.Count -gt 0 -and $env:MT5_EVIDENCE_PASSPHRASE.Length -ge 20) {
            & python research/phase4/scripts/evidence_vault.py seal --source $staging --output (Join-Path $safe 'evidence.aesgcm')
            if ($LASTEXITCODE -ne 0) { $runState = 'ENCRYPTION_FAILED_NO_PLAINTEXT_ARTIFACTS' }
        }
    }
    Publish-Status $runState
    Remove-Item -LiteralPath $protectedIni -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $staging -Force -Recurse -ErrorAction SilentlyContinue
}
if ($runState -ne 'MT5_REPORT_AND_CSV_CAPTURE_PRESENT_UNVERIFIED_TICK_PROVENANCE') {
    throw 'Phase 4 evidence is incomplete (no live trading occurred).'
}
Write-Host 'Phase 4 cloud capture completed. Artifacts include encrypted evidence and redacted status only.'