-- =====================================================================
-- Menus vivos dos projetos (18/11/2026, pedido do dono: "deixe esses menus
-- editáveis na tela quando abro").
-- Cada menu é uma página (HTML + CSS) no mesmo visual do impresso. No bloco
-- :::arquivos do capítulo, a linha com "menu:<código>" no lugar do arquivo abre
-- o menu numa janela por cima: quem pode editar o projeto clica no texto,
-- muda e salva; "Baixar PDF" imprime pelo navegador (folha e marcas de corte
-- em `folha`). Fontes e imagens ficam no bucket privado workspace-files
-- (<projeto>/cardapios/fontes e /imagens), servidas por /api/arquivo.
-- Toda gravação guarda a versão anterior em cardapios_vivos_historico;
-- nada se apaga (arquivado_em). A página roda num iframe sem scripts.
-- =====================================================================

create table if not exists public.cardapios_vivos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  codigo text not null check (codigo ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
  title text not null check (length(title) between 1 and 120),
  html text not null check (length(html) <= 400000),
  css text not null default '' check (length(css) <= 200000),
  -- impressão: {"largura": pt, "altura": pt, "grade": [linhas, colunas], "marcas": true}; {} = cada página no próprio tamanho
  folha jsonb not null default '{}'::jsonb,
  versao int not null default 1,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  arquivado_em timestamptz,
  unique (workspace_id, codigo)
);

create table if not exists public.cardapios_vivos_historico (
  id bigint generated always as identity primary key,
  cardapio_id uuid not null references public.cardapios_vivos(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  versao int not null,
  title text not null,
  html text not null,
  css text not null,
  folha jsonb not null,
  gravado_por uuid,
  gravado_em timestamptz not null
);
create index if not exists cardapios_vivos_historico_idx on public.cardapios_vivos_historico (cardapio_id, versao desc);

alter table public.cardapios_vivos enable row level security;
alter table public.cardapios_vivos_historico enable row level security;

drop policy if exists "membros leem menus" on public.cardapios_vivos;
create policy "membros leem menus" on public.cardapios_vivos for select to authenticated using (public.is_member(workspace_id));
drop policy if exists "membros criam menus" on public.cardapios_vivos;
create policy "membros criam menus" on public.cardapios_vivos for insert to authenticated with check (public.is_member(workspace_id));
drop policy if exists "membros mudam menus" on public.cardapios_vivos;
create policy "membros mudam menus" on public.cardapios_vivos for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
drop policy if exists "membros leem historico de menus" on public.cardapios_vivos_historico;
create policy "membros leem historico de menus" on public.cardapios_vivos_historico for select to authenticated using (public.is_member(workspace_id));

-- Antes de cada mudança: guarda a versão anterior, sobe a versão e marca quem mudou
create or replace function public.cardapios_vivos_versionar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.html is not distinct from old.html and new.css is not distinct from old.css
     and new.title is not distinct from old.title and new.folha is not distinct from old.folha
     and new.arquivado_em is not distinct from old.arquivado_em then
    return new;
  end if;
  insert into public.cardapios_vivos_historico (cardapio_id, workspace_id, versao, title, html, css, folha, gravado_por, gravado_em)
  values (old.id, old.workspace_id, old.versao, old.title, old.html, old.css, old.folha, old.updated_by, old.updated_at);
  new.versao := old.versao + 1;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.id := old.id;
  new.workspace_id := old.workspace_id;
  new.codigo := old.codigo;
  return new;
end $$;
drop trigger if exists cardapios_vivos_versionar on public.cardapios_vivos;
create trigger cardapios_vivos_versionar before update on public.cardapios_vivos
  for each row execute function public.cardapios_vivos_versionar();

-- Aparece no painel Mudanças do projeto como mudança da pessoa
drop trigger if exists log_cardapios_vivos on public.cardapios_vivos;
create trigger log_cardapios_vivos after insert or update on public.cardapios_vivos
  for each row execute function public.log_activity();

-- Nada se apaga
drop trigger if exists cardapios_vivos_sem_exclusao on public.cardapios_vivos;
create trigger cardapios_vivos_sem_exclusao before delete on public.cardapios_vivos for each row execute function public.bloquear_exclusao();
drop trigger if exists cardapios_vivos_historico_sem_exclusao on public.cardapios_vivos_historico;
create trigger cardapios_vivos_historico_sem_exclusao before delete on public.cardapios_vivos_historico for each row execute function public.bloquear_exclusao();

-- Quem só vê a área de projetos não grava (mesma trava das outras tabelas)
drop trigger if exists acesso_guarda on public.cardapios_vivos;
create trigger acesso_guarda before insert or update or delete on public.cardapios_vivos
  for each row execute function public.acesso_guarda('projetos');
drop trigger if exists acesso_guarda on public.cardapios_vivos_historico;
create trigger acesso_guarda before insert or update or delete on public.cardapios_vivos_historico
  for each row execute function public.acesso_guarda('projetos');
