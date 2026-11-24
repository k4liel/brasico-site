-- eSocial: releitura com os acessos que sobram (23/11/2026)
-- A Brasico77 tem só 6 trabalhadores ativos, todos já lidos: esocial_proximo não tinha o que pedir
-- (releitura comum a cada 21/30 dias) e a empresa ficou dias sem nenhuma resposta do governo.
-- A página do RH (estadoEsocial em components/RhDados.tsx) mostrava "eSocial parada desde 20/11" em vermelho.
-- Agora, quando não há mais nada na fila, a rotina relê o trabalhador ativo lido há mais tempo,
-- se a última leitura dele tem mais de 2 dias. Só usa acesso que sobraria no dia (LAIF e Genesis
-- sempre têm fila antes disso) e respeita o limite diário, os 40 min entre acessos e as falhas recentes.
do $$
declare
  v_def text := pg_get_functiondef('public.esocial_proximo(text)'::regprocedure);
  v_marca text := E'  exception when others then\n    return null;';
  v_novo text := E'    -- folga: nada mais na fila; relê quem está há mais tempo sem leitura (mais de 2 dias)\n'
    || E'    select * into w from public.esocial_trabalhadores t\n'
    || E'    where t.empresa_id = e.id and t.ativo and t.consultado_ate is not null\n'
    || E'      and t.consultado_ate < now() - interval ''2 days''\n'
    || E'      and not exists (select 1 from public.esocial_execucoes f where f.empresa_id = e.id and f.ambiente = 1\n'
    || E'        and f.tipo = ''identificadores_trabalhador'' and f.status = ''falha'' and f.parametros->>''cpf'' = t.cpf and f.created_at > now() - interval ''20 hours'')\n'
    || E'    order by t.consultado_ate limit 1;\n'
    || E'    if w.cpf is not null then\n'
    || E'      v_ini := w.consultado_ate at time zone ''America/Sao_Paulo'';\n'
    || E'      v_fim := least(v_ini + interval ''31 days'' - interval ''1 minute'', v_agora - interval ''65 minutes'');\n'
    || E'      return public.esocial_pedir(e.id, 1, ''identificadores_trabalhador'', jsonb_build_object(''cpf'', w.cpf, ''motivo'', ''folga'',\n'
    || E'        ''dtIni'', to_char(v_ini, ''YYYY-MM-DD"T"HH24:MI:SS''), ''dtFim'', to_char(v_fim, ''YYYY-MM-DD"T"HH24:MI:SS'')), ''agenda'', null);\n'
    || E'    end if;\n';
begin
  if position('''motivo'', ''folga''' in v_def) > 0 then return; end if;  -- já aplicado
  if position(v_marca in v_def) = 0 then raise exception 'esocial_proximo mudou: marca não encontrada'; end if;
  execute replace(v_def, v_marca, v_novo || v_marca);
end $$;
