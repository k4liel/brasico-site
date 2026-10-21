-- =====================================================================
-- Tabelas editáveis no site (bloco :::editavel dos capítulos).
-- O Markdown traz a tabela com os valores iniciais; o que os sócios digitam
-- no site fica aqui, por projeto, bloco (id do :::editavel), linha e coluna.
-- Os valores não dependem do idioma: o mesmo bloco nos 4 idiomas mostra o
-- mesmo valor. Toda mudança fica no histórico; exclusões bloqueadas.
-- =====================================================================

create table if not exists public.celulas_editaveis (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bloco text not null check (bloco ~ '^[a-z0-9-]{1,60}$'),
  linha int not null check (linha between 0 and 999),
  coluna int not null check (coluna between 0 and 30),
  valor text not null default '' check (length(valor) <= 200),
  atualizado_por uuid references auth.users(id) default auth.uid(),
  atualizado_em timestamptz not null default now(),
  primary key (workspace_id, bloco, linha, coluna)
);

create table if not exists public.celulas_editaveis_historico (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bloco text not null,
  linha int not null,
  coluna int not null,
  valor_antigo text,
  valor_novo text,
  alterado_por uuid,
  alterado_em timestamptz not null default now()
);
create index if not exists celulas_editaveis_historico_idx on public.celulas_editaveis_historico (workspace_id, bloco, alterado_em desc);

alter table public.celulas_editaveis enable row level security;
alter table public.celulas_editaveis_historico enable row level security;

drop policy if exists "membros leem celulas" on public.celulas_editaveis;
create policy "membros leem celulas" on public.celulas_editaveis for select to authenticated using (public.is_member(workspace_id));
drop policy if exists "membros gravam celulas" on public.celulas_editaveis;
create policy "membros gravam celulas" on public.celulas_editaveis for insert to authenticated with check (public.is_member(workspace_id));
drop policy if exists "membros mudam celulas" on public.celulas_editaveis;
create policy "membros mudam celulas" on public.celulas_editaveis for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
drop policy if exists "membros leem historico de celulas" on public.celulas_editaveis_historico;
create policy "membros leem historico de celulas" on public.celulas_editaveis_historico for select to authenticated using (public.is_member(workspace_id));

-- Quem mudou e quando; cada mudança vai para o histórico
create or replace function public.celulas_editaveis_registrar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.valor is not distinct from old.valor then return new; end if;
    new.atualizado_em := now();
    new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
  end if;
  insert into public.celulas_editaveis_historico (workspace_id, bloco, linha, coluna, valor_antigo, valor_novo, alterado_por)
  values (new.workspace_id, new.bloco, new.linha, new.coluna, case when tg_op = 'UPDATE' then old.valor end, new.valor,
          coalesce(auth.uid(), new.atualizado_por));
  return new;
end $$;
drop trigger if exists celulas_editaveis_registrar on public.celulas_editaveis;
create trigger celulas_editaveis_registrar before insert or update on public.celulas_editaveis
  for each row execute function public.celulas_editaveis_registrar();

drop trigger if exists celulas_editaveis_sem_exclusao on public.celulas_editaveis;
create trigger celulas_editaveis_sem_exclusao before delete on public.celulas_editaveis for each row execute function public.bloquear_exclusao();
drop trigger if exists celulas_editaveis_historico_sem_exclusao on public.celulas_editaveis_historico;
create trigger celulas_editaveis_historico_sem_exclusao before delete on public.celulas_editaveis_historico for each row execute function public.bloquear_exclusao();

-- Link público: só leitura, só do projeto daquele link
create or replace function public.celulas_publicas(p_slug text)
returns table (bloco text, linha int, coluna int, valor text)
language sql stable security definer set search_path = public as $$
  select c.bloco, c.linha, c.coluna, c.valor
  from public.celulas_editaveis c
  join public.workspaces w on w.id = c.workspace_id
  where length(coalesce(p_slug, '')) >= 32 and w.public_slug = p_slug and w.is_public and w.removido_em is null;
$$;
revoke execute on function public.celulas_publicas(text) from public;
grant execute on function public.celulas_publicas(text) to anon, authenticated;

-- Conector: os Claudes leem o que foi digitado no site
create or replace function public.mcp_celulas(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.mcp_auth(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object('bloco', c.bloco, 'linha', c.linha, 'coluna', c.coluna, 'valor', c.valor,
                                        'atualizado_em', c.atualizado_em) order by c.bloco, c.linha, c.coluna)
    from public.celulas_editaveis c where c.workspace_id = a.o_ws), '[]'::jsonb);
end $$;
revoke execute on function public.mcp_celulas(text) from public, authenticated;
grant execute on function public.mcp_celulas(text) to anon;
