-- Líderes não veem nada do RHiD (09/11/2026, pedido do dono): para quem não é sócio, escala_dados não manda o ponto
-- ('real' vazio), o saldo do banco de horas, o tipo de afastamento nem os feriados trabalhados (crédito de folga), e
-- escala_copiar_rhid só roda para sócios. Na tela, o líder não tem o interruptor do ponto oficial, o "Copiar do RHiD"
-- nem as colunas Banco e Comp. (components/EscalaLider.tsx e EscalaPlanejada.tsx).
do $do$
declare d text := pg_get_functiondef('public.escala_dados(date,date)'::regprocedure);
begin
  if position('where v_socio and d.dia between p_de and p_ate)' in d) = 0 then
    d := replace(d, 'where d.dia between p_de and p_ate)', 'where v_socio and d.dia between p_de and p_ate)');
    d := replace(d, '''saldo_banco'', (select', '''saldo_banco'', case when not v_socio then null else (select');
    d := replace(d, 'order by d.dia desc limit 1),', 'order by d.dia desc limit 1) end,');
    d := replace(d, '''afastado'', (select coalesce(jt.nome', '''afastado'', case when not v_socio then null else (select coalesce(jt.nome');
    d := replace(d, 'order by j.inicio desc limit 1)) j', 'order by j.inicio desc limit 1) end) j');
    d := replace(d, '''comp_creditos'', (select count(*) from public.rhid_dias d where ', '''comp_creditos'', (select count(*) from public.rhid_dias d where v_socio and ');
    execute d;
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.escala_copiar_rhid(uuid[],date,date,boolean)'::regprocedure);
begin
  if position('Só os sócios copiam do RHiD' in d) = 0 then
    d := regexp_replace(d, '\nbegin\n', E'\nbegin\n  if not public.rhid_pode_ver(auth.uid()) then raise exception ''Só os sócios copiam do RHiD.'' using errcode = ''42501''; end if;\n');
    execute d;
  end if;
end $do$;
