-- =====================================================================
-- Receita Federal: acervo fiscal (30/10/2026)
-- Cópia integral do projeto "Organograma Fiscal Brasico" (capítulos nos 5 idiomas, CSS e rodapé)
-- para dentro da área da Receita, antes de o projeto ser apagado. O conteúdo fica só no banco
-- (o repositório é público). A página /receita mostra estes capítulos nas seções do guia fiscal.
-- Nada se apaga: capítulo substituído por dado ao vivo fica com `substituido_por`.
-- =====================================================================

create table if not exists public.receita_acervo (
  id uuid primary key,                -- mesmo id do capítulo no projeto de origem
  secao text not null,                -- em qual seção da página o capítulo aparece
  ordem int not null,
  titulo text not null, conteudo text not null default '',
  titulo_en text, conteudo_en text, titulo_pl text, conteudo_pl text,
  titulo_fr text, conteudo_fr text, titulo_de text, conteudo_de text,
  origem text not null default 'Organograma Fiscal Brasico',
  atualizado_na_origem timestamptz,
  copiado_em timestamptz not null default now(),
  substituido_por text                -- quando um dado ao vivo da página passa a valer no lugar
);

create table if not exists public.receita_acervo_estilo (
  id int primary key default 1 check (id = 1),
  css text not null default '',
  rodape text, copiado_em timestamptz not null default now()
);

alter table public.receita_acervo enable row level security;
alter table public.receita_acervo_estilo enable row level security;
drop policy if exists "ver acervo" on public.receita_acervo;
create policy "ver acervo" on public.receita_acervo for select using (public.receita_pode_ver(auth.uid()));
drop policy if exists "ver estilo" on public.receita_acervo_estilo;
create policy "ver estilo" on public.receita_acervo_estilo for select using (public.receita_pode_ver(auth.uid()));

-- Cópia (pode rodar de novo: atualiza com o que estiver no projeto)
insert into public.receita_acervo (id, secao, ordem, titulo, conteudo, titulo_en, conteudo_en, titulo_pl, conteudo_pl,
  titulo_fr, conteudo_fr, titulo_de, conteudo_de, atualizado_na_origem)
select n.id,
  case
    when n.title ~ '^(00|01|04)\s' then 'empresas'
    when n.title ~ '^(02)\s' then 'dividas'
    when n.title ~ '^(18|19|20|21|22|23|24)\s' then 'dividas'
    when n.title ~ '^(03)\s' then 'calendario'
    when n.title ~ '^(05|06|07|08|09|11|12|13)\s' then 'mapa'
    when n.title ~ '^(10)\s' then 'reforma'
    when n.title ~ '^(14|15)\s' then 'roteiro'
    else 'referencias' end,
  coalesce(substring(n.title from '^(\d+)')::int, 99) * 10 + case when n.title ~ 'Mapa societ' then 5 else 0 end,
  n.title, coalesce(n.content, ''), n.title_en, n.content_en, n.title_pl, n.content_pl, n.title_fr, n.content_fr,
  n.title_de, n.content_de, n.updated_at
from public.notes n
where n.workspace_id = '9c2048a6-37c5-4c3d-ad9b-2bb444eb6fb2' and n.archived_at is null
on conflict (id) do update set titulo = excluded.titulo, conteudo = excluded.conteudo,
  titulo_en = excluded.titulo_en, conteudo_en = excluded.conteudo_en, titulo_pl = excluded.titulo_pl, conteudo_pl = excluded.conteudo_pl,
  titulo_fr = excluded.titulo_fr, conteudo_fr = excluded.conteudo_fr, titulo_de = excluded.titulo_de, conteudo_de = excluded.conteudo_de,
  atualizado_na_origem = excluded.atualizado_na_origem, copiado_em = now();

insert into public.receita_acervo_estilo (id, css, rodape)
select 1, coalesce(w.doc_css, ''), w.doc_rodape from public.workspaces w where w.id = '9c2048a6-37c5-4c3d-ad9b-2bb444eb6fb2'
on conflict (id) do update set css = excluded.css, rodape = excluded.rodape, copiado_em = now();
