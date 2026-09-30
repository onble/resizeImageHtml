param([int]$Port = 4178, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskUrl = "http://127.0.0.1:$Port"
try {
    $taskPage = Invoke-WebRequest -Uri $taskUrl -UseBasicParsing -TimeoutSec 2
    if ($taskPage.Content -notmatch 'name="resize-token"') { throw "端口 $Port 被其他程序占用。请使用 .\start.ps1 -Port 4179。" }
    if (-not $NoOpen) { Start-Process $taskUrl }
    exit 0
} catch {
    if ($_.Exception.Message -like '*被其他程序占用*') { throw }
}
$taskNode = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $taskNode) {
    $taskBundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $taskBundled) { $taskNode = $taskBundled }
}
if (-not $taskNode) { throw '未找到 Node.js，请安装 Node.js 20 或更新版本后重新启动。无需安装 npm 依赖。' }
$taskVersion = & $taskNode --version
if ([int]($taskVersion.TrimStart('v').Split('.')[0]) -lt 20) { throw '需要 Node.js 20 或更新版本。' }
$taskRuntime = Join-Path $taskRoot '.runtime'
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
$taskServer = Join-Path $taskRoot 'server.mjs'
$env:PORT = "$Port"
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList @(('"' + $taskServer + '"'), '--no-open') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRuntime 'server.log') -RedirectStandardError (Join-Path $taskRuntime 'server.error.log')
Set-Content -LiteralPath (Join-Path $taskRuntime 'server.pid') -Value $taskProcess.Id
$taskReady = $false
for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    Start-Sleep -Milliseconds 200
    if ($taskProcess.HasExited) { throw "启动失败，请查看 $taskRuntime\server.error.log" }
    try {
        $taskResponse = Invoke-WebRequest -Uri $taskUrl -UseBasicParsing -TimeoutSec 1
        if ($taskResponse.Content -match 'name="resize-token"') { $taskReady = $true; break }
    } catch {}
}
if (-not $taskReady) { throw "服务未就绪，请查看 $taskRuntime\server.error.log" }
if (-not $NoOpen) { Start-Process $taskUrl }
Write-Host "已启动：$taskUrl。关闭网页不会停止服务；双击 停止工具.cmd 可停止后台服务。"
