-- =====================================================================
-- Índice de Preços: gera os capítulos do projeto "Índice de Preços" a partir da
-- base precos_notas / precos_itens (supabase/indice_precos.sql), nos 5 idiomas.
--   select public.precos_publicar('<id do projeto>');
-- Cria os capítulos que faltam, só regrava os que mudaram (a versão anterior fica
-- em versoes) e arquiva os que sobrarem. A agenda precos-projeto roda todo dia às
-- 6h de Fortaleza; os números vêm sempre da base, nunca digitados à mão.
-- Visual: capítulos em HTML (blocos :::html) com classes ip-* estilizadas pelo CSS
-- do projeto (definir_estilo); gráficos em SVG gerados aqui.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Textos fixos de cada idioma
-- ---------------------------------------------------------------------
create or replace function public.precos_txt(p_lang text)
returns jsonb language sql immutable as $$
  select case p_lang
  when 'en' then jsonb_build_object(
    'capa', 'Cover', 'indice', 'Monthly index', 'altas', 'Rises and falls', 'oscilacao', 'Monthly swings',
    'comparar', 'Supplier comparison', 'fornecedores', 'Suppliers', 'catalogo', 'Catalogue', 'metodo', 'Method',
    'sobretitulo', 'Purchasing database · Cicchetti', 'titulo', 'Price|Index',
    'subtitulo', 'Every item on every purchase invoice of the sites, by supplier and date.',
    'periodo', 'Period', 'notas', 'Invoices', 'itens', 'Items purchased', 'produtos', 'Products', 'nforn', 'Suppliers',
    'atualizado', 'Updated on', 'lema', 'One price history for every future project',
    'produto', 'Product', 'un', 'Unit', 'compras', 'Purchases', 'menor', 'Lowest', 'medio', 'Average', 'maior', 'Highest',
    'ultimo', 'Last', 'var', 'Change', 'unid', 'Sites', 'mes', 'Month', 'gasto', 'Spend', 'periodo_c', 'Period',
    'fornecedor', 'Supplier', 'total', 'Total', 'primeiro', 'First', 'barato', 'Cheapest', 'caro', 'Most expensive', 'dif', 'Gap',
    'geral', 'Overall', 'varmes', 'Change in month', 'comparados', 'Items compared', 'faixa', 'Range', 'historico', 'History',
    'nivel', 'Index', 'gasto_total', 'Total spend', 'indice_atual', 'Price index', 'desde', 'since', 'no_mes', 'last month'
  ) || jsonb_build_object(
    'h_panorama', 'Purchasing overview', 'lead_panorama', 'What the sites bought, how much they paid and where prices are heading.',
    'h_indice', 'Monthly price index', 'lead_indice', 'How much the same basket of items costs from one month to the next. First month of each line = 100.',
    'h_gasto', 'Spend per month and site', 'g_indice', 'Price index · first month = 100', 'g_gasto', 'Spend per month (R$)',
    'h_altas', 'Biggest price changes', 'lead_altas', 'First versus last purchase of every product bought on at least 3 different days.',
    'sub_altas', 'Biggest rises', 'sub_quedas', 'Biggest falls',
    'h_osc', 'Monthly price swings', 'lead_osc', 'Average price paid each month for the 40 products with the highest spend. Red: above the product''s own average; green: below.',
    'h_comp', 'Same item, different suppliers', 'lead_comp', 'Products bought from 2 or more suppliers, with the cheapest and the most expensive average price.',
    'h_forn', 'All suppliers', 'lead_forn', 'Every supplier with at least one invoice, from the highest to the lowest spend.',
    'lead_cat', 'products · alphabetical order · prices in R$ per purchase unit', 'pos', 'Last price within the range (lowest → highest)',
    'em_rs', 'R$ per unit',
    'nota_indice', 'Each month compares only items bought in that month and the previous one, in the same unit, weighted by the previous month''s spend (chained index). Changes above 5× or below 1/5 are left out as likely typing or unit errors. Returns are excluded.',
    'nota_comp', 'Only identical descriptions are matched. The same product written differently by each supplier does not show up here: look it up with precos_consultar.',
    'mil', 'k', 'mi', 'M')
  when 'pl' then jsonb_build_object(
    'capa', 'Okładka', 'indice', 'Indeks miesięczny', 'altas', 'Wzrosty i spadki', 'oscilacao', 'Wahania miesięczne',
    'comparar', 'Porównanie dostawców', 'fornecedores', 'Dostawcy', 'catalogo', 'Katalog', 'metodo', 'Metoda',
    'sobretitulo', 'Baza zakupów · Cicchetti', 'titulo', 'Indeks|Cen',
    'subtitulo', 'Każda pozycja z każdej faktury zakupowej lokali, według dostawcy i daty.',
    'periodo', 'Okres', 'notas', 'Faktury', 'itens', 'Kupione pozycje', 'produtos', 'Produkty', 'nforn', 'Dostawcy',
    'atualizado', 'Aktualizacja', 'lema', 'Jedna historia cen dla wszystkich przyszłych projektów',
    'produto', 'Produkt', 'un', 'J.m.', 'compras', 'Zakupy', 'menor', 'Najniższa', 'medio', 'Średnia', 'maior', 'Najwyższa',
    'ultimo', 'Ostatnia', 'var', 'Zmiana', 'unid', 'Lokale', 'mes', 'Miesiąc', 'gasto', 'Wydatki', 'periodo_c', 'Okres',
    'fornecedor', 'Dostawca', 'total', 'Razem', 'primeiro', 'Pierwsza', 'barato', 'Najtańszy', 'caro', 'Najdroższy', 'dif', 'Różnica',
    'geral', 'Ogółem', 'varmes', 'Zmiana w miesiącu', 'comparados', 'Porównane pozycje', 'faixa', 'Zakres', 'historico', 'Historia',
    'nivel', 'Indeks', 'gasto_total', 'Wydatki łącznie', 'indice_atual', 'Indeks cen', 'desde', 'od', 'no_mes', 'ostatni miesiąc'
  ) || jsonb_build_object(
    'h_panorama', 'Przegląd zakupów', 'lead_panorama', 'Co kupiły lokale, ile zapłaciły i dokąd zmierzają ceny.',
    'h_indice', 'Miesięczny indeks cen', 'lead_indice', 'Ile kosztuje ten sam koszyk pozycji z miesiąca na miesiąc. Pierwszy miesiąc każdej linii = 100.',
    'h_gasto', 'Wydatki według miesiąca i lokalu', 'g_indice', 'Indeks cen · pierwszy miesiąc = 100', 'g_gasto', 'Wydatki miesięczne (R$)',
    'h_altas', 'Największe zmiany cen', 'lead_altas', 'Pierwszy zakup w porównaniu z ostatnim, dla produktów kupionych w co najmniej 3 różne dni.',
    'sub_altas', 'Największe wzrosty', 'sub_quedas', 'Największe spadki',
    'h_osc', 'Miesięczne wahania cen', 'lead_osc', 'Średnia cena płacona w każdym miesiącu za 40 produktów o największych wydatkach. Czerwony: powyżej średniej produktu; zielony: poniżej.',
    'h_comp', 'Ta sama pozycja, różni dostawcy', 'lead_comp', 'Produkty kupowane od 2 lub więcej dostawców, z najtańszą i najdroższą ceną średnią.',
    'h_forn', 'Wszyscy dostawcy', 'lead_forn', 'Każdy dostawca z co najmniej jedną fakturą, od największych do najmniejszych wydatków.',
    'lead_cat', 'produktów · kolejność alfabetyczna · ceny w R$ za jednostkę zakupu', 'pos', 'Ostatnia cena w zakresie (najniższa → najwyższa)',
    'em_rs', 'R$ za jednostkę',
    'nota_indice', 'Każdy miesiąc porównuje tylko pozycje kupione w nim i w poprzednim miesiącu, w tej samej jednostce, ważone wydatkami z poprzedniego miesiąca (indeks łańcuchowy). Zmiany powyżej 5× lub poniżej 1/5 są pomijane jako prawdopodobne błędy. Zwroty są wyłączone.',
    'nota_comp', 'Łączone są tylko identyczne opisy. Ten sam produkt opisany inaczej przez każdego dostawcę się tu nie pojawi: wyszukaj go przez precos_consultar.',
    'mil', 'tys.', 'mi', 'mln')
  when 'fr' then jsonb_build_object(
    'capa', 'Couverture', 'indice', 'Indice mensuel', 'altas', 'Hausses et baisses', 'oscilacao', 'Variations mensuelles',
    'comparar', 'Comparer les fournisseurs', 'fornecedores', 'Fournisseurs', 'catalogo', 'Catalogue', 'metodo', 'Méthode',
    'sobretitulo', 'Base d''achats · Cicchetti', 'titulo', 'Indice|des Prix',
    'subtitulo', 'Chaque article de chaque facture d''achat des sites, par fournisseur et par date.',
    'periodo', 'Période', 'notas', 'Factures', 'itens', 'Articles achetés', 'produtos', 'Produits', 'nforn', 'Fournisseurs',
    'atualizado', 'Mis à jour le', 'lema', 'Un seul historique de prix pour tous les projets à venir',
    'produto', 'Produit', 'un', 'Unité', 'compras', 'Achats', 'menor', 'Plus bas', 'medio', 'Moyen', 'maior', 'Plus haut',
    'ultimo', 'Dernier', 'var', 'Variation', 'unid', 'Sites', 'mes', 'Mois', 'gasto', 'Dépenses', 'periodo_c', 'Période',
    'fornecedor', 'Fournisseur', 'total', 'Total', 'primeiro', 'Premier', 'barato', 'Moins cher', 'caro', 'Plus cher', 'dif', 'Écart',
    'geral', 'Global', 'varmes', 'Variation du mois', 'comparados', 'Articles comparés', 'faixa', 'Fourchette', 'historico', 'Historique',
    'nivel', 'Indice', 'gasto_total', 'Dépenses totales', 'indice_atual', 'Indice des prix', 'desde', 'depuis', 'no_mes', 'dernier mois'
  ) || jsonb_build_object(
    'h_panorama', 'Vue d''ensemble des achats', 'lead_panorama', 'Ce que les sites ont acheté, combien ils ont payé et où vont les prix.',
    'h_indice', 'Indice mensuel des prix', 'lead_indice', 'Combien coûte le même panier d''articles d''un mois à l''autre. Premier mois de chaque courbe = 100.',
    'h_gasto', 'Dépenses par mois et par site', 'g_indice', 'Indice des prix · premier mois = 100', 'g_gasto', 'Dépenses par mois (R$)',
    'h_altas', 'Plus fortes variations de prix', 'lead_altas', 'Premier achat comparé au dernier, pour chaque produit acheté au moins 3 jours différents.',
    'sub_altas', 'Plus fortes hausses', 'sub_quedas', 'Plus fortes baisses',
    'h_osc', 'Variations mensuelles des prix', 'lead_osc', 'Prix moyen payé chaque mois pour les 40 produits aux plus fortes dépenses. Rouge : au-dessus de la moyenne du produit ; vert : en dessous.',
    'h_comp', 'Même article, fournisseurs différents', 'lead_comp', 'Produits achetés chez 2 fournisseurs ou plus, avec le prix moyen le plus bas et le plus élevé.',
    'h_forn', 'Tous les fournisseurs', 'lead_forn', 'Chaque fournisseur avec au moins une facture, de la plus forte à la plus faible dépense.',
    'lead_cat', 'produits · ordre alphabétique · prix en R$ par unité d''achat', 'pos', 'Dernier prix dans la fourchette (plus bas → plus haut)',
    'em_rs', 'R$ par unité',
    'nota_indice', 'Chaque mois ne compare que les articles achetés ce mois-là et le mois précédent, dans la même unité, pondérés par les dépenses du mois précédent (indice chaîné). Les variations au-delà de 5× ou en deçà de 1/5 sont écartées comme erreurs probables. Les retours sont exclus.',
    'nota_comp', 'Seules les descriptions identiques sont rapprochées. Un même produit décrit différemment par chaque fournisseur n''apparaît pas ici : cherchez-le avec precos_consultar.',
    'mil', 'k', 'mi', 'M')
  when 'de' then jsonb_build_object(
    'capa', 'Titelseite', 'indice', 'Monatsindex', 'altas', 'Anstiege und Rückgänge', 'oscilacao', 'Monatliche Schwankungen',
    'comparar', 'Lieferantenvergleich', 'fornecedores', 'Lieferanten', 'catalogo', 'Katalog', 'metodo', 'Methode',
    'sobretitulo', 'Einkaufsdatenbank · Cicchetti', 'titulo', 'Preis|index',
    'subtitulo', 'Jede Position jeder Einkaufsrechnung der Standorte, nach Lieferant und Datum.',
    'periodo', 'Zeitraum', 'notas', 'Rechnungen', 'itens', 'Gekaufte Positionen', 'produtos', 'Produkte', 'nforn', 'Lieferanten',
    'atualizado', 'Aktualisiert am', 'lema', 'Eine Preishistorie für alle künftigen Projekte',
    'produto', 'Produkt', 'un', 'Einheit', 'compras', 'Käufe', 'menor', 'Niedrigster', 'medio', 'Durchschnitt', 'maior', 'Höchster',
    'ultimo', 'Letzter', 'var', 'Änderung', 'unid', 'Standorte', 'mes', 'Monat', 'gasto', 'Ausgaben', 'periodo_c', 'Zeitraum',
    'fornecedor', 'Lieferant', 'total', 'Gesamt', 'primeiro', 'Erster', 'barato', 'Günstigster', 'caro', 'Teuerster', 'dif', 'Abstand',
    'geral', 'Gesamt', 'varmes', 'Änderung im Monat', 'comparados', 'Verglichene Positionen', 'faixa', 'Spanne', 'historico', 'Verlauf',
    'nivel', 'Index', 'gasto_total', 'Gesamtausgaben', 'indice_atual', 'Preisindex', 'desde', 'seit', 'no_mes', 'letzter Monat'
  ) || jsonb_build_object(
    'h_panorama', 'Einkaufsüberblick', 'lead_panorama', 'Was die Standorte gekauft haben, was sie gezahlt haben und wohin die Preise gehen.',
    'h_indice', 'Monatlicher Preisindex', 'lead_indice', 'Was derselbe Warenkorb von Monat zu Monat kostet. Erster Monat jeder Linie = 100.',
    'h_gasto', 'Ausgaben nach Monat und Standort', 'g_indice', 'Preisindex · erster Monat = 100', 'g_gasto', 'Ausgaben pro Monat (R$)',
    'h_altas', 'Größte Preisänderungen', 'lead_altas', 'Erster gegen letzten Kauf jedes Produkts, das an mindestens 3 verschiedenen Tagen gekauft wurde.',
    'sub_altas', 'Größte Anstiege', 'sub_quedas', 'Größte Rückgänge',
    'h_osc', 'Monatliche Preisschwankungen', 'lead_osc', 'Durchschnittlich gezahlter Preis pro Monat für die 40 Produkte mit den höchsten Ausgaben. Rot: über dem eigenen Durchschnitt des Produkts; grün: darunter.',
    'h_comp', 'Gleiche Position, verschiedene Lieferanten', 'lead_comp', 'Produkte, die bei 2 oder mehr Lieferanten gekauft wurden, mit dem günstigsten und dem teuersten Durchschnittspreis.',
    'h_forn', 'Alle Lieferanten', 'lead_forn', 'Jeder Lieferant mit mindestens einer Rechnung, von den höchsten zu den niedrigsten Ausgaben.',
    'lead_cat', 'Produkte · alphabetisch · Preise in R$ pro Einkaufseinheit', 'pos', 'Letzter Preis in der Spanne (niedrigster → höchster)',
    'em_rs', 'R$ pro Einheit',
    'nota_indice', 'Jeder Monat vergleicht nur Positionen, die in diesem und im Vormonat in derselben Einheit gekauft wurden, gewichtet mit den Ausgaben des Vormonats (Kettenindex). Änderungen über 5× oder unter 1/5 gelten als wahrscheinliche Fehler und bleiben außen vor. Rücksendungen sind ausgeschlossen.',
    'nota_comp', 'Nur identische Beschreibungen werden zusammengeführt. Dasselbe Produkt, das jeder Lieferant anders schreibt, erscheint hier nicht: mit precos_consultar suchen.',
    'mil', 'Tsd.', 'mi', 'Mio.')
  else jsonb_build_object(
    'capa', 'Capa', 'indice', 'Índice mensal', 'altas', 'Altas e quedas', 'oscilacao', 'Oscilação mensal',
    'comparar', 'Comparar fornecedores', 'fornecedores', 'Fornecedores', 'catalogo', 'Catálogo', 'metodo', 'Método',
    'sobretitulo', 'Base de compras · Cicchetti', 'titulo', 'Índice|de Preços',
    'subtitulo', 'Todos os itens de todas as notas de compra das unidades, por fornecedor e data.',
    'periodo', 'Período', 'notas', 'Notas', 'itens', 'Itens comprados', 'produtos', 'Produtos', 'nforn', 'Fornecedores',
    'atualizado', 'Atualizado em', 'lema', 'Um só histórico de preços para todos os projetos futuros',
    'produto', 'Produto', 'un', 'Un.', 'compras', 'Compras', 'menor', 'Menor', 'medio', 'Médio', 'maior', 'Maior',
    'ultimo', 'Último', 'var', 'Variação', 'unid', 'Unidades', 'mes', 'Mês', 'gasto', 'Gasto', 'periodo_c', 'Período',
    'fornecedor', 'Fornecedor', 'total', 'Total', 'primeiro', 'Primeiro', 'barato', 'Mais barato', 'caro', 'Mais caro', 'dif', 'Diferença',
    'geral', 'Geral', 'varmes', 'Variação no mês', 'comparados', 'Itens comparados', 'faixa', 'Faixa', 'historico', 'Histórico',
    'nivel', 'Índice', 'gasto_total', 'Gasto total', 'indice_atual', 'Índice de preços', 'desde', 'desde', 'no_mes', 'no último mês'
  ) || jsonb_build_object(
    'h_panorama', 'Panorama de compras', 'lead_panorama', 'O que as unidades compraram, quanto pagaram e para onde os preços estão indo.',
    'h_indice', 'Índice mensal de preços', 'lead_indice', 'Quanto custa a mesma cesta de itens de um mês para o outro. Primeiro mês de cada linha = 100.',
    'h_gasto', 'Gasto por mês e unidade', 'g_indice', 'Índice de preços · primeiro mês = 100', 'g_gasto', 'Gasto por mês (R$)',
    'h_altas', 'Maiores variações de preço', 'lead_altas', 'Primeira compra contra a última de cada produto comprado em pelo menos 3 dias diferentes.',
    'sub_altas', 'Maiores altas', 'sub_quedas', 'Maiores quedas',
    'h_osc', 'Oscilação mensal de preços', 'lead_osc', 'Preço médio pago em cada mês pelos 40 produtos de maior gasto. Vermelho: acima da média do próprio produto; verde: abaixo.',
    'h_comp', 'Mesmo item, fornecedores diferentes', 'lead_comp', 'Produtos comprados de 2 ou mais fornecedores, com o preço médio mais barato e o mais caro.',
    'h_forn', 'Todos os fornecedores', 'lead_forn', 'Cada fornecedor com pelo menos uma nota, do maior para o menor gasto.',
    'lead_cat', 'produtos · ordem alfabética · preços em R$ por unidade de compra', 'pos', 'Último preço dentro da faixa (menor → maior)',
    'em_rs', 'R$ por unidade',
    'nota_indice', 'Cada mês compara só os itens comprados nele e no mês anterior, na mesma unidade de compra, com peso pelo gasto do mês anterior (índice encadeado). Variações acima de 5× ou abaixo de 1/5 ficam de fora por serem provável erro de digitação ou de unidade. Devoluções não entram.',
    'nota_comp', 'Só juntamos descrições iguais. O mesmo produto escrito de jeito diferente por cada fornecedor não aparece aqui: procure com precos_consultar.',
    'mil', 'mil', 'mi', 'mi')
  end
$$;

-- ---------------------------------------------------------------------
-- Formatos: números, dinheiro, porcentagem e datas de cada idioma
-- ---------------------------------------------------------------------
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
-- Valor curto para gráficos e destaques: R$ 352 mil / R$ 1,2 mi
create or replace function public.precos_curto(v numeric, p_lang text)
returns text language sql immutable as $$
  select case when v is null then '–'
    when abs(v) >= 1000000 then 'R$ ' || public.precos_num(v / 1000000, p_lang, 1) || ' ' || (public.precos_txt(p_lang)->>'mi')
    when abs(v) >= 1000 then 'R$ ' || public.precos_num(v / 1000, p_lang, 0) || ' ' || (public.precos_txt(p_lang)->>'mil')
    else 'R$ ' || public.precos_num(v, p_lang, 0) end
$$;
create or replace function public.precos_pct(v numeric, p_lang text)
returns text language sql immutable as $$
  select case when v is null then '–' when round(v, 1) > 0 then '+' || public.precos_num(v, p_lang, 1) || '%'
              when round(v, 1) < 0 then '−' || public.precos_num(abs(v), p_lang, 1) || '%'
              else public.precos_num(0, p_lang, 1) || '%' end
$$;
create or replace function public.precos_dt(d date, p_lang text)
returns text language sql immutable as $$
  select case when d is null then '–' when p_lang = 'de' then to_char(d, 'DD.MM.YYYY') else to_char(d, 'DD/MM/YYYY') end
$$;
create or replace function public.precos_dt_curta(d date, p_lang text)
returns text language sql immutable as $$
  select case when d is null then '–' when p_lang = 'de' then to_char(d, 'DD.MM.YY') else to_char(d, 'DD/MM/YY') end
$$;
create or replace function public.precos_mes(d date, p_lang text)
returns text language sql immutable as $$
  select case p_lang
    when 'en' then (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[extract(month from d)]
    when 'pl' then (array['sty','lut','mar','kwi','maj','cze','lip','sie','wrz','paź','lis','gru'])[extract(month from d)]
    when 'fr' then (array['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'])[extract(month from d)]
    when 'de' then (array['Jan.','Feb.','März','Apr.','Mai','Juni','Juli','Aug.','Sep.','Okt.','Nov.','Dez.'])[extract(month from d)]
    else (array['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'])[extract(month from d)] end
    || ' ' || to_char(d, 'YY')
$$;
-- Texto seguro dentro do HTML
create or replace function public.precos_esc(t text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;
create or replace function public.precos_cel(t text)
returns text language sql immutable as $$ select replace(replace(coalesce(t, ''), '|', '/'), E'\n', ' ') $$;
create or replace function public.precos_sigla(u text)
returns text language sql immutable as $$
  select case u when 'midway' then 'MW' when 'pipa_centro' then 'PC' when 'pipa_producao' then 'PP' else u end
$$;
-- Etiquetas das unidades ("MW PC" → chips)
create or replace function public.precos_chips(p text)
returns text language sql immutable as $$
  select coalesce(string_agg(format('<span class="ip-u ip-%s">%s</span>', lower(s), s), '' order by s), '')
  from regexp_split_to_table(coalesce(p, ''), '\s+') s where s <> ''
$$;
-- Selo de variação: vermelho quando o preço sobe, verde quando cai
create or replace function public.precos_selo(v numeric, p_lang text)
returns text language sql immutable as $$
  select case when v is null then '<span class="ip-var ip-eq">–</span>'
    else format('<span class="ip-var %s">%s</span>', case when round(v, 1) > 0 then 'ip-up' when round(v, 1) < 0 then 'ip-down' else 'ip-eq' end,
                public.precos_pct(v, p_lang)) end
$$;
-- Fundo do mapa de calor: distância do preço à média do próprio produto
create or replace function public.precos_calor(p numeric, media numeric)
returns text language sql immutable as $$
  select case when p is null or coalesce(media, 0) = 0 or abs(p / media - 1) < 0.015 then ''
    else format(' style="background:rgba(%s,%s)"', case when p > media then '196,50,38' else '18,140,92' end,
                round(least(abs(p / media - 1) * 1.8, 0.42) + 0.06, 2)) end
$$;
-- Passo redondo para os eixos dos gráficos (1, 2, 2,5 ou 5 × 10^n)
create or replace function public.precos_passo(v numeric)
returns numeric language sql immutable as $$
  select case when coalesce(v, 0) <= 0 then 1 else
    (case when n <= 1 then 1 when n <= 2 then 2 when n <= 2.5 then 2.5 when n <= 5 then 5 else 10 end) * m end
  from (select v / power(10::numeric, floor(log(v))) n, power(10::numeric, floor(log(v))) m) x
$$;

-- Minigráfico (linha) de uma série de preços
drop function if exists public.precos_spark(numeric[], int, int);
create or replace function public.precos_spark(p numeric[], p_w int default 96, p_h int default 26, p_cls text default null)
returns text language plpgsql immutable as $$
declare n int := coalesce(array_length(p, 1), 0); vmin numeric; vmax numeric; pts text := ''; i int; x numeric; y numeric; cls text;
begin
  if n < 2 then return ''; end if;
  select min(v), max(v) into vmin, vmax from unnest(p) v;
  for i in 1..n loop
    x := round(2 + (p_w - 4) * (i - 1)::numeric / (n - 1), 1);
    y := case when vmax = vmin then p_h / 2.0 else round(p_h - 3 - (p_h - 6) * (p[i] - vmin) / (vmax - vmin), 1) end;
    pts := pts || x || ',' || y || ' ';
  end loop;
  cls := coalesce(p_cls, case when p[n] > p[1] * 1.005 then 'ip-up' when p[n] < p[1] * 0.995 then 'ip-down' else 'ip-eq' end);
  return format('<svg class="ip-spark %s" viewBox="0 0 %s %s" width="%s" height="%s"><polyline class="ip-spark-l" points="%s"/><circle class="ip-spark-p" cx="%s" cy="%s" r="2.4"/></svg>',
    cls, p_w, p_h, p_w, p_h, trim(pts), x, y);
end $$;

-- Gráfico de linhas (índice). p_series: [{"c": "geral", "n": "Geral", "v": [100, 99.5, null, ...]}]
drop function if exists public.precos_graf_linhas(text[], jsonb, text);
create or replace function public.precos_graf_linhas(p_rot text[], p_series jsonb, p_lang text, W int default 680, H int default 250)
returns text language plpgsql immutable as $$
declare
  ml int := 40; mr int := 118; mt int := 16; mb int := 30; nt int; pe numeric;
  n int := coalesce(array_length(p_rot, 1), 0); vmin numeric; vmax numeric; passo numeric;
  s jsonb; i int; k int; x numeric; y numeric; v numeric; pts text; pontos text; out text; lx numeric; ly numeric; ult numeric;
  rot jsonb := '[]'; r record; ant numeric := -100;
begin
  if n = 0 then return ''; end if;
  select min(e::text::numeric), max(e::text::numeric) into vmin, vmax
  from jsonb_array_elements(p_series) s2, jsonb_array_elements(s2->'v') e where jsonb_typeof(e) = 'number';
  if vmin is null then return ''; end if;
  pe := public.precos_passo(greatest((vmax - vmin) * 1.15, 2) / 4);
  vmin := floor((vmin - pe * 0.2) / pe) * pe; vmax := ceil((vmax + pe * 0.2) / pe) * pe;
  nt := round((vmax - vmin) / pe)::int;
  passo := (W - ml - mr)::numeric / greatest(n - 1, 1);
  out := format('<svg class="ip-graf-svg" viewBox="0 0 %s %s" role="img">', W, H);
  for k in 0..nt loop
    v := vmin + pe * k; y := round(mt + (H - mt - mb) * (1 - (v - vmin) / (vmax - vmin)), 1);
    out := out || format('<line class="%s" x1="%s" x2="%s" y1="%s" y2="%s"/><text class="ip-eixo" x="%s" y="%s" text-anchor="end">%s</text>',
      case when k = 0 then 'ip-base' else 'ip-grade' end, ml, W - mr, y, y, ml - 8, y + 3.5, public.precos_num(v, p_lang, case when pe < 1 then 1 else 0 end));
  end loop;
  -- linha de referência em 100
  if 100 between vmin and vmax then
    y := round(mt + (H - mt - mb) * (1 - (100 - vmin) / (vmax - vmin)), 1);
    out := out || format('<line class="ip-ref" x1="%s" x2="%s" y1="%s" y2="%s"/>', ml, W - mr, y, y);
  end if;
  for i in 1..n loop
    x := round(ml + passo * (i - 1), 1);
    out := out || format('<text class="ip-eixo" x="%s" y="%s" text-anchor="middle">%s</text>', x, H - 9, public.precos_esc(p_rot[i]));
  end loop;
  for s in select * from jsonb_array_elements(p_series) loop
    pts := ''; pontos := ''; ult := null;
    for i in 1..n loop
      v := nullif(s->'v'->>(i - 1), '')::numeric;
      continue when v is null;
      x := round(ml + passo * (i - 1), 1); y := round(mt + (H - mt - mb) * (1 - (v - vmin) / (vmax - vmin)), 1);
      pts := pts || x || ',' || y || ' ';
      pontos := pontos || format('<circle class="ip-p ip-c-%s" cx="%s" cy="%s" r="%s"/>', s->>'c', x, y, case when s->>'c' = 'geral' then 3 else 2.2 end);
      lx := x; ly := y; ult := v;
    end loop;
    continue when ult is null;
    out := out || format('<polyline class="ip-l ip-c-%s" points="%s"/>', s->>'c', trim(pts)) || pontos;
    rot := rot || jsonb_build_object('y', ly, 'x', lx, 't', (s->>'n') || ' ' || public.precos_num(ult, p_lang, 1), 'c', s->>'c');
  end loop;
  -- rótulos no fim das linhas, sem se sobrepor
  for r in select * from jsonb_to_recordset(rot) as t(y numeric, x numeric, t text, c text) order by y loop
    y := greatest(r.y, ant + 14); ant := y;
    out := out || format('<text class="ip-rot ip-t-%s" x="%s" y="%s">%s</text>', r.c, W - mr + 10, y + 3.5, public.precos_esc(r.t));
  end loop;
  return out || '</svg>';
end $$;

-- Gráfico de barras empilhadas (gasto). p_series: [{"c": "mw", "v": [..]}]
drop function if exists public.precos_graf_barras(text[], jsonb, text);
create or replace function public.precos_graf_barras(p_rot text[], p_series jsonb, p_lang text, W int default 680, H int default 250)
returns text language plpgsql immutable as $$
declare
  ml int := 64; mr int := 12; mt int := 22; mb int := 30; pe numeric; nt int;
  n int := coalesce(array_length(p_rot, 1), 0); vmax numeric := 0; tot numeric; passo numeric; bw numeric;
  i int; k int; x numeric; y numeric; v numeric; base numeric; s jsonb; out text; alt numeric;
begin
  if n = 0 then return ''; end if;
  for i in 1..n loop
    select coalesce(sum(nullif(e->'v'->>(i - 1), '')::numeric), 0) into tot from jsonb_array_elements(p_series) e;
    vmax := greatest(vmax, tot);
  end loop;
  if vmax = 0 then return ''; end if;
  pe := public.precos_passo(vmax * 1.05 / 5); nt := ceil(vmax * 1.05 / pe)::int; vmax := pe * nt;
  passo := (W - ml - mr)::numeric / n; bw := least(passo * 0.56, 64);
  out := format('<svg class="ip-graf-svg" viewBox="0 0 %s %s" role="img">', W, H);
  for k in 0..nt loop
    v := pe * k; y := round(mt + (H - mt - mb) * (1 - v / vmax), 1);
    out := out || format('<line class="%s" x1="%s" x2="%s" y1="%s" y2="%s"/><text class="ip-eixo" x="%s" y="%s" text-anchor="end">%s</text>',
      case when k = 0 then 'ip-base' else 'ip-grade' end, ml, W - mr, y, y, ml - 8, y + 3.5, public.precos_curto(v, p_lang));
  end loop;
  for i in 1..n loop
    x := ml + passo * (i - 0.5); base := 0;
    for s in select * from jsonb_array_elements(p_series) loop
      v := coalesce(nullif(s->'v'->>(i - 1), '')::numeric, 0);
      continue when v <= 0;
      alt := (H - mt - mb) * v / vmax;
      y := mt + (H - mt - mb) * (1 - (base + v) / vmax);
      out := out || format('<rect class="ip-b ip-c-%s" x="%s" y="%s" width="%s" height="%s"/>', s->>'c', round(x - bw / 2, 1), round(y, 1), round(bw, 1), round(alt, 1));
      base := base + v;
    end loop;
    if base > 0 then
      out := out || format('<text class="ip-rot-b" x="%s" y="%s" text-anchor="middle">%s</text>', round(x, 1),
        round(mt + (H - mt - mb) * (1 - base / vmax) - 6, 1), public.precos_curto(base, p_lang));
    end if;
    out := out || format('<text class="ip-eixo" x="%s" y="%s" text-anchor="middle">%s</text>', round(x, 1), H - 9, public.precos_esc(p_rot[i]));
  end loop;
  return out || '</svg>';
end $$;

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

-- Cabeçalho de capítulo
create or replace function public.precos_cab(p_num int, p_secao text, p_titulo text, p_lead text, p_extra text default '')
returns text language sql immutable as $$
  select format('<header class="ip-cab"><span class="ip-cab-n">%s</span><span class="ip-cab-s">%s</span>%s</header><h1 class="ip-h1">%s</h1><p class="ip-lead">%s</p>',
    lpad(p_num::text, 2, '0'), public.precos_esc(p_secao),
    case when p_extra <> '' then '<span class="ip-cab-x">' || public.precos_esc(p_extra) || '</span>' else '' end,
    public.precos_esc(p_titulo), public.precos_esc(p_lead))
$$;

-- ---------------------------------------------------------------------
-- Capítulos de um idioma: (numero, titulo, conteudo)
-- (a versão antiga, só com o idioma, dá lugar a esta com o limite de linhas para prévias)
drop function if exists public.precos_capitulos(text);
-- ---------------------------------------------------------------------
create or replace function public.precos_capitulos(p_lang text, p_max_linhas int default null)
returns table (numero int, titulo text, conteudo text)
language plpgsql volatile security definer set search_path = public as $$
#variable_conflict use_column
declare
  t jsonb := public.precos_txt(p_lang); L text := p_lang;
  v_de date; v_ate date; v_notas int; v_itens int; v_prod int; v_forn int; v_gasto numeric;
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_meses date[]; v_rot text[]; a_ger numeric[]; a_mw numeric[]; a_pc numeric[]; a_pp numeric[]; a_var numeric[]; a_n int[];
  g_mw numeric[]; g_pc numeric[]; g_pp numeric[]; g_notas int[];
  s text; s2 text; s3 text; c record; n int; k int; v_idx_ult numeric; v_idx_var numeric;
  graf_ind text; graf_gas text; graf_ind_l text; graf_gas_l text; leg_ind text; leg_gas text; atualiz text;
  lim int := coalesce(p_max_linhas, 100000);
begin
  select min(data_emissao), max(data_emissao), count(*) into v_de, v_ate, v_notas from precos_notas where itens_coletados_em is not null;
  select count(*), sum(valor_total) into v_itens, v_gasto from precos_itens;
  select count(*) into v_prod from precos_produtos;
  select count(distinct fornecedor) into v_forn from precos_notas where itens_coletados_em is not null;
  select array_agg(m order by m) into v_meses from (select distinct date_trunc('month', data_emissao)::date m from precos_historico) x;
  select array_agg(public.precos_mes(m, L) order by m) into v_rot from unnest(v_meses) m;
  atualiz := (t->>'atualizado') || ' ' || public.precos_dt(v_hoje, L);

  -- Índice encadeado mês a mês (média geométrica ponderada pelo gasto do mês anterior)
  drop table if exists _ip_idx;
  create temp table _ip_idx on commit drop as
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
  )
  select grupo, mes, idx, n, 100 * exp(sum(ln(idx)) over (partition by grupo order by mes)) nivel from cad;

  select array_agg(round(c.nivel, 2) order by m) into a_ger from unnest(v_meses) m left join _ip_idx c on c.grupo = 'todas' and c.mes = m;
  select array_agg(round(c.nivel, 2) order by m) into a_mw from unnest(v_meses) m left join _ip_idx c on c.grupo = 'midway' and c.mes = m;
  select array_agg(round(c.nivel, 2) order by m) into a_pc from unnest(v_meses) m left join _ip_idx c on c.grupo = 'pipa_centro' and c.mes = m;
  select array_agg(round(c.nivel, 2) order by m) into a_pp from unnest(v_meses) m left join _ip_idx c on c.grupo = 'pipa_producao' and c.mes = m;
  select array_agg(case when c.n is null then null else (c.idx - 1) * 100 end order by m), array_agg(c.n order by m)
    into a_var, a_n from unnest(v_meses) m left join _ip_idx c on c.grupo = 'todas' and c.mes = m;
  v_idx_ult := a_ger[array_length(a_ger, 1)];
  v_idx_var := a_var[array_length(a_var, 1)];

  select array_agg(x.mw order by m), array_agg(x.pc order by m), array_agg(x.pp order by m), array_agg(coalesce(x.notas, 0) order by m)
    into g_mw, g_pc, g_pp, g_notas
  from unnest(v_meses) m left join (
    select date_trunc('month', n.data_emissao)::date mes,
      sum(i.valor_total) filter (where i.unidade = 'midway') mw, sum(i.valor_total) filter (where i.unidade = 'pipa_centro') pc,
      sum(i.valor_total) filter (where i.unidade = 'pipa_producao') pp, count(distinct n.id) notas
    from precos_itens i join precos_notas n on n.id = i.nota_id group by 1) x on x.mes = m;

  graf_ind := public.precos_graf_linhas(v_rot, jsonb_build_array(
    jsonb_build_object('c', 'mw', 'n', 'MW', 'v', to_jsonb(a_mw)),
    jsonb_build_object('c', 'pc', 'n', 'PC', 'v', to_jsonb(a_pc)),
    jsonb_build_object('c', 'pp', 'n', 'PP', 'v', to_jsonb(a_pp)),
    jsonb_build_object('c', 'geral', 'n', t->>'geral', 'v', to_jsonb(a_ger))), L);
  graf_gas := public.precos_graf_barras(v_rot, jsonb_build_array(
    jsonb_build_object('c', 'mw', 'v', to_jsonb(g_mw)), jsonb_build_object('c', 'pc', 'v', to_jsonb(g_pc)),
    jsonb_build_object('c', 'pp', 'v', to_jsonb(g_pp))), L);
  graf_ind_l := public.precos_graf_linhas(v_rot, jsonb_build_array(
    jsonb_build_object('c', 'mw', 'n', 'MW', 'v', to_jsonb(a_mw)),
    jsonb_build_object('c', 'pc', 'n', 'PC', 'v', to_jsonb(a_pc)),
    jsonb_build_object('c', 'pp', 'n', 'PP', 'v', to_jsonb(a_pp)),
    jsonb_build_object('c', 'geral', 'n', t->>'geral', 'v', to_jsonb(a_ger))), L, 1120, 300);
  graf_gas_l := public.precos_graf_barras(v_rot, jsonb_build_array(
    jsonb_build_object('c', 'mw', 'v', to_jsonb(g_mw)), jsonb_build_object('c', 'pc', 'v', to_jsonb(g_pc)),
    jsonb_build_object('c', 'pp', 'v', to_jsonb(g_pp))), L, 1120, 300);
  leg_ind := format('<div class="ip-leg"><span><i class="ip-c-geral"></i>%s</span><span><i class="ip-c-mw"></i>Midway Mall</span><span><i class="ip-c-pc"></i>Pipa Centro</span><span><i class="ip-c-pp"></i>Produção Pipa</span></div>', t->>'geral');
  leg_gas := '<div class="ip-leg"><span><i class="ip-c-mw"></i>Midway Mall</span><span><i class="ip-c-pc"></i>Pipa Centro</span><span><i class="ip-c-pp"></i>Produção Pipa</span></div>';

  -- ===================== 00 · Capa + Panorama =====================
  select string_agg(format('<div class="ip-kpi-u"><span class="ip-u ip-%s">%s</span><b>%s</b></div>', lower(sg), sg, public.precos_curto(g, L)), '' order by g desc)
    into s
  from (select public.precos_sigla(unidade) sg, sum(valor_total) g from precos_itens group by unidade) u;


  -- Destaques: 6 altas e 6 quedas, com minigráfico (produtos comprados em 4+ dias e com gasto relevante)
  drop table if exists _ip_mov;
  create temp table _ip_mov on commit drop as
  select p.*, (p.ultimo_preco / p.primeiro_preco - 1) * 100 var,
    (select array_agg(h.preco_efetivo order by h.data_emissao, h.nota_id) from precos_historico h
      where h.produto = p.produto and coalesce(h.unidade_compra, '') = p.unidade_compra and h.preco_efetivo > 0) serie
  from precos_produtos p
  where p.dias >= 3 and p.primeiro_preco > 0 and p.categoria <> 'Devolução' and p.ultimo_preco / p.primeiro_preco between 0.2 and 5;

  select string_agg(format('<tr><td><b>%s</b><small>%s · %s %s</small></td><td class="ip-sp">%s</td><td class="ip-n">%s</td></tr>',
      public.precos_esc(produto), unidade_compra, t->>'ultimo', public.precos_num(ultimo_preco, L, 2),
      public.precos_spark(serie, 84, 24, 'ip-up'), public.precos_selo(var, L)), '' order by o)
    into s2
  from (select *, row_number() over (order by var desc) o from _ip_mov where var > 0 and dias >= 4 and gasto >= 500) x where o <= 6;
  select string_agg(format('<tr><td><b>%s</b><small>%s · %s %s</small></td><td class="ip-sp">%s</td><td class="ip-n">%s</td></tr>',
      public.precos_esc(produto), unidade_compra, t->>'ultimo', public.precos_num(ultimo_preco, L, 2),
      public.precos_spark(serie, 84, 24, 'ip-down'), public.precos_selo(var, L)), '' order by o)
    into s3
  from (select *, row_number() over (order by var asc) o from _ip_mov where var < 0 and dias >= 4 and gasto >= 500) x where o <= 6;

  numero := 0; titulo := '00 · ' || (t->>'capa');
  conteudo := concat_ws(E'\n', ':::capa', 'marca: Brasico', 'sobretitulo: ' || (t->>'sobretitulo'), 'titulo: ' || (t->>'titulo'),
    'subtitulo: ' || (t->>'subtitulo'),
    'info: ' || (t->>'periodo') || ' | ' || public.precos_dt_curta(v_de, L) || ' – ' || public.precos_dt_curta(v_ate, L),
    'info: ' || (t->>'notas') || ' | ' || public.precos_num(v_notas, L, 0),
    'info: ' || (t->>'itens') || ' | ' || public.precos_num(v_itens, L, 0),
    'info: ' || (t->>'produtos') || ' | ' || public.precos_num(v_prod, L, 0),
    'info: ' || (t->>'nforn') || ' | ' || public.precos_num(v_forn, L, 0),
    'info: ' || (t->>'atualizado') || ' | ' || public.precos_dt(v_hoje, L),
    'lema: ' || (t->>'lema'), ':::', '', ':::html',
    public.precos_cab(0, t->>'h_panorama', t->>'h_panorama', t->>'lead_panorama', atualiz)
    || '<div class="ip-kpis">'
    || format('<div class="ip-kpi ip-kpi-destaque"><span class="ip-kpi-r">%s</span><span class="ip-kpi-v">%s</span><div class="ip-kpi-us">%s</div></div>',
         t->>'gasto_total', public.precos_curto(v_gasto, L), coalesce(s, ''))
    || format('<div class="ip-kpi"><span class="ip-kpi-r">%s</span><span class="ip-kpi-v">%s</span><span class="ip-kpi-d">%s %s</span><span class="ip-kpi-d">%s %s</span></div>',
         t->>'indice_atual', public.precos_num(v_idx_ult, L, 1), public.precos_selo(v_idx_ult - 100, L), (t->>'desde') || ' ' || v_rot[1],
         public.precos_selo(v_idx_var, L), t->>'no_mes')
    || format('<div class="ip-kpi"><span class="ip-kpi-r">%s</span><span class="ip-kpi-v">%s</span><span class="ip-kpi-d">%s %s</span></div>',
         t->>'notas', public.precos_num(v_notas, L, 0), public.precos_num(v_itens, L, 0), lower(t->>'itens'))
    || format('<div class="ip-kpi"><span class="ip-kpi-r">%s</span><span class="ip-kpi-v">%s</span><span class="ip-kpi-d">%s %s</span></div>',
         t->>'produtos', public.precos_num(v_prod, L, 0), public.precos_num(v_forn, L, 0), lower(t->>'nforn'))
    || '</div>'
    || format('<div class="ip-duas"><figure class="ip-graf"><figcaption>%s</figcaption>%s%s</figure><figure class="ip-graf"><figcaption>%s</figcaption>%s%s</figure></div>',
      t->>'g_indice', graf_ind, leg_ind, t->>'g_gasto', graf_gas, leg_gas)
    || format('<div class="ip-duas"><div><h2 class="ip-h2">%s</h2><table class="ip-tab ip-mini"><tbody>%s</tbody></table></div><div><h2 class="ip-h2">%s</h2><table class="ip-tab ip-mini"><tbody>%s</tbody></table></div></div>',
      t->>'sub_altas', coalesce(s2, ''), t->>'sub_quedas', coalesce(s3, '')),
    ':::');
  return next;

  -- ===================== 01 · Índice mensal =====================
  select string_agg(format('<tr><td>%s</td><td class="ip-n"><b>%s</b></td><td class="ip-n">%s</td><td class="ip-n">%s</td><td class="ip-n">%s</td><td class="ip-n">%s</td><td class="ip-n ip-mut">%s</td></tr>',
      v_rot[i], public.precos_num(a_ger[i], L, 1), case when a_var[i] is null then '<span class="ip-mut">–</span>' else public.precos_selo(a_var[i], L) end,
      public.precos_num(a_mw[i], L, 1), public.precos_num(a_pc[i], L, 1), public.precos_num(a_pp[i], L, 1), coalesce(public.precos_num(a_n[i], L, 0), '–')), '' order by i)
    into s
  from generate_subscripts(v_meses, 1) i;
  select string_agg(format('<tr><td>%s</td><td class="ip-n">%s</td><td class="ip-n">%s</td><td class="ip-n">%s</td><td class="ip-n"><b>%s</b></td><td class="ip-n ip-mut">%s</td></tr>',
      v_rot[i], public.precos_num(g_mw[i], L, 0), public.precos_num(g_pc[i], L, 0), public.precos_num(g_pp[i], L, 0),
      public.precos_num(coalesce(g_mw[i], 0) + coalesce(g_pc[i], 0) + coalesce(g_pp[i], 0), L, 0), public.precos_num(g_notas[i], L, 0)), '' order by i)
    into s2
  from generate_subscripts(v_meses, 1) i;
  numero := 1; titulo := '01 · ' || (t->>'indice');
  conteudo := E':::html\n' || public.precos_cab(1, t->>'indice', t->>'h_indice', t->>'lead_indice', atualiz)
    || format('<figure class="ip-graf ip-graf-largo"><figcaption>%s</figcaption>%s%s</figure>', t->>'g_indice', graf_ind_l, leg_ind)
    || format('<table class="ip-tab"><thead><tr><th>%s</th><th class="ip-n">%s</th><th class="ip-n">%s</th><th class="ip-n">Midway</th><th class="ip-n">Pipa Centro</th><th class="ip-n">Produção Pipa</th><th class="ip-n">%s</th></tr></thead><tbody>%s</tbody></table>',
         t->>'mes', t->>'geral', t->>'varmes', t->>'comparados', coalesce(s, ''))
    || format('<h2 class="ip-h2">%s</h2><figure class="ip-graf ip-graf-largo"><figcaption>%s</figcaption>%s%s</figure>', t->>'h_gasto', t->>'g_gasto', graf_gas_l, leg_gas)
    || format('<table class="ip-tab"><thead><tr><th>%s</th><th class="ip-n">Midway</th><th class="ip-n">Pipa Centro</th><th class="ip-n">Produção Pipa</th><th class="ip-n">%s</th><th class="ip-n">%s</th></tr></thead><tbody>%s</tbody></table>',
         t->>'mes', (t->>'total') || ' (R$)', t->>'notas', coalesce(s2, ''))
    || format('<p class="ip-nota">%s</p>', public.precos_esc(t->>'nota_indice')) || E'\n:::';
  return next;

  -- ===================== 02 · Altas e quedas =====================
  numero := 2; titulo := '02 · ' || (t->>'altas');
  conteudo := E':::html\n' || public.precos_cab(2, t->>'altas', t->>'h_altas', t->>'lead_altas', atualiz);
  for k in 1..2 loop
    select string_agg(format('<tr><td><b>%s</b><small>%s %s</small></td><td>%s</td><td class="ip-n">%s<small>%s</small></td><td class="ip-n"><b>%s</b><small>%s</small></td><td class="ip-sp">%s</td><td class="ip-n">%s</td><td class="ip-n ip-mut">%s</td></tr>',
        public.precos_esc(produto), public.precos_esc(left(ultimo_fornecedor, 34)), public.precos_chips(unidades), unidade_compra,
        public.precos_num(primeiro_preco, L, 2), public.precos_dt_curta(primeira_compra, L),
        public.precos_num(ultimo_preco, L, 2), public.precos_dt_curta(ultima_compra, L),
        public.precos_spark(serie[greatest(1, array_length(serie, 1) - 39):], 110, 26, case when var > 0 then 'ip-up' else 'ip-down' end), public.precos_selo(var, L), public.precos_num(compras, L, 0)), '' order by o)
      into s
    from (select *, row_number() over (order by case when k = 1 then -var else var end) o from _ip_mov where case when k = 1 then var > 0 else var < 0 end) x
    where o <= least(30, lim);
    conteudo := conteudo || format('<h2 class="ip-h2">%s</h2><table class="ip-tab"><thead><tr><th>%s</th><th>%s</th><th class="ip-n">%s (R$)</th><th class="ip-n">%s (R$)</th><th>%s</th><th class="ip-n">%s</th><th class="ip-n">%s</th></tr></thead><tbody>%s</tbody></table>',
      case k when 1 then t->>'sub_altas' else t->>'sub_quedas' end, t->>'produto', t->>'un', t->>'primeiro', t->>'ultimo', t->>'historico', t->>'var', t->>'compras', coalesce(s, ''));
  end loop;
  conteudo := conteudo || E'\n:::';
  return next;

  -- ===================== 03 · Oscilação mensal (mapa de calor) =====================
  with top as (select produto, unidade_compra, gasto, medio from precos_produtos where categoria <> 'Devolução' order by gasto desc limit least(40, lim)),
  pm as (select h.produto, coalesce(h.unidade_compra, '') un, date_trunc('month', h.data_emissao)::date mes,
           sum(h.preco_efetivo * h.quantidade) / sum(h.quantidade) preco
         from precos_historico h join top on top.produto = h.produto and top.unidade_compra = coalesce(h.unidade_compra, '')
         where h.preco_efetivo > 0 and h.quantidade > 0 group by 1, 2, 3)
  select string_agg('<tr><td><b>' || public.precos_esc(top.produto) || '</b></td><td>' || top.unidade_compra || '</td>'
      || (select string_agg(format('<td class="ip-n ip-calor"%s>%s</td>', public.precos_calor(pm.preco, top.medio), coalesce(public.precos_num(pm.preco, L, 2), '<span class="ip-mut">·</span>')), '' order by m)
          from unnest(v_meses) m left join pm on pm.produto = top.produto and pm.un = top.unidade_compra and pm.mes = m)
      || '<td class="ip-n">' || coalesce((select public.precos_selo(((array_agg(pm.preco order by pm.mes desc))[1]
           / nullif((array_agg(pm.preco order by pm.mes))[1], 0) - 1) * 100, L)
         from pm where pm.produto = top.produto and pm.un = top.unidade_compra having count(*) > 1), '<span class="ip-mut">–</span>') || '</td></tr>', '' order by top.gasto desc)
    into s
  from top;
  numero := 3; titulo := '03 · ' || (t->>'oscilacao');
  conteudo := E':::html\n' || public.precos_cab(3, t->>'oscilacao', t->>'h_osc', t->>'lead_osc', atualiz)
    || format('<table class="ip-tab ip-calor-tab"><thead><tr><th>%s</th><th>%s</th>%s<th class="ip-n">%s</th></tr></thead><tbody>%s</tbody></table>',
         t->>'produto', t->>'un', (select string_agg('<th class="ip-n">' || r || '</th>', '' order by o) from unnest(v_rot) with ordinality u(r, o)),
         t->>'var', coalesce(s, ''))
    || format('<p class="ip-nota">%s · %s</p>', public.precos_esc(t->>'em_rs'), public.precos_esc((t->>'var') || ': ' || v_rot[1] || ' → ' || v_rot[array_length(v_rot, 1)]))
    || E'\n:::';
  return next;

  -- ===================== 04 · Comparar fornecedores =====================
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
  select string_agg(format('<tr><td><b>%s</b><small>%s · %s %s</small></td><td class="ip-n"><b class="ip-bom">%s</b><small>%s</small></td><td class="ip-n">%s<small>%s</small></td><td class="ip-n"><span class="ip-var ip-gap">+%s%%</span></td><td class="ip-n ip-mut">%s</td></tr>',
      public.precos_esc(produto), un, public.precos_num(nf, L, 0), lower(t->>'nforn'),
      public.precos_num(p_bar, L, 2), public.precos_esc(left(f_bar, 32)),
      public.precos_num(p_car, L, 2), public.precos_esc(left(f_car, 32)),
      public.precos_num((p_car / nullif(p_bar, 0) - 1) * 100, L, 1), public.precos_num(compras, L, 0)), '' order by gasto desc)
    into s
  from (select * from r where p_car / nullif(p_bar, 0) <= 5 and p_car > p_bar * 1.005 order by gasto desc limit least(100, lim)) x;
  numero := 4; titulo := '04 · ' || (t->>'comparar');
  conteudo := E':::html\n' || public.precos_cab(4, t->>'comparar', t->>'h_comp', t->>'lead_comp', atualiz)
    || format('<table class="ip-tab"><thead><tr><th>%s</th><th class="ip-n">%s (R$)</th><th class="ip-n">%s (R$)</th><th class="ip-n">%s</th><th class="ip-n">%s</th></tr></thead><tbody>%s</tbody></table>',
         t->>'produto', t->>'barato', t->>'caro', t->>'dif', t->>'compras', coalesce(s, ''))
    || format('<p class="ip-nota">%s</p>', public.precos_esc(t->>'nota_comp')) || E'\n:::';
  return next;

  -- ===================== 05 · Fornecedores =====================
  select string_agg(format('<tr><td><b>%s</b><small>%s</small></td><td class="ip-n">%s</td><td class="ip-barra-c"><span class="ip-barra"><i style="width:%s%%"></i></span><span class="ip-n">%s</span></td><td class="ip-n">%s</td><td class="ip-n ip-mut">%s – %s</td></tr>',
      public.precos_esc(fornecedor), public.precos_chips(unidades), public.precos_num(notas, L, 0),
      greatest(round(100 * gasto / nullif(mx, 0), 1), 0.5), public.precos_num(gasto, L, 0), public.precos_num(produtos, L, 0),
      public.precos_dt_curta(de, L), public.precos_dt_curta(ate, L)), '' order by gasto desc nulls last)
    into s
  from (select n.fornecedor, string_agg(distinct public.precos_sigla(n.unidade), ' ') unidades, count(distinct n.id) notas,
          sum(i.valor_total) gasto, count(distinct i.produto) produtos, min(n.data_emissao) de, max(n.data_emissao) ate,
          max(sum(i.valor_total)) over () mx
        from precos_notas n join precos_itens i on i.nota_id = n.id group by n.fornecedor
        order by sum(i.valor_total) desc nulls last limit lim) x;
  numero := 5; titulo := '05 · ' || (t->>'fornecedores');
  conteudo := E':::html\n' || public.precos_cab(5, t->>'fornecedores', t->>'h_forn', t->>'lead_forn', atualiz)
    || format('<table class="ip-tab"><thead><tr><th>%s</th><th class="ip-n">%s</th><th class="ip-n">%s (R$)</th><th class="ip-n">%s</th><th class="ip-n">%s</th></tr></thead><tbody>%s</tbody></table>',
         t->>'fornecedor', t->>'notas', t->>'gasto', t->>'produtos', t->>'periodo_c', coalesce(s, ''))
    || E'\n:::';
  return next;

  -- ===================== 06+ · Catálogo por categoria =====================
  n := 6;
  for c in select categoria, sum(gasto) g, count(*) q from precos_produtos group by categoria order by sum(gasto) desc loop
    select string_agg(format('<tr><td><b>%s</b><small>%s %s</small></td><td>%s</td><td class="ip-n ip-mut">%s</td><td class="ip-n">%s</td><td class="ip-n">%s</td><td class="ip-n">%s</td><td class="ip-n"><b>%s</b><small>%s</small></td><td class="ip-fx"><span class="ip-faixa"><i style="left:%s%%"></i></span></td><td class="ip-n">%s</td></tr>',
        public.precos_esc(produto), public.precos_esc(left(ultimo_fornecedor, 34)), public.precos_chips(unidades), unidade_compra,
        public.precos_num(compras, L, 0), public.precos_num(menor, L, 2), public.precos_num(medio, L, 2), public.precos_num(maior, L, 2),
        public.precos_num(ultimo_preco, L, 2), public.precos_dt_curta(ultima_compra, L),
        case when maior > menor then round(100 * (ultimo_preco - menor) / (maior - menor)) else 50 end,
        case when compras > 1 then public.precos_selo((ultimo_preco / nullif(primeiro_preco, 0) - 1) * 100, L) else '<span class="ip-mut">–</span>' end),
        '' order by produto, unidade_compra)
      into s
    from (select * from precos_produtos where categoria = c.categoria order by produto, unidade_compra limit lim) x;
    numero := n;
    titulo := lpad(n::text, 2, '0') || ' · ' || (t->>'catalogo') || ' · ' || public.precos_categoria(c.categoria, L);
    conteudo := E':::html\n' || public.precos_cab(n, (t->>'catalogo') || ' · ' || public.precos_categoria(c.categoria, L),
        public.precos_categoria(c.categoria, L),
        public.precos_num(c.q, L, 0) || ' ' || (t->>'lead_cat'), (t->>'gasto') || ' ' || public.precos_curto(c.g, L))
      || format('<table class="ip-tab ip-cat"><thead><tr><th>%s</th><th>%s</th><th class="ip-n">%s</th><th class="ip-n">%s</th><th class="ip-n">%s</th><th class="ip-n">%s</th><th class="ip-n">%s</th><th title="%s">%s</th><th class="ip-n">%s</th></tr></thead><tbody>%s</tbody></table>',
           t->>'produto', t->>'un', t->>'compras', t->>'menor', t->>'medio', t->>'maior', t->>'ultimo', public.precos_esc(t->>'pos'), t->>'faixa', t->>'var', coalesce(s, ''))
      || E'\n:::';
    return next;
    n := n + 1;
  end loop;

  -- ===================== Método (último capítulo) =====================
  numero := n; titulo := lpad(n::text, 2, '0') || ' · ' || (t->>'metodo');
  conteudo := E':::html\n' || public.precos_cab(n, t->>'metodo', case L when 'en' then 'Method and how to use it' when 'pl' then 'Metoda i sposób użycia'
      when 'fr' then 'Méthode et mode d''emploi' when 'de' then 'Methode und Nutzung' else 'Método e como usar' end,
      case L when 'en' then 'Where the numbers come from, how they are calculated and how to query the database in future projects.'
        when 'pl' then 'Skąd pochodzą liczby, jak są liczone i jak korzystać z bazy w przyszłych projektach.'
        when 'fr' then 'D''où viennent les chiffres, comment ils sont calculés et comment interroger la base dans les futurs projets.'
        when 'de' then 'Woher die Zahlen kommen, wie sie berechnet werden und wie man die Datenbank in künftigen Projekten abfragt.'
        else 'De onde vêm os números, como são calculados e como consultar a base em projetos futuros.' end, atualiz)
    || '<dl class="ip-dl">' || case L
    when 'en' then '<dt>Source</dt><dd>Purchase invoices in Cicchetti Management, copied every minute into the Brasico database (tables precos_notas and precos_itens). Supplier tax IDs are removed.</dd><dt>Effective price</dt><dd>(Item total − discount + freight) ÷ quantity, in the purchase unit on the invoice (KG, UN, CX…). Only compare items in the same unit.</dd><dt>Product</dt><dd>The item description standardised (capitals, no extra spaces). The same product from two suppliers is only matched when the description is identical.</dd><dt>Sites</dt><dd><span class="ip-u ip-mw">MW</span> Midway Mall · <span class="ip-u ip-pc">PC</span> Pipa Centro · <span class="ip-u ip-pp">PP</span> Produção Pipa. Each site is a separate database: spend is always shown per site.</dd><dt>Price index</dt><dd>Chained monthly index: each month compares the items bought in that month and in the previous one, weighted by the previous month''s spend.</dd><dt>Future projects</dt><dd>Ask your Claude, e.g. “look up the price of mozzarella in the Price Index”: the <code>precos_consultar</code> tool returns the summary per product and every purchase. In the database: views <code>precos_historico</code> and <code>precos_produtos</code>.</dd><dt>Updates</dt><dd>Recomputed from the database every day at 6am. Never edit by hand: fix the invoice in Cicchetti Management.</dd>'
    when 'pl' then '<dt>Źródło</dt><dd>Faktury zakupowe w Cicchetti Management, kopiowane co minutę do bazy Brasico (tabele precos_notas i precos_itens). Numery identyfikacyjne dostawców są usuwane.</dd><dt>Cena efektywna</dt><dd>(Wartość pozycji − rabat + transport) ÷ ilość, w jednostce zakupu z faktury (KG, UN, CX…). Porównuj tylko pozycje w tej samej jednostce.</dd><dt>Produkt</dt><dd>Ujednolicony opis pozycji (wielkie litery, bez zbędnych spacji). Ten sam produkt od dwóch dostawców łączy się tylko przy identycznym opisie.</dd><dt>Lokale</dt><dd><span class="ip-u ip-mw">MW</span> Midway Mall · <span class="ip-u ip-pc">PC</span> Pipa Centro · <span class="ip-u ip-pp">PP</span> Produção Pipa. Każdy lokal to osobna baza: wydatki zawsze pokazujemy osobno.</dd><dt>Indeks cen</dt><dd>Miesięczny indeks łańcuchowy: każdy miesiąc porównuje pozycje kupione w nim i w poprzednim miesiącu, ważone wydatkami z poprzedniego miesiąca.</dd><dt>Przyszłe projekty</dt><dd>Poproś swojego Claude, np. „sprawdź cenę mozzarelli w Indeksie Cen”: narzędzie <code>precos_consultar</code> zwraca podsumowanie produktu i wszystkie zakupy. W bazie: widoki <code>precos_historico</code> i <code>precos_produtos</code>.</dd><dt>Aktualizacja</dt><dd>Przeliczane z bazy codziennie o 6:00. Nie poprawiaj ręcznie: popraw fakturę w Cicchetti Management.</dd>'
    when 'fr' then '<dt>Source</dt><dd>Factures d''achat dans Cicchetti Management, copiées chaque minute dans la base Brasico (tables precos_notas et precos_itens). Les numéros fiscaux des fournisseurs sont retirés.</dd><dt>Prix effectif</dt><dd>(Total de l''article − remise + transport) ÷ quantité, dans l''unité d''achat de la facture (KG, UN, CX…). Ne comparez que des articles dans la même unité.</dd><dt>Produit</dt><dd>La description de l''article standardisée (majuscules, sans espaces en trop). Un même produit chez deux fournisseurs n''est rapproché que si la description est identique.</dd><dt>Sites</dt><dd><span class="ip-u ip-mw">MW</span> Midway Mall · <span class="ip-u ip-pc">PC</span> Pipa Centro · <span class="ip-u ip-pp">PP</span> Produção Pipa. Chaque site est une base distincte : les dépenses sont toujours montrées par site.</dd><dt>Indice des prix</dt><dd>Indice mensuel chaîné : chaque mois compare les articles achetés ce mois-là et le mois précédent, pondérés par les dépenses du mois précédent.</dd><dt>Futurs projets</dt><dd>Demandez à votre Claude, par ex. « cherche le prix de la mozzarella dans l''Indice des Prix » : l''outil <code>precos_consultar</code> renvoie le résumé par produit et tous les achats. Dans la base : vues <code>precos_historico</code> et <code>precos_produtos</code>.</dd><dt>Mise à jour</dt><dd>Recalculé depuis la base chaque jour à 6 h. Ne modifiez jamais à la main : corrigez la facture dans Cicchetti Management.</dd>'
    when 'de' then '<dt>Quelle</dt><dd>Einkaufsrechnungen im Cicchetti Management, jede Minute in die Brasico-Datenbank kopiert (Tabellen precos_notas und precos_itens). Steuernummern der Lieferanten werden entfernt.</dd><dt>Effektiver Preis</dt><dd>(Positionssumme − Rabatt + Fracht) ÷ Menge, in der Einkaufseinheit der Rechnung (KG, UN, CX…). Nur Positionen in derselben Einheit vergleichen.</dd><dt>Produkt</dt><dd>Die vereinheitlichte Positionsbeschreibung (Großbuchstaben, ohne doppelte Leerzeichen). Dasselbe Produkt von zwei Lieferanten wird nur bei identischer Beschreibung zusammengeführt.</dd><dt>Standorte</dt><dd><span class="ip-u ip-mw">MW</span> Midway Mall · <span class="ip-u ip-pc">PC</span> Pipa Centro · <span class="ip-u ip-pp">PP</span> Produção Pipa. Jeder Standort ist eine eigene Datenbank: Ausgaben werden immer pro Standort gezeigt.</dd><dt>Preisindex</dt><dd>Monatlicher Kettenindex: Jeder Monat vergleicht die in diesem und im Vormonat gekauften Positionen, gewichtet mit den Ausgaben des Vormonats.</dd><dt>Künftige Projekte</dt><dd>Fragen Sie Ihren Claude, z. B. „Suche den Preis für Mozzarella im Preisindex“: Das Werkzeug <code>precos_consultar</code> liefert die Zusammenfassung pro Produkt und alle Käufe. In der Datenbank: Ansichten <code>precos_historico</code> und <code>precos_produtos</code>.</dd><dt>Aktualisierung</dt><dd>Täglich um 6 Uhr aus der Datenbank neu berechnet. Nie von Hand ändern: Rechnung im Cicchetti Management korrigieren.</dd>'
    else '<dt>Fonte</dt><dd>Notas de compra do Cicchetti Management, copiadas a cada minuto para o banco do Brasico (tabelas precos_notas e precos_itens). O CNPJ dos fornecedores é retirado.</dd><dt>Preço efetivo</dt><dd>(Total do item − desconto + frete) ÷ quantidade, na unidade de compra da nota (KG, UN, CX…). Só compare itens na mesma unidade.</dd><dt>Produto</dt><dd>A descrição do item padronizada (maiúsculas, sem espaços a mais). O mesmo produto de dois fornecedores só se junta quando a descrição é igual.</dd><dt>Unidades</dt><dd><span class="ip-u ip-mw">MW</span> Midway Mall · <span class="ip-u ip-pc">PC</span> Pipa Centro · <span class="ip-u ip-pp">PP</span> Produção Pipa. Cada unidade é uma base separada: o gasto aparece sempre por unidade.</dd><dt>Índice de preços</dt><dd>Índice mensal encadeado: cada mês compara os itens comprados nele e no mês anterior, com peso pelo gasto do mês anterior.</dd><dt>Projetos futuros</dt><dd>Peça ao seu Claude, por exemplo “veja o preço da mussarela no Índice de Preços”: a ferramenta <code>precos_consultar</code> devolve o resumo por produto e todas as compras. No banco: views <code>precos_historico</code> e <code>precos_produtos</code>.</dd><dt>Atualização</dt><dd>Recalculado da base todo dia às 6h. Nunca edite à mão: corrija a nota no Cicchetti Management.</dd>'
    end || E'</dl>\n:::';
  return next;
end $$;
revoke execute on function public.precos_capitulos(text, int) from public, anon, authenticated;

-- Grava os capítulos no projeto (só o que mudou) e arquiva os que sobrarem. Devolve o que fez.
create or replace function public.precos_publicar(p_ws uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  r record; v_id uuid; v_dono uuid; v_criados int := 0; v_atualizados int := 0; v_arquivados int := 0; v_nums text[] := '{}';
begin
  select created_by into v_dono from workspaces where id = p_ws and removido_em is null;
  if v_dono is null then raise exception 'Projeto % não encontrado.', p_ws; end if;

  drop table if exists _ip_caps;
  create temp table _ip_caps on commit drop as
  select pt.numero, pt.titulo t_pt, pt.conteudo c_pt, en.titulo t_en, en.conteudo c_en, pl.titulo t_pl, pl.conteudo c_pl,
         fr.titulo t_fr, fr.conteudo c_fr, de.titulo t_de, de.conteudo c_de
  from public.precos_capitulos('pt') pt
    join public.precos_capitulos('en') en using (numero) join public.precos_capitulos('pl') pl using (numero)
    join public.precos_capitulos('fr') fr using (numero) join public.precos_capitulos('de') de using (numero);

  for r in select * from _ip_caps order by numero loop
    v_nums := v_nums || lpad(r.numero::text, 2, '0');
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
  drop table _ip_caps;

  -- Capítulo com número que não existe mais (ex.: uma categoria sumiu): sai do documento, sem apagar
  update notes set archived_at = now()
  where workspace_id = p_ws and archived_at is null and not (split_part(title, ' · ', 1) = any (v_nums));
  get diagnostics v_arquivados = row_count;
  return jsonb_build_object('criados', v_criados, 'atualizados', v_atualizados, 'arquivados', v_arquivados);
end $$;
revoke execute on function public.precos_publicar(uuid) from public, anon, authenticated;

-- Agenda: atualiza o projeto todo dia às 6h de Fortaleza (9h UTC)
select cron.unschedule('precos-projeto') where exists (select 1 from cron.job where jobname = 'precos-projeto');
select cron.schedule('precos-projeto', '0 9 * * *', $job$ select public.precos_publicar('b65dc4e3-d23e-4079-ae83-fd9b1cf9bf90') $job$);
