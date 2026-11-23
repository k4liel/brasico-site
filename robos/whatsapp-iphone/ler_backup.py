"""
Lê as conversas do WhatsApp de um backup do iPhone feito no Windows (app Dispositivos Apple ou iTunes).

Nada se conecta ao WhatsApp: o programa só abre o backup que o próprio iPhone gravou no computador.
Esta primeira versão SÓ CONFERE (conta grupos, mensagens e arquivos); não envia nada para lugar nenhum
e não mostra o texto das mensagens.

Uso:  python ler_backup.py            (procura o backup sozinho)
      python ler_backup.py <pasta>    (pasta de um backup específico)
"""
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone

# Onde o Windows guarda os backups do iPhone (iTunes antigo e app da Microsoft Store / Dispositivos Apple)
PASTAS = [
    os.path.join(os.environ.get("APPDATA", ""), "Apple Computer", "MobileSync", "Backup"),
    os.path.join(os.environ.get("USERPROFILE", ""), "Apple", "MobileSync", "Backup"),
]
# Pasta do WhatsApp dentro do backup (WhatsApp normal e WhatsApp Business)
DOMINIOS = {
    "AppDomainGroup-group.net.whatsapp.WhatsApp.shared": "WhatsApp",
    "AppDomainGroup-group.net.whatsapp.WhatsAppSMB.shared": "WhatsApp Business",
}
EPOCA_APPLE = datetime(2001, 1, 1, tzinfo=timezone.utc)
FORTALEZA = timezone(timedelta(hours=-3))


def data(segundos):
    if segundos is None:
        return None
    return (EPOCA_APPLE + timedelta(seconds=float(segundos))).astimezone(FORTALEZA)


def achar_backups(pastas):
    achados = []
    for base in pastas:
        if not os.path.isdir(base):
            continue
        for nome in os.listdir(base):
            p = os.path.join(base, nome)
            if os.path.isfile(os.path.join(p, "Manifest.db")):
                achados.append(p)
    return sorted(achados, key=lambda p: os.path.getmtime(os.path.join(p, "Manifest.db")), reverse=True)


def colunas(con, tabela):
    return {r[1] for r in con.execute(f"pragma table_info({tabela})")}


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # nomes de grupo com emoji
    backups = [sys.argv[1]] if len(sys.argv) > 1 else achar_backups(PASTAS)
    if not backups:
        print("Nenhum backup do iPhone encontrado neste computador.")
        print("Procurei em:\n  " + "\n  ".join(PASTAS))
        return 1
    backup = backups[0]
    print(f"Backup: {backup}")
    print(f"Feito em: {datetime.fromtimestamp(os.path.getmtime(os.path.join(backup, 'Manifest.db'))):%d/%m/%Y %H:%M}")

    tmp = tempfile.mkdtemp(prefix="wa-iphone-")
    try:
        manifesto = os.path.join(tmp, "Manifest.db")
        shutil.copy2(os.path.join(backup, "Manifest.db"), manifesto)
        try:
            man = sqlite3.connect(f"file:{manifesto}?mode=ro", uri=True)
            man.execute("select count(*) from Files").fetchone()
        except sqlite3.DatabaseError:
            print("\nEste backup tem SENHA (criptografado). Esta versão ainda não abre backup com senha.")
            print("Avise o Claude: dá para ler, com você digitando a senha aqui no computador.")
            return 2

        linha = None
        for dominio, nome in DOMINIOS.items():
            linha = man.execute(
                "select fileID from Files where domain = ? and relativePath = 'ChatStorage.sqlite'", (dominio,)
            ).fetchone()
            if linha:
                app, dominio_wa = nome, dominio
                break
        if not linha:
            print("\nO backup não tem as conversas do WhatsApp (o app não estava no iPhone ou o backup está incompleto).")
            return 3
        midias_no_backup = man.execute(
            "select count(*) from Files where domain = ? and relativePath like 'Message/Media/%' and flags = 1",
            (dominio_wa,),
        ).fetchone()[0]

        fid = linha[0]
        origem = os.path.join(backup, fid[:2], fid)
        if not os.path.isfile(origem):
            origem = os.path.join(backup, fid)  # backups muito antigos não usam subpastas
        chats = os.path.join(tmp, "ChatStorage.sqlite")
        shutil.copy2(origem, chats)
        db = sqlite3.connect(f"file:{chats}?mode=ro", uri=True)

        print(f"App: {app}")
        sessoes = db.execute(
            "select Z_PK, ZCONTACTJID, ZPARTNERNAME from ZWACHATSESSION where ZCONTACTJID like '%@g.us'"
        ).fetchall()
        tem_data = "ZMESSAGEDATE" in colunas(db, "ZWAMESSAGE")
        sete_dias = (datetime.now(timezone.utc) - EPOCA_APPLE - timedelta(days=7)).total_seconds()

        total_msgs = db.execute(
            "select count(*) from ZWAMESSAGE m join ZWACHATSESSION s on s.Z_PK = m.ZCHATSESSION where s.ZCONTACTJID like '%@g.us'"
        ).fetchone()[0]
        print(f"\nGrupos: {len(sessoes)}   Mensagens nos grupos: {total_msgs}   Arquivos (fotos, áudios, documentos) no backup: {midias_no_backup}")

        resumo = []
        for pk, jid, nome in sessoes:
            n, ultima, semana = db.execute(
                "select count(*), max(ZMESSAGEDATE), sum(ZMESSAGEDATE >= ?) from ZWAMESSAGE where ZCHATSESSION = ?",
                (sete_dias, pk),
            ).fetchone() if tem_data else (0, None, 0)
            resumo.append((nome or jid, n, data(ultima), semana or 0))
        resumo.sort(key=lambda r: r[2] or datetime.min.replace(tzinfo=FORTALEZA), reverse=True)

        print("\nGrupo                                    msgs   últimos 7 dias   última mensagem")
        for nome, n, ultima, semana in resumo:
            print(f"{nome[:40]:<40} {n:>6}   {semana:>14}   {ultima:%d/%m/%Y %H:%M}" if ultima else f"{nome[:40]:<40} {n:>6}   {semana:>14}   —")
        print("\nSó conferência: nada foi enviado e nenhum texto de mensagem foi mostrado.")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
