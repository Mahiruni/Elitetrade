import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const script=src('../scripts/elitebridge-windows-vps-preflight.ps1');
const docs=src('../docs/ELITEBRIDGE_WINDOWS_VPS_RUNBOOK.md');
const workflow=src('../.github/workflows/elitebridge-phase7-mt5-lab.yml');
test('Windows VPS preflight is read-only and never mutates host RDP, firewall or account configuration',()=>{
 assert.match(script,/ValidateSet\('Audit','Ready'\)/);
 assert.match(script,/ELITEBRIDGE_REQUIRES_WINDOWS_X64_VPS/);
 assert.match(script,/Get-CimInstance Win32_ComputerSystem/);
 assert.match(script,/Get-NetFirewallProfile/);
 assert.match(script,/Get-Command \$command/);
 assert.match(script,/Get-Process -Name 'terminal64'/);
 assert.match(script,/Mode -eq 'Ready' -and \$missing.Count -gt 0/);
 assert.doesNotMatch(script,/Disable-NetFirewallRule|Enable-NetFirewallRule|New-NetFirewallRule|Set-NetFirewallRule|Set-NetFirewallProfile|Set-ItemProperty|New-ItemProperty|winrm quickconfig|Set-ExecutionPolicy|Set-LocalUser|net user|Enable-PSRemoting|Enable-NetAdapter|Set-Registry/i);
 assert.doesNotMatch(script,/Invoke-WebRequest|Invoke-RestMethod|Start-Process|OrderSend|order_send|mt5\.login|mt5\.initialize/i);
 assert.doesNotMatch(script,/Write-Output\s+\$(?:env:)?(?:password|secret|token|login|username)/i);
});
test('Windows VPS guide maintains DEMO-only broker and token authority boundaries',()=>{
 assert.match(docs,/Windows Server.+Desktop Experience/i);
 assert.match(docs,/Android phone/i);
 assert.match(docs,/IP-restricted RDP firewall\/VPN/);
 assert.match(docs,/python -m pip install MetaTrader5/);
 assert.match(docs,/elitebridge-windows-vps-preflight\.ps1 -Mode Audit/);
 assert.match(docs,/elitebridge-windows-demo-probe\.ps1/);
 assert.match(docs,/DEMO/);
 assert.match(docs,/REAL\/CONTEST accounts/);
 assert.match(docs,/DEVICE ENROLLED: NO \| NETWORK REQUESTS: 0 \| ORDERS: 0/);
 assert.match(docs,/MetaApi is unchanged/);
});
test('CI audits actual Windows PowerShell without pretending hosted runner has real broker access',()=>{
 assert.match(workflow,/windows-latest/);
 assert.match(workflow,/ubuntu-latest/);
 assert.match(workflow,/elitebridge-windows-vps-preflight\.ps1 -Mode Audit/);
 assert.match(workflow,/elitebridge-windows-vps-preflight\.test\.mjs/);
 assert.doesNotMatch(workflow,/order_send|DEMO_EXECUTION_ENABLED\s*=\s*true/);
});
