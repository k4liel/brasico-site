"""
Uma rodada completa: backup do WhatsApp normal (cabo ou Wi-Fi) e envio do que é novo para o Brasico.
Feita para o Agendador de Tarefas do Windows (ver instalar_agenda.ps1). Se o iPhone não estiver por perto
(nem no cabo nem no mesmo Wi-Fi), não faz nada e tenta na próxima vez.

Registro em %LOCALAPPDATA%\\brasico-wa-iphone\\rodadas.log
"""
import datetime
import os
import subprocess
import sys

BASE = os.path.join(os.environ["LOCALAPPDATA"], "brasico-wa-iphone")
AQUI = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(BASE, "venv", "Scripts", "python.exe")
TRAVA = os.path.join(BASE, "rodada.trava")
LOG = os.path.join(BASE, "rodadas.log")


def registrar(texto):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{datetime.datetime.now():%d/%m/%Y %H:%M} {texto}\n")


def iphone_por_perto():
    r = subprocess.run([os.path.join(BASE, "venv", "Scripts", "pymobiledevice3.exe"), "usbmux", "list"],
                       capture_output=True, text=True, timeout=60)
    return '"ConnectionType"' in r.stdout


def main():
    # Uma rodada por vez (uma trava com mais de 3 h é de uma rodada que caiu)
    if os.path.exists(TRAVA) and (datetime.datetime.now().timestamp() - os.path.getmtime(TRAVA)) < 3 * 3600:
        return 0
    open(TRAVA, "w").close()
    try:
        if not iphone_por_perto():
            registrar("iPhone fora do alcance (nem cabo nem Wi-Fi): fica para a próxima")
            return 0
        registrar("backup começou")
        with open(os.path.join(BASE, "backup.log"), "w", encoding="utf-8") as saida:
            b = subprocess.run([PY, os.path.join(AQUI, "backup_whatsapp.py"), os.path.join(BASE, "backup")],
                               stdout=saida, stderr=subprocess.STDOUT, timeout=3 * 3600,
                               env={**os.environ, "WA_TENTATIVAS": "6"})  # ~3 min esperando o código
        if b.returncode == 4:
            registrar("backup incompleto: precisa ligar o iPhone no cabo uma vez (pelo Wi-Fi levaria horas)")
            return 4
        if b.returncode != 0:
            registrar(f"backup falhou (código {b.returncode}); veja backup.log")
            return 1
        e = subprocess.run([PY, "-I", os.path.join(AQUI, "enviar.py")], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=2 * 3600)
        fim = [l for l in e.stdout.splitlines() if l.startswith(("Grupos:", "FIM"))]
        registrar("envio: " + " | ".join(fim) if e.returncode == 0 else f"envio falhou: {e.stdout[-300:]} {e.stderr[-300:]}")
        return e.returncode
    finally:
        os.remove(TRAVA)


if __name__ == "__main__":
    sys.exit(main())
