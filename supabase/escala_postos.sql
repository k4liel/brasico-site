-- Posto do dia (09/11/2026, pedido do dono): na Cozinha do Sempre Vivo a equipe reveza entre a Cozinha e a Produção,
-- no mesmo lugar. O grupo diz os postos possíveis (escala_grupos.postos) e cada dia de trabalho guarda onde a pessoa
-- fica (escala_planejada.posto). Só os grupos com postos mostram a escolha na janelinha do bloquinho.
alter table public.escala_grupos add column if not exists postos text[] not null default '{}';
alter table public.escala_planejada add column if not exists posto text not null default '';
update public.escala_grupos set postos = '{Cozinha,Produção}' where local = 'Sempre Vivo' and setor = 'Cozinha';

create or replace function public.escala_gravar(p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v jsonb; v_grupos uuid[] := public.escala_grupos_do(auth.uid()); v_antes jsonb; v_n int := 0; v_cod text;
begin
  for v in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    if not exists (select 1 from public.escala_membros m where m.cliente_id = (v->>'cliente_id')::bigint
                   and m.pessoa_id = (v->>'pessoa_id')::bigint and m.grupo_id = any(v_grupos)) then
      raise exception 'Sem permissão para mudar a escala desta pessoa.' using errcode = '42501';
    end if;
    v_cod := coalesce(v->>'codigo', '');
    select to_jsonb(e) - 'atualizado_em' - 'atualizado_por' into v_antes from public.escala_planejada e
    where e.cliente_id = (v->>'cliente_id')::bigint and e.pessoa_id = (v->>'pessoa_id')::bigint and e.dia = (v->>'dia')::date;
    insert into public.escala_planejada as e (cliente_id, pessoa_id, dia, codigo, entrada, saida, intervalo, obs, posto, origem, atualizado_por)
    values ((v->>'cliente_id')::bigint, (v->>'pessoa_id')::bigint, (v->>'dia')::date, v_cod,
      case when v_cod = 'T' then v->>'entrada' end, case when v_cod = 'T' then v->>'saida' end,
      case when v_cod = 'T' then nullif(v->>'intervalo', '') end, coalesce(v->>'obs', ''),
      case when v_cod = 'T' then coalesce(v->>'posto', '') else '' end, 'manual', auth.uid())
    on conflict (cliente_id, pessoa_id, dia) do update set
      codigo = excluded.codigo, entrada = excluded.entrada, saida = excluded.saida, intervalo = excluded.intervalo, posto = excluded.posto,
      obs = case when v ? 'obs' then excluded.obs else e.obs end, origem = 'manual', atualizado_em = now(), atualizado_por = auth.uid();
    insert into public.escala_planejada_historico (cliente_id, pessoa_id, dia, antes, depois, por)
    values ((v->>'cliente_id')::bigint, (v->>'pessoa_id')::bigint, (v->>'dia')::date, v_antes, v, auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.escala_gravar(jsonb) from public, anon;
grant execute on function public.escala_gravar(jsonb) to authenticated;

-- escala_dados: os postos de cada grupo e o posto de cada dia
do $do$
declare d text := pg_get_functiondef('public.escala_dados(date,date)'::regprocedure);
begin
  if position('''postos''' in d) = 0 then
    d := replace(d, '''fixo'', g.fixo,', '''fixo'', g.fixo, ''postos'', g.postos,');
    d := replace(d, '''obs'', e.obs, ''origem'', e.origem,', '''obs'', e.obs, ''posto'', e.posto, ''origem'', e.origem,');
    execute d;
  end if;
end $do$;
