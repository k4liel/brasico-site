# Cria (ou refaz) a tarefa "Brasico - Avaliações" no Agendador de Tarefas do Windows (25/11/2026).
# A cada 15 min roda pc.mjs (uma passada e sai): o banco diz o que está na hora de ler (hoje: Expedia dos dois hotéis,
# a cada hora; avaliacoes_fontes.leitura = 'pc'). Só com o usuário conectado (o Edge abre com janela, fora da tela).
# Sem janela de console: o node é chamado por um .vbs escondido. Registro em %LOCALAPPDATA%\brasico-avaliacoes\rodadas.log.
# Instalar: copie pc.mjs para a pasta e rode este arquivo no PowerShell (a pasta precisa de config.json e do playwright-core).
$base = Join-Path $env:LOCALAPPDATA "brasico-avaliacoes"
Copy-Item (Join-Path $PSScriptRoot "pc.mjs") (Join-Path $base "pc.mjs") -Force
$node = (Get-Command node).Source
$vbs = Join-Path $base "rodar.vbs"
@"
CreateObject("WScript.Shell").Run """$node"" ""$base\pc.mjs""", 0, True
"@ | Set-Content -Encoding ascii $vbs
$acao = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`"" -WorkingDirectory $base
$gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 14) -MultipleInstances IgnoreNew
$quem = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Brasico - Avaliações" -Action $acao -Trigger $gatilho -Settings $ajustes -Principal $quem -Force |
  Select-Object TaskName, State
