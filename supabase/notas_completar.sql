-- =====================================================================
-- Notas: nenhuma nota fica só em resumo por falha no encadeamento (04/11/2026)
--  - O que aconteceu: as notas que chegaram em resumo na leitura das 6h e das 9h de 04/11 (filial 0002,
--    trecho buscado um a um) ficaram sem itens porque a leitura terminou em "falha" (656, limite de
--    20 consultas por hora) e a ciência só era pedida depois de leitura "ok" ou "sem_dados".
--  - Agora:
--    1) depois de qualquer leitura (até com falha), se há nota em resumo dentro dos 10 dias, pede a ciência;
--    2) depois da ciência registrada, busca na hora a nota completa pela chave (consChNFe), que já vem com itens;
--    3) a busca pela chave só tenta notas com ciência registrada (sem ela a SEFAZ devolve só o resumo
--       e a consulta gasta o limite de 20 por hora);
--    4) rodada de segurança `notas-completar` (7h30 e 15h de Fortaleza): para cada empresa ativa, ciência
--       do que falta e, depois, a busca pela chave.
--  - Nota em resumo com mais de 10 dias e sem ciência só sai com a confirmação da operação (210200),
--    que o Brasico não registra sem pedido do dono.
-- =====================================================================

create or replace function public.notas_pendentes_chave(p_cnpj text)
returns table (chave text) language sql stable security definer set search_path = public as $$
  select n.chave from public.notas n
  where n.empresa_cnpj = p_cnpj and n.origem = 'sefaz' and not n.completa and n.situacao is distinct from 'cancelada'
    and not exists (select 1 from public.notas_eventos e where e.chave = n.chave and e.tipo = '110111')
    and exists (select 1 from public.notas_eventos e where e.chave = n.chave and e.tipo = '210210'
                and e.sentido = 'enviado' and e.cstat in (135, 136, 573))
    and n.chave_tentativas < 5 and (n.chave_tentada_em is null or n.chave_tentada_em < now() - interval '6 hours')
  order by n.emissao desc limit 10
$$;
revoke execute on function public.notas_pendentes_chave(text) from public, anon, authenticated;

create or replace function public.notas_worker_concluir(p_segredo text, p_execucao uuid, p_status text, p_cstat integer, p_erro text,
  p_resultado jsonb, p_notas jsonb, p_eventos jsonb, p_ult_nsu text, p_max_nsu text, p_bloquear_ate timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x public.notas_execucoes; e public.notas_empresas; r jsonb;
begin
  perform public.notas_conferir_segredo(p_segredo);
  select * into x from public.notas_execucoes where id = p_execucao;
  if x.id is null or x.status <> 'rodando' then return null; end if;
  r := public.notas_gravar(x.empresa_cnpj, p_notas, p_eventos);

  update public.notas_empresas set
    ult_nsu = case when p_ult_nsu ~ '^\d{15}$' and p_ult_nsu > ult_nsu then p_ult_nsu else ult_nsu end,
    max_nsu = coalesce(p_max_nsu, max_nsu),
    bloqueado_ate = case when x.tipo = 'distribuicao' then p_bloquear_ate
                         when x.tipo = 'chave' and p_cstat = 656 then p_bloquear_ate else bloqueado_ate end,
    ultima_consulta = case when x.tipo = 'distribuicao' then now() else ultima_consulta end,
    ultimo_status = left(coalesce(nullif(p_erro, ''), p_status), 200),
    atualizado_em = now()
  where cnpj = x.empresa_cnpj returning * into e;

  update public.notas_execucoes set status = p_status, cstat = p_cstat, erro = nullif(p_erro, ''), fim = now(),
    resultado = x.resultado || coalesce(p_resultado, '{}')
  where id = x.id;

  if (select count(*) from public.notas_execucoes where empresa_cnpj = x.empresa_cnpj and origem = 'encadeada'
      and created_at > now() - interval '1 day') < 30 then
    if x.tipo = 'distribuicao' and p_status <> 'falha' and coalesce((p_resultado->>'continua')::boolean, false) then
      perform public.notas_pedir(x.empresa_cnpj, 'distribuicao', 'encadeada', null);
    elsif x.tipo = 'distribuicao' and e.ciencia and exists (select 1 from public.notas_pendentes_ciencia(x.empresa_cnpj)) then
      -- a ciência é outro serviço (recepção de eventos): vale mesmo depois de uma leitura com falha
      perform public.notas_pedir(x.empresa_cnpj, 'ciencia', 'encadeada', null);
    elsif x.tipo = 'ciencia' and p_status = 'ok' and coalesce((p_resultado->>'pedidas')::int, 0) >= 20
      and exists (select 1 from public.notas_pendentes_ciencia(x.empresa_cnpj)) then
      perform public.notas_pedir(x.empresa_cnpj, 'ciencia', 'encadeada', null);
    elsif x.tipo = 'ciencia' and coalesce((p_resultado->>'registradas')::int, 0) > 0
      and (e.bloqueado_ate is null or e.bloqueado_ate < now())
      and exists (select 1 from public.notas_pendentes_chave(x.empresa_cnpj)) then
      -- ciência registrada: a nota completa já sai pela chave
      perform public.notas_pedir(x.empresa_cnpj, 'chave', 'encadeada', null);
    end if;
  end if;
  return r;
end $$;
revoke execute on function public.notas_worker_concluir(text, uuid, text, integer, text, jsonb, jsonb, jsonb, text, text, timestamptz) from public, authenticated;
grant execute on function public.notas_worker_concluir(text, uuid, text, integer, text, jsonb, jsonb, jsonb, text, text, timestamptz) to anon;

-- Rodada de segurança: ciência do que falta e, depois, a nota completa pela chave
create or replace function public.notas_completar()
returns int language plpgsql security definer set search_path = public as $$
declare e public.notas_empresas; n int := 0;
begin
  for e in select * from public.notas_empresas where ativa order by nome loop
    begin
      if e.ciencia and exists (select 1 from public.notas_pendentes_ciencia(e.cnpj)) then
        perform public.notas_pedir(e.cnpj, 'ciencia', 'agenda', null); n := n + 1;
      elsif (e.bloqueado_ate is null or e.bloqueado_ate < now()) and exists (select 1 from public.notas_pendentes_chave(e.cnpj)) then
        perform public.notas_pedir(e.cnpj, 'chave', 'agenda', null); n := n + 1;
      end if;
    exception when others then null;  -- já em andamento ou sem certificado: tenta na próxima
    end;
  end loop;
  return n;
end $$;
revoke execute on function public.notas_completar() from public, anon, authenticated;

select cron.unschedule('notas-completar') where exists (select 1 from cron.job where jobname = 'notas-completar');
select cron.schedule('notas-completar', '30 10 * * *', $job$ select public.notas_completar() $job$);
select cron.unschedule('notas-completar-tarde') where exists (select 1 from cron.job where jobname = 'notas-completar-tarde');
select cron.schedule('notas-completar-tarde', '0 18 * * *', $job$ select public.notas_completar() $job$);
