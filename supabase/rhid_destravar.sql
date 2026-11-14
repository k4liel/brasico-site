-- RHiD: leituras que ficavam "rodando" para sempre (13/11/2026, achado no painel de integrações).
-- Causa: a apuração do ponto (tipo "batidas", 12h e 17h, quando o RHiD fica lento) passava dos 150 s que a
-- Edge Function pode rodar; a função era derrubada no meio e não marcava o fim. A função rhid-extrair agora tem
-- um prazo por execução (nenhuma chamada espera além dele). Aqui, a rede de segurança, igual à do eSocial e das
-- notas: o que ficar na fila ou rodando por mais de 10 minutos vira falha (nada se apaga).
create or replace function public.rhid_destravar()
returns integer language sql security definer set search_path = public as $$
  with x as (
    update public.rhid_execucoes
    set status = 'falha', fim = coalesce(fim, now()),
        erro = case when status = 'na_fila' then 'a função não chegou a começar (o pedido se perdeu)'
                    else 'interrompida: passou do tempo da função (150 s); a próxima leitura continua de onde parou' end
    where status in ('na_fila', 'rodando') and created_at < now() - interval '10 minutes'
    returning 1)
  select count(*)::int from x
$$;
revoke execute on function public.rhid_destravar() from public, anon, authenticated;

select cron.schedule('rhid-destravar', '*/15 * * * *', $job$ select public.rhid_destravar() $job$);

-- As que já estavam presas (11 desde 03/11/2026) viram falha na primeira rodada.
select public.rhid_destravar();
