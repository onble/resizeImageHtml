$ErrorActionPreference = 'Stop'
$taskPidFile = Join-Path $PSScriptRoot '.runtime\server.pid'
if (-not (Test-Path -LiteralPath $taskPidFile)) { Write-Host '没有通过启动脚本运行的服务。'; exit 0 }
$taskProcessId = [int](Get-Content -LiteralPath $taskPidFile)
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $taskProcessId" -ErrorAction SilentlyContinue
$taskServer = Join-Path $PSScriptRoot 'server.mjs'
if ($taskProcess -and $taskProcess.Name -eq 'node.exe' -and $taskProcess.CommandLine.Contains($taskServer)) {
    Stop-Process -Id $taskProcessId
    Write-Host '图片缩放工作台已停止。'
} else { Write-Host '原服务已停止；未操作其他进程。' }
Remove-Item -LiteralPath $taskPidFile -Force
