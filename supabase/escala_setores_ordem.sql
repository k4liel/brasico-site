-- Ordem dos setores de cada casa na escala (09/11/2026, pedido do dono): por padrão os setores saem em ordem
-- alfabética; no "Organizar linhas" o sócio sobe e desce cada setor (▲▼) e a ordem vale para todos (Ponto, escala
-- editável, PDF e líderes). Afastados fica sempre no fim. Nada se apaga (posição nova sobrescreve).
create table if not exists public.escala_setores_ordem (
  local text not null,
  setor text not null,
  posicao int not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users(id),
  primary key (local, setor)
);
alter table public.escala_setores_ordem enable row level security;
drop policy if exists escala_setores_ordem_ver on public.escala_setores_ordem;
create policy escala_setores_ordem_ver on public.escala_setores_ordem for select using (auth.uid() is not null);
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'escala_setores_ordem_sem_exclusao') then
    create trigger escala_setores_ordem_sem_exclusao before delete on public.escala_setores_ordem for each row execute function public.bloquear_exclusao();
    create trigger escala_setores_ordem_sem_truncate before truncate on public.escala_setores_ordem for each statement execute function public.bloquear_exclusao();
  end if;
end $$;

-- Grava a ordem dos setores de uma casa (a lista na ordem nova)
create or replace function public.escala_setores_ordenar(p_local text, p_setores text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.rhid_pode_ver(auth.uid()) then raise exception 'Só os sócios organizam a escala.' using errcode = '42501'; end if;
  insert into public.escala_setores_ordem as o (local, setor, posicao, atualizado_por)
  select p_local, s, n::int, auth.uid() from unnest(coalesce(p_setores, '{}')) with ordinality as t(s, n)
  on conflict (local, setor) do update set posicao = excluded.posicao, atualizado_em = now(), atualizado_por = auth.uid();
end $$;
revoke execute on function public.escala_setores_ordenar(text, text[]) from public, anon;
grant execute on function public.escala_setores_ordenar(text, text[]) to authenticated;
