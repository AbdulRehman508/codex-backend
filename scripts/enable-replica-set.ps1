<#
    Turns the local standalone MongoDB into a one-node replica set.

    Why bother: a standalone mongod has no transactions and no oplog, so there
    is no way to recover to a point in time. A replica set — even with a single
    member — gives both, and nothing else about the install changes.

    RUN THIS AS ADMINISTRATOR:
      right-click PowerShell -> "Run as administrator", then:
      cd E:\Project\codex-backend\codex
      powershell -ExecutionPolicy Bypass -File scripts\enable-replica-set.ps1

    It takes a database backup first, and keeps a copy of the old config, so
    the change can be undone.
#>

param(
    [string]$ConfigPath = 'C:\Program Files\MongoDB\Server\8.2\bin\mongod.cfg',
    [string]$ServiceName = 'MongoDB',
    [string]$ReplSetName = 'rs0',
    [int]$Port = 27017
)

$ErrorActionPreference = 'Stop'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Good($text) { Write-Host "    $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }

# --- must be elevated, or the config under Program Files cannot be written
$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Write-Host "This needs an elevated PowerShell (Run as administrator)." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $ConfigPath)) {
    Write-Host "mongod.cfg not found at: $ConfigPath" -ForegroundColor Red
    Write-Host "Pass the right path with -ConfigPath '<path to mongod.cfg>'" -ForegroundColor Red
    exit 1
}

# --- 1. back the data up before touching anything
Step 'Taking a database backup'
Push-Location (Split-Path $PSScriptRoot -Parent)
npm run backup
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Host 'Backup failed — stopping here rather than restarting MongoDB.' -ForegroundColor Red
    exit 1
}
Pop-Location
Good 'backup written to backups\'

# --- 2. keep the old config, then add the replication block
Step 'Updating mongod.cfg'
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
Copy-Item $ConfigPath "$ConfigPath.$stamp.bak" -Force
Good "old config saved as mongod.cfg.$stamp.bak"

$config = Get-Content $ConfigPath -Raw
if ($config -match '(?m)^\s*replication\s*:') {
    Warn 'the config already has a replication block — leaving it alone'
} else {
    # the commented-out "#replication:" placeholder ships with MongoDB
    $block = "replication:`r`n  replSetName: $ReplSetName`r`n"
    if ($config -match '(?m)^#replication:') {
        $config = $config -replace '(?m)^#replication:', $block.TrimEnd()
    } else {
        $config = $config.TrimEnd() + "`r`n`r`n" + $block
    }
    Set-Content -Path $ConfigPath -Value $config -Encoding ASCII
    Good "replSetName: $ReplSetName added"
}

# --- 3. restart the service so it picks the block up
Step "Restarting the $ServiceName service"
Restart-Service $ServiceName
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if ((Get-Service $ServiceName).Status -eq 'Running') { break }
}
if ((Get-Service $ServiceName).Status -ne 'Running') {
    Write-Host 'MongoDB did not come back up. Restore the .bak config and restart it.' -ForegroundColor Red
    exit 1
}
Good 'service running'

# --- 4. initiate the set (safe to re-run: an initiated set just says so)
Step 'Initiating the replica set'
$mongosh = (Get-Command mongosh -ErrorAction SilentlyContinue).Source
if (-not $mongosh) {
    $candidates = Get-ChildItem 'C:\Program Files\MongoDB' -Recurse -Filter 'mongosh.exe' -ErrorAction SilentlyContinue
    if ($candidates) { $mongosh = $candidates[0].FullName }
}

if ($mongosh) {
    & $mongosh --quiet --port $Port --eval @"
try {
  rs.status();
  print('already a replica set');
} catch (e) {
  rs.initiate({ _id: '$ReplSetName', members: [{ _id: 0, host: 'localhost:$Port' }] });
  print('replica set initiated');
}
"@
    Start-Sleep -Seconds 3
    & $mongosh --quiet --port $Port --eval "print('ok: ' + rs.status().ok + ', primary: ' + (rs.isMaster().ismaster))"
} else {
    # no shell installed — the driver can do it just as well
    Push-Location (Split-Path $PSScriptRoot -Parent)
    node -e @"
const { MongoClient } = require('mongodb');
(async () => {
  const c = new MongoClient('mongodb://localhost:$Port/?directConnection=true');
  await c.connect();
  const admin = c.db('admin');
  try {
    await admin.command({ replSetGetStatus: 1 });
    console.log('    already a replica set');
  } catch {
    await admin.command({
      replSetInitiate: { _id: '$ReplSetName', members: [{ _id: 0, host: 'localhost:$Port' }] },
    });
    console.log('    replica set initiated');
  }
  await new Promise((r) => setTimeout(r, 3000));
  const status = await admin.command({ replSetGetStatus: 1 });
  console.log('    ok:', status.ok, '| state:', status.members[0].stateStr);
  await c.close();
})().catch((e) => { console.error('    failed:', e.message); process.exit(1); });
"@
    Pop-Location
}

Step 'Done'
Good 'MongoDB is a one-node replica set. Nothing in the app changes.'
Warn 'Start the API and run `npm run test:e2e` to confirm everything still works.'
Write-Host "`nTo undo: restore mongod.cfg.$stamp.bak over mongod.cfg and restart the service.`n"
