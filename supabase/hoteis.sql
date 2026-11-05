-- =====================================================================
-- Hotéis (05/11/2026): grupo "Hotéis" do menu, com uma página por hotel (/hoteis/<hotel>).
-- Cada página é um documento de capítulos (5 idiomas, CSS próprio, abas), como os projetos,
-- mas guardado só no banco (o repositório é público). Quem vê: os sócios (notas_pode_ver).
-- Hotéis: filha-da-lua (conteúdo do antigo projeto "Filha da Lua Ecolodge", copiado de
-- filhadalua_capitulos/filhadalua_estilo, que ficam sem uso) e sempre-vivo (começa vazio).
-- Nada se apaga: capítulo tirado = `arquivado_em`.
-- =====================================================================

create table if not exists public.hoteis (
  id text primary key,                 -- endereço: /hoteis/<id>
  nome text not null,
  ordem int not null default 0,
  css text not null default '',
  rodape text, rodape_en text, rodape_pl text, rodape_fr text, rodape_de text,
  abas_grupos boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.hoteis_capitulos (
  id uuid primary key default gen_random_uuid(),
  hotel text not null references public.hoteis(id),
  ordem int not null,
  titulo text not null, conteudo text not null default '',
  titulo_en text, conteudo_en text, titulo_pl text, conteudo_pl text,
  titulo_fr text, conteudo_fr text, titulo_de text, conteudo_de text,
  origem text,
  atualizado_em timestamptz not null default now(),
  arquivado_em timestamptz
);
create index if not exists hoteis_capitulos_hotel on public.hoteis_capitulos (hotel, ordem);

alter table public.hoteis enable row level security;
alter table public.hoteis_capitulos enable row level security;
drop policy if exists "ver hoteis" on public.hoteis;
create policy "ver hoteis" on public.hoteis for select using (public.notas_pode_ver(auth.uid()));
drop policy if exists "ver capitulos" on public.hoteis_capitulos;
create policy "ver capitulos" on public.hoteis_capitulos for select using (public.notas_pode_ver(auth.uid()));
grant select on public.hoteis, public.hoteis_capitulos to authenticated;

insert into public.hoteis (id, nome, ordem, css, rodape, rodape_en, rodape_pl, rodape_fr, rodape_de, abas_grupos)
select 'filha-da-lua', 'Filha da Lua', 1, e.css, e.rodape, e.rodape_en, e.rodape_pl, e.rodape_fr, e.rodape_de, e.abas_grupos
from public.filhadalua_estilo e where e.id = 1
on conflict (id) do nothing;
insert into public.hoteis (id, nome, ordem) values ('sempre-vivo', 'Sempre Vivo', 2) on conflict (id) do nothing;

insert into public.hoteis_capitulos (id, hotel, ordem, titulo, conteudo, titulo_en, conteudo_en, titulo_pl, conteudo_pl,
  titulo_fr, conteudo_fr, titulo_de, conteudo_de, origem, arquivado_em)
select c.id, 'filha-da-lua', c.ordem, c.titulo, c.conteudo, c.titulo_en, c.conteudo_en, c.titulo_pl, c.conteudo_pl,
  c.titulo_fr, c.conteudo_fr, c.titulo_de, c.conteudo_de, c.origem, c.arquivado_em
from public.filhadalua_capitulos c
on conflict (id) do nothing;
