-- Página Usuários: mostra também quem lidera a escala da casa inteira (15/11/2026; a Carol aparecia "sem acesso
-- a nada" porque a lista só olhava a liderança por setor, escala_lideres). Campo novo 'casas' = locais de
-- escala_lideres_locais em vigor.
do $do$
declare d text := pg_get_functiondef('public.usuarios_lista()'::regprocedure);
begin
  if position('''casas''' in d) > 0 then return; end if;
  if position('''grupos'', (select coalesce(jsonb_agg(l.grupo_id)' in d) = 0 then
    raise exception 'usuarios_lista mudou: ajuste este script';
  end if;
  d := replace(d, '''grupos'', (select coalesce(jsonb_agg(l.grupo_id)',
    '''casas'', (select coalesce(jsonb_agg(c.local order by c.local), ''[]'') from public.escala_lideres_locais c
                 where c.pessoa_id = p.id and c.arquivado_em is null),
      ''grupos'', (select coalesce(jsonb_agg(l.grupo_id)');
  execute d;
end $do$;
