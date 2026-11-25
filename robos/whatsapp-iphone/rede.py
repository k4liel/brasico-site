"""
Acha o iPhone na rede local sem depender do anúncio (bonjour): quando o Windows marca a rede como "Pública",
o firewall bloqueia as respostas do anúncio e o iPhone some, mesmo estando na mesma rede. Então procura, na
faixa de endereços do computador, quem tem aberta a porta do iPhone (62078, a do lockdown).
"""
import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor

PORTA = 62078


def ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # não manda nada: só descobre por qual placa o computador sai
        return s.getsockname()[0]
    finally:
        s.close()


def _aberta(ip):
    try:
        with socket.create_connection((ip, PORTA), timeout=0.6):
            return ip
    except OSError:
        return None


def iphones_na_rede():
    """Endereços da rede (faixa /24 do computador) com a porta do iPhone aberta."""
    try:
        meu = ip_local()
    except OSError:
        return []
    rede = ipaddress.ip_network(f"{meu}/24", strict=False)
    ips = [str(h) for h in rede.hosts() if str(h) != meu]
    with ThreadPoolExecutor(64) as ex:
        return [ip for ip in ex.map(_aberta, ips) if ip]
