-- Análise das compras em duas etapas (04/11/2026). A Edge Function compras-analise só roda 150 s e a análise
-- pesada de uma lista grande leva minutos: a etapa 1 (separar o pedido e buscar os candidatos nas notas) roda na
-- função; a etapa 2 vai para a fila de lotes da Anthropic (Message Batches) e é recolhida numa chamada seguinte.
-- Enquanto espera o lote, a análise fica 'no_lote' (com o id do lote em `lote` e o que é preciso para gravar em `dados`).

alter table public.compras_analises add column if not exists lote text, add column if not exists dados jsonb;
alter table public.compras_analises drop constraint if exists compras_analises_status_check;
alter table public.compras_analises add constraint compras_analises_status_check
  check (status in ('analisando','no_lote','ok','sem_pedido','pulada','falha'));
create index if not exists compras_analises_no_lote on public.compras_analises (inicio) where status = 'no_lote';

-- Testes da função (corpo {"teste": true, "pessoa": "<id>"}): nada aqui vira lista
create table if not exists public.compras_testes (
  id bigint generated always as identity primary key,
  pessoa_id uuid references public.operacao_pessoas(id),
  lote text,
  resultado jsonb,
  inicio timestamptz not null default now(),
  fim timestamptz
);
alter table public.compras_testes enable row level security;

-- compras_auto_proxima: quem está 'no_lote' não entra de novo na fila; lote parado há 6 h vira falha
CREATE OR REPLACE FUNCTION public.compras_auto_proxima(p_semana uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_inicio date; v_de timestamptz; v_ate timestamptz; p record; v_analise bigint;
  c_grupo constant text := '120363040261291910@g.us';
begin
  perform pg_advisory_xact_lock(hashtext('compras_auto_proxima'));
  select inicio into v_inicio from public.compras_semanas where id = p_semana and status = 'aberta';
  if v_inicio is null then return null; end if;
  select j.de, j.ate into v_de, v_ate from public.compras_janela(v_inicio) j;
  update public.compras_analises set status = 'falha', erro = 'tempo esgotado', fim = now()
  where semana_id = p_semana and ((status = 'analisando' and inicio < now() - interval '15 minutes')
                               or (status = 'no_lote' and inicio < now() - interval '6 hours'));

  select o.*, u.ultima, ult.inicio ultima_analise into p
  from public.operacao_pessoas o
  join lateral (select max(m.enviada_em) ultima from public.wa_mensagens m
    where m.grupo_id = c_grupo and not m.de_nos and m.enviada_em >= v_de and m.enviada_em < v_ate
      and public.compras_nome(m.autor_nome) = public.compras_nome(o.wa_nome)) u on u.ultima is not null
  left join lateral (select max(a.inicio) inicio from public.compras_analises a
    where a.semana_id = p_semana and a.pessoa_id = o.id and a.status <> 'falha') ult on true
  where o.ativo and o.papel = 'solicitante' and coalesce(trim(o.wa_nome), '') <> ''
    and not exists (select 1 from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id and a.status in ('analisando', 'no_lote'))
    and (select count(*) from public.compras_analises a where a.semana_id = p_semana and a.pessoa_id = o.id
         and a.status = 'falha' and a.inicio > greatest(u.ultima, now() - interval '20 hours')) < 2
    and (
      ult.inicio is null or ult.inicio < u.ultima
      or (ult.inicio < now() - interval '20 hours' and now() < v_ate
          and exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = o.id and l.status in ('aguardando', 'em_revisao'))
          and not exists (select 1 from public.compras_listas l where l.semana_id = p_semana and l.pessoa_id = o.id
                          and public.compras_lista_ativa(l.status) and public.compras_lista_tocada(l.id)))
    )
  order by (ult.inicio is null or ult.inicio < u.ultima) desc, u.ultima limit 1;
  if p.id is null then return null; end if;

  insert into public.compras_analises (semana_id, pessoa_id, status) values (p_semana, p.id, 'analisando') returning id into v_analise;
  return jsonb_build_object('id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'setor', p.setor, 'wa_nome', p.wa_nome,
    'analise', v_analise, 'de', v_de, 'ate', v_ate);
end $function$;
