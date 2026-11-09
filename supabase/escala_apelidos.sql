-- Apelidos na escala (09/11/2026, pedido do dono): no dia a dia a escala mostra só o apelido de cada pessoa (o nome
-- completo fica ao passar o mouse). Uma linha por pessoa (cliente_id, pessoa_id; contratado sem ponto = cliente 0).
-- Quem define: sócios e o líder que monta a escala da pessoa. Tirar = apelido vazio; nada se apaga.
create table if not exists public.escala_apelidos (
  cliente_id bigint not null,
  pessoa_id bigint not null,
  apelido text not null default '',
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id),
  primary key (cliente_id, pessoa_id)
);
alter table public.escala_apelidos enable row level security;
drop policy if exists escala_apelidos_ver on public.escala_apelidos;
create policy escala_apelidos_ver on public.escala_apelidos for select using (public.rhid_pode_ver(auth.uid()));
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'escala_apelidos_sem_exclusao') then
    create trigger escala_apelidos_sem_exclusao before delete on public.escala_apelidos for each row execute function public.bloquear_exclusao();
    create trigger escala_apelidos_sem_truncate before truncate on public.escala_apelidos for each statement execute function public.bloquear_exclusao();
  end if;
end $$;

create or replace function public.escala_apelido_definir(p_cliente bigint, p_pessoa bigint, p_apelido text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.rhid_pode_ver(auth.uid()) or public.escala_pode_pessoa(auth.uid(), p_cliente, p_pessoa)) then
    raise exception 'Sem permissão para esta pessoa.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_apelido, ''))) > 30 then raise exception 'Apelido de até 30 letras.'; end if;
  insert into public.escala_apelidos as a (cliente_id, pessoa_id, apelido, atualizado_por)
  values (p_cliente, p_pessoa, trim(coalesce(p_apelido, '')), auth.uid())
  on conflict (cliente_id, pessoa_id) do update set apelido = excluded.apelido, atualizado_em = now(), atualizado_por = auth.uid();
end $$;
revoke execute on function public.escala_apelido_definir(bigint, bigint, text) from public, anon;
grant execute on function public.escala_apelido_definir(bigint, bigint, text) to authenticated;

-- escala_dados: o apelido de cada pessoa
do $do$
declare d text := pg_get_functiondef('public.escala_dados(date,date)'::regprocedure);
begin
  if position('escala_apelidos' in d) = 0 then
    d := replace(d, '''cargo'', coalesce(c.nome, ''''),',
      '''cargo'', coalesce(c.nome, ''''), ''apelido'', (select nullif(a.apelido, '''') from public.escala_apelidos a where a.cliente_id = p.cliente_id and a.pessoa_id = p.id),');
    d := replace(d, '''grupo_id'', m.grupo_id, ''cargo'', e.cargo,',
      '''grupo_id'', m.grupo_id, ''cargo'', e.cargo, ''apelido'', (select nullif(a.apelido, '''') from public.escala_apelidos a where a.cliente_id = 0 and a.pessoa_id = e.id),');
    execute d;
  end if;
end $do$;
