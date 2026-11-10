-- eSocial: salários antes das releituras comuns (10/11/2026, revisão do RH pedida pelo dono)
-- Diagnóstico: só 29 de 88 ativos da LAIF tinham salário de contrato. O salário vem do S-2200/S-2206, buscado na
-- "janela da admissão", que ficava depois das releituras — com 88 pessoas, as releituras gastavam os 10 acessos
-- do dia e a LAIF nunca chegou à janela da admissão (86 na fila).
-- Nova ordem em esocial_proximo (mesmo gasto de acessos por dia):
--   download cheio → S-1299 → quem nunca foi lido → releitura de quem PAROU/INATIVO (pode ter saído)
--   → janela da admissão (salário) → releitura comum (batendo, afastado, sem ponto) → S-1005 → histórico → download.
-- A consulta do S-1010 (rubricas) sem chave voltava 402 "Solicitação inválida" e gastava acesso: fica desligada
-- até se saber a chave certa (a folha é lida pelo S-1200/S-1210, que já chegam).
-- Ids de 34 posições (ID1…/ID2…/ID3…, os totalizadores por trabalhador S-5001/5002/5003) não baixam por este
-- serviço, como os de 35: viram 'indisponivel' (antes ficavam 'pendente' para sempre e inflavam a fila).

do $do$
declare f text;
begin
  f := pg_get_functiondef('public.esocial_proximo(text)'::regprocedure);

  -- 1) a releitura passa a ter dois passos: primeiro só parou/inativo; a comum vai para depois da admissão
  f := replace(f, $a$    order by (t.ponto_situacao in ('parou', 'inativo')) desc, t.consultado_ate limit 1;
    if w.cpf is not null then$a$, $a$      and t.ponto_situacao in ('parou', 'inativo')
    order by t.consultado_ate limit 1;
    if w.cpf is not null then$a$);

  -- 2) S-1010 desligado
  f := replace(f, $a$    if not exists (select 1 from public.esocial_execucoes where empresa_id = e.id and ambiente = 1
        and tipo = 'identificadores_tabela' and status in ('ok', 'sem_dados') and parametros->>'tpEvt' = 'S-1010')$a$,
    $a$    if false and not exists (select 1 from public.esocial_execucoes where empresa_id = e.id and ambiente = 1
        and tipo = 'identificadores_tabela' and status in ('ok', 'sem_dados') and parametros->>'tpEvt' = 'S-1010')$a$);

  -- 3) releitura comum logo depois da janela da admissão (antes do histórico)
  f := replace(f, $a$    select * into w from public.esocial_trabalhadores t
    where t.empresa_id = e.id and t.ativo and t.consultado_desde is not null$a$, $a$    select * into w from public.esocial_trabalhadores t
    where t.empresa_id = e.id and t.ativo
      and coalesce(t.ponto_situacao, '') not in ('parou', 'inativo')
      and t.consultado_ate < now() - case t.ponto_situacao
        when 'batendo' then interval '21 days'
        when 'afastado' then interval '21 days'
        when 'sem_ponto' then interval '30 days'
        else interval '7 days' end
      and not exists (select 1 from public.esocial_execucoes f where f.empresa_id = e.id and f.ambiente = 1
        and f.tipo = 'identificadores_trabalhador' and f.status = 'falha' and f.parametros->>'cpf' = t.cpf and f.created_at > now() - interval '20 hours')
    order by t.consultado_ate limit 1;
    if w.cpf is not null then
      v_ini := w.consultado_ate at time zone 'America/Sao_Paulo';
      v_fim := least(v_ini + interval '31 days' - interval '1 minute', v_agora - interval '65 minutes');
      return public.esocial_pedir(e.id, 1, 'identificadores_trabalhador', jsonb_build_object('cpf', w.cpf,
        'dtIni', to_char(v_ini, 'YYYY-MM-DD"T"HH24:MI:SS'), 'dtFim', to_char(v_fim, 'YYYY-MM-DD"T"HH24:MI:SS')), 'agenda', null);
    end if;

    select * into w from public.esocial_trabalhadores t
    where t.empresa_id = e.id and t.ativo and t.consultado_desde is not null$a$);

  if f not like '%t.ponto_situacao in (''parou'', ''inativo'')
    order by t.consultado_ate limit 1;%' or f not like '%if false and not exists%' or f not like '%coalesce(t.ponto_situacao, '''') not in%' then
    raise exception 'esocial_proximo: algum trecho não foi encontrado';
  end if;
  execute f;
end $do$;

-- Ids que não baixam (34 posições) deixam de ser "pendentes"
update public.esocial_eventos set situacao = 'indisponivel'
where situacao = 'pendente' and length(id_evento) <> 36;

create or replace function public.esocial_eventos_indisponivel()
returns trigger language plpgsql as $$
begin
  if new.situacao = 'pendente' and length(new.id_evento) <> 36 then new.situacao := 'indisponivel'; end if;
  return new;
end $$;
drop trigger if exists esocial_eventos_indisponivel on public.esocial_eventos;
create trigger esocial_eventos_indisponivel before insert or update of situacao on public.esocial_eventos
  for each row execute function public.esocial_eventos_indisponivel();
