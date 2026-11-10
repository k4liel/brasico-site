-- Pessoas na escala que não estão no RH nem no ponto (10/11/2026, pedido do dono): terceirizados ou acordos ainda a
-- confirmar com o diretor. Ficam em escala_extras com empresa_id = 'terceiro' e um "cpf" provisório (não é CPF de verdade),
-- aparecem na escala com "fora do ponto" e no painel Sem ponto (aba Na escala), e podem mudar de lugar ou sair como os outros.
-- Primeiros: Fiama (Sempre Vivo · Reservas) e Elvis (Sempre Vivo · Financeiro). Nada se apaga.

-- Lista do painel Sem ponto: os do RH (como antes) + os de escala_extras que não estão no RH
create or replace function public.escala_contratados_fora()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Sem acesso' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(j order by nome), '[]') from (
    select t.nome, jsonb_build_object(
      'empresa_id', t.empresa_id, 'cpf', t.cpf, 'nome', t.nome, 'cargo', coalesce(t.cargo, ''), 'unidade', coalesce(t.unidade, ''),
      'admissao', t.admissao, 'ponto', t.ponto_situacao,
      'extra_id', x.id, 'situacao', x.situacao, 'local', x.local, 'setor', x.setor, 'posicao', x.posicao) j
    from public.esocial_trabalhadores t
    left join public.escala_extras x on x.empresa_id = t.empresa_id and x.cpf = t.cpf
    where t.ativo and (t.ponto_situacao = 'sem_ponto' or x.situacao = 'na_escala')
    union all
    select x.nome, jsonb_build_object(
      'empresa_id', x.empresa_id, 'cpf', x.cpf, 'nome', x.nome, 'cargo', x.cargo, 'unidade', 'Fora do RH (a confirmar)',
      'admissao', null, 'ponto', 'sem_ponto',
      'extra_id', x.id, 'situacao', x.situacao, 'local', x.local, 'setor', x.setor, 'posicao', x.posicao)
    from public.escala_extras x
    where not exists (select 1 from public.esocial_trabalhadores t where t.empresa_id = x.empresa_id and t.cpf = x.cpf)
      and x.situacao <> 'ignorado'
  ) s);
end $$;
revoke execute on function public.escala_contratados_fora() from public, anon;
grant execute on function public.escala_contratados_fora() to authenticated;

-- Incluir / mudar / tirar: aceita também quem só existe em escala_extras (fora do RH)
create or replace function public.escala_contratado_definir(p_empresa text, p_cpf text, p_situacao text, p_local text default '', p_setor text default '')
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_grupo uuid; v_local text := coalesce(nullif(trim(p_local), ''), 'Sem local'); v_setor text := coalesce(trim(p_setor), '');
  v_nome text; v_cargo text;
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Só os sócios mexem na escala de todos.' using errcode = '42501'; end if;
  if p_situacao not in ('na_escala', 'ignorado', 'fora') then raise exception 'Situação inválida'; end if;
  select t.nome, coalesce(t.cargo, '') into v_nome, v_cargo from public.esocial_trabalhadores t where t.empresa_id = p_empresa and t.cpf = p_cpf;
  if not found then
    select x.nome, x.cargo into v_nome, v_cargo from public.escala_extras x where x.empresa_id = p_empresa and x.cpf = p_cpf;
    if not found then raise exception 'Pessoa não encontrada no RH'; end if;
  end if;
  insert into public.escala_extras as x (empresa_id, cpf, nome, cargo, local, setor, situacao, atualizado_por)
  values (p_empresa, p_cpf, v_nome, v_cargo, v_local, v_setor, p_situacao, auth.uid())
  on conflict (empresa_id, cpf) do update set nome = excluded.nome, cargo = excluded.cargo,
    local = case when p_situacao = 'na_escala' then excluded.local else x.local end,
    setor = case when p_situacao = 'na_escala' then excluded.setor else x.setor end,
    situacao = excluded.situacao, atualizado_em = now(), atualizado_por = auth.uid()
  returning id into v_id;
  if p_situacao = 'na_escala' then
    select id into v_grupo from public.escala_grupos where local = v_local and setor = v_setor;
    if v_grupo is null then
      insert into public.escala_grupos (nome, local, setor) values (v_local || case when v_setor <> '' then ' · ' || v_setor else '' end, v_local, v_setor)
      returning id into v_grupo;
    else
      update public.escala_grupos set arquivado_em = null where id = v_grupo and arquivado_em is not null;
    end if;
    insert into public.escala_membros (cliente_id, pessoa_id, grupo_id) values (0, v_id, v_grupo)
    on conflict (cliente_id, pessoa_id) do update set grupo_id = excluded.grupo_id, atualizado_em = now();
  end if;
  return v_id;
end $$;
revoke execute on function public.escala_contratado_definir(text, text, text, text, text) from public, anon;
grant execute on function public.escala_contratado_definir(text, text, text, text, text) to authenticated;

-- Fiamma (Reservas) e Elvis (Financeiro), Sempre Vivo
insert into public.escala_extras (empresa_id, cpf, nome, cargo, local, setor, situacao)
values ('terceiro', 'a-confirmar-fiamma', 'FIAMA', '???', 'Sempre Vivo', 'Reservas', 'na_escala'),
       ('terceiro', 'a-confirmar-elvis', 'ELVIS', '???', 'Sempre Vivo', 'Financeiro', 'na_escala')
on conflict (empresa_id, cpf) do nothing;
insert into public.escala_membros (cliente_id, pessoa_id, grupo_id)
select 0, x.id, g.id from public.escala_extras x
join public.escala_grupos g on g.local = x.local and g.setor = x.setor
where x.empresa_id = 'terceiro' and x.cpf in ('a-confirmar-fiamma', 'a-confirmar-elvis')
on conflict (cliente_id, pessoa_id) do nothing;
