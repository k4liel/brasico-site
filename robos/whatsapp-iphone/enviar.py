"""
Manda para o Brasico as mensagens dos GRUPOS do WhatsApp normal que estão no backup do iPhone.

Lê o arquivo de conversas (ChatStorage.sqlite) e os arquivos de mídia do backup feito por backup_whatsapp.py
e envia tudo para a Edge Function whatsapp-webhook no mesmo formato que a Evolution usava (messages.upsert,
groups.upsert, contacts.upsert). O banco ignora o que já existe (mesmo id de mensagem), então reenviar não
duplica nada. O WhatsApp Business é ignorado.

A chave fica em %LOCALAPPDATA%\\brasico-wa-iphone\\config.json (fora do GitHub).
Guarda em enviados.db o que já foi enviado, para não mandar a mesma mídia duas vezes.

Uso:  python enviar.py [--teste] [--sem-midia] [pasta-do-backup-do-aparelho]
      --teste      só conta o que seria enviado
      --sem-midia  manda só o texto (a mídia vai numa próxima vez)
"""
import base64
import json
import mimetypes
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.request

BASE = os.path.join(os.environ["LOCALAPPDATA"], "brasico-wa-iphone")
DOMINIO = "AppDomainGroup-group.net.whatsapp.WhatsApp.shared"   # só o WhatsApp normal
EPOCA_APPLE = 978307200
MIDIA_MAX = 15 * 1024**2          # mídia maior que isso vai sem o arquivo (só os dados)
LOTE_BYTES = 6 * 1024**2          # tamanho máximo de cada envio
LOTE_MSGS = 150
PULAR = {6, 10, 14}               # avisos do grupo, chamadas e mensagens apagadas
MIME = {"opus": "audio/ogg", "webp": "image/webp", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
        "mp4": "video/mp4", "pdf": "application/pdf", "mov": "video/quicktime",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}

args = [a for a in sys.argv[1:] if not a.startswith("--")]
TESTE = "--teste" in sys.argv
SEM_MIDIA = "--sem-midia" in sys.argv
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def pasta_do_backup():
    if args:
        return args[0]
    raiz = os.path.join(BASE, "backup")
    for nome in os.listdir(raiz):
        if os.path.isfile(os.path.join(raiz, nome, "Manifest.db")):
            return os.path.join(raiz, nome)
    raise SystemExit("Nenhum backup encontrado em " + raiz)


def arquivo(backup, fid):
    p = os.path.join(backup, fid[:2], fid)
    return p if os.path.isfile(p) and os.path.getsize(p) > 0 else None


def mime_de(caminho):
    ext = caminho.rsplit(".", 1)[-1].lower()
    return MIME.get(ext) or mimetypes.guess_type(caminho)[0] or "application/octet-stream"


def postar(cfg, corpo):
    dados = json.dumps(corpo).encode()
    for tentativa in range(4):
        req = urllib.request.Request(cfg["url"], data=dados, method="POST",
                                     headers={"Content-Type": "application/json", "x-segredo": cfg["segredo"]})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise SystemExit("O Brasico recusou a chave (401). Confira o config.json.")
            erro = f"HTTP {e.code}: {e.read()[:200]!r}"
        except Exception as e:  # rede
            erro = str(e)
        time.sleep(5 * (tentativa + 1))
    raise SystemExit("Falhou o envio depois de 4 tentativas: " + erro)


def main():
    cfg = json.load(open(os.path.join(BASE, "config.json"), encoding="utf-8"))
    backup = pasta_do_backup()
    man = sqlite3.connect(f"file:{os.path.join(backup, 'Manifest.db')}?mode=ro", uri=True)
    fids = {rel: fid for fid, rel in man.execute("select fileID, relativePath from Files where domain = ? and flags = 1", (DOMINIO,))}
    if "ChatStorage.sqlite" not in fids:
        raise SystemExit("O backup não tem as conversas do WhatsApp normal.")

    tmp = tempfile.mkdtemp(prefix="wa-enviar-")
    try:
        for nome in ("ChatStorage.sqlite", "ChatStorage.sqlite-wal", "ChatStorage.sqlite-shm"):
            if nome in fids and arquivo(backup, fids[nome]):
                shutil.copy2(arquivo(backup, fids[nome]), os.path.join(tmp, nome))
        db = sqlite3.connect(os.path.join(tmp, "ChatStorage.sqlite"))

        estado = sqlite3.connect(os.path.join(BASE, "enviados.db"))
        estado.execute("create table if not exists enviados (id text primary key, com_midia integer, em text)")
        ja = dict(estado.execute("select id, com_midia from enviados"))

        grupos = db.execute(
            "select Z_PK, ZCONTACTJID, coalesce(ZPARTNERNAME, '') from ZWACHATSESSION where ZCONTACTJID like '%@g.us'"
        ).fetchall()
        membros = db.execute(
            "select Z_PK, ZMEMBERJID, coalesce(ZCONTACTNAME, ZFIRSTNAME, '') from ZWAGROUPMEMBER where ZMEMBERJID is not null"
        ).fetchall()
        membro = {pk: (jid, nome) for pk, jid, nome in membros}

        linhas = db.execute("""
            select m.ZSTANZAID, s.ZCONTACTJID, m.ZISFROMME, m.ZGROUPMEMBER, m.ZFROMJID, m.ZMESSAGEDATE, m.ZMESSAGETYPE,
                   m.ZTEXT, i.ZTITLE, i.ZMEDIALOCALPATH, i.ZFILESIZE, i.ZMOVIEDURATION, i.ZVCARDNAME
            from ZWAMESSAGE m
            join ZWACHATSESSION s on s.Z_PK = m.ZCHATSESSION
            left join ZWAMEDIAITEM i on i.Z_PK = m.ZMEDIAITEM
            where s.ZCONTACTJID like '%@g.us' and m.ZSTANZAID is not null
            order by m.ZMESSAGEDATE""").fetchall()

        mensagens, sem_arquivo = [], 0
        for (mid, gjid, de_mim, gm, de_jid, data, tipo, texto, titulo, local, tamanho, dur, vcard) in linhas:
            if tipo in PULAR:
                continue
            caminho = fid = None
            if local:
                fid = fids.get("Message/" + local)
                caminho = arquivo(backup, fid) if fid else None
            tem_midia = bool(caminho) and not SEM_MIDIA and os.path.getsize(caminho) <= MIDIA_MAX
            if ja.get(mid) is not None and (ja[mid] or not tem_midia):
                continue  # já foi (com a mídia, ou sem mídia e ainda não há mídia)
            mime = mime_de(local) if local else ""
            seg = int(dur or 0)
            if tipo in (0, 7):
                msg = {"conversation": texto or ""}
            elif tipo == 1:
                msg = {"imageMessage": {"caption": titulo or "", "mimetype": mime, "fileLength": tamanho or 0}}
            elif tipo in (2, 11):
                msg = {"videoMessage": {"caption": titulo or "", "mimetype": mime, "seconds": seg, "fileLength": tamanho or 0}}
            elif tipo == 3:
                msg = {"audioMessage": {"mimetype": mime or "audio/ogg", "seconds": seg, "fileLength": tamanho or 0}}
            elif tipo == 8:
                legenda = titulo if titulo and titulo != texto else ""
                msg = {"documentMessage": {"fileName": texto or "", "caption": legenda, "mimetype": mime, "fileLength": tamanho or 0}}
            elif tipo == 15:
                msg = {"stickerMessage": {"mimetype": mime or "image/webp", "fileLength": tamanho or 0}}
            elif tipo == 4:
                msg = {"contactMessage": {"displayName": vcard or ""}}
            elif tipo == 5:
                msg = {"locationMessage": {"name": titulo or ""}}
            elif texto:
                msg = {"conversation": texto}
            else:
                continue
            autor_jid, autor_nome = membro.get(gm, (de_jid if de_jid and not de_jid.endswith("@g.us") else "", ""))
            d = {
                "key": {"remoteJid": gjid, "id": mid, "fromMe": bool(de_mim), "participant": "" if de_mim else autor_jid},
                "pushName": "" if de_mim else autor_nome,
                "messageTimestamp": int((data or 0) + EPOCA_APPLE),
                "message": msg,
            }
            if tem_midia:
                d["base64"] = base64.b64encode(open(caminho, "rb").read()).decode()
            elif local and not caminho:
                sem_arquivo += 1
            mensagens.append((mid, tem_midia, d))

        com_midia = sum(1 for _, t, _ in mensagens if t)
        print(f"Grupos: {len(grupos)}   Mensagens a enviar: {len(mensagens)}   com arquivo: {com_midia}   "
              f"arquivo que não veio no backup: {sem_arquivo}")
        if TESTE:
            print("Teste: nada foi enviado.")
            return 0

        # 1) nomes dos grupos  2) nomes de quem escreve  3) mensagens
        postar(cfg, {"event": "groups.upsert", "instance": "iphone",
                     "data": [{"id": jid, "subject": nome} for _, jid, nome in grupos if nome]})
        contatos = [{"id": jid, "pushName": nome} for _, jid, nome in membros if nome and jid.endswith("@lid")]
        for i in range(0, len(contatos), 500):
            postar(cfg, {"event": "contacts.upsert", "instance": "iphone", "data": contatos[i:i + 500]})

        lote, tam, enviadas = [], 0, 0

        def mandar():
            nonlocal lote, tam, enviadas
            if not lote:
                return
            postar(cfg, {"event": "messages.upsert", "instance": "iphone", "data": [d for _, _, d in lote]})
            agora = time.strftime("%Y-%m-%dT%H:%M:%S")
            estado.executemany("insert into enviados values (?, ?, ?) on conflict(id) do update set com_midia = max(com_midia, excluded.com_midia), em = excluded.em",
                               [(mid, int(t), agora) for mid, t, _ in lote])
            estado.commit()
            enviadas += len(lote)
            print(f"  enviadas {enviadas}/{len(mensagens)}", flush=True)
            lote, tam = [], 0

        for item in mensagens:
            peso = len(item[2].get("base64", "")) + 1000
            if lote and (tam + peso > LOTE_BYTES or len(lote) >= LOTE_MSGS):
                mandar()
            lote.append(item)
            tam += peso
        mandar()
        print(f"FIM: {enviadas} mensagens enviadas.")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
