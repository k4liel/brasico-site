-- =====================================================================
-- Página Filha da Lua (05/11/2026)
-- Cópia integral do projeto "Filha da Lua Ecolodge" (capítulos nos 5 idiomas, CSS, rodapé e abas)
-- para a página própria /filha-da-lua, antes de o projeto ir para a Lixeira (pedido do dono).
-- O conteúdo fica só no banco (o repositório é público). Quem vê: os sócios (notas_pode_ver).
-- Nada se apaga: capítulo tirado fica com `arquivado_em`.
-- =====================================================================

create table if not exists public.filhadalua_capitulos (
  id uuid primary key,                -- mesmo id do capítulo no projeto de origem
  ordem int not null,
  titulo text not null, conteudo text not null default '',
  titulo_en text, conteudo_en text, titulo_pl text, conteudo_pl text,
  titulo_fr text, conteudo_fr text, titulo_de text, conteudo_de text,
  origem text not null default 'Filha da Lua Ecolodge',
  atualizado_na_origem timestamptz,
  copiado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  arquivado_em timestamptz
);

create table if not exists public.filhadalua_estilo (
  id int primary key default 1 check (id = 1),
  css text not null default '',
  rodape text, rodape_en text, rodape_pl text, rodape_fr text, rodape_de text,
  abas_grupos boolean not null default true,
  copiado_em timestamptz not null default now()
);

alter table public.filhadalua_capitulos enable row level security;
alter table public.filhadalua_estilo enable row level security;
drop policy if exists "ver capitulos" on public.filhadalua_capitulos;
create policy "ver capitulos" on public.filhadalua_capitulos for select using (public.notas_pode_ver(auth.uid()));
drop policy if exists "ver estilo" on public.filhadalua_estilo;
create policy "ver estilo" on public.filhadalua_estilo for select using (public.notas_pode_ver(auth.uid()));
grant select on public.filhadalua_capitulos, public.filhadalua_estilo to authenticated;

-- Cópia (pode rodar de novo enquanto o projeto existir: atualiza com o que estiver nele)
insert into public.filhadalua_capitulos (id, ordem, titulo, conteudo, titulo_en, conteudo_en, titulo_pl, conteudo_pl,
  titulo_fr, conteudo_fr, titulo_de, conteudo_de, atualizado_na_origem)
select n.id, coalesce(substring(n.title from '^(\d+)')::int, 99),
  n.title, coalesce(n.content, ''), n.title_en, n.content_en, n.title_pl, n.content_pl, n.title_fr, n.content_fr,
  n.title_de, n.content_de, n.updated_at
from public.notes n
where n.workspace_id = 'b4f6a579-0100-471e-9fa1-21f4274bb21d' and n.archived_at is null
on conflict (id) do update set ordem = excluded.ordem, titulo = excluded.titulo, conteudo = excluded.conteudo,
  titulo_en = excluded.titulo_en, conteudo_en = excluded.conteudo_en, titulo_pl = excluded.titulo_pl, conteudo_pl = excluded.conteudo_pl,
  titulo_fr = excluded.titulo_fr, conteudo_fr = excluded.conteudo_fr, titulo_de = excluded.titulo_de, conteudo_de = excluded.conteudo_de,
  atualizado_na_origem = excluded.atualizado_na_origem, copiado_em = now(), atualizado_em = now();

insert into public.filhadalua_estilo (id, css, rodape, rodape_en, rodape_pl, rodape_fr, rodape_de, abas_grupos)
select 1, coalesce(w.doc_css, ''), w.doc_rodape, w.doc_rodape_en, w.doc_rodape_pl, w.doc_rodape_fr, w.doc_rodape_de,
  coalesce(w.doc_abas_grupos, true)
from public.workspaces w where w.id = 'b4f6a579-0100-471e-9fa1-21f4274bb21d'
on conflict (id) do update set css = excluded.css, rodape = excluded.rodape, rodape_en = excluded.rodape_en,
  rodape_pl = excluded.rodape_pl, rodape_fr = excluded.rodape_fr, rodape_de = excluded.rodape_de,
  abas_grupos = excluded.abas_grupos, copiado_em = now();
