-- =====================================================================
-- Cardápios das casas: PDFs para imprimir e link público (22/11/2026)
-- Pedido do dono: os menus saem do projeto e vão para Hotéis e restaurantes →
-- Ponta Negra → Cardápios (/restaurantes/ponta-negra/cardapios), com duas
-- partes separadas: "Editar na tela" (cardapios_vivos) e "Para imprimir"
-- (os PDFs desta tabela). E uma página pública (/menus/<código>) para a equipe
-- e o marketing baixarem sempre a versão atual: quando um menu muda, sobe um
-- PDF novo e troca-se `arquivo` (e `menu_versao`) aqui; o link continua o mesmo.
-- Os arquivos ficam no bucket privado workspace-files (<projeto>/<arquivo>.pdf
-- e a capa em <projeto>/<pasta>/capas/<nome>.jpg). Só os PDFs `ativo` de uma
-- casa com link ligado abrem sem login. Nada se apaga (arquivado_em).
-- =====================================================================

create table if not exists public.cardapios_impressos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  codigo text not null check (codigo ~ '^[a-z0-9][a-z0-9-]{0,60}$'),   -- fixo: é o endereço do PDF no link público
  menu_codigo text,                                                   -- o menu editável correspondente (cardapios_vivos.codigo)
  menu_versao int,                                                    -- a versão desse menu que o PDF mostra (menor que a atual = PDF desatualizado)
  titulo text not null check (length(titulo) between 1 and 120),
  descricao text not null default '',
  formato text not null default '',                                   -- ex.: "A3 deitado"
  paginas int,
  arquivo text not null check (arquivo ~ '^[a-z0-9][a-z0-9_-]*(/[a-z0-9][a-z0-9_-]*){0,2}$'), -- sem .pdf, a partir da pasta do projeto
  situacao text not null default 'ativo' check (situacao in ('ativo', 'pausado')),
  ordem int not null default 0,
  atualizado_em timestamptz not null default now(),                   -- quando o PDF foi trocado
  atualizado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  arquivado_em timestamptz,
  unique (workspace_id, codigo)
);

create table if not exists public.cardapios_impressos_historico (
  id bigint generated always as identity primary key,
  impresso_id uuid not null references public.cardapios_impressos(id) on delete cascade,
  workspace_id uuid not null,
  antes jsonb not null,
  gravado_por uuid,
  gravado_em timestamptz not null default now()
);

-- Um link por casa (projeto). Gerar de novo derruba o anterior.
create table if not exists public.cardapios_links (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{11,79}$'),
  nome text not null,                     -- o que aparece no topo da página pública
  ativo boolean not null default true,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  desligado_em timestamptz
);

alter table public.cardapios_impressos enable row level security;
alter table public.cardapios_impressos_historico enable row level security;
alter table public.cardapios_links enable row level security;

drop policy if exists "membros leem impressos" on public.cardapios_impressos;
create policy "membros leem impressos" on public.cardapios_impressos for select to authenticated using (public.is_member(workspace_id));
drop policy if exists "membros mudam impressos" on public.cardapios_impressos;
create policy "membros mudam impressos" on public.cardapios_impressos for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
drop policy if exists "membros criam impressos" on public.cardapios_impressos;
create policy "membros criam impressos" on public.cardapios_impressos for insert to authenticated with check (public.is_member(workspace_id));
drop policy if exists "membros leem historico impressos" on public.cardapios_impressos_historico;
create policy "membros leem historico impressos" on public.cardapios_impressos_historico for select to authenticated using (public.is_member(workspace_id));
drop policy if exists "membros leem link" on public.cardapios_links;
create policy "membros leem link" on public.cardapios_links for select to authenticated using (public.is_member(workspace_id));

-- histórico: guarda a linha de antes a cada mudança
create or replace function public.cardapios_impressos_versionar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if row(new.*) is not distinct from row(old.*) then return new; end if;
  insert into public.cardapios_impressos_historico (impresso_id, workspace_id, antes, gravado_por)
  values (old.id, old.workspace_id, to_jsonb(old), public.acesso_usuario());
  if new.arquivo is distinct from old.arquivo then
    new.atualizado_em := now();
    new.atualizado_por := coalesce(public.acesso_usuario(), new.atualizado_por);
  end if;
  new.id := old.id;
  new.workspace_id := old.workspace_id;
  new.codigo := old.codigo;
  return new;
end $$;
drop trigger if exists cardapios_impressos_versionar on public.cardapios_impressos;
create trigger cardapios_impressos_versionar before update on public.cardapios_impressos
  for each row execute function public.cardapios_impressos_versionar();

-- nada se apaga
create or replace function public.cardapios_sem_apagar()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('brasico.permitir_exclusao', true), '') <> 'sim' then
    raise exception 'Nada se apaga nos cardápios: arquive (arquivado_em).';
  end if;
  return old;
end $$;
drop trigger if exists cardapios_impressos_sem_apagar on public.cardapios_impressos;
create trigger cardapios_impressos_sem_apagar before delete on public.cardapios_impressos
  for each row execute function public.cardapios_sem_apagar();
drop trigger if exists cardapios_links_sem_apagar on public.cardapios_links;
create trigger cardapios_links_sem_apagar before delete on public.cardapios_links
  for each row execute function public.cardapios_sem_apagar();

drop trigger if exists acesso_guarda on public.cardapios_impressos;
create trigger acesso_guarda before insert or update or delete on public.cardapios_impressos
  for each row execute function public.acesso_guarda('projetos');
drop trigger if exists acesso_guarda on public.cardapios_impressos_historico;
create trigger acesso_guarda before insert or update or delete on public.cardapios_impressos_historico
  for each row execute function public.acesso_guarda('projetos');
drop trigger if exists acesso_guarda on public.cardapios_links;
create trigger acesso_guarda before insert or update or delete on public.cardapios_links
  for each row execute function public.acesso_guarda('projetos');

-- Gera (ou troca) o link público da casa: o anterior para de abrir na hora
create or replace function public.cardapios_link_gerar(p_ws uuid, p_nome text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_slug text;
  v_nome text;
begin
  if not public.is_member(p_ws) or not public.acesso_pode_editar('projetos') then
    raise exception 'Sem permissão para mudar o link desta casa.' using errcode = '42501';
  end if;
  v_nome := coalesce(nullif(trim(p_nome), ''), (select nome from public.cardapios_links where workspace_id = p_ws), 'Cardápios');
  v_slug := regexp_replace(lower(translate(v_nome, 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeiooouc' || 'aaaaeeiooouc')), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from left(v_slug, 40)) || '-' || substr(md5(gen_random_uuid()::text), 1, 10);
  insert into public.cardapios_links (workspace_id, slug, nome, ativo, criado_por)
  values (p_ws, v_slug, v_nome, true, auth.uid())
  on conflict (workspace_id) do update set slug = excluded.slug, nome = excluded.nome, ativo = true,
    criado_por = excluded.criado_por, criado_em = now(), desligado_em = null;
  return v_slug;
end $$;
revoke execute on function public.cardapios_link_gerar(uuid, text) from public, anon;
grant execute on function public.cardapios_link_gerar(uuid, text) to authenticated;

create or replace function public.cardapios_link_ligar(p_ws uuid, p_ligado boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_ws) or not public.acesso_pode_editar('projetos') then
    raise exception 'Sem permissão para mudar o link desta casa.' using errcode = '42501';
  end if;
  update public.cardapios_links set ativo = p_ligado, desligado_em = case when p_ligado then null else now() end
  where workspace_id = p_ws;
end $$;
revoke execute on function public.cardapios_link_ligar(uuid, boolean) from public, anon;
grant execute on function public.cardapios_link_ligar(uuid, boolean) to authenticated;

-- Página pública: os PDFs ativos da casa do link (nada, se o link estiver desligado)
create or replace function public.cardapios_publicos(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nome', l.nome,
    'menus', coalesce((
      select jsonb_agg(jsonb_build_object(
        'codigo', i.codigo, 'titulo', i.titulo, 'descricao', i.descricao, 'formato', i.formato,
        'paginas', i.paginas, 'atualizado_em', i.atualizado_em) order by i.ordem, i.titulo)
      from public.cardapios_impressos i
      where i.workspace_id = l.workspace_id and i.situacao = 'ativo' and i.arquivado_em is null), '[]'::jsonb))
  from public.cardapios_links l
  join public.workspaces w on w.id = l.workspace_id and w.removido_em is null
  where l.slug = p_slug and l.ativo;
$$;
revoke execute on function public.cardapios_publicos(text) from public;
grant execute on function public.cardapios_publicos(text) to anon, authenticated;

-- Caminho no bucket do PDF (ou da capa) de um menu do link público
create or replace function public.cardapio_publico_arquivo(p_slug text, p_codigo text, p_capa boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'caminho', case when p_capa
      then i.workspace_id || '/' || coalesce(nullif(regexp_replace(i.arquivo, '/?[^/]+$', ''), '') || '/', '') || 'capas/' || regexp_replace(i.arquivo, '^.*/', '') || '.jpg'
      else i.workspace_id || '/' || i.arquivo || '.pdf' end,
    'nome', l.nome || ' - ' || i.titulo,
    'atualizado_em', i.atualizado_em)
  from public.cardapios_links l
  join public.workspaces w on w.id = l.workspace_id and w.removido_em is null
  join public.cardapios_impressos i on i.workspace_id = l.workspace_id
  where l.slug = p_slug and l.ativo and i.codigo = p_codigo and i.situacao = 'ativo' and i.arquivado_em is null;
$$;
revoke execute on function public.cardapio_publico_arquivo(text, text, boolean) from public;
grant execute on function public.cardapio_publico_arquivo(text, text, boolean) to anon, authenticated;

-- O arquivo do bucket é um PDF (ou capa) ativo de uma casa com link ligado?
create or replace function public.cardapio_arquivo_e_publico(p_nome text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cardapios_impressos i
    join public.cardapios_links l on l.workspace_id = i.workspace_id and l.ativo
    where i.situacao = 'ativo' and i.arquivado_em is null
      and p_nome in (
        i.workspace_id || '/' || i.arquivo || '.pdf',
        i.workspace_id || '/' || coalesce(nullif(regexp_replace(i.arquivo, '/?[^/]+$', ''), '') || '/', '') || 'capas/' || regexp_replace(i.arquivo, '^.*/', '') || '.jpg'));
$$;
revoke execute on function public.cardapio_arquivo_e_publico(text) from public;
grant execute on function public.cardapio_arquivo_e_publico(text) to anon, authenticated;

drop policy if exists "link publico le cardapios" on storage.objects;
create policy "link publico le cardapios" on storage.objects for select to anon
using (bucket_id = 'workspace-files' and public.cardapio_arquivo_e_publico(name));

-- ---------------------------------------------------------------------
-- Cicchetti Ponta Negra (projeto CCHT Open - Ponta Negra): os PDFs de 18/11/2026
-- (iguais aos menus editáveis: o último ajuste do Jantar gerou o PDF no mesmo minuto)
-- ---------------------------------------------------------------------
insert into public.cardapios_impressos (workspace_id, codigo, menu_codigo, menu_versao, titulo, descricao, formato, paginas, arquivo, situacao, ordem, atualizado_em) values
  ('b648cc8b-8f21-4d52-84ab-3c664e7cae04', 'cafe-da-manha', 'cafe-da-manha', 1, 'Café da manhã', 'Por kg (R$ 98,90), das 7h às 11h', 'A3 deitado', 1, 'cardapios/cafe-da-manha-1811', 'ativo', 10, '2026-11-18 18:52:20+00'),
  ('b648cc8b-8f21-4d52-84ab-3c664e7cae04', 'menu-do-dia', 'menu-do-dia', 1, 'Menu do dia', 'Grandioso All Day Menu, das 11h às 17h', 'A3 deitado', 1, 'cardapios/menu-do-dia-1811', 'ativo', 20, '2026-11-18 19:29:01+00'),
  ('b648cc8b-8f21-4d52-84ab-3c664e7cae04', 'jantar', 'jantar', 2, 'Jantar', '52 pratos, no visual do cardápio de Pipa', 'A3', 2, 'cardapios/jantar-1811c', 'ativo', 30, '2026-11-19 00:15:25+00'),
  ('b648cc8b-8f21-4d52-84ab-3c664e7cae04', 'deli', 'deli-temporario', 1, 'Menu Deli', 'Lanches, doces, sucos, chás e cafés; no verso, 6 vinhos, cervejas, águas e soft drinks', 'A4 em pé', 2, 'cardapios/deli-temporario-1811', 'ativo', 40, '2026-11-18 19:08:01+00'),
  ('b648cc8b-8f21-4d52-84ab-3c664e7cae04', 'feito-na-hora', 'feito-na-hora', 1, 'Feito na hora', 'Ovos, French toast, tapiocas, omeletes e panquecas · 12 × 9 cm, 4 por folha com marcas de corte', 'A4 deitado', 1, 'cardapios/feito-na-hora-1811b-a4', 'ativo', 50, '2026-11-18 19:46:58+00'),
  ('b648cc8b-8f21-4d52-84ab-3c664e7cae04', 'deli-completo', 'deli', 1, 'Menu Deli (carta completa)', 'A carta de vinhos completa e os minivinhos no verso', 'A4 em pé', 2, 'cardapios/deli-1311c', 'pausado', 60, '2026-11-13 21:58:40+00')
on conflict (workspace_id, codigo) do nothing;

-- link público (pedido do dono em 22/11/2026: "pra quem tiver o link", para o grupo de Ponta Negra e o marketing)
insert into public.cardapios_links (workspace_id, slug, nome)
select 'b648cc8b-8f21-4d52-84ab-3c664e7cae04', 'cicchetti-ponta-negra-' || substr(md5(gen_random_uuid()::text), 1, 10), 'Cicchetti Ponta Negra'
on conflict (workspace_id) do nothing;
