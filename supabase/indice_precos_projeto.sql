-- =====================================================================
-- Índice de Preços: gera os capítulos do projeto "Índice de Preços" a partir da
-- base precos_notas / precos_itens (supabase/indice_precos.sql), nos 5 idiomas.
--   select public.precos_publicar('<id do projeto>');
-- Cria os capítulos que faltam e só regrava os que mudaram (a versão anterior
-- fica em versoes, como em toda mudança). A agenda precos-projeto roda todo dia às 6h
-- de Fortaleza; os números vêm sempre da base, nunca digitados à mão.
-- =====================================================================

-- Textos fixos de cada idioma
create or replace function public.precos_txt(p_lang text)
returns jsonb language sql immutable as $$
  select case p_lang
  when 'en' then jsonb_build_object(
    'capa', 'Cover', 'como', 'How to use', 'indice', 'Monthly index', 'altas', 'Rises and falls',
    'comparar', 'Supplier comparison', 'oscilacao', 'Monthly swings', 'fornecedores', 'Suppliers', 'catalogo', 'Catalogue',
    'sobretitulo', 'Purchasing database', 'titulo', 'Price|Index',
    'subtitulo', 'Every item on every purchase invoice, by supplier and date',
    'periodo', 'Period', 'notas', 'Invoices', 'itens', 'Items purchased', 'produtos', 'Products', 'nforn', 'Suppliers',
    'atualizado', 'Updated on', 'lema', 'One price history for every future project',
    'produto', 'Product', 'un', 'Unit', 'compras', 'Purchases', 'menor', 'Lowest', 'medio', 'Average', 'maior', 'Highest',
    'ultimo', 'Last', 'data', 'Date', 'var', 'Change', 'ultforn', 'Last supplier', 'unid', 'Sites', 'mes', 'Month',
    'gasto', 'Spend', 'primeira', 'First', 'ultima', 'Last', 'fornecedor', 'Supplier', 'total', 'Total',
    'primeiro', 'First', 'barato', 'Cheapest (avg.)', 'caro', 'Most expensive (avg.)', 'dif', 'Gap',
    'geral', 'Overall', 'varmes', 'Change in month', 'comparados', 'Items compared')
  when 'pl' then jsonb_build_object(
    'capa', 'Okładka', 'como', 'Jak korzystać', 'indice', 'Indeks miesięczny', 'altas', 'Wzrosty i spadki',
    'comparar', 'Porównanie dostawców', 'oscilacao', 'Wahania miesięczne', 'fornecedores', 'Dostawcy', 'catalogo', 'Katalog',
    'sobretitulo', 'Baza zakupów', 'titulo', 'Indeks|Cen',
    'subtitulo', 'Każda pozycja z każdej faktury zakupowej, według dostawcy i daty',
    'periodo', 'Okres', 'notas', 'Faktury', 'itens', 'Kupione pozycje', 'produtos', 'Produkty', 'nforn', 'Dostawcy',
    'atualizado', 'Aktualizacja', 'lema', 'Jedna historia cen dla wszystkich przyszłych projektów',
    'produto', 'Produkt', 'un', 'J.m.', 'compras', 'Zakupy', 'menor', 'Najniższa', 'medio', 'Średnia', 'maior', 'Najwyższa',
    'ultimo', 'Ostatnia', 'data', 'Data', 'var', 'Zmiana', 'ultforn', 'Ostatni dostawca', 'unid', 'Lokale', 'mes', 'Miesiąc',
    'gasto', 'Wydatki', 'primeira', 'Pierwszy', 'ultima', 'Ostatni', 'fornecedor', 'Dostawca', 'total', 'Razem',
    'primeiro', 'Pierwsza', 'barato', 'Najtańszy (śr.)', 'caro', 'Najdroższy (śr.)', 'dif', 'Różnica',
    'geral', 'Ogółem', 'varmes', 'Zmiana w miesiącu', 'comparados', 'Porównane pozycje')
  when 'fr' then jsonb_build_object(
    'capa', 'Couverture', 'como', 'Mode d''emploi', 'indice', 'Indice mensuel', 'altas', 'Hausses et baisses',
    'comparar', 'Comparer les fournisseurs', 'oscilacao', 'Variations mensuelles', 'fornecedores', 'Fournisseurs', 'catalogo', 'Catalogue',
    'sobretitulo', 'Base d''achats', 'titulo', 'Indice|des Prix',
    'subtitulo', 'Chaque article de chaque facture d''achat, par fournisseur et par date',
    'periodo', 'Période', 'notas', 'Factures', 'itens', 'Articles achetés', 'produtos', 'Produits', 'nforn', 'Fournisseurs',
    'atualizado', 'Mis à jour le', 'lema', 'Un seul historique de prix pour tous les projets à venir',
    'produto', 'Produit', 'un', 'Unité', 'compras', 'Achats', 'menor', 'Plus bas', 'medio', 'Moyen', 'maior', 'Plus haut',
    'ultimo', 'Dernier', 'data', 'Date', 'var', 'Variation', 'ultforn', 'Dernier fournisseur', 'unid', 'Sites', 'mes', 'Mois',
    'gasto', 'Dépenses', 'primeira', 'Premier', 'ultima', 'Dernier', 'fornecedor', 'Fournisseur', 'total', 'Total',
    'primeiro', 'Premier', 'barato', 'Moins cher (moy.)', 'caro', 'Plus cher (moy.)', 'dif', 'Écart',
    'geral', 'Global', 'varmes', 'Variation du mois', 'comparados', 'Articles comparés')
  when 'de' then jsonb_build_object(
    'capa', 'Titelseite', 'como', 'Anleitung', 'indice', 'Monatsindex', 'altas', 'Anstiege und Rückgänge',
    'comparar', 'Lieferantenvergleich', 'oscilacao', 'Monatliche Schwankungen', 'fornecedores', 'Lieferanten', 'catalogo', 'Katalog',
    'sobretitulo', 'Einkaufsdatenbank', 'titulo', 'Preis|index',
    'subtitulo', 'Jede Position jeder Einkaufsrechnung, nach Lieferant und Datum',
    'periodo', 'Zeitraum', 'notas', 'Rechnungen', 'itens', 'Gekaufte Positionen', 'produtos', 'Produkte', 'nforn', 'Lieferanten',
    'atualizado', 'Aktualisiert am', 'lema', 'Eine Preishistorie für alle künftigen Projekte',
    'produto', 'Produkt', 'un', 'Einheit', 'compras', 'Käufe', 'menor', 'Niedrigster', 'medio', 'Durchschnitt', 'maior', 'Höchster',
    'ultimo', 'Letzter', 'data', 'Datum', 'var', 'Änderung', 'ultforn', 'Letzter Lieferant', 'unid', 'Standorte', 'mes', 'Monat',
    'gasto', 'Ausgaben', 'primeira', 'Erster', 'ultima', 'Letzter', 'fornecedor', 'Lieferant', 'total', 'Gesamt',
    'primeiro', 'Erster', 'barato', 'Günstigster (Ø)', 'caro', 'Teuerster (Ø)', 'dif', 'Abstand',
    'geral', 'Gesamt', 'varmes', 'Änderung im Monat', 'comparados', 'Verglichene Positionen')
  else jsonb_build_object(
    'capa', 'Capa', 'como', 'Como usar', 'indice', 'Índice mensal', 'altas', 'Altas e quedas',
    'comparar', 'Comparar fornecedores', 'oscilacao', 'Oscilação mensal', 'fornecedores', 'Fornecedores', 'catalogo', 'Catálogo',
    'sobretitulo', 'Base de compras', 'titulo', 'Índice|de Preços',
    'subtitulo', 'Todos os itens de todas as notas de compra, por fornecedor e data',
    'periodo', 'Período', 'notas', 'Notas', 'itens', 'Itens comprados', 'produtos', 'Produtos', 'nforn', 'Fornecedores',
    'atualizado', 'Atualizado em', 'lema', 'Um só histórico de preços para todos os projetos futuros',
    'produto', 'Produto', 'un', 'Un.', 'compras', 'Compras', 'menor', 'Menor', 'medio', 'Médio', 'maior', 'Maior',
    'ultimo', 'Último', 'data', 'Data', 'var', 'Variação', 'ultforn', 'Último fornecedor', 'unid', 'Unidades', 'mes', 'Mês',
    'gasto', 'Gasto', 'primeira', 'Primeira', 'ultima', 'Última', 'fornecedor', 'Fornecedor', 'total', 'Total',
    'primeiro', 'Primeiro', 'barato', 'Mais barato (média)', 'caro', 'Mais caro (média)', 'dif', 'Diferença',
    'geral', 'Geral', 'varmes', 'Variação no mês', 'comparados', 'Itens comparados')
  end
$$;

-- Números, dinheiro, porcentagem e datas no formato de cada idioma
create or replace function public.precos_num(v numeric, p_lang text, p_casas int default 2)
returns text language sql immutable as $$
  select case when v is null then '–' else
    case p_lang
      when 'en' then s
      when 'fr' then translate(s, ',.', ' ,')
      when 'pl' then translate(s, ',.', ' ,')
      else translate(s, ',.', '.,')
    end end
  from (select to_char(round(v, p_casas), case when p_casas = 0 then 'FM999,999,999,990' else 'FM999,999,999,990.' || repeat('0', p_casas) end) s) x
$$;
create or replace function public.precos_rs(v numeric, p_lang text)
returns text language sql immutable as $$ select case when v is null then '–' else 'R$ ' || public.precos_num(v, p_lang, 2) end $$;
create or replace function public.precos_pct(v numeric, p_lang text)
returns text language sql immutable as $$
  select case when v is null then '–' when round(v, 1) > 0 then '+' || public.precos_num(v, p_lang, 1) || '%'
              else public.precos_num(v, p_lang, 1) || '%' end
$$;
create or replace function public.precos_dt(d date, p_lang text)
returns text language sql immutable as $$
  select case when d is null then '–' when p_lang = 'de' then to_char(d, 'DD.MM.YYYY') else to_char(d, 'DD/MM/YYYY') end
$$;
create or replace function public.precos_mes(d date, p_lang text)
returns text language sql immutable as $$
  select case when p_lang = 'de' then to_char(d, 'MM.YYYY') else to_char(d, 'MM/YYYY') end
$$;
create or replace function public.precos_cel(t text)
returns text language sql immutable as $$ select replace(replace(coalesce(t, ''), '|', '/'), E'\n', ' ') $$;
create or replace function public.precos_sigla(u text)
returns text language sql immutable as $$
  select case u when 'midway' then 'MW' when 'pipa_centro' then 'PC' when 'pipa_producao' then 'PP' else u end
$$;
create or replace function public.precos_categoria(c text, p_lang text)
returns text language sql immutable as $$
  select coalesce(case p_lang
    when 'en' then case c when 'Comida' then 'Food' when 'Bebida' then 'Drinks' when 'Conferir' then 'To review'
      when 'Limpeza' then 'Cleaning' when 'Embalagem' then 'Packaging' when 'Embalagens' then 'Packaging'
      when 'Comida de funcionários' then 'Staff meals' when 'Devolução' then 'Returns' when 'Sem categoria' then 'Uncategorised' 
      when 'Descartáveis' then 'Disposables' when 'Fora do CMV' then 'Outside COGS' when 'Servico' then 'Services' when 'Escritório' then 'Office' when 'Outros' then 'Other' when 'Manutenção' then 'Maintenance' when 'Bonificação' then 'Free goods' when 'Upgrade' then 'Upgrades' end
    when 'pl' then case c when 'Comida' then 'Jedzenie' when 'Bebida' then 'Napoje' when 'Conferir' then 'Do sprawdzenia'
      when 'Limpeza' then 'Środki czystości' when 'Embalagem' then 'Opakowania' when 'Embalagens' then 'Opakowania'
      when 'Comida de funcionários' then 'Posiłki pracownicze' when 'Devolução' then 'Zwroty' when 'Sem categoria' then 'Bez kategorii' 
      when 'Descartáveis' then 'Jednorazowe' when 'Fora do CMV' then 'Poza kosztem towarów' when 'Servico' then 'Usługi' when 'Escritório' then 'Biuro' when 'Outros' then 'Inne' when 'Manutenção' then 'Konserwacja' when 'Bonificação' then 'Gratisy' when 'Upgrade' then 'Ulepszenia' end
    when 'fr' then case c when 'Comida' then 'Nourriture' when 'Bebida' then 'Boissons' when 'Conferir' then 'À vérifier'
      when 'Limpeza' then 'Nettoyage' when 'Embalagem' then 'Emballages' when 'Embalagens' then 'Emballages'
      when 'Comida de funcionários' then 'Repas du personnel' when 'Devolução' then 'Retours' when 'Sem categoria' then 'Sans catégorie' 
      when 'Descartáveis' then 'Jetables' when 'Fora do CMV' then 'Hors coût des marchandises' when 'Servico' then 'Services' when 'Escritório' then 'Bureau' when 'Outros' then 'Autres' when 'Manutenção' then 'Maintenance' when 'Bonificação' then 'Gratuités' when 'Upgrade' then 'Améliorations' end
    when 'de' then case c when 'Comida' then 'Lebensmittel' when 'Bebida' then 'Getränke' when 'Conferir' then 'Zu prüfen'
      when 'Limpeza' then 'Reinigung' when 'Embalagem' then 'Verpackung' when 'Embalagens' then 'Verpackung'
      when 'Comida de funcionários' then 'Personalessen' when 'Devolução' then 'Rücksendungen' when 'Sem categoria' then 'Ohne Kategorie' 
      when 'Descartáveis' then 'Einwegartikel' when 'Fora do CMV' then 'Außerhalb Wareneinsatz' when 'Servico' then 'Dienstleistungen' when 'Escritório' then 'Büro' when 'Outros' then 'Sonstiges' when 'Manutenção' then 'Wartung' when 'Bonificação' then 'Naturalrabatt' when 'Upgrade' then 'Upgrades' end
    end, c)
$$;

-- Resumo por produto (descrição padronizada + unidade de compra), base de várias tabelas
create or replace view public.precos_produtos with (security_invoker = true) as
select produto, coalesce(unidade_compra, '') unidade_compra,
  coalesce((array_agg(categoria order by data_emissao desc) filter (where categoria is not null))[1], 'Sem categoria') categoria,
  count(*) compras, count(distinct data_emissao) dias, sum(quantidade) quantidade, sum(valor_total) gasto,
  min(preco_efetivo) menor, max(preco_efetivo) maior,
  sum(preco_efetivo * quantidade) / nullif(sum(quantidade), 0) medio,
  (array_agg(preco_efetivo order by data_emissao, nota_id))[1] primeiro_preco, min(data_emissao) primeira_compra,
  (array_agg(preco_efetivo order by data_emissao desc, nota_id))[1] ultimo_preco, max(data_emissao) ultima_compra,
  (array_agg(fornecedor order by data_emissao desc, nota_id))[1] ultimo_fornecedor,
  count(distinct fornecedor) fornecedores,
  string_agg(distinct public.precos_sigla(unidade), ' ') unidades
from public.precos_historico
where preco_efetivo is not null and quantidade > 0
group by produto, coalesce(unidade_compra, '');
revoke all on public.precos_produtos from anon;
grant select on public.precos_produtos to authenticated;

-- Capítulos de um idioma: (numero, titulo, conteudo)
create or replace function public.precos_capitulos(p_lang text)
returns table (numero int, titulo text, conteudo text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  t jsonb := public.precos_txt(p_lang);
  v_de date; v_ate date; v_notas int; v_itens int; v_prod int; v_forn int; v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_meses date[]; s text; c record; n int;
  L text := p_lang;
begin
  select min(data_emissao), max(data_emissao), count(*) into v_de, v_ate, v_notas from precos_notas where itens_coletados_em is not null;
  select count(*) into v_itens from precos_itens;
  select count(*) into v_prod from precos_produtos;
  select count(distinct fornecedor) into v_forn from precos_notas where itens_coletados_em is not null;
  select array_agg(m order by m) into v_meses from (select distinct date_trunc('month', data_emissao)::date m from precos_historico) x;

  -- 00 · Capa
  numero := 0; titulo := '00 · ' || (t->>'capa');
  conteudo := concat_ws(E'\n', ':::capa', 'marca: Brasico', 'sobretitulo: ' || (t->>'sobretitulo'), 'titulo: ' || (t->>'titulo'),
    'subtitulo: ' || (t->>'subtitulo'),
    'info: ' || (t->>'periodo') || ' | ' || public.precos_dt(v_de, L) || ' – ' || public.precos_dt(v_ate, L),
    'info: ' || (t->>'notas') || ' | ' || public.precos_num(v_notas, L, 0),
    'info: ' || (t->>'itens') || ' | ' || public.precos_num(v_itens, L, 0),
    'info: ' || (t->>'produtos') || ' | ' || public.precos_num(v_prod, L, 0),
    'info: ' || (t->>'nforn') || ' | ' || public.precos_num(v_forn, L, 0),
    'info: ' || (t->>'atualizado') || ' | ' || public.precos_dt(v_hoje, L),
    'lema: ' || (t->>'lema'), ':::');
  return next;

  -- 01 · Como usar
  select string_agg(format('%s%s | %s | %s', case when u.unidade = 'midway' then '!' else '' end,
      case u.unidade when 'midway' then 'Midway Mall' when 'pipa_centro' then 'Pipa Centro' else 'Produção Pipa' end,
      public.precos_rs(u.gasto, L),
      public.precos_num(u.notas, L, 0) || ' ' || lower(t->>'notas') || ' · ' || public.precos_num(u.forn, L, 0) || ' ' || lower(t->>'nforn')
        || ' · ' || public.precos_dt(u.de, L) || ' – ' || public.precos_dt(u.ate, L)), E'\n' order by u.gasto desc)
    into s
  from (select n.unidade, count(*) notas, count(distinct fornecedor) forn, min(data_emissao) de, max(data_emissao) ate,
          (select sum(i.valor_total) from precos_itens i where i.unidade = n.unidade) gasto
        from precos_notas n where itens_coletados_em is not null group by n.unidade) u;
  numero := 1; titulo := '01 · ' || (t->>'como');
  conteudo := case L
  when 'en' then E'**1 · HOW TO USE**\n# How to use this database\n*Every purchase invoice of the sites, item by item, to know how much we pay, to whom and how it changes.*\n\n:::cards\n' || coalesce(s, '') || E'\n:::\n\n'
    || E'## What is in it\n- **Source** — purchase invoices in Cicchetti Management, copied every minute into the Brasico database (tables precos_notas and precos_itens).\n- **Effective price** — (item total − discount + freight) ÷ quantity, in the purchase unit on the invoice (KG, UN, CX...). Only compare items in the same unit.\n- **Product** — the item description standardised (capitals, no extra spaces). The same product from two suppliers is only matched when the description is identical.\n- **Sites** — MW = Midway Mall, PC = Pipa Centro, PP = Produção Pipa. Each site is a separate database: spend is always shown per site.\n\n## How to query it in future projects\n- **Connector** — ask your Claude: \"look up the price of mozzarella in the Price Index\". The precos_consultar tool returns the summary per product and every purchase.\n- **Database** — view precos_historico (one row per item purchased) and precos_produtos (one row per product).\n\n> Figures are recomputed from the database every day at 6am. Never edit them by hand: fix the invoice in Cicchetti Management and the next update corrects them here.'
  when 'pl' then E'**1 · JAK KORZYSTAĆ**\n# Jak korzystać z tej bazy\n*Każda faktura zakupowa lokali, pozycja po pozycji: ile płacimy, komu i jak to się zmienia.*\n\n:::cards\n' || coalesce(s, '') || E'\n:::\n\n'
    || E'## Co zawiera\n- **Źródło** — faktury zakupowe w Cicchetti Management, kopiowane co minutę do bazy Brasico (tabele precos_notas i precos_itens).\n- **Cena efektywna** — (wartość pozycji − rabat + transport) ÷ ilość, w jednostce zakupu z faktury (KG, UN, CX...). Porównuj tylko pozycje w tej samej jednostce.\n- **Produkt** — opis pozycji ujednolicony (wielkie litery, bez zbędnych spacji). Ten sam produkt od dwóch dostawców łączy się tylko przy identycznym opisie.\n- **Lokale** — MW = Midway Mall, PC = Pipa Centro, PP = Produção Pipa. Każdy lokal to osobna baza: wydatki zawsze pokazujemy osobno.\n\n## Jak korzystać w przyszłych projektach\n- **Konektor** — poproś swojego Claude: „sprawdź cenę mozzarelli w Indeksie Cen”. Narzędzie precos_consultar zwraca podsumowanie produktu i wszystkie zakupy.\n- **Baza** — widok precos_historico (jeden wiersz na kupioną pozycję) i precos_produtos (jeden wiersz na produkt).\n\n> Liczby są przeliczane z bazy codziennie o 6:00. Nie poprawiaj ich ręcznie: popraw fakturę w Cicchetti Management, a następna aktualizacja poprawi je tutaj.'
  when 'fr' then E'**1 · MODE D''EMPLOI**\n# Comment utiliser cette base\n*Chaque facture d''achat des sites, article par article : combien nous payons, à qui et comment cela évolue.*\n\n:::cards\n' || coalesce(s, '') || E'\n:::\n\n'
    || E'## Contenu\n- **Source** — factures d''achat dans Cicchetti Management, copiées chaque minute dans la base Brasico (tables precos_notas et precos_itens).\n- **Prix effectif** — (total de l''article − remise + transport) ÷ quantité, dans l''unité d''achat de la facture (KG, UN, CX...). Ne comparez que des articles dans la même unité.\n- **Produit** — la description de l''article standardisée (majuscules, sans espaces en trop). Un même produit chez deux fournisseurs n''est rapproché que si la description est identique.\n- **Sites** — MW = Midway Mall, PC = Pipa Centro, PP = Produção Pipa. Chaque site est une base distincte : les dépenses sont toujours montrées par site.\n\n## Comment l''interroger dans les futurs projets\n- **Connecteur** — demandez à votre Claude : « cherche le prix de la mozzarella dans l''Indice des Prix ». L''outil precos_consultar renvoie le résumé par produit et tous les achats.\n- **Base** — vue precos_historico (une ligne par article acheté) et precos_produtos (une ligne par produit).\n\n> Les chiffres sont recalculés depuis la base chaque jour à 6 h. Ne les modifiez jamais à la main : corrigez la facture dans Cicchetti Management et la prochaine mise à jour les corrigera ici.'
  when 'de' then E'**1 · ANLEITUNG**\n# So nutzen Sie diese Datenbank\n*Jede Einkaufsrechnung der Standorte, Position für Position: was wir zahlen, an wen und wie es sich ändert.*\n\n:::cards\n' || coalesce(s, '') || E'\n:::\n\n'
    || E'## Inhalt\n- **Quelle** — Einkaufsrechnungen im Cicchetti Management, jede Minute in die Brasico-Datenbank kopiert (Tabellen precos_notas und precos_itens).\n- **Effektiver Preis** — (Positionssumme − Rabatt + Fracht) ÷ Menge, in der Einkaufseinheit der Rechnung (KG, UN, CX...). Nur Positionen in derselben Einheit vergleichen.\n- **Produkt** — die vereinheitlichte Positionsbeschreibung (Großbuchstaben, ohne doppelte Leerzeichen). Dasselbe Produkt von zwei Lieferanten wird nur bei identischer Beschreibung zusammengeführt.\n- **Standorte** — MW = Midway Mall, PC = Pipa Centro, PP = Produção Pipa. Jeder Standort ist eine eigene Datenbank: Ausgaben werden immer pro Standort gezeigt.\n\n## Abfrage in künftigen Projekten\n- **Konnektor** — fragen Sie Ihren Claude: „Suche den Preis für Mozzarella im Preisindex“. Das Werkzeug precos_consultar liefert die Zusammenfassung pro Produkt und alle Käufe.\n- **Datenbank** — Ansicht precos_historico (eine Zeile pro gekaufter Position) und precos_produtos (eine Zeile pro Produkt).\n\n> Die Zahlen werden täglich um 6 Uhr aus der Datenbank neu berechnet. Nie von Hand ändern: Rechnung im Cicchetti Management korrigieren, das nächste Update korrigiert sie hier.'
  else E'**1 · COMO USAR**\n# Como usar esta base\n*Todas as notas de compra das unidades, item por item, para saber quanto pagamos, a quem e como isso muda.*\n\n:::cards\n' || coalesce(s, '') || E'\n:::\n\n'
    || E'## O que tem aqui\n- **Fonte** — notas de compra do Cicchetti Management, copiadas a cada minuto para o banco do Brasico (tabelas precos_notas e precos_itens).\n- **Preço efetivo** — (total do item − desconto + frete) ÷ quantidade, na unidade de compra da nota (KG, UN, CX...). Só compare itens na mesma unidade.\n- **Produto** — a descrição do item padronizada (maiúsculas, sem espaços a mais). O mesmo produto de dois fornecedores só se junta quando a descrição é igual.\n- **Unidades** — MW = Midway Mall, PC = Pipa Centro, PP = Produção Pipa. Cada unidade é uma base separada: o gasto aparece sempre por unidade.\n\n## Como consultar em projetos futuros\n- **Conector** — peça ao seu Claude: "veja o preço da mussarela no Índice de Preços". A ferramenta precos_consultar devolve o resumo por produto e todas as compras.\n- **Banco** — view precos_historico (uma linha por item comprado) e precos_produtos (uma linha por produto).\n\n> Os números são recalculados da base todo dia às 6h. Nunca edite à mão: corrija a nota no Cicchetti Management e a próxima atualização corrige aqui.'
  end;
  return next;

  -- 02 · Índice mensal (encadeado mês a mês, média geométrica ponderada pelo gasto do mês anterior)
  with pm as (
    select g.grupo, date_trunc('month', h.data_emissao)::date mes, h.produto, coalesce(h.unidade_compra, '') un,
      sum(h.valor_total) gasto, sum(h.preco_efetivo * h.quantidade) / sum(h.quantidade) preco
    from precos_historico h cross join lateral (values ('todas'), (h.unidade)) g(grupo)
    where h.preco_efetivo > 0 and h.quantidade > 0 and coalesce(h.categoria, '') <> 'Devolução'
    group by 1, 2, 3, 4
  ), pares as (
    select b.grupo, b.mes, a.gasto w, b.preco / a.preco r
    from pm a join pm b on b.grupo = a.grupo and b.produto = a.produto and b.un = a.un and b.mes = (a.mes + interval '1 month')::date
    where b.preco / a.preco between 0.2 and 5
  ), mi as (
    select grupo, mes, exp(sum(w * ln(r)) / sum(w)) idx, count(*) n from pares group by 1, 2
  ), cad as (
    select m.grupo, m.mes, coalesce(mi.idx, 1) idx, mi.n from (select distinct grupo, mes from pm) m left join mi using (grupo, mes)
  ), cadeia as (
    select grupo, mes, idx, n, 100 * exp(sum(ln(idx)) over (partition by grupo order by mes)) nivel from cad
  )
  select string_agg(format('| %s | %s | %s | %s | %s | %s | %s |', public.precos_mes(g.mes, L),
      public.precos_num(g.nivel, L, 1), case when g.n is null then '–' else public.precos_pct((g.idx - 1) * 100, L) end,
      coalesce(public.precos_num(mw.nivel, L, 1), '–'), coalesce(public.precos_num(pc.nivel, L, 1), '–'),
      coalesce(public.precos_num(pp.nivel, L, 1), '–'), coalesce(public.precos_num(g.n, L, 0), '–')), E'\n' order by g.mes)
    into s
  from cadeia g
    left join cadeia mw on mw.grupo = 'midway' and mw.mes = g.mes
    left join cadeia pc on pc.grupo = 'pipa_centro' and pc.mes = g.mes
    left join cadeia pp on pp.grupo = 'pipa_producao' and pp.mes = g.mes
  where g.grupo = 'todas';
  numero := 2; titulo := '02 · ' || (t->>'indice');
  conteudo := case L
    when 'en' then E'**2 · INDEX**\n# Monthly price index\n*How much the same basket of items costs from one month to the next. First month of each column = 100.*\n'
    when 'pl' then E'**2 · INDEKS**\n# Miesięczny indeks cen\n*Ile kosztuje ten sam koszyk pozycji z miesiąca na miesiąc. Pierwszy miesiąc każdej kolumny = 100.*\n'
    when 'fr' then E'**2 · INDICE**\n# Indice mensuel des prix\n*Combien coûte le même panier d''articles d''un mois à l''autre. Premier mois de chaque colonne = 100.*\n'
    when 'de' then E'**2 · INDEX**\n# Monatlicher Preisindex\n*Was derselbe Warenkorb von Monat zu Monat kostet. Erster Monat jeder Spalte = 100.*\n'
    else E'**2 · ÍNDICE**\n# Índice mensal de preços\n*Quanto custa a mesma cesta de itens de um mês para o outro. Primeiro mês de cada coluna = 100.*\n' end
    || E'\n' || format('| %s | %s | %s | Midway (MW) | Pipa Centro (PC) | Produção Pipa (PP) | %s |', t->>'mes', t->>'geral', t->>'varmes', t->>'comparados')
    || E'\n|---|---:|---:|---:|---:|---:|---:|\n' || coalesce(s, '');

  -- Gasto por mês e unidade
  select string_agg(format('| %s | %s | %s | %s | %s | %s |', public.precos_mes(mes, L), public.precos_rs(mw, L), public.precos_rs(pc, L),
      public.precos_rs(pp, L), public.precos_rs(coalesce(mw, 0) + coalesce(pc, 0) + coalesce(pp, 0), L), public.precos_num(notas, L, 0)),
      E'\n' order by mes)
    into s
  from (select date_trunc('month', n.data_emissao)::date mes,
          sum(i.valor_total) filter (where i.unidade = 'midway') mw, sum(i.valor_total) filter (where i.unidade = 'pipa_centro') pc,
          sum(i.valor_total) filter (where i.unidade = 'pipa_producao') pp, count(distinct n.id) notas
        from precos_itens i join precos_notas n on n.id = i.nota_id group by 1) x;
  conteudo := conteudo || E'\n\n## ' || case L when 'en' then 'Spend per month and site' when 'pl' then 'Wydatki według miesiąca i lokalu'
      when 'fr' then 'Dépenses par mois et par site' when 'de' then 'Ausgaben nach Monat und Standort' else 'Gasto por mês e unidade' end
    || E'\n' || format('| %s | Midway | Pipa Centro | Produção Pipa | %s | %s |', t->>'mes', t->>'total', t->>'notas')
    || E'\n|---|---:|---:|---:|---:|---:|\n' || coalesce(s, '') || E'\n\n> ' || case L
    when 'en' then 'Each month compares only items bought in that month and in the previous one, in the same unit, weighted by the previous month''s spend (chained index). Changes above 5× or below 1/5 are left out as likely typing or unit errors. Returns are excluded.'
    when 'pl' then 'Każdy miesiąc porównuje tylko pozycje kupione w nim i w poprzednim miesiącu, w tej samej jednostce, ważone wydatkami z poprzedniego miesiąca (indeks łańcuchowy). Zmiany powyżej 5× lub poniżej 1/5 są pomijane jako prawdopodobne błędy. Zwroty są wyłączone.'
    when 'fr' then 'Chaque mois ne compare que les articles achetés ce mois-là et le mois précédent, dans la même unité, pondérés par les dépenses du mois précédent (indice chaîné). Les variations au-delà de 5× ou en deçà de 1/5 sont écartées comme erreurs probables. Les retours sont exclus.'
    when 'de' then 'Jeder Monat vergleicht nur Positionen, die in diesem und im Vormonat in derselben Einheit gekauft wurden, gewichtet mit den Ausgaben des Vormonats (Kettenindex). Änderungen über 5× oder unter 1/5 gelten als wahrscheinliche Fehler und bleiben außen vor. Rücksendungen sind ausgeschlossen.'
    else 'Cada mês compara só os itens comprados nele e no mês anterior, na mesma unidade de compra, com peso pelo gasto do mês anterior (índice encadeado). Variações acima de 5× ou abaixo de 1/5 ficam de fora por serem provável erro de digitação ou de unidade. Devoluções não entram.' end;
  return next;

  -- 03 · Altas e quedas (primeira × última compra; produtos com 3+ compras em datas diferentes)
  numero := 3; titulo := '03 · ' || (t->>'altas');
  conteudo := case L
    when 'en' then E'**3 · RISES AND FALLS**\n# Biggest price changes\n*First purchase versus last purchase of each product bought on at least 3 different days.*\n'
    when 'pl' then E'**3 · WZROSTY I SPADKI**\n# Największe zmiany cen\n*Pierwszy zakup w porównaniu z ostatnim, dla produktów kupionych w co najmniej 3 różne dni.*\n'
    when 'fr' then E'**3 · HAUSSES ET BAISSES**\n# Plus fortes variations de prix\n*Premier achat comparé au dernier, pour chaque produit acheté au moins 3 jours différents.*\n'
    when 'de' then E'**3 · ANSTIEGE UND RÜCKGÄNGE**\n# Größte Preisänderungen\n*Erster gegen letzten Kauf jedes Produkts, das an mindestens 3 verschiedenen Tagen gekauft wurde.*\n'
    else E'**3 · ALTAS E QUEDAS**\n# Maiores variações de preço\n*Primeira compra contra a última de cada produto comprado em pelo menos 3 dias diferentes.*\n' end;
  for c in select * from (values (1, 'desc'), (2, 'asc')) v(k, ordem) loop
    execute format($q$
      select string_agg(format('| %%s | %%s | %%s | %%s | %%s | %%s | %%s | %%s |', public.precos_cel(produto), unidade_compra,
          public.precos_rs(primeiro_preco, $1) || ' (' || public.precos_dt(primeira_compra, $1) || ')',
          public.precos_rs(ultimo_preco, $1) || ' (' || public.precos_dt(ultima_compra, $1) || ')',
          '**' || public.precos_pct((ultimo_preco / primeiro_preco - 1) * 100, $1) || '**',
          public.precos_num(compras, $1, 0), public.precos_cel(left(ultimo_fornecedor, 32)), unidades), E'\n' order by ultimo_preco / primeiro_preco %s)
      from (select * from public.precos_produtos where dias >= 3 and primeiro_preco > 0 and categoria <> 'Devolução'
              and ultimo_preco / primeiro_preco between 0.2 and 5 and ultimo_preco / primeiro_preco %s 1
            order by ultimo_preco / primeiro_preco %s limit 30) x $q$,
      c.ordem, case c.k when 1 then '>' else '<' end, c.ordem) into s using L;
    conteudo := conteudo || E'\n## ' || case c.k when 1 then case L when 'en' then 'Biggest rises' when 'pl' then 'Największe wzrosty'
        when 'fr' then 'Plus fortes hausses' when 'de' then 'Größte Anstiege' else 'Maiores altas' end
      else case L when 'en' then 'Biggest falls' when 'pl' then 'Największe spadki' when 'fr' then 'Plus fortes baisses'
        when 'de' then 'Größte Rückgänge' else 'Maiores quedas' end end
      || E'\n' || format('| %s | %s | %s | %s | %s | %s | %s | %s |', t->>'produto', t->>'un', t->>'primeiro', t->>'ultimo', t->>'var',
           t->>'compras', t->>'ultforn', t->>'unid')
      || E'\n|---|---|---:|---:|---:|---:|---|---|\n' || coalesce(s, '–') || E'\n';
  end loop;
  return next;

  -- 04 · Comparar fornecedores (mesmo produto e unidade, 2+ fornecedores)
  with pf as (
    select produto, coalesce(unidade_compra, '') un, fornecedor, count(*) compras, sum(valor_total) gasto,
      sum(preco_efetivo * quantidade) / sum(quantidade) medio
    from precos_historico where preco_efetivo > 0 and quantidade > 0 and coalesce(categoria, '') <> 'Devolução'
    group by 1, 2, 3
  ), r as (
    select produto, un, count(*) nf, sum(compras) compras, sum(gasto) gasto,
      (array_agg(fornecedor order by medio))[1] f_bar, min(medio) p_bar,
      (array_agg(fornecedor order by medio desc))[1] f_car, max(medio) p_car
    from pf group by 1, 2 having count(*) >= 2
  )
  select string_agg(format('| %s | %s | %s | %s | %s | %s | %s |', public.precos_cel(produto), un,
      public.precos_cel(left(f_bar, 30)) || ' — ' || public.precos_rs(p_bar, L),
      public.precos_cel(left(f_car, 30)) || ' — ' || public.precos_rs(p_car, L),
      '**' || public.precos_pct((p_car / nullif(p_bar, 0) - 1) * 100, L) || '**', public.precos_num(nf, L, 0), public.precos_num(compras, L, 0)),
      E'\n' order by gasto desc)
    into s
  from (select * from r where p_car / nullif(p_bar, 0) <= 5 order by gasto desc limit 120) x;
  numero := 4; titulo := '04 · ' || (t->>'comparar');
  conteudo := case L
    when 'en' then E'**4 · SUPPLIERS**\n# Same item, different suppliers\n*Products bought from 2 or more suppliers, with the cheapest and the most expensive average price.*\n'
    when 'pl' then E'**4 · DOSTAWCY**\n# Ta sama pozycja, różni dostawcy\n*Produkty kupowane od 2 lub więcej dostawców, z najtańszą i najdroższą ceną średnią.*\n'
    when 'fr' then E'**4 · FOURNISSEURS**\n# Même article, fournisseurs différents\n*Produits achetés chez 2 fournisseurs ou plus, avec le prix moyen le plus bas et le plus élevé.*\n'
    when 'de' then E'**4 · LIEFERANTEN**\n# Gleiche Position, verschiedene Lieferanten\n*Produkte, die bei 2 oder mehr Lieferanten gekauft wurden, mit dem günstigsten und dem teuersten Durchschnittspreis.*\n'
    else E'**4 · FORNECEDORES**\n# Mesmo item, fornecedores diferentes\n*Produtos comprados de 2 ou mais fornecedores, com o preço médio mais barato e o mais caro.*\n' end
    || E'\n' || format('| %s | %s | %s | %s | %s | %s | %s |', t->>'produto', t->>'un', t->>'barato', t->>'caro', t->>'dif', t->>'nforn', t->>'compras')
    || E'\n|---|---|---|---|---:|---:|---:|\n' || coalesce(s, '–') || E'\n\n> ' || case L
    when 'en' then 'Only identical descriptions are matched. The same product written differently by each supplier does not show up here: look it up with precos_consultar.'
    when 'pl' then 'Łączone są tylko identyczne opisy. Ten sam produkt opisany inaczej przez każdego dostawcę się tu nie pojawi: wyszukaj go przez precos_consultar.'
    when 'fr' then 'Seules les descriptions identiques sont rapprochées. Un même produit décrit différemment par chaque fournisseur n''apparaît pas ici : cherchez-le avec precos_consultar.'
    when 'de' then 'Nur identische Beschreibungen werden zusammengeführt. Dasselbe Produkt, das jeder Lieferant anders schreibt, erscheint hier nicht: mit precos_consultar suchen.'
    else 'Só juntamos descrições iguais. O mesmo produto escrito de jeito diferente por cada fornecedor não aparece aqui: procure com precos_consultar.' end;
  return next;

  -- 05 · Oscilação mensal (40 produtos de maior gasto, preço médio de cada mês)
  with top as (select produto, unidade_compra, gasto, primeiro_preco, ultimo_preco from precos_produtos
               where categoria <> 'Devolução' order by gasto desc limit 40),
  pm as (select h.produto, coalesce(h.unidade_compra, '') un, date_trunc('month', h.data_emissao)::date mes,
           sum(h.preco_efetivo * h.quantidade) / sum(h.quantidade) preco
         from precos_historico h join top on top.produto = h.produto and top.unidade_compra = coalesce(h.unidade_compra, '')
         where h.preco_efetivo > 0 and h.quantidade > 0 group by 1, 2, 3)
  select string_agg('| ' || public.precos_cel(top.produto) || ' | ' || top.unidade_compra || ' | '
      || (select string_agg(coalesce(public.precos_num(pm.preco, L, 2), '–'), ' | ' order by m)
          from unnest(v_meses) m left join pm on pm.produto = top.produto and pm.un = top.unidade_compra and pm.mes = m)
      || ' | **' || coalesce((select public.precos_pct(((array_agg(pm.preco order by pm.mes desc))[1]
           / nullif((array_agg(pm.preco order by pm.mes))[1], 0) - 1) * 100, L)
         from pm where pm.produto = top.produto and pm.un = top.unidade_compra), '–') || '** |', E'\n' order by top.gasto desc)
    into s
  from top;
  numero := 5; titulo := '05 · ' || (t->>'oscilacao');
  conteudo := case L
    when 'en' then E'**5 · SWINGS**\n# Monthly price swings\n*Average price paid each month (R$) for the 40 products with the highest spend.*\n'
    when 'pl' then E'**5 · WAHANIA**\n# Miesięczne wahania cen\n*Średnia cena płacona w każdym miesiącu (R$) za 40 produktów o największych wydatkach.*\n'
    when 'fr' then E'**5 · VARIATIONS**\n# Variations mensuelles des prix\n*Prix moyen payé chaque mois (R$) pour les 40 produits aux plus fortes dépenses.*\n'
    when 'de' then E'**5 · SCHWANKUNGEN**\n# Monatliche Preisschwankungen\n*Durchschnittlich gezahlter Preis pro Monat (R$) für die 40 Produkte mit den höchsten Ausgaben.*\n'
    else E'**5 · OSCILAÇÃO**\n# Oscilação mensal de preços\n*Preço médio pago em cada mês (R$) pelos 40 produtos de maior gasto.*\n' end
    || E'\n| ' || (t->>'produto') || ' | ' || (t->>'un') || ' | '
    || (select string_agg(public.precos_mes(m, L), ' | ' order by m) from unnest(v_meses) m) || ' | ' || (t->>'var') || E' |\n|---|---|'
    || (select string_agg('---:|', '' order by m) from unnest(v_meses) m) || E'---:|\n' || coalesce(s, '');
  return next;

  -- 06 · Fornecedores
  select string_agg(format('| %s | %s | %s | %s | %s | %s | %s |', public.precos_cel(fornecedor), unidades, public.precos_num(notas, L, 0),
      public.precos_rs(gasto, L), public.precos_num(produtos, L, 0), public.precos_dt(de, L), public.precos_dt(ate, L)), E'\n' order by gasto desc nulls last)
    into s
  from (select n.fornecedor, string_agg(distinct public.precos_sigla(n.unidade), ' ') unidades, count(distinct n.id) notas,
          sum(i.valor_total) gasto, count(distinct i.produto) produtos, min(n.data_emissao) de, max(n.data_emissao) ate
        from precos_notas n join precos_itens i on i.nota_id = n.id group by n.fornecedor) x;
  numero := 6; titulo := '06 · ' || (t->>'fornecedores');
  conteudo := case L
    when 'en' then E'**6 · SUPPLIERS**\n# All suppliers\n*Every supplier with at least one invoice, from the highest to the lowest spend.*\n'
    when 'pl' then E'**6 · DOSTAWCY**\n# Wszyscy dostawcy\n*Każdy dostawca z co najmniej jedną fakturą, od największych do najmniejszych wydatków.*\n'
    when 'fr' then E'**6 · FOURNISSEURS**\n# Tous les fournisseurs\n*Chaque fournisseur avec au moins une facture, de la plus forte à la plus faible dépense.*\n'
    when 'de' then E'**6 · LIEFERANTEN**\n# Alle Lieferanten\n*Jeder Lieferant mit mindestens einer Rechnung, von den höchsten zu den niedrigsten Ausgaben.*\n'
    else E'**6 · FORNECEDORES**\n# Todos os fornecedores\n*Cada fornecedor com pelo menos uma nota, do maior para o menor gasto.*\n' end
    || E'\n' || format('| %s | %s | %s | %s | %s | %s | %s |', t->>'fornecedor', t->>'unid', t->>'notas', t->>'gasto', t->>'produtos', t->>'primeira', t->>'ultima')
    || E'\n|---|---|---:|---:|---:|---|---|\n' || coalesce(s, '');
  return next;

  -- 07+ · Catálogo por categoria (todos os produtos)
  n := 7;
  for c in select categoria, sum(gasto) g, count(*) q from precos_produtos group by categoria order by sum(gasto) desc loop
    select string_agg(format('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |', public.precos_cel(produto), unidade_compra,
        public.precos_num(compras, L, 0), public.precos_rs(menor, L), public.precos_rs(medio, L), public.precos_rs(maior, L),
        public.precos_rs(ultimo_preco, L), public.precos_dt(ultima_compra, L),
        case when compras > 1 then public.precos_pct((ultimo_preco / nullif(primeiro_preco, 0) - 1) * 100, L) else '–' end,
        public.precos_cel(left(ultimo_fornecedor, 30)), unidades), E'\n' order by produto, unidade_compra)
      into s
    from precos_produtos where categoria = c.categoria;
    numero := n; titulo := lpad(n::text, 2, '0') || ' · ' || (t->>'catalogo') || ' · ' || public.precos_categoria(c.categoria, L);
    conteudo := '**' || n || ' · ' || upper(t->>'catalogo') || E'**\n# ' || public.precos_categoria(c.categoria, L) || E'\n*'
      || public.precos_num(c.q, L, 0) || ' ' || lower(t->>'produtos') || ' · ' || public.precos_rs(c.g, L) || ' · ' || case L
        when 'en' then 'alphabetical order' when 'pl' then 'kolejność alfabetyczna' when 'fr' then 'ordre alphabétique'
        when 'de' then 'alphabetische Reihenfolge' else 'em ordem alfabética' end || E'*\n\n'
      || format('| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |', t->>'produto', t->>'un', t->>'compras', t->>'menor', t->>'medio',
           t->>'maior', t->>'ultimo', t->>'data', t->>'var', t->>'ultforn', t->>'unid')
      || E'\n|---|---|---:|---:|---:|---:|---:|---|---:|---|---|\n' || coalesce(s, '');
    return next;
    n := n + 1;
  end loop;
end $$;
revoke execute on function public.precos_capitulos(text) from public, anon, authenticated;

-- Grava os capítulos no projeto (só o que mudou). Devolve quantos foram criados e atualizados.
create or replace function public.precos_publicar(p_ws uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; v_id uuid; v_dono uuid; v_criados int := 0; v_atualizados int := 0;
begin
  select created_by into v_dono from workspaces where id = p_ws and removido_em is null;
  if v_dono is null then raise exception 'Projeto % não encontrado.', p_ws; end if;

  for r in
    select pt.numero, pt.titulo t_pt, pt.conteudo c_pt, en.titulo t_en, en.conteudo c_en, pl.titulo t_pl, pl.conteudo c_pl,
           fr.titulo t_fr, fr.conteudo c_fr, de.titulo t_de, de.conteudo c_de
    from public.precos_capitulos('pt') pt
      join public.precos_capitulos('en') en using (numero) join public.precos_capitulos('pl') pl using (numero)
      join public.precos_capitulos('fr') fr using (numero) join public.precos_capitulos('de') de using (numero)
  loop
    select id into v_id from notes where workspace_id = p_ws and archived_at is null
      and split_part(title, ' · ', 1) = lpad(r.numero::text, 2, '0') limit 1;
    if v_id is null then
      insert into notes (workspace_id, title, content, created_by, title_en, content_en, title_pl, content_pl, title_fr, content_fr, title_de, content_de)
      values (p_ws, r.t_pt, r.c_pt, v_dono, r.t_en, r.c_en, r.t_pl, r.c_pl, r.t_fr, r.c_fr, r.t_de, r.c_de);
      v_criados := v_criados + 1;
    else
      update notes set title = r.t_pt, content = r.c_pt, title_en = r.t_en, content_en = r.c_en, title_pl = r.t_pl, content_pl = r.c_pl,
        title_fr = r.t_fr, content_fr = r.c_fr, title_de = r.t_de, content_de = r.c_de
      where id = v_id and (title, content, title_en, content_en, title_pl, content_pl, title_fr, content_fr, title_de, content_de)
        is distinct from (r.t_pt, r.c_pt, r.t_en, r.c_en, r.t_pl, r.c_pl, r.t_fr, r.c_fr, r.t_de, r.c_de);
      if found then v_atualizados := v_atualizados + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('criados', v_criados, 'atualizados', v_atualizados);
end $$;
revoke execute on function public.precos_publicar(uuid) from public, anon, authenticated;

-- Agenda: atualiza o projeto todo dia às 6h de Fortaleza (9h UTC)
select cron.unschedule('precos-projeto') where exists (select 1 from cron.job where jobname = 'precos-projeto');
select cron.schedule('precos-projeto', '0 9 * * *', $job$ select public.precos_publicar('b65dc4e3-d23e-4079-ae83-fd9b1cf9bf90') $job$);
