# Cria (ou refaz) a tarefa "Brasico - WhatsApp do iPhone" no Agendador de Tarefas do Windows.
# 3 horários por dia (8h, 14h e 21h; pedido do dono, 23/11/2026). Em cada horário tenta a cada 15 min por 1 hora
# até dar certo (rodada.py não repete o horário que já deu certo). Só com o usuário conectado (não guarda a senha do
# Windows). Se o computador estava desligado, roda assim que ligar. O iPhone pode estar no Wi-Fi (o normal) ou no cabo.
$base = Join-Path $env:LOCALAPPDATA "brasico-wa-iphone"
$py = Join-Path $base "venv\Scripts\pythonw.exe"
$script = Join-Path $PSScriptRoot "rodada.py"
$acao = New-ScheduledTaskAction -Execute $py -Argument "`"$script`"" -WorkingDirectory $base
$repete = (New-ScheduledTaskTrigger -Once -At "08:00" -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Hours 1)).Repetition
# Não parar a rodada no fim da hora de repetição: com isso ligado o Windows matava o backup no meio
# (código 0xC000013A / tarefa "terminada", 27/11/2026). O limite de verdade é o ExecutionTimeLimit de 3 h.
$repete.StopAtDurationEnd = $false
$gatilhos = foreach ($hora in "08:00", "14:00", "21:00") {
  $g = New-ScheduledTaskTrigger -Daily -At $hora
  $g.Repetition = $repete
  $g
}
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
$quem = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Brasico - WhatsApp do iPhone" -Action $acao -Trigger $gatilhos -Settings $ajustes -Principal $quem -Force |
  Select-Object TaskName, State
