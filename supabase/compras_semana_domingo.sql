-- Semana das compras vai de domingo a domingo (pedido do dono, 05/11/2026).
-- Antes: a janela ia de quarta 6h a quarta 6h e todo pedido feito depois de quarta 6h caía na semana seguinte,
-- escondido da Central (que abre na semana atual). Ex.: o "Pedido Ceasa" do Bruno de quarta 04/11 22h36 foi para 09/11.
-- Agora: mensagem do grupo COMPRAS de domingo 00h até o sábado seguinte 23h59 (Fortaleza) = semana que começa na
-- segunda desse intervalo (compras_semanas.inicio continua sendo a segunda-feira). O domingo já é da semana nova.

create or replace function public.compras_janela(p_inicio date, out de timestamptz, out ate timestamptz)
returns record language sql immutable as $$
  select ((p_inicio - 1)::timestamp) at time zone 'America/Fortaleza',
         ((p_inicio + 6)::timestamp) at time zone 'America/Fortaleza'
$$;

-- segunda-feira da semana de uma data/hora (domingo conta para a semana que começa no dia seguinte)
create or replace function public.compras_semana_alvo(p_quando timestamptz)
returns date language sql immutable as $$
  select (date_trunc('week', (p_quando at time zone 'America/Fortaleza') + interval '1 day'))::date
$$;

create or replace function public.compras_semana_de(p_data date default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_ini date; v_id uuid;
begin
  -- sem data: a semana de agora (no domingo já é a semana nova)
  v_ini := coalesce(p_data, public.compras_semana_alvo(now()));
  v_ini := v_ini - (extract(isodow from v_ini)::int - 1);
  insert into public.compras_semanas (inicio) values (v_ini) on conflict (inicio) do nothing;
  select id into v_id from public.compras_semanas where inicio = v_ini;
  return v_id;
end $$;

-- o que caiu na semana de 09/11 pela regra antiga (a lista "Pedido Ceasa" do Bruno e a análise dela) volta para 02/11
update public.compras_listas set semana_id = (select id from public.compras_semanas where inicio = '2026-11-02')
where semana_id = (select id from public.compras_semanas where inicio = '2026-11-09');
update public.compras_analises set semana_id = (select id from public.compras_semanas where inicio = '2026-11-02')
where semana_id = (select id from public.compras_semanas where inicio = '2026-11-09');
