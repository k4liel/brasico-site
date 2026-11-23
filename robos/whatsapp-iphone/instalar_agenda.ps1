# Cria (ou refaz) a tarefa "Brasico - WhatsApp do iPhone" no Agendador de Tarefas do Windows.
# Roda rodada.py a cada 2 horas, das 7h às 23h, só com o usuário conectado (não guarda senha do Windows).
# Se o computador estava desligado na hora, roda assim que ligar. Se o iPhone não estiver no cabo nem no
# mesmo Wi-Fi, a rodada não faz nada.
$base = Join-Path $env:LOCALAPPDATA "brasico-wa-iphone"
$py = Join-Path $base "venv\Scripts\pythonw.exe"
$script = Join-Path $PSScriptRoot "rodada.py"
$acao = New-ScheduledTaskAction -Execute $py -Argument "`"$script`"" -WorkingDirectory $base
$gatilho = New-ScheduledTaskTrigger -Daily -At "07:00"
$gatilho.Repetition = (New-ScheduledTaskTrigger -Once -At "07:00" -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Hours 16)).Repetition
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
$quem = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Brasico - WhatsApp do iPhone" -Action $acao -Trigger $gatilho -Settings $ajustes -Principal $quem -Force |
  Select-Object TaskName, State
