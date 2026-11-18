#!/bin/sh
# Rotina de "usuário comum" do WhatsApp da Brasico (17/11/2026, depois do bloqueio de 16/11).
# Desliga a Evolution em alguns períodos do dia, como uma pessoa que fecha o WhatsApp no computador:
#   - de madrugada: sai entre 00h20 e 01h10 e volta entre 05h40 e 06h30;
#   - de dia: 2 ou 3 pausas de 15 a 50 minutos, em horários sorteados entre 09h e 22h30.
# Os horários mudam todo dia. O login fica guardado: ao voltar, a Evolution reconecta sozinha e o
# WhatsApp entrega as mensagens que chegaram durante a pausa (nada se perde).
# Roda num projeto próprio na VPS (brasico-wa-rotina, rotina/docker-compose.yml) e só liga e desliga o
# contêiner da Evolution (nome em ALVO, hoje "evolution_api"). ATIVA=0 deixa a Evolution sempre ligada.

ATIVA="${ATIVA:-1}"
ALVO="${ALVO:-evolution_api}"
export TZ="<-03>3"   # Fortaleza (sem horário de verão)

log() { echo "$(date '+%Y-%m-%d %H:%M') $*"; }

# Contêiner da Evolution (pelo nome exato)
alvo() {
  docker ps -aq --filter "name=^${ALVO}$" | head -n1
}

sorteio() { # sorteio MIN MAX -> inteiro entre MIN e MAX (semente nova a cada sorteio)
  awk -v a="$1" -v b="$2" -v s="$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')" 'BEGIN{srand(s); print a + int(rand() * (b - a + 1))}'
}

# Plano do dia: linhas "inicio fim" em minutos desde a meia-noite
montar_plano() {
  ini=$(sorteio 20 70); fim=$(sorteio 340 390)
  echo "$ini $fim"
  n=$(sorteio 2 3)
  faixa_ini=540; faixa_fim=1350; tam=$(( (faixa_fim - faixa_ini) / n ))
  i=0
  while [ "$i" -lt "$n" ]; do
    dur=$(sorteio 15 50)
    base=$(( faixa_ini + i * tam ))
    p=$(sorteio "$base" $(( base + tam - dur - 20 )))
    echo "$p $(( p + dur ))"
    i=$(( i + 1 ))
  done
}

hhmm() { printf '%02d:%02d' $(( $1 / 60 )) $(( $1 % 60 )); }

dia=""
plano=""
while true; do
  hoje=$(date +%F)
  if [ "$hoje" != "$dia" ]; then
    dia="$hoje"
    plano=$(montar_plano)
    log "Plano de hoje (Evolution desligada):$(echo "$plano" | while read a b; do printf ' %s-%s' "$(hhmm "$a")" "$(hhmm "$b")"; done)"
  fi

  agora=$(date '+%H %M' | awk '{print $1 * 60 + $2}')
  dormir=0
  if [ "$ATIVA" = "1" ]; then
    dormir=$(echo "$plano" | awk -v t="$agora" '$1 <= t && t < $2 {print 1; exit}')
    [ -z "$dormir" ] && dormir=0
  fi

  c=$(alvo)
  if [ -n "$c" ]; then
    rodando=$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)
    if [ "$dormir" = "1" ] && [ "$rodando" = "true" ]; then
      log "Pausa: desligando a Evolution"; docker stop -t 20 "$c" >/dev/null
    elif [ "$dormir" = "0" ] && [ "$rodando" != "true" ]; then
      log "Volta: ligando a Evolution"; docker start "$c" >/dev/null
    fi
  else
    log "Contêiner da Evolution não encontrado ($ALVO)"
  fi
  sleep 60
done
