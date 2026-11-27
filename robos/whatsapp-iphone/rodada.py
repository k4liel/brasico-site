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
# Sem janela: rodando pelo pythonw, cada python.exe filho abria uma janela preta; fechar a janela mata o backup
# (código 3221225786 = 0xC000013A, "fechado pelo Ctrl+C/janela"), como em 27/11/2026 às 8h39 e 9h58.
SEM_JANELA = getattr(subprocess, "CREATE_NO_WINDOW", 0)
LOG = os.path.join(BASE, "rodadas.log")


def registrar(texto):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{datetime.datetime.now():%d/%m/%Y %H:%M} {texto}\n")


def iphone_por_perto():
    pmd = os.path.join(BASE, "venv", "Scripts", "pymobiledevice3.exe")
    r = subprocess.run([pmd, "usbmux", "list"], capture_output=True, text=True, timeout=60,
                       creationflags=SEM_JANELA)
    if '"ConnectionType"' in r.stdout:
        return True
    # O serviço da Apple às vezes não vê o iPhone pelo Wi-Fi (depois que ele religa); procura direto na rede
    r = subprocess.run([pmd, "bonjour", "mobdev2"], capture_output=True, text=True, timeout=60,
                       creationflags=SEM_JANELA)
    if '"UniqueDeviceID"' in r.stdout:
        return True
    # Rede marcada como "Pública" no Windows: o firewall esconde o anúncio; procura pela porta do iPhone
    from rede import iphones_na_rede
    return bool(iphones_na_rede())


ULTIMA_OK = os.path.join(BASE, "ultima_ok.txt")


def main():
    agora = datetime.datetime.now().timestamp()
    # 3 horários por dia, cada um tentando a cada 15 min por 1 h: deu certo há menos de 2 h = este horário já foi
    if os.path.exists(ULTIMA_OK) and agora - os.path.getmtime(ULTIMA_OK) < 2 * 3600:
        return 0
    # Uma rodada por vez (uma trava com mais de 3 h é de uma rodada que caiu)
    if os.path.exists(TRAVA) and (agora - os.path.getmtime(TRAVA)) < 3 * 3600:
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
                               env={**os.environ, "WA_TENTATIVAS": "6"}, creationflags=SEM_JANELA)  # ~3 min esperando o código
        if b.returncode == 4:
            registrar("backup incompleto: precisa ligar o iPhone no cabo uma vez (pelo Wi-Fi levaria horas)")
            return 4
        if b.returncode != 0:
            registrar(f"backup falhou (código {b.returncode}); veja backup.log")
            return 1
        e = subprocess.run([PY, "-I", os.path.join(AQUI, "enviar.py")], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=2 * 3600, creationflags=SEM_JANELA)
        fim = [l for l in e.stdout.splitlines() if l.startswith(("Grupos:", "FIM"))]
        registrar("envio: " + " | ".join(fim) if e.returncode == 0 else f"envio falhou: {e.stdout[-300:]} {e.stderr[-300:]}")
        if e.returncode == 0:
            open(ULTIMA_OK, "w").close()
        return e.returncode
    finally:
        os.remove(TRAVA)


if __name__ == "__main__":
    sys.exit(main())
