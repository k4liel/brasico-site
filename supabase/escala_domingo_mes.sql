-- Domingo do mês (09/11/2026, pedido do dono): a folga de domingo que cada pessoa tem no mês, diferente da folga
-- normal. Código DM na escala planejada; só em domingo (escala_gravar recusa em outro dia). Conta como descanso.
alter table public.escala_planejada drop constraint if exists escala_planejada_codigo_check;
alter table public.escala_planejada add constraint escala_planejada_codigo_check
  check (codigo = any (array['', 'T', 'F', 'FC', 'FE', 'AT', 'BH', 'LIC', 'DM']));

do $do$
declare d text := pg_get_functiondef('public.escala_gravar(jsonb)'::regprocedure);
begin
  if position('Domingo do mês' in d) = 0 then
    d := replace(d, $r$    v_cod := coalesce(v->>'codigo', '');$r$,
      $r$    v_cod := coalesce(v->>'codigo', '');
    if v_cod = 'DM' and extract(dow from v_dia) <> 0 then
      raise exception 'Domingo do mês só pode ser num domingo (%).', to_char(v_dia, 'DD/MM') using errcode = 'P0001';
    end if;$r$);
    execute d;
  end if;
end $do$;
