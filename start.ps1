param([int]$Port = 4178, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskUrl = "http://127.0.0.1:$Port"
if ($Port -lt 1 -or $Port -gt 65535) { throw '端口必须为 1–65535。' }
$taskRuntime = Join-Path $taskRoot '.runtime'
$taskPidFile = Join-Path $taskRuntime 'server.pid'
$taskServer = Join-Path $taskRoot 'server.mjs'
$taskNode = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $taskNode) {
    $taskBundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $taskBundled) { $taskNode = $taskBundled }
}
if (-not $taskNode) { throw '未找到 Node.js，请安装 Node.js 20 或更新版本后重新启动。无需安装 npm 依赖。' }
$taskVersion = & $taskNode --version
if ([int]($taskVersion.TrimStart('v').Split('.')[0]) -lt 20) { throw '需要 Node.js 20 或更新版本。' }
$taskProcessor = Join-Path $taskRoot 'image-processor.mjs'
$taskCheckOutput = & $taskNode $taskProcessor --check
if ($LASTEXITCODE -ne 0) { throw '图片处理启动自检失败，请查看上方错误。需要 Python 3.10 或更新版本及 Pillow；可通过 RESIZE_IMAGE_PYTHON 指定 Python，启动脚本不会自动安装依赖。' }
try { $taskExpected = ($taskCheckOutput -join "`n") | ConvertFrom-Json }
catch { throw '图片处理预检返回无效 JSON，无法确认本地服务版本。' }
if ($taskExpected.protocol -ne 2 -or -not $taskExpected.buildId) { throw '图片处理预检缺少协议版本或构建标识，无法安全复用服务。' }
if ($taskExpected.processingCheck.format -ne 'png' -or $taskExpected.processingCheck.width -ne 1 -or $taskExpected.processingCheck.height -ne 1) { throw '图片处理预检未完成真实 PNG 缩放，无法启动服务。' }

function Get-TaskService {
    try { $taskPage = Invoke-WebRequest -Uri $taskUrl -UseBasicParsing -TimeoutSec 2 }
    catch { return $null }
    $taskTokenMatch = [regex]::Match($taskPage.Content, 'name="resize-token"\s+content="([^"]+)"')
    if (-not $taskTokenMatch.Success) { return [pscustomobject]@{ Recognized = $false; Engine = $null } }
    $taskEngine = $null
    try { $taskEngine = Invoke-RestMethod -Uri "$taskUrl/api/engine" -Headers @{ 'X-Resize-Token' = $taskTokenMatch.Groups[1].Value } -TimeoutSec 2 }
    catch { }
    return [pscustomobject]@{ Recognized = $true; Engine = $taskEngine }
}

function Test-TaskVersion($taskService) {
    return $null -ne $taskService -and $taskService.Recognized -and $null -ne $taskService.Engine -and $taskService.Engine.protocol -eq $taskExpected.protocol -and $taskService.Engine.buildId -ceq $taskExpected.buildId -and $taskService.Engine.upToDate -eq $true -and $taskService.Engine.processingCheck.format -eq 'png' -and $taskService.Engine.processingCheck.width -eq 1 -and $taskService.Engine.processingCheck.height -eq 1
}

function Get-TaskListeners {
    if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { throw '无法查询端口监听进程，不能安全检查或替换已运行的服务。' }
    return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::1', '::') })
}

$taskExisting = Get-TaskService
if (Test-TaskVersion $taskExisting) {
    if (-not $NoOpen) { Start-Process $taskUrl }
    Write-Host "已复用当前版本：$taskUrl"
    exit 0
}
$taskListeners = @(Get-TaskListeners)
if ($null -ne $taskExisting -or $taskListeners.Count) {
    if (-not (Test-Path -LiteralPath $taskPidFile)) { throw "端口 $Port 已占用或服务版本过旧，但缺少本项目 server.pid，未停止任何进程。请停止占用程序，或使用 .\start.ps1 -Port 4179。" }
    $taskOldId = 0
    if (-not [int]::TryParse((Get-Content -LiteralPath $taskPidFile -Raw).Trim(), [ref]$taskOldId) -or $taskOldId -le 0) { throw '本项目 server.pid 无效，未停止任何进程。' }
    $taskOldInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $taskOldId" -ErrorAction SilentlyContinue
    $taskServerArgument = '(?i)(?:^|["\s])' + [regex]::Escape($taskServer) + '(?=["\s]|$)'
    if (-not $taskOldInfo -or $taskOldInfo.Name -ne 'node.exe' -or $taskOldInfo.CommandLine -notmatch $taskServerArgument) { throw "server.pid 对应进程无法验证为本项目 server.mjs，未停止任何进程。端口：$Port。" }
    if (-not $taskListeners.Count -or @($taskListeners | Where-Object { $_.OwningProcess -ne $taskOldId }).Count) { throw "端口 $Port 的监听进程与本项目 server.pid 不一致，未停止任何进程。" }
    $taskOldProcess = Get-Process -Id $taskOldId -ErrorAction Stop
    Stop-Process -InputObject $taskOldProcess -ErrorAction Stop
    if (-not $taskOldProcess.WaitForExit(10000)) { throw '旧版图片服务未能及时退出，未启动新服务。' }
    if (@(Get-TaskListeners).Count) { throw "端口 $Port 在旧服务退出后仍被占用，未停止其他进程。" }
    Write-Host '已停止经 PID、命令行和端口共同验证的旧版服务，正在启动当前版本。'
}

New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
$env:PORT = "$Port"
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList @(('"' + $taskServer + '"'), '--no-open') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskRuntime 'server.log') -RedirectStandardError (Join-Path $taskRuntime 'server.error.log')
Set-Content -LiteralPath $taskPidFile -Value $taskProcess.Id
$taskReady = $false
for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    Start-Sleep -Milliseconds 200
    if ($taskProcess.HasExited) { throw "启动失败，请查看 $taskRuntime\server.error.log" }
    if (Test-TaskVersion (Get-TaskService)) { $taskReady = $true; break }
}
if (-not $taskReady) { throw "服务未就绪或版本不匹配，请查看 $taskRuntime\server.error.log" }
if (-not $NoOpen) { Start-Process $taskUrl }
Write-Host "已启动当前版本：$taskUrl。关闭网页不会停止服务；双击 停止工具.cmd 可停止后台服务。"
