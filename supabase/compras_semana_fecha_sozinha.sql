-- A semana de compras fecha sozinha (pedido do dono, 05/11/2026): o botão "Fechar a semana" saiu da tela.
-- Fecha 7 dias depois que a semana termina (sábado), para dar tempo de marcar pedidos recebidos e conferir as notas.
-- Ex.: semana de 02/11 (domingo 01/11 a sábado 07/11) fecha no domingo 15/11. Roda todo dia às 3h de Fortaleza.
create or replace function public.compras_fechar_semanas()
returns integer language sql security definer set search_path to 'public' as $$
  with f as (
    update public.compras_semanas set status = 'fechada', fechada_em = now(), fechada_por = null
    where status = 'aberta' and inicio + 13 < (now() at time zone 'America/Fortaleza')::date
    returning 1)
  select count(*)::int from f
$$;
revoke all on function public.compras_fechar_semanas() from public, anon, authenticated;
select cron.schedule('compras-fechar-semanas', '0 6 * * *', $$select public.compras_fechar_semanas()$$);
