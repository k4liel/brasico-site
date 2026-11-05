-- =====================================================================
-- Fichas técnicas: o que faltava do projeto "Fichas técnicas" (05/11/2026, a pedido do dono)
--  - Molho Demi-glace da planilha Produção 2026 (aba 26 do projeto): não entrou na cópia de
--    28/10 porque tem o mesmo nome do demi-glace das "Fichas da casa" (receita diferente).
--  - 18 bases do bar do Midway que no projeto estavam só em tabelas (aba 07): super juice,
--    extratos, xaropes e espumas. O custo da planilha do bar vai nas observações.
--  - Preço de cada item da produção (aba 24) nas observações da ficha correspondente.
--  - As linhas "Custo da receita" que a cópia de 28/10 tinha virado ingrediente ficam removidas.
-- O projeto continua na Lixeira. Rodar uma vez: as fichas novas não se repetem (confere o nome).
-- =====================================================================
do $$
declare
  v_f uuid; v_k int; r jsonb; it jsonb;
  v_midway_nota uuid := '4187dfc0-bda2-4463-9bb7-586633076c0a';
  v_prod_nota uuid := '247d1e06-cd8c-4d58-a648-d283f12ea51e';
  novas jsonb := $j$[
  {"un":"producao","grupo":"Molhos e ragu","nota":"prod","nome":"Molho Demi-glace (planilha 2026)",
   "preparo":"Distribua os ossos e o ossobuco em assadeiras, sem amontoar, e asse a 220 °C por 1 h a 1h30, virando até dourar bem, sem queimar.\nCorte grosseiramente a cebola, a cenoura e o salsão e junte às assadeiras nos últimos 30 a 40 minutos.\nPasse o mocotó limpo e as carnes douradas para uma panela, junte o vinho e água para cobrir (cerca de 25 a 30 L); divida entre panelas se precisar.\nCozinhe em fervura suave por 6 a 8 horas, tirando a espuma e o excesso de gordura; junte água quente quando precisar para manter tudo coberto.\nCoe em peneira fina, esprema os sólidos e tire a gordura da superfície.\nVolte o caldo ao fogo baixo, sem tampa, e reduza até perto de 10 L; prove o sabor e a consistência com o molho quente.\nSe precisar, faça um roux com 300 g de farinha, 100 g de manteiga e 200 g de azeite, cozinhando até ficar castanho, sem queimar; junte aos poucos com o batedor, só o necessário, e cozinhe mais 20 a 30 minutos.\nCorrija o sal no fim e, se precisar, passe de novo pela peneira fina.",
   "obs":"Guardar congelado a −15 °C · Validade: 90 dias\nConfirmar: cenoura em litros (1 L); o roux usa manteiga (100 g) e azeite (200 g) que não estão nos ingredientes; a lista fala em 20 L de água e o preparo em 25 a 30 L. É uma receita diferente do Molho Demi-glace das Fichas da casa.",
   "itens":[["Osso bovino",10,"kg"],["Ossobuco",5,"kg"],["Mocotó",5,"kg"],["Farinha de trigo",0.3,"kg"],["Cebola",2,"kg"],["Cenoura",1,"L"],["Salsão",0.5,"kg"],["Vinho tinto seco",5,"L"],["Água",20,"L"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Super Juice","rend":3.5,"rend_un":"L",
   "preparo":"Descasque os limões, misture as cascas com os ácidos e deixe descansar por 1 hora.\nEsprema os limões, junte o sumo, as cascas e a água filtrada e bata.\nPeneire e coe, ficando só com o líquido.",
   "obs":"Rende 3,5 L · Custo na planilha do bar: R$ 12,09",
   "itens":[["Água filtrada",750,"ml"],["Limão siciliano",0.2,"kg"],["Limão Taiti",1.8,"kg"],["Ácido málico",0.006,"kg"],["Ácido cítrico",0.044,"kg"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Extrato de Abacaxi","preparo":"Bata no liquidificador, peneire e guarde para uso.","obs":"Custo na planilha do bar: R$ 8,00","itens":[["Abacaxi",1,"un"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Extrato de Gengibre","preparo":"Bata no liquidificador, peneire e guarde para uso.","obs":"Custo na planilha do bar: R$ 9,20","itens":[["Gengibre",0.4,"kg"],["Água filtrada",1,"L"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Extrato de Manga","preparo":"Bata no liquidificador, peneire e guarde para uso.","obs":"Custo na planilha do bar: R$ 4,80","itens":[["Polpa de manga",1,"kg"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Extrato de Maracujá","preparo":"Bata no liquidificador, peneire e guarde para uso.","obs":"Custo na planilha do bar: R$ 23,00","itens":[["Polpa de maracujá",1,"kg"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Extrato de Morango","preparo":"Bata no liquidificador, peneire e guarde para uso.","obs":"Custo na planilha do bar: R$ 18,99","itens":[["Morango congelado",1,"kg"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Xarope de Açúcar (base)","preparo":"Bata o açúcar e a água filtrada no liquidificador e guarde para uso.","obs":"Custo na planilha do bar: R$ 6,62","itens":[["Açúcar",1,"kg"],["Água filtrada",1,"L"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Xarope Siciliano","preparo":"Bata tudo no liquidificador, peneire e guarde para uso.","obs":"Custo na planilha do bar: R$ 10,02","itens":[["Açúcar",1,"kg"],["Água filtrada",1,"L"],["Limão siciliano",0.2,"kg"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Xarope de Hibisco","preparo":"Leve tudo ao fogo, coe e guarde para uso.","obs":"Custo na planilha do bar: R$ 13,62","itens":[["Açúcar",1,"kg"],["Água filtrada",1,"L"],["Hibisco",0.1,"kg"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Xarope de Gengibre","preparo":"Leve tudo ao fogo, coe e guarde para uso.","obs":"Custo na planilha do bar: R$ 11,79","itens":[["Açúcar",1,"kg"],["Água filtrada",0.5,"L"],["Extrato de Gengibre",0.5,"L"],["Limão Taiti",0.15,"kg"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Xarope de Capim-limão e Gengibre","preparo":"Leve tudo ao fogo, coe e guarde para uso.","obs":"Custo na planilha do bar: R$ 9,82","itens":[["Açúcar",1,"kg"],["Água filtrada",1,"L"],["Gengibre",0.06,"kg"],["Limão Taiti",0.15,"kg"],["Capim-limão",0.5,"maço"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Xarope de Maracujá e Especiarias","preparo":"Leve tudo ao fogo, coe e guarde para uso.","obs":"Custo na planilha do bar: R$ 21,78","itens":[["Açúcar",1,"kg"],["Água filtrada",1,"L"],["Polpa de maracujá",0.5,"kg"],["Limão Taiti",0.15,"kg"],["Gengibre",0.08,"kg"],["Manjericão",0.5,"maço"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Xarope de Frutas Vermelhas e Especiarias","preparo":"Leve tudo ao fogo, coe e guarde para uso.","obs":"Custo na planilha do bar: R$ 37,70","itens":[["Açúcar",1,"kg"],["Água filtrada",1,"L"],["Morango congelado",0.5,"kg"],["Amora congelada",0.5,"kg"],["Limão Taiti",0.15,"kg"],["Vinagre de maçã",0.002,"L"],["Cumaru",1,"un"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Xarope de Abacaxi e Especiarias","preparo":"Leve tudo ao fogo, coe e guarde para uso.","obs":"Custo na planilha do bar: R$ 16,79","itens":[["Açúcar",1,"kg"],["Água filtrada",1,"L"],["Abacaxi",1,"un"],["Limão Taiti",0.15,"kg"],["Alecrim",0.5,"maço"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Xarope de Caju e Especiarias","preparo":"Leve tudo ao fogo, coe e guarde para uso.","obs":"Custo na planilha do bar: R$ 18,79","itens":[["Açúcar",1,"kg"],["Água filtrada",1,"L"],["Caju",0.4,"kg"],["Limão Taiti",0.15,"kg"],["Alecrim",0.5,"maço"],["Tomilho",0.5,"maço"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Espuma de Gengibre","preparo":"Bata tudo no liquidificador e guarde para uso.","obs":"Custo na planilha do bar: R$ 5,91","itens":[["Xarope de Gengibre",0.75,"L"],["Super Juice",0.25,"L"],["Emulsificante",0.03,"kg"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Espuma de Caju","preparo":"Bata tudo no liquidificador e guarde para uso.","obs":"Custo na planilha do bar: R$ 8,54","itens":[["Xarope de Caju e Especiarias",0.75,"L"],["Super Juice",0.25,"L"],["Emulsificante",0.03,"kg"]]},
  {"un":"midway","grupo":"Bases do bar","nome":"Espuma de Frutas Vermelhas","preparo":"Bata tudo no liquidificador e guarde para uso.","obs":"Custo na planilha do bar: R$ 15,63","itens":[["Xarope de Frutas Vermelhas e Especiarias",0.75,"L"],["Super Juice",0.25,"L"],["Emulsificante",0.03,"kg"]]}
  ]$j$;
  precos jsonb := $j$[
  ["Ravioli Pecorino Trufado","R$ 5,76 por porção (pacote com 10)"],["Pappardelle","R$ 3,07 por porção (pacote com 4)"],
  ["Gamberoni","R$ 10,33 por porção"],["Almôndegas","R$ 6,50 por porção"],["Cupim","R$ 15,49 por porção (pacote com 12)"],
  ["Molho de Tomate","R$ 57,60 por pacote de 2 kg"],["Ragu de Ossobuco","R$ 123,40 por pacote de 2 kg"],
  ["Molho Bolonhesa Cicchetti","R$ 128,30 por pacote de 2 kg"],["Molho Demi-glace (planilha 2026)","R$ 60,48 por pacote de 2 kg"],
  ["Bisque de Camarão","R$ 27,28 por pacote de 2 kg"],["Pão Natural","R$ 10,50 por unidade (também baguete)"],
  ["Pão Preto","R$ 12,30 por unidade"],["Pão de Castanha","R$ 14,50 por unidade"],
  ["Pão de Hambúrguer","R$ 2,88 por pão (pacote com 6)"],["Croissant","R$ 1,10 por unidade (pacote com 25)"]
  ]$j$;
begin
  for r in select * from jsonb_array_elements(novas) loop
    continue when exists (select 1 from public.fichas where unidade_negocio = r->>'un' and lower(nome) = lower(r->>'nome'));
    insert into public.fichas (nome, unidade_negocio, grupo, tipo, rendimento, rendimento_unidade, preparo, observacoes, origem_nota_id)
    values (r->>'nome', r->>'un', r->>'grupo', 'preparo', (r->>'rend')::numeric, r->>'rend_un', r->>'preparo', r->>'obs',
            case when r->>'nota' = 'prod' then v_prod_nota else v_midway_nota end)
    returning id into v_f;
    v_k := 0;
    for it in select * from jsonb_array_elements(r->'itens') loop
      v_k := v_k + 1;
      insert into public.fichas_itens (ficha_id, ordem, ingrediente, quantidade, unidade)
      values (v_f, v_k, it->>0, (it->>1)::numeric, it->>2);
    end loop;
  end loop;

  -- Linhas de total que viraram ingrediente na cópia de 28/10
  update public.fichas_itens set removido = true where not removido and ingrediente ~* '^\s*custo da receita\s*$';

  -- Sub-preparos e insumos (mesma regra de fichas_importar)
  update public.fichas_itens fi set sub_ficha_id = s.id
  from public.fichas f, public.fichas s
  where f.id = fi.ficha_id and not fi.removido and fi.sub_ficha_id is null and s.id <> f.id and s.ativa
    and s.unidade_negocio in (f.unidade_negocio, 'producao') and lower(s.nome) = lower(fi.ingrediente);
  insert into public.insumos (nome, unidade)
  select distinct on (lower(trim(fi.ingrediente))) trim(fi.ingrediente), public.insumos_unidade_base(fi.unidade)
  from public.fichas_itens fi
  where not fi.removido and fi.sub_ficha_id is null and fi.insumo_id is null
    and not exists (select 1 from public.insumos i where lower(i.nome) = lower(trim(fi.ingrediente)))
  order by lower(trim(fi.ingrediente))
  on conflict do nothing;
  update public.fichas_itens fi set insumo_id = i.id from public.insumos i
  where not fi.removido and i.ativo and fi.insumo_id is null and fi.sub_ficha_id is null and lower(i.nome) = lower(trim(fi.ingrediente));
  insert into public.insumos_apelidos (insumo_id, apelido, origem, confirmado, semelhanca)
  select distinct on (lower(trim(fi.ingrediente))) fi.insumo_id, trim(fi.ingrediente), 'ficha', true, 1
  from public.fichas_itens fi
  where not fi.removido and fi.insumo_id is not null
    and not exists (select 1 from public.insumos_apelidos a where a.insumo_id = fi.insumo_id and lower(a.apelido) = lower(trim(fi.ingrediente)))
  on conflict do nothing;

  -- Preço da produção (aba 24) nas observações
  for it in select * from jsonb_array_elements(precos) loop
    update public.fichas
       set observacoes = concat_ws(E'\n', observacoes, 'Preço da produção (planilha 2026): ' || (it->>1)), atualizado_em = now()
     where ativa and unidade_negocio = 'producao' and lower(nome) = lower(it->>0)
       and coalesce(observacoes, '') not like '%Preço da produção (planilha 2026)%';
  end loop;
end $$;
