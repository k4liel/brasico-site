-- Código novo no bloquinho da escala (23/11/2026, pedido do dono): FX = Flexível. A pessoa trabalha no dia, mas
-- sem horário certo. Fica na aba "Trabalha" da janelinha e conta como dia trabalhado nas regras (como HO e VN, sem horas).
alter table public.escala_planejada drop constraint if exists escala_planejada_codigo_check;
alter table public.escala_planejada add constraint escala_planejada_codigo_check
  check (codigo = any (array['', 'T', 'F', 'FC', 'FE', 'AT', 'BH', 'LIC', 'DM', 'FA', 'VN', 'HO', 'CC', 'FL', 'SV', 'FX']));

-- Feriado a confirmar: quem estava em FX num feriado também conta como trabalhando
do $$
declare d text := pg_get_functiondef('public.escala_compensas_dados()'::regprocedure);
begin
  if position('''CC'', ''FL'', ''SV'')' in d) > 0 then
    d := replace(d, '''CC'', ''FL'', ''SV'')', '''CC'', ''FL'', ''SV'', ''FX'')');
    execute d;
  elsif position('''FX''' in d) = 0 then
    raise exception 'escala_compensas_dados mudou: ajuste este script';
  end if;
end $$;
