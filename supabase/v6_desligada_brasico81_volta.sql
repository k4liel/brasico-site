-- Correção de 04/11/2026, a pedido do dono: a Brasico81 VOLTA ao grupo (a sócia dela é a Bresico64).
-- Continuam desligadas só a V6 (Cicchetti Midway) e as duas sócias externas dela, N&Bpar e Portokon.
-- As linhas da Brasico81 tiradas do acervo voltam a partir do projeto original "Organograma Fiscal Brasico".

-- 1) Cadastro fiscal
update public.fiscal_empresas set desligada_em = null, desligada_motivo = null,
  papel = 'Participação (era sócia da V6, desligada em 31/10/2026)',
  observacao = 'Sociedade de participação do grupo (sócia: Bresico64) no Lucro Presumido: ECF, ECD e DCTFWeb todo ano. Era a sócia do grupo na V6 (Cicchetti Midway), desligada em 31/10/2026: conferir com o contador como ficou essa participação.'
where raiz = '57602760';
update public.fiscal_empresas set desligada_motivo = 'Desligada com o encerramento do Cicchetti Midway: o grupo encerrou todas as conexões com a V6 e com as sócias externas dela (N&Bpar e Portokon).'
where raiz in ('58076145', '57178958', '53802704');
update public.fiscal_empresas set observacao = 'Risco de exclusão do Simples (LC 123, art. 3º, §4º, IV e V): o sócio único tem 10% da Brasico77 e administra a Brasico81 e a Brasico1010, no Lucro Presumido. Até 31/10/2026 administrava também a V6 (Cicchetti Midway), hoje desligada do grupo: esse período ainda conta na análise. Levar ao contador.'
where cnpj = '50639716000101';

-- 2) Acervo: devolve as linhas da Brasico81 (todos os idiomas), copiadas do projeto original
do $$
declare
  r record; o record; l text; c text; orig text; linha text; ancora text;
begin
  for r in select a.id, a.titulo from public.receita_acervo a
           where a.substituido_por is null and a.titulo in ('01 · Mapa societário') loop
    select * into o from public.notes n
      where n.workspace_id = '9c2048a6-37c5-4c3d-ad9b-2bb444eb6fb2' and n.title = r.titulo and n.archived_at is null limit 1;
    continue when o.id is null;
    foreach l in array array['pt', 'en', 'pl', 'fr', 'de'] loop
      execute format('select %I from public.receita_acervo where id = $1', case l when 'pt' then 'conteudo' else 'conteudo_' || l end) into c using r.id;
      orig := case l when 'pt' then o.content when 'en' then o.content_en when 'pl' then o.content_pl when 'fr' then o.content_fr else o.content_de end;
      continue when c is null or orig is null;
      -- nó do organograma, depois do nó da FIF
      -- (inserção por texto simples: replace() não interpreta \ nem &)
      linha := substring(orig from '[^\n]*<div class="of-node"><span class="of-code">[A-Z]+</span><b>Brasico81 [^<]*</b>[^\n]*\n');
      ancora := substring(c from '[^\n]*<b>FIF Ltda</b>[^\n]*\n');
      if linha is not null and ancora is not null and position(linha in c) = 0 then
        c := replace(c, ancora, ancora || linha);
      end if;
      -- linha da tabela de inscrições, depois da FIF
      linha := substring(orig from '[^\n]*<tr><td>57\.602\.760/0001-96</td>[^\n]*\n');
      ancora := substring(c from '[^\n]*<tr><td>40\.818\.708/0001-79</td>[^\n]*\n');
      if linha is not null and ancora is not null and position(linha in c) = 0 then
        c := replace(c, ancora, ancora || linha);
      end if;
      -- quem administra, antes da Brasico1010
      linha := substring(orig from '[^\n]*<tr><td>Brasico81</td>[^\n]*\n');
      ancora := substring(c from '[^\n]*<tr><td>Brasico1010</td>[^\n]*\n');
      if linha is not null and ancora is not null and position(linha in c) = 0 then
        c := replace(c, ancora, linha || ancora);
      end if;
      execute format('update public.receita_acervo set %I = $1 where id = $2', case l when 'pt' then 'conteudo' else 'conteudo_' || l end) using c, r.id;
    end loop;
  end loop;
end $$;

-- 3) Textos em português
update public.receita_acervo set conteudo = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(conteudo,
  'administra a Brasico1010, no Lucro Presumido. Até 31/10/2026 administrava também a Brasico81 e a V6 (Cicchetti Midway, R$ 4,43 milhões em 12 meses na TOTVS), hoje desligadas do grupo; esse período ainda conta na análise.',
  'administra a Brasico81 e a Brasico1010, no Lucro Presumido. Até 31/10/2026 administrava também a V6 (Cicchetti Midway, R$ 4,43 milhões em 12 meses na TOTVS), hoje desligada do grupo; esse período ainda conta na análise.'),
  'administra a Brasico1010, no Lucro Presumido (até 31/10/2026 também a Brasico81 e a V6, hoje desligadas do grupo). A Lei',
  'administra a Brasico81 e a Brasico1010, no Lucro Presumido (até 31/10/2026 também a V6, hoje desligada do grupo). A Lei'),
  'administra a Brasico1010 (e, até 31/10/2026, a Brasico81 e a V6, hoje desligadas)',
  'administra a Brasico81 e a Brasico1010 (e, até 31/10/2026, a V6, hoje desligada)'),
  'o mesmo que administra a Brasico1010 (e administrava a Brasico81 e a V6 até o desligamento, em 31/10/2026).',
  'o mesmo que administra a Brasico81 e a Brasico1010 (e administrava a V6 até o desligamento, em 31/10/2026).'),
  'sócia da FIF, do Hotel Filho do Vento e da Brasico1010', 'sócia da FIF, do Hotel Filho do Vento, da Brasico81 e da Brasico1010'),
  'Bresico64 e FIF estão no Lucro Presumido', 'Bresico64, FIF e Brasico81 estão no Lucro Presumido'),
  '<span>Sociedade de participação → sócia da V6 (Cicchetti Midway)</span>', '<span>Sociedade de participação → era sócia da V6 (Cicchetti Midway), desligada do grupo em 31/10/2026</span>'),
  '10 raízes de CNPJ e 11 inscrições. Empresas e filiais já baixadas ficaram de fora, e a V6 e as sócias dela, desligadas em 31/10/2026, estão no capítulo “Empresas desligadas”.',
  '11 raízes de CNPJ e 12 inscrições. Empresas e filiais já baixadas ficaram de fora, e a V6 e as duas sócias externas dela, desligadas em 31/10/2026, estão no capítulo “Empresas desligadas”.'),
  '## As 11 inscrições ativas', '## As 12 inscrições ativas'),
  'O mapa completo das 11 inscrições ativas', 'O mapa completo das 12 inscrições ativas')
where substituido_por is null;
update public.receita_acervo set conteudo = replace(conteudo, '<td>Participação (sócia da V6)</td>', '<td>Participação (era sócia da V6, desligada em 31/10/2026)</td>')
where substituido_por is null and titulo = '01 · Mapa societário';

-- 4) Capítulo das desligadas: sem a Brasico81
update public.receita_acervo set conteudo = replace(replace(replace(replace(regexp_replace(conteudo,
    '[^\n]*<tr><td>57\.602\.760/0001-96</td>[^\n]*\n', '', 'g'),
  'e as três sócias dela foram desligadas do grupo', 'e as duas sócias externas dela (N&Bpar e Portokon) foram desligadas do grupo'),
  '## As quatro inscrições desligadas', '## As três inscrições desligadas'),
  'Até 31/10/2026 o sócio da LAIF administrava a Brasico81 e a V6, no Lucro Presumido,', 'Até 31/10/2026 o sócio da LAIF administrava a V6, no Lucro Presumido,'),
  '<b>Conferir a saída nos contratos</b><span>No cadastro de 26/10/2026 a Bresico64 ainda aparecia como sócia da Brasico81. Confirmar com o contador que a saída do grupo foi registrada na Junta Comercial.</span>',
  '<b>A Brasico81 continua no grupo</b><span>A Brasico81 (sócia: Bresico64) era a sócia do grupo na V6. Ela segue no grupo; conferir com o contador como ficou a participação dela na V6 depois do desligamento.</span>')
where substituido_por is null and titulo = '01 · Empresas desligadas';
