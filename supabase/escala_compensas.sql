-- Banco de compensas (09/11/2026, pedido do dono). Uma compensa (crédito de folga) nasce quando o líder (ou um sócio)
-- marca que a pessoa trabalhou num feriado; vale 60 dias. A folga compensada (FC) na escala só grava se houver
-- compensa em aberto: usa a mais antiga e fica ligada a ela (usada_dia); tirar a FC devolve a compensa. Sócios lançam
-- saldo antigo à mão (origem 'ajuste', com motivo). Nada se apaga (cancelar = situacao 'cancelada').
-- Feriados: o RHiD marca "feriado" também em folgas de algumas pessoas. Vale só o calendário oficial de Tibau do Sul
-- (escala_feriados: nacionais, do RN e municipais — Leis 812 e 813/2023), pedido do dono.

create table if not exists public.escala_feriados (
  dia date primary key,
  nome text not null,
  origem text not null default 'nacional' check (origem in ('nacional', 'estadual', 'municipal')),
  lei text not null default ''
);
alter table public.escala_feriados enable row level security;
drop policy if exists escala_feriados_ver on public.escala_feriados;
create policy escala_feriados_ver on public.escala_feriados for select using (auth.uid() is not null);
-- Só feriados oficiais de Tibau do Sul (nacionais, do RN e municipais). Fora: Carnaval, Corpus Christi e pontos facultativos.
insert into public.escala_feriados (dia, nome, origem, lei) values
  ('2026-01-01', 'Confraternização Universal', 'nacional', 'Lei 10.607/2002'),
  ('2026-04-03', 'Sexta-feira Santa', 'nacional', 'Lei 9.093/1995'),
  ('2026-04-04', 'Emancipação Política de Tibau do Sul', 'municipal', 'Lei Municipal 812/2023'),
  ('2026-04-21', 'Tiradentes', 'nacional', 'Lei 10.607/2002'),
  ('2026-05-01', 'Dia do Trabalho', 'nacional', 'Lei 10.607/2002'),
  ('2026-06-13', 'Santo Antônio (padroeiro de Tibau do Sul)', 'municipal', 'Lei Municipal 813/2023'),
  ('2026-09-07', 'Independência do Brasil', 'nacional', 'Lei 10.607/2002'),
  ('2026-10-03', 'Mártires de Cunhaú e Uruaçu', 'estadual', 'Lei Estadual 8.913/2006 (RN)'),
  ('2026-10-12', 'Nossa Senhora Aparecida', 'nacional', 'Lei 6.802/1980'),
  ('2026-11-02', 'Finados', 'nacional', 'Lei 10.607/2002'),
  ('2026-11-15', 'Proclamação da República', 'nacional', 'Lei 10.607/2002'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional', 'Lei 14.759/2023'),
  ('2026-12-25', 'Natal', 'nacional', 'Lei 10.607/2002'),
  ('2027-01-01', 'Confraternização Universal', 'nacional', 'Lei 10.607/2002'),
  ('2027-03-26', 'Sexta-feira Santa', 'nacional', 'Lei 9.093/1995'),
  ('2027-04-04', 'Emancipação Política de Tibau do Sul', 'municipal', 'Lei Municipal 812/2023'),
  ('2027-04-21', 'Tiradentes', 'nacional', 'Lei 10.607/2002'),
  ('2027-05-01', 'Dia do Trabalho', 'nacional', 'Lei 10.607/2002'),
  ('2027-06-13', 'Santo Antônio (padroeiro de Tibau do Sul)', 'municipal', 'Lei Municipal 813/2023'),
  ('2027-09-07', 'Independência do Brasil', 'nacional', 'Lei 10.607/2002'),
  ('2027-10-03', 'Mártires de Cunhaú e Uruaçu', 'estadual', 'Lei Estadual 8.913/2006 (RN)'),
  ('2027-10-12', 'Nossa Senhora Aparecida', 'nacional', 'Lei 6.802/1980'),
  ('2027-11-02', 'Finados', 'nacional', 'Lei 10.607/2002'),
  ('2027-11-15', 'Proclamação da República', 'nacional', 'Lei 10.607/2002'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional', 'Lei 14.759/2023'),
  ('2027-12-25', 'Natal', 'nacional', 'Lei 10.607/2002')
on conflict (dia) do update set nome = excluded.nome, origem = excluded.origem, lei = excluded.lei;

-- Feriados de um período: só o calendário oficial (o "feriado" do RHiD também marca folgas de algumas pessoas)
create or replace function public.escala_feriados_de(p_de date, p_ate date)
returns setof date language sql stable security definer set search_path = public as $$
  select dia from public.escala_feriados where dia between p_de and p_ate
$$;
revoke execute on function public.escala_feriados_de(date, date) from public, anon;
grant execute on function public.escala_feriados_de(date, date) to authenticated;

create table if not exists public.escala_compensas (
  id bigint generated always as identity primary key,
  cliente_id bigint not null,
  pessoa_id bigint not null,
  origem text not null check (origem in ('feriado', 'ajuste')),
  feriado date,
  motivo text not null default '',
  vence_em date,
  situacao text not null default 'aberta' check (situacao in ('aberta', 'usada', 'cancelada')),
  usada_dia date,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id)
);
create unique index if not exists escala_compensas_feriado_unico on public.escala_compensas (cliente_id, pessoa_id, feriado) where origem = 'feriado';
create index if not exists escala_compensas_pessoa on public.escala_compensas (cliente_id, pessoa_id, situacao);
alter table public.escala_compensas enable row level security;
drop policy if exists escala_compensas_ver on public.escala_compensas;
create policy escala_compensas_ver on public.escala_compensas for select using (public.rhid_pode_ver(auth.uid()));
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'escala_compensas_sem_exclusao') then
    create trigger escala_compensas_sem_exclusao before delete on public.escala_compensas for each row execute function public.bloquear_exclusao();
    create trigger escala_compensas_sem_truncate before truncate on public.escala_compensas for each statement execute function public.bloquear_exclusao();
  end if;
end $$;

-- A pessoa é de um grupo que o usuário edita?
create or replace function public.escala_pode_pessoa(p_user uuid, p_cliente bigint, p_pessoa bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.escala_membros m where m.cliente_id = p_cliente and m.pessoa_id = p_pessoa
                 and m.grupo_id = any(public.escala_grupos_do(p_user)))
$$;

-- Gravar a escala com a trava da compensa: FC só com compensa em aberto (a mais antiga, de feriado até o dia da folga)
create or replace function public.escala_gravar(p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v jsonb; v_grupos uuid[] := public.escala_grupos_do(auth.uid()); v_antes jsonb; v_n int := 0; v_cod text; v_ant text;
  v_cli bigint; v_pes bigint; v_dia date; v_comp bigint; v_nome text;
begin
  for v in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    v_cli := (v->>'cliente_id')::bigint; v_pes := (v->>'pessoa_id')::bigint; v_dia := (v->>'dia')::date;
    if not exists (select 1 from public.escala_membros m where m.cliente_id = v_cli and m.pessoa_id = v_pes and m.grupo_id = any(v_grupos)) then
      raise exception 'Sem permissão para mudar a escala desta pessoa.' using errcode = '42501';
    end if;
    v_cod := coalesce(v->>'codigo', '');
    select to_jsonb(e) - 'atualizado_em' - 'atualizado_por' into v_antes from public.escala_planejada e
    where e.cliente_id = v_cli and e.pessoa_id = v_pes and e.dia = v_dia;
    v_ant := coalesce(v_antes->>'codigo', '');
    -- Tirou uma FC: a compensa volta a ficar em aberto
    if v_ant = 'FC' and v_cod <> 'FC' then
      update public.escala_compensas set situacao = 'aberta', usada_dia = null, atualizado_em = now(), atualizado_por = auth.uid()
      where cliente_id = v_cli and pessoa_id = v_pes and situacao = 'usada' and usada_dia = v_dia;
    end if;
    -- Pôs uma FC: precisa de compensa em aberto
    if v_cod = 'FC' and v_ant <> 'FC' then
      select c.id into v_comp from public.escala_compensas c
      where c.cliente_id = v_cli and c.pessoa_id = v_pes and c.situacao = 'aberta' and (c.feriado is null or c.feriado <= v_dia)
      order by coalesce(c.feriado, c.criado_em::date), c.id limit 1 for update;
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

-- Trabalhou (ou não) no feriado: cria a compensa em aberto (60 dias) ou marca que não trabalhou
create or replace function public.escala_compensa_feriado(p_cliente bigint, p_pessoa bigint, p_feriado date, p_trabalhou boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_usada date;
begin
  if not public.escala_pode_pessoa(auth.uid(), p_cliente, p_pessoa) then raise exception 'Sem permissão para esta pessoa.' using errcode = '42501'; end if;
  if not exists (select 1 from public.escala_feriados_de(p_feriado, p_feriado)) then raise exception '% não é feriado.', to_char(p_feriado, 'DD/MM'); end if;
  if p_feriado > (now() at time zone 'America/Fortaleza')::date then raise exception 'O feriado ainda não chegou.'; end if;
  select usada_dia into v_usada from public.escala_compensas
  where cliente_id = p_cliente and pessoa_id = p_pessoa and origem = 'feriado' and feriado = p_feriado and situacao = 'usada';
  if not p_trabalhou and v_usada is not null then
    raise exception 'Essa compensa já foi dada (folga em %): tire a FC antes.', to_char(v_usada, 'DD/MM');
  end if;
  insert into public.escala_compensas as c (cliente_id, pessoa_id, origem, feriado, vence_em, situacao, motivo, criado_por, atualizado_por)
  values (p_cliente, p_pessoa, 'feriado', p_feriado, p_feriado + 60, case when p_trabalhou then 'aberta' else 'cancelada' end,
          case when p_trabalhou then '' else 'não trabalhou' end, auth.uid(), auth.uid())
  on conflict (cliente_id, pessoa_id, feriado) where origem = 'feriado' do update set
    situacao = case when c.situacao = 'usada' then 'usada' when p_trabalhou then 'aberta' else 'cancelada' end,
    motivo = case when p_trabalhou then '' else 'não trabalhou' end, atualizado_em = now(), atualizado_por = auth.uid();
end $$;
revoke execute on function public.escala_compensa_feriado(bigint, bigint, date, boolean) from public, anon;
grant execute on function public.escala_compensa_feriado(bigint, bigint, date, boolean) to authenticated;

-- Saldo antigo lançado à mão (só sócios) e cancelar um lançamento à mão ainda em aberto
create or replace function public.escala_compensa_lancar(p_cliente bigint, p_pessoa bigint, p_qtd int, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Só os sócios lançam saldo de compensa.' using errcode = '42501'; end if;
  if coalesce(p_qtd, 0) < 1 or p_qtd > 30 then raise exception 'Quantidade de 1 a 30.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Diga o motivo (ex.: saldo de outubro).'; end if;
  insert into public.escala_compensas (cliente_id, pessoa_id, origem, motivo, criado_por, atualizado_por)
  select p_cliente, p_pessoa, 'ajuste', trim(p_motivo), auth.uid(), auth.uid() from generate_series(1, p_qtd);
end $$;
revoke execute on function public.escala_compensa_lancar(bigint, bigint, int, text) from public, anon;
grant execute on function public.escala_compensa_lancar(bigint, bigint, int, text) to authenticated;

create or replace function public.escala_compensa_cancelar(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Só os sócios cancelam um lançamento.' using errcode = '42501'; end if;
  update public.escala_compensas set situacao = 'cancelada', motivo = motivo || ' (cancelado)', atualizado_em = now(), atualizado_por = auth.uid()
  where id = p_id and origem = 'ajuste' and situacao = 'aberta';
  if not found then raise exception 'Só dá para cancelar lançamento à mão ainda em aberto.'; end if;
end $$;
revoke execute on function public.escala_compensa_cancelar(bigint) from public, anon;
grant execute on function public.escala_compensa_cancelar(bigint) to authenticated;

-- O banco de compensas de quem o usuário vê: compensas de cada pessoa e os feriados a confirmar
-- (feriado dos últimos 120 dias em que a pessoa estava na escala trabalhando e ainda não se disse se trabalhou)
create or replace function public.escala_compensas_dados()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_grupos uuid[] := public.escala_grupos_do(auth.uid()); v_hoje date := (now() at time zone 'America/Fortaleza')::date;
begin
  if not public.rhid_pode_ver(auth.uid()) and cardinality(v_grupos) = 0 then raise exception 'Sem acesso à escala' using errcode = '42501'; end if;
  return (
    with membros as (
      select m.cliente_id, m.pessoa_id, g.local, g.setor, coalesce(p.nome, x.nome) nome
      from public.escala_membros m join public.escala_grupos g on g.id = m.grupo_id
      left join public.rhid_pessoas p on m.cliente_id <> 0 and p.cliente_id = m.cliente_id and p.id = m.pessoa_id and p.situacao = 1 and p.presente
      left join public.escala_extras x on m.cliente_id = 0 and x.id = m.pessoa_id and x.situacao = 'na_escala'
      where m.grupo_id = any(v_grupos) and coalesce(p.nome, x.nome) is not null
    ), feriados as (select f dia from public.escala_feriados_de(v_hoje - 120, v_hoje) f)
    select jsonb_build_object(
      'hoje', v_hoje,
      'socio', public.rhid_pode_ver(auth.uid()),
      'feriados', (select coalesce(jsonb_agg(jsonb_build_object('dia', f.dia, 'nome', coalesce(ef.nome, 'Feriado')) order by f.dia), '[]')
                   from public.escala_feriados_de(v_hoje - 120, v_hoje + 400) f(dia) left join public.escala_feriados ef on ef.dia = f.dia),
      'pessoas', (select coalesce(jsonb_agg(jsonb_build_object(
          'cliente_id', mb.cliente_id, 'id', mb.pessoa_id, 'nome', mb.nome, 'local', mb.local, 'setor', mb.setor,
          'compensas', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'origem', c.origem, 'feriado', c.feriado, 'motivo', c.motivo,
                          'vence_em', c.vence_em, 'situacao', c.situacao, 'usada_dia', c.usada_dia) order by coalesce(c.feriado, c.criado_em::date), c.id), '[]')
                        from public.escala_compensas c where c.cliente_id = mb.cliente_id and c.pessoa_id = mb.pessoa_id),
          'a_confirmar', (select coalesce(jsonb_agg(jsonb_build_object('dia', e.dia, 'entrada', e.entrada, 'saida', e.saida) order by e.dia), '[]')
                          from public.escala_planejada e join feriados f on f.dia = e.dia
                          where e.cliente_id = mb.cliente_id and e.pessoa_id = mb.pessoa_id and e.codigo = 'T' and e.dia <= v_hoje
                            and not exists (select 1 from public.escala_compensas c where c.cliente_id = mb.cliente_id and c.pessoa_id = mb.pessoa_id
                                            and c.origem = 'feriado' and c.feriado = e.dia))
        ) order by mb.local, mb.setor, mb.nome), '[]') from membros mb)
    )
  );
end $$;
revoke execute on function public.escala_compensas_dados() from public, anon;
grant execute on function public.escala_compensas_dados() to authenticated;

-- escala_dados: feriados de verdade (calendário + maioria no RHiD), não as folgas que o RHiD marca como feriado
do $do$
declare d text := pg_get_functiondef('public.escala_dados(date,date)'::regprocedure);
begin
  if position('escala_feriados_de' in d) = 0 then
    d := replace(d, '''feriados'', (select coalesce(jsonb_agg(distinct d.dia), ''[]'') from public.rhid_dias d where d.feriado and d.dia between p_de and p_ate)',
                    '''feriados'', (select coalesce(jsonb_agg(f order by f), ''[]'') from public.escala_feriados_de(p_de, p_ate) f)');
    execute d;
  end if;
end $do$;
