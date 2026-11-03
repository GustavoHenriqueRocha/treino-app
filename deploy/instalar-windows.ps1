# Instala o app de treino no Windows (Ryzen): abre a porta no firewall e
# cria uma tarefa que sobe o servidor na inicialização, sincronizando com o Arch.
# Rodar como administrador, dentro da pasta do projeto:
#   powershell -ExecutionPolicy Bypass -File deploy\instalar-windows.ps1
$ErrorActionPreference = "Stop"
$pasta = Split-Path -Parent $PSScriptRoot
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = (Get-Command py).Source }

New-NetFirewallRule -DisplayName "Treino 8790" -Direction Inbound -Protocol TCP -LocalPort 8790 -Action Allow -ErrorAction SilentlyContinue | Out-Null

New-Item -ItemType Directory -Force -Path "$pasta\dados" | Out-Null
$cmd = "set TREINO_PEER=http://100.109.141.7:8790&& cd /d `"$pasta`" && `"$python`" server.py >> dados\servidor.log 2>&1"
$acao = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c $cmd"
$gatilho = New-ScheduledTaskTrigger -AtStartup
$cfg = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName "Treino" -Action $acao -Trigger $gatilho -Settings $cfg -User "SYSTEM" -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName "Treino"
Write-Host "Treino instalado: http://localhost:8790"
