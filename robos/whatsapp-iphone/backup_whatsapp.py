"""
Backup do iPhone que grava SÓ o WhatsApp normal (o número da Brasico), com tudo: conversas, fotos, áudios,
vídeos, documentos e figurinhas. O WhatsApp Business fica de fora.

Como funciona: o iPhone manda o backup inteiro pelo cabo; o computador guarda só os arquivos das pastas do
WhatsApp normal (perguntadas ao próprio iPhone) e descarta o resto na hora (pymobiledevice3, filter_callback).
Antes de começar, o iPhone confere se o computador tem espaço para o backup INTEIRO e recusa se não tiver
(erro 105) — por isso o programa informa ao iPhone um espaço grande. Para não encher o disco de verdade,
uma vigia para tudo se o espaço livre real cair abaixo de 3 GB.

Uso:  <venv>\\Scripts\\python.exe backup_whatsapp.py <pasta-dos-backups>
"""
import asyncio
import os
import shutil
import sys
import threading
import time

from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services import device_link
from pymobiledevice3.services.installation_proxy import InstallationProxyService
from pymobiledevice3.services.mobilebackup2 import Mobilebackup2Service

APP = "net.whatsapp.WhatsApp"                       # WhatsApp normal (o Business é net.whatsapp.WhatsAppSMB)
GRUPOS = ("group.net.whatsapp.WhatsApp.shared", "group.net.whatsapp.WhatsApp.private")
DOMINIOS = ("AppDomain-net.whatsapp.WhatsApp", *(f"AppDomainGroup-{g}" for g in GRUPOS))
MINIMO_REAL = 3 * 1024**3
INFORMADO = 4 * 1024**4

pasta = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.abspath("backup")
os.makedirs(pasta, exist_ok=True)
amostra = open(os.path.join(pasta, "nomes-amostra.txt"), "w", encoding="utf-8")
contagem = {"guardados": 0, "descartados": 0}


async def espaco_informado(self, _message):
    self._reported_free_space = max(shutil.disk_usage(self.root_path).free, INFORMADO)
    await self.status_response(0, status_dict=self._reported_free_space)


device_link.DeviceLink.get_free_disk_space = espaco_informado


def vigia():
    while True:
        if shutil.disk_usage(pasta).free < MINIMO_REAL:
            print("PARADO: o disco ficou com menos de 3 GB livres.", flush=True)
            os._exit(3)
        time.sleep(3)


async def pastas_do_whatsapp(lockdown):
    async with InstallationProxyService(lockdown=lockdown) as ip:
        app = (await ip.get_apps(bundle_identifiers=[APP]))[APP]
    caminhos = [app["Container"]] + [app["GroupContainers"][g] for g in GRUPOS if g in app.get("GroupContainers", {})]
    # o iPhone às vezes escreve /private/var/... e às vezes /var/...
    return tuple({c.rstrip("/") + "/" for c in caminhos} | {c.replace("/private", "", 1).rstrip("/") + "/" for c in caminhos})


async def main():
    lockdown = await create_using_usbmux()
    caminhos = await pastas_do_whatsapp(lockdown)
    print("Pastas do WhatsApp normal:", *caminhos, sep="\n  ", flush=True)

    def guardar(arq) -> bool:
        nome = arq.device_name or ""
        if arq.domain:  # verificação pelo Manifest.db
            ok = arq.domain in DOMINIOS
        else:
            ok = nome.startswith(caminhos) or any(nome.startswith(d + "/") or nome.startswith(d + "-") for d in DOMINIOS)
        contagem["guardados" if ok else "descartados"] += 1
        if contagem["guardados"] + contagem["descartados"] <= 40 or (ok and contagem["guardados"] <= 20):
            amostra.write(f"{'GUARDA' if ok else 'fora  '} {nome}\n")
            amostra.flush()
        return ok

    ultimo = [-1]

    def andamento(p):
        p = int(p)
        if p != ultimo[0] and p % 5 == 0:
            ultimo[0] = p
            print(f"{p}%  (guardados {contagem['guardados']}, descartados {contagem['descartados']})", flush=True)

    async with Mobilebackup2Service(lockdown) as mb:
        await mb.backup(full=False, backup_directory=pasta, filter_callback=guardar, progress_callback=andamento)
    print(f"FIM: guardados {contagem['guardados']}, descartados {contagem['descartados']}", flush=True)


threading.Thread(target=vigia, daemon=True).start()
asyncio.run(main())
