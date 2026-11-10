-- Escolher a compensa ao dar a FC (10/11/2026, pedido do dono). Antes a FC usava sempre a compensa em aberto mais
-- antiga; agora o bloquinho mostra as compensas em aberto da pessoa (feriado ou saldo lançado, com o motivo) e manda a
-- escolhida em compensa_id. Sem compensa_id continua a mais antiga (vários dias de uma vez). Numa FC que já existe,
-- mandar outra compensa_id troca: a antiga volta a ficar em aberto e a nova fica usada naquele dia.

create or replace function public.escala_gravar(p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v jsonb; v_grupos uuid[] := public.escala_grupos_do(auth.uid()); v_antes jsonb; v_n int := 0; v_cod text; v_ant text;
  v_cli bigint; v_pes bigint; v_dia date; v_comp bigint; v_nome text; v_escolhida bigint; v_atual bigint;
begin
  for v in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_cli := (v->>'cliente_id')::bigint; v_pes := (v->>'pessoa_id')::bigint; v_dia := (v->>'dia')::date;
    if not exists (select 1 from public.escala_membros m where m.cliente_id = v_cli and m.pessoa_id = v_pes and m.grupo_id = any(v_grupos)) then
      raise exception 'Sem permissão para mudar a escala desta pessoa.' using errcode = '42501';
    end if;
    v_cod := coalesce(v->>'codigo', '');
    v_escolhida := nullif(v->>'compensa_id', '')::bigint;
    if v_cod = 'DM' and extract(dow from v_dia) <> 0 then
      raise exception 'Domingo do mês só pode ser num domingo (%).', to_char(v_dia, 'DD/MM') using errcode = 'P0001';
    end if;
    select to_jsonb(e) - 'atualizado_em' - 'atualizado_por' into v_antes from public.escala_planejada e
    where e.cliente_id = v_cli and e.pessoa_id = v_pes and e.dia = v_dia;
    v_ant := coalesce(v_antes->>'codigo', '');
    -- Compensa usada hoje nesse dia (se já era FC)
    v_atual := null;
    if v_ant = 'FC' then
      select id into v_atual from public.escala_compensas
      where cliente_id = v_cli and pessoa_id = v_pes and situacao = 'usada' and usada_dia = v_dia order by id limit 1;
    end if;
    -- Tirou a FC, ou trocou a compensa da FC: a que estava volta a ficar em aberto
    if v_ant = 'FC' and (v_cod <> 'FC' or (v_escolhida is not null and v_escolhida is distinct from v_atual)) then
      update public.escala_compensas set situacao = 'aberta', usada_dia = null, atualizado_em = now(), atualizado_por = auth.uid()
      where cliente_id = v_cli and pessoa_id = v_pes and situacao = 'usada' and usada_dia = v_dia;
    end if;
    -- Pôs uma FC (ou trocou a compensa): a escolhida, ou a mais antiga em aberto
    if v_cod = 'FC' and (v_ant <> 'FC' or (v_escolhida is not null and v_escolhida is distinct from v_atual)) then
      v_comp := null;
      if v_escolhida is not null then
        select c.id into v_comp from public.escala_compensas c
        where c.id = v_escolhida and c.cliente_id = v_cli and c.pessoa_id = v_pes and c.situacao = 'aberta'
          and (c.feriado is null or c.feriado <= v_dia)
        for update;
        if v_comp is null then
          raise exception 'Essa compensa não está mais em aberto (ou o feriado é depois de %). Abra o bloquinho de novo.', to_char(v_dia, 'DD/MM') using errcode = 'P0001';
        end if;
      else
        select c.id into v_comp from public.escala_compensas c
        where c.cliente_id = v_cli and c.pessoa_id = v_pes and c.situacao = 'aberta' and (c.feriado is null or c.feriado <= v_dia)
        order by coalesce(c.feriado, c.criado_em::date), c.id limit 1 for update;
      end if;
      if v_comp is null then
        select coalesce((select nome from public.rhid_pessoas where cliente_id = v_cli and id = v_pes), (select nome from public.escala_extras where v_cli = 0 and id = v_pes), '') into v_nome;
        raise exception 'Sem compensa em aberto para % em %: marque antes o feriado trabalhado.', initcap(split_part(v_nome, ' ', 1)), to_char(v_dia, 'DD/MM') using errcode = 'P0001';
      end if;
      update public.escala_compensas set situacao = 'usada', usada_dia = v_dia, atualizado_em = now(), atualizado_por = auth.uid() where id = v_comp;
    end if;
    insert into public.escala_planejada as e (cliente_id, pessoa_id, dia, codigo, entrada, saida, intervalo, obs, posto, origem, atualizado_por)
    values (v_cli, v_pes, v_dia, v_cod,
      case when v_cod = 'T' then v->>'entrada' end, case when v_cod = 'T' then v->>'saida' end,
      case when v_cod = 'T' then nullif(v->>'intervalo', '') end, coalesce(v->>'obs', ''),
      case when v_cod = 'T' then coalesce(v->>'posto', '') else '' end, 'manual', auth.uid())
    on conflict (cliente_id, pessoa_id, dia) do update set
      codigo = excluded.codigo, entrada = excluded.entrada, saida = excluded.saida, intervalo = excluded.intervalo, posto = excluded.posto,
      obs = case when v ? 'obs' then excluded.obs else e.obs end, origem = 'manual', atualizado_em = now(), atualizado_por = auth.uid();
    insert into public.escala_planejada_historico (cliente_id, pessoa_id, dia, antes, depois, por)
    values (v_cli, v_pes, v_dia, v_antes, v, auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.escala_gravar(jsonb) from public, anon;
grant execute on function public.escala_gravar(jsonb) to authenticated;

-- A tela recebe também quando cada compensa foi lançada (data do saldo lançado à mão)
do $$
declare d text := pg_get_functiondef('public.escala_compensas_dados()'::regprocedure);
begin
  if position('''criado_em'', c.criado_em' in d) = 0 then
    d := replace(d, '''usada_dia'', c.usada_dia)', '''usada_dia'', c.usada_dia, ''criado_em'', c.criado_em)');
    if position('''criado_em'', c.criado_em' in d) = 0 then raise exception 'escala_compensas_dados mudou: ajuste este script'; end if;
    execute d;
  end if;
end $$;
