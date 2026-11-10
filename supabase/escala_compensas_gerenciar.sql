-- Quem gerencia o banco de compensas (10/11/2026, pedido do dono: a Carol, líder do Sempre Vivo, só via).
-- Além dos sócios, quem tem operacao_pessoas.gerencia_compensas lança saldo e cancela compensas em aberto
-- das pessoas dos grupos que lidera. Nada se apaga: cancelar = situacao 'cancelada'.

alter table public.operacao_pessoas add column if not exists gerencia_compensas boolean not null default false;

-- Pode gerenciar as compensas desta pessoa? (sem pessoa: gerencia alguma coisa?)
create or replace function public.escala_gerencia_compensas(p_user uuid, p_cliente bigint default null, p_pessoa bigint default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.rhid_pode_ver(p_user)
      or (exists (select 1 from public.operacao_pessoas o where o.user_id = p_user and o.ativo and o.gerencia_compensas)
          and (p_cliente is null or public.escala_pode_pessoa(p_user, p_cliente, p_pessoa)))
$$;
revoke execute on function public.escala_gerencia_compensas(uuid, bigint, bigint) from public, anon;
grant execute on function public.escala_gerencia_compensas(uuid, bigint, bigint) to authenticated;

create or replace function public.escala_compensa_lancar(p_cliente bigint, p_pessoa bigint, p_qtd int, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.escala_gerencia_compensas(auth.uid(), p_cliente, p_pessoa) then
    raise exception 'Sem permissão para lançar compensa desta pessoa.' using errcode = '42501';
  end if;
  if coalesce(p_qtd, 0) < 1 or p_qtd > 30 then raise exception 'Quantidade de 1 a 30.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Diga o motivo (ex.: saldo de outubro).'; end if;
  insert into public.escala_compensas (cliente_id, pessoa_id, origem, motivo, criado_por, atualizado_por)
  select p_cliente, p_pessoa, 'ajuste', trim(p_motivo), auth.uid(), auth.uid() from generate_series(1, p_qtd);
end $$;

-- Cancelar qualquer compensa ainda em aberto (lançada à mão ou de feriado)
create or replace function public.escala_compensa_cancelar(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from public.escala_compensas where id = p_id;
  if not found then raise exception 'Compensa não encontrada.'; end if;
  if not public.escala_gerencia_compensas(auth.uid(), c.cliente_id, c.pessoa_id) then
    raise exception 'Sem permissão para cancelar compensa desta pessoa.' using errcode = '42501';
  end if;
  if c.situacao <> 'aberta' then raise exception 'Só dá para cancelar compensa em aberto (a já dada: tire a FC da escala antes).'; end if;
  update public.escala_compensas set situacao = 'cancelada',
    motivo = case when coalesce(motivo, '') = '' then 'cancelado' else motivo || ' (cancelado)' end,
    atualizado_em = now(), atualizado_por = auth.uid()
  where id = p_id;
end $$;

-- A tela recebe 'gerencia' para mostrar Lançar saldo e o × de cancelar
do $$
declare d text := pg_get_functiondef('public.escala_compensas_dados()'::regprocedure);
begin
  if position('''gerencia''' in d) = 0 then
    d := replace(d, '''socio'', public.rhid_pode_ver(auth.uid()),',
                    '''socio'', public.rhid_pode_ver(auth.uid()), ''gerencia'', public.escala_gerencia_compensas(auth.uid()),');
    if position('''gerencia''' in d) = 0 then raise exception 'escala_compensas_dados mudou: ajuste este script'; end if;
    execute d;
  end if;
end $$;

-- Primeira: Carol (líder do Sempre Vivo)
update public.operacao_pessoas set gerencia_compensas = true where nome = 'Carol' and papel = 'lider';
