-- Central de avaliações (24/11/2026, pedido do dono: "ver todas as avaliações no mesmo lugar", Google de todas as casas,
-- TripAdvisor e os canais de venda dos hotéis). Página /avaliacoes (components/Avaliacoes.tsx).
--
-- De onde vêm (pesquisa de 24/11/2026; detalhes em CLAUDE.md, seção Avaliações):
--   google_busca   restaurantes: caixa "Ver todos os comentários do Google" da Busca (ordenada por Mais recentes, sem login)
--                  — o Google Maps sem login mostra só 5 ("visualização limitada").
--   google_viagens hotéis: página do hotel no Google Viagens, aba Avaliações (Mais recentes; mistura Google e TripAdvisor,
--                  guardamos só as do Google).
--   tripadvisor    página pública, "Mais recentes", 10 por página.
--   booking        página do hotel, janela "Ler todas as avaliações", "Mais recentes primeiro".
--   expedia        página do hotel (com datas), janela das avaliações, "More reviews".
-- Leitura: o robô do PMS na VPS (robos/avaliacoes/avaliacoes.mjs, chamado por robos/chefweb/chefweb.mjs a cada rodada,
-- baixado do GitHub na hora: mudar a leitura não exige reiniciar). Cada fonte é lida a cada `intervalo_horas`.
-- Nada se apaga: avaliação que some do site continua aqui (removida_do_site_em fica para o futuro).

create table if not exists public.avaliacoes_fontes (
  id text primary key,                 -- ex.: google_cicchetti_pipa
  casa text not null,                  -- filha_da_lua · sempre_vivo · cicchetti_pipa · cicchetti_ponta_negra
  site text not null,                  -- google · tripadvisor · booking · expedia
  tipo text not null default 'hotel',  -- hotel · restaurante
  nome_no_site text,
  url text,
  leitor text,                         -- google_busca · google_viagens · tripadvisor · booking · expedia
  escala int not null default 5,       -- nota máxima no site (5 ou 10)
  ativa boolean not null default true,
  intervalo_horas int not null default 6,
  observacao text,
  nota numeric,                        -- nota geral mostrada pelo site
  total int,                           -- nº de avaliações mostrado pelo site
  distribuicao jsonb,                  -- {"5":1041,"4":234,...}
  posicao text,                        -- ex.: "Nº 1 de 99 hotéis especializados em Praia da Pipa"
  lida_em timestamptz,                 -- última leitura que deu certo
  tentou_em timestamptz,
  erro text,
  erro_em timestamptz,
  ordem int not null default 0,
  criada_em timestamptz not null default now()
);

create table if not exists public.avaliacoes (
  id bigint generated always as identity primary key,
  fonte_id text not null references public.avaliacoes_fontes(id),
  externo_id text not null,            -- id do site, ou um código montado do autor + data + texto
  autor text,
  autor_info text,                     -- "Local Guide · 13 avaliações", país, contribuições
  pais text,
  nota numeric,                        -- na escala do site
  escala int not null default 5,
  nota5 numeric generated always as (round(nota * 5.0 / nullif(escala, 0), 2)) stored,
  titulo text,
  texto text,
  positivo text,                       -- Booking separa o que gostou e o que não gostou
  negativo text,
  resposta text,                       -- resposta da casa, quando houver
  resposta_data text,
  data_avaliacao date,                 -- data da avaliação (aproximada quando o site diz "um mês atrás")
  data_aproximada boolean not null default false,
  data_texto text,
  estadia text,                        -- mês/período da estadia
  perfil text,                         -- casal, família, viajante a negócios…
  quarto text,
  link text,
  detalhes jsonb,
  primeira_leitura timestamptz not null default now(),
  ultima_leitura timestamptz not null default now(),
  unique (fonte_id, externo_id)
);
create index if not exists avaliacoes_data on public.avaliacoes (data_avaliacao desc);
create index if not exists avaliacoes_fonte_data on public.avaliacoes (fonte_id, data_avaliacao desc);

-- Retrato do dia de cada fonte (nota e total), para a evolução
create table if not exists public.avaliacoes_notas (
  fonte_id text not null references public.avaliacoes_fontes(id),
  dia date not null,
  nota numeric,
  total int,
  distribuicao jsonb,
  lido_em timestamptz not null default now(),
  primary key (fonte_id, dia)
);

create table if not exists public.avaliacoes_execucoes (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'robo',  -- robo · navegador (carga feita pelo Claude no navegador do app)
  inicio timestamptz not null default now(),
  fim timestamptz,
  status text not null default 'rodando', -- rodando · ok · parcial · falha
  resumo jsonb not null default '[]'::jsonb,
  erro text
);

-- Chave temporária para a carga pelo navegador do app (só o hash; vale poucas horas)
create table if not exists public.avaliacoes_chaves (
  chave_hash text primary key,
  expira_em timestamptz not null,
  criada_em timestamptz not null default now()
);

alter table public.avaliacoes_fontes enable row level security;
alter table public.avaliacoes enable row level security;
alter table public.avaliacoes_notas enable row level security;
alter table public.avaliacoes_execucoes enable row level security;
alter table public.avaliacoes_chaves enable row level security;

-- Quem vê: os sócios (como as páginas dos hotéis)
drop policy if exists "socios leem fontes" on public.avaliacoes_fontes;
create policy "socios leem fontes" on public.avaliacoes_fontes for select to authenticated using (public.notas_pode_ver(auth.uid()));
drop policy if exists "socios leem avaliacoes" on public.avaliacoes;
create policy "socios leem avaliacoes" on public.avaliacoes for select to authenticated using (public.notas_pode_ver(auth.uid()));
drop policy if exists "socios leem notas" on public.avaliacoes_notas;
create policy "socios leem notas" on public.avaliacoes_notas for select to authenticated using (public.notas_pode_ver(auth.uid()));
drop policy if exists "socios leem execucoes" on public.avaliacoes_execucoes;
create policy "socios leem execucoes" on public.avaliacoes_execucoes for select to authenticated using (public.notas_pode_ver(auth.uid()));

-- Trava de acessos (área Hotéis e restaurantes)
do $$ declare t text; begin
  foreach t in array array['avaliacoes_fontes','avaliacoes','avaliacoes_notas','avaliacoes_execucoes'] loop
    execute format('drop trigger if exists acesso_guarda on public.%I', t);
    execute format('create trigger acesso_guarda before insert or update or delete on public.%I for each row execute function public.acesso_guarda(''hoteis'')', t);
  end loop;
end $$;

-- Quem pode gravar: o robô (segredo do robô do PMS) ou uma chave temporária da carga pelo navegador
create or replace function public.avaliacoes_ok(p_segredo text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select public.pms_robo_ok(p_segredo)
      or exists (select 1 from public.avaliacoes_chaves
                  where chave_hash = encode(extensions.digest(coalesce(p_segredo, ''), 'sha256'), 'hex') and expira_em > now());
$$;
revoke all on function public.avaliacoes_ok(text) from public, anon, authenticated;

-- O robô pergunta o que ler nesta rodada (no máximo p_max fontes, as mais atrasadas primeiro)
create or replace function public.avaliacoes_robo_comecar(p_segredo text, p_max int default 4)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_fontes jsonb;
begin
  if not public.avaliacoes_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.avaliacoes_execucoes set status = 'falha', erro = 'presa', fim = now()
   where status = 'rodando' and inicio < now() - interval '40 minutes';
  select coalesce(jsonb_agg(x order by (x->>'atraso')::bigint desc), '[]'::jsonb) into v_fontes from (
    select jsonb_build_object('id', f.id, 'leitor', f.leitor, 'url', f.url, 'nome', f.nome_no_site, 'escala', f.escala,
             'primeira', not exists (select 1 from public.avaliacoes a where a.fonte_id = f.id),
             'conhecidos', (select coalesce(jsonb_agg(a.externo_id), '[]'::jsonb) from (select externo_id from public.avaliacoes a
                              where a.fonte_id = f.id order by a.primeira_leitura desc, a.id desc limit 30) a),
             'atraso', extract(epoch from now() - coalesce(f.tentou_em, '2000-01-01'))::bigint) x
      from public.avaliacoes_fontes f
     where f.ativa and f.leitor is not null and f.url is not null
       and coalesce(f.tentou_em, '2000-01-01') < now() - make_interval(hours => f.intervalo_horas)
     order by coalesce(f.tentou_em, '2000-01-01') limit greatest(p_max, 1)) s;
  if jsonb_array_length(v_fontes) = 0 then return jsonb_build_object('fazer', false, 'motivo', 'nada para ler agora'); end if;
  insert into public.avaliacoes_execucoes default values returning id into v_id;
  update public.avaliacoes_fontes set tentou_em = now() where id in (select x->>'id' from jsonb_array_elements(v_fontes) x);
  return jsonb_build_object('fazer', true, 'execucao', v_id, 'fontes', v_fontes);
end $$;
revoke all on function public.avaliacoes_robo_comecar(text, int) from public, authenticated;
grant execute on function public.avaliacoes_robo_comecar(text, int) to anon;

-- Grava o que foi lido de uma fonte: resumo (nota, total, distribuição, posição) e as avaliações (upsert pelo id do site)
create or replace function public.avaliacoes_gravar(p_segredo text, p_fonte text, p_resumo jsonb, p_itens jsonb,
                                                    p_erro text default null, p_execucao uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_escala int; v_novas int := 0; v_lidas int := 0; v_nota numeric; v_total int;
begin
  if not public.avaliacoes_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select escala into v_escala from public.avaliacoes_fontes where id = p_fonte;
  if v_escala is null then raise exception 'fonte desconhecida: %', p_fonte; end if;

  if p_erro is not null and coalesce(jsonb_array_length(p_itens), 0) = 0 then
    update public.avaliacoes_fontes set erro = left(p_erro, 500), erro_em = now() where id = p_fonte;
  else
    v_nota := nullif(p_resumo->>'nota', '')::numeric;
    v_total := nullif(p_resumo->>'total', '')::int;
    update public.avaliacoes_fontes set
      nota = coalesce(v_nota, nota), total = coalesce(v_total, total),
      distribuicao = coalesce(nullif(p_resumo->'distribuicao', '{}'::jsonb), distribuicao),
      posicao = coalesce(nullif(p_resumo->>'posicao', ''), posicao),
      lida_em = now(), erro = case when p_erro is null then null else left(p_erro, 500) end,
      erro_em = case when p_erro is null then erro_em else now() end
     where id = p_fonte;
    if v_nota is not null or v_total is not null then
      insert into public.avaliacoes_notas (fonte_id, dia, nota, total, distribuicao)
      values (p_fonte, (now() at time zone 'America/Fortaleza')::date, v_nota, v_total, nullif(p_resumo->'distribuicao', '{}'::jsonb))
      on conflict (fonte_id, dia) do update set nota = coalesce(excluded.nota, avaliacoes_notas.nota),
        total = coalesce(excluded.total, avaliacoes_notas.total),
        distribuicao = coalesce(excluded.distribuicao, avaliacoes_notas.distribuicao), lido_em = now();
    end if;

    with dados as (
      select i->>'id' as externo_id, i from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i
       where coalesce(i->>'id', '') <> ''
    ), gravadas as (
      insert into public.avaliacoes as a (fonte_id, externo_id, autor, autor_info, pais, nota, escala, titulo, texto, positivo,
        negativo, resposta, resposta_data, data_avaliacao, data_aproximada, data_texto, estadia, perfil, quarto, link, detalhes)
      select p_fonte, d.externo_id, left(d.i->>'autor', 200), left(d.i->>'autor_info', 300), left(d.i->>'pais', 100),
             nullif(d.i->>'nota', '')::numeric, v_escala, left(d.i->>'titulo', 500), left(d.i->>'texto', 8000),
             left(d.i->>'positivo', 5000), left(d.i->>'negativo', 5000), left(d.i->>'resposta', 5000), left(d.i->>'resposta_data', 100),
             nullif(d.i->>'data', '')::date, coalesce((d.i->>'aproximada')::boolean, false), left(d.i->>'data_texto', 120),
             left(d.i->>'estadia', 120), left(d.i->>'perfil', 120), left(d.i->>'quarto', 200), left(d.i->>'link', 500),
             nullif(d.i->'detalhes', 'null'::jsonb)
        from dados d
      on conflict (fonte_id, externo_id) do update set
        autor = coalesce(excluded.autor, a.autor), autor_info = coalesce(excluded.autor_info, a.autor_info),
        nota = coalesce(excluded.nota, a.nota), titulo = coalesce(excluded.titulo, a.titulo),
        -- texto: fica o mais completo (o site às vezes corta com "…")
        texto = case when length(coalesce(excluded.texto, '')) >= length(coalesce(a.texto, '')) then excluded.texto else a.texto end,
        positivo = coalesce(excluded.positivo, a.positivo), negativo = coalesce(excluded.negativo, a.negativo),
        resposta = coalesce(excluded.resposta, a.resposta), resposta_data = coalesce(excluded.resposta_data, a.resposta_data),
        -- data aproximada ("um mês atrás") não troca uma data exata nem uma aproximada mais antiga
        data_avaliacao = case when a.data_avaliacao is null then excluded.data_avaliacao
                              when not excluded.data_aproximada and a.data_aproximada then excluded.data_avaliacao
                              else a.data_avaliacao end,
        data_aproximada = case when a.data_avaliacao is null then excluded.data_aproximada
                               else a.data_aproximada and excluded.data_aproximada end,
        data_texto = coalesce(excluded.data_texto, a.data_texto), estadia = coalesce(excluded.estadia, a.estadia),
        perfil = coalesce(excluded.perfil, a.perfil), quarto = coalesce(excluded.quarto, a.quarto),
        link = coalesce(excluded.link, a.link), detalhes = coalesce(excluded.detalhes, a.detalhes), ultima_leitura = now()
      returning (xmax = 0) as nova
    )
    select count(*) filter (where nova), count(*) into v_novas, v_lidas from gravadas;
  end if;

  if p_execucao is not null then
    update public.avaliacoes_execucoes set resumo = resumo || jsonb_build_array(jsonb_build_object(
      'fonte', p_fonte, 'lidas', v_lidas, 'novas', v_novas, 'nota', v_nota, 'total', v_total, 'erro', p_erro, 'em', now()))
     where id = p_execucao;
  end if;
  return jsonb_build_object('lidas', v_lidas, 'novas', v_novas);
end $$;
revoke all on function public.avaliacoes_gravar(text, text, jsonb, jsonb, text, uuid) from public, authenticated;
grant execute on function public.avaliacoes_gravar(text, text, jsonb, jsonb, text, uuid) to anon;

create or replace function public.avaliacoes_robo_fim(p_segredo text, p_execucao uuid, p_erro text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.avaliacoes_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.avaliacoes_execucoes set fim = now(), erro = p_erro,
    status = case when p_erro is not null then 'falha'
                  when exists (select 1 from jsonb_array_elements(resumo) r where r->>'erro' is not null) then 'parcial' else 'ok' end
   where id = p_execucao;
end $$;
revoke all on function public.avaliacoes_robo_fim(text, uuid, text) from public, authenticated;
grant execute on function public.avaliacoes_robo_fim(text, uuid, text) to anon;

-- Fontes (24/11/2026). Ponta Negra ainda não tem página em nenhum site: fica cadastrada, desligada, com o aviso.
insert into public.avaliacoes_fontes (id, casa, site, tipo, nome_no_site, url, leitor, escala, ativa, ordem, observacao) values
 ('google_filha_da_lua', 'filha_da_lua', 'google', 'hotel', 'Filha da Lua - Eco Lodge Pipa',
  'https://www.google.com/travel/search?q=Filha%20da%20Lua%20Eco%20Lodge%20Pipa&hl=pt-BR&gl=br', 'google_viagens', 5, true, 10, null),
 ('tripadvisor_filha_da_lua', 'filha_da_lua', 'tripadvisor', 'hotel', 'Filha Da Lua - Eco Lodge',
  'https://www.tripadvisor.com.br/Hotel_Review-g303522-d23033693-Reviews-Filha_Da_Lua_Eco_Lodge-Praia_da_Pipa_Tibau_do_Sul_State_of_Rio_Grande_do_Norte.html', 'tripadvisor', 5, true, 11, null),
 ('booking_filha_da_lua', 'filha_da_lua', 'booking', 'hotel', 'Filha Da Lua Ecolodge',
  'https://www.booking.com/hotel/br/filha-da-lua-ecolodge.pt-br.html', 'booking', 10, true, 12, null),
 ('expedia_filha_da_lua', 'filha_da_lua', 'expedia', 'hotel', 'Filha da Lua Ecolodge',
  'https://www.expedia.com/Tibau-Do-Sul-Hotels-Filha-Da-Lua-Ecolodge.h76145811.Hotel-Information', 'expedia', 10, true, 13,
  'Mesmas avaliações na Hoteis.com, Travelocity e Orbitz (grupo Expedia).'),
 ('google_sempre_vivo', 'sempre_vivo', 'google', 'hotel', 'Sempre Vivo Hotel & Cicchetti Restaurante',
  'https://www.google.com/travel/search?q=Sempre%20Vivo%20Hotel%20%26%20Cicchetti%20Restaurante%20Pipa&hl=pt-BR&gl=br', 'google_viagens', 5, true, 20,
  'No Google o hotel e o restaurante Cicchetti de dentro dele são um perfil só.'),
 ('tripadvisor_sempre_vivo', 'sempre_vivo', 'tripadvisor', 'hotel', 'Sempre Vivo Hotel',
  'https://www.tripadvisor.com.br/Hotel_Review-g303522-d28912825-Reviews-Sempre_Vivo_Hotel-Praia_da_Pipa_Tibau_do_Sul_State_of_Rio_Grande_do_Norte.html', 'tripadvisor', 5, true, 21, null),
 ('tripadvisor_cicchetti_sempre_vivo', 'sempre_vivo', 'tripadvisor', 'restaurante', 'Cicchetti Sempre Vivo',
  'https://www.tripadvisor.com.br/Restaurant_Review-g303522-d24997647-Reviews-Cicchetti_Sempre_Vivo-Praia_da_Pipa_Tibau_do_Sul_State_of_Rio_Grande_do_Norte.html', 'tripadvisor', 5, true, 22,
  'Restaurante de dentro do hotel.'),
 ('booking_sempre_vivo', 'sempre_vivo', 'booking', 'hotel', 'Sempre Vivo',
  'https://www.booking.com/hotel/br/sempre-vivo.pt-br.html', 'booking', 10, true, 23, null),
 ('expedia_sempre_vivo', 'sempre_vivo', 'expedia', 'hotel', 'Sempre Vivo',
  'https://www.expedia.com/Tibau-Do-Sul-Hotels-Sempre-Vivo.h90898596.Hotel-Information', 'expedia', 10, true, 24,
  'Mesmas avaliações na Hoteis.com, Travelocity e Orbitz (grupo Expedia).'),
 ('google_cicchetti_pipa', 'cicchetti_pipa', 'google', 'restaurante', 'Cicchetti Praia da Pipa',
  'https://www.google.com/search?q=Cicchetti+Praia+da+Pipa&hl=pt-BR&gl=br', 'google_busca', 5, true, 30, null),
 ('tripadvisor_cicchetti_pipa', 'cicchetti_pipa', 'tripadvisor', 'restaurante', 'Cicchetti Praia da Pipa', null, 'tripadvisor', 5, true, 31,
  'Endereço da página no TripAdvisor a confirmar.'),
 ('google_cicchetti_ponta_negra', 'cicchetti_ponta_negra', 'google', 'restaurante', 'Cicchetti Ponta Negra', null, 'google_busca', 5, false, 40,
  'Ainda não existe perfil no Google. Criar no Google Perfil da Empresa (business.google.com) e depois ligar aqui.'),
 ('tripadvisor_cicchetti_ponta_negra', 'cicchetti_ponta_negra', 'tripadvisor', 'restaurante', 'Cicchetti Ponta Negra', null, 'tripadvisor', 5, false, 41,
  'Ainda não existe página no TripAdvisor.')
on conflict (id) do nothing;
