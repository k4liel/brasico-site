// Guia completo de formatação, entregue ao Claude pela ferramenta guia_formatacao.
export const GUIA_FORMATACAO = `
GUIA DE FORMATAÇÃO DO BRASICO

Cada projeto é um documento. Cada capítulo é uma nota em Markdown. O número no começo do título define a ordem: "00 · Capa", "01 · Resumo", "02 · Cardápio"...
O site mostra o documento em dois modos: Página (largura da tela) e PDF (folhas A4). Os dois usam o mesmo conteúdo.

1) MARKDOWN COM BLOCOS PRONTOS
- 1ª linha **N · SEÇÃO** → etiqueta dourada da seção
- # Título, ## Subtítulo, ### BLOCO — R$ 1.000 (o valor depois de — vai para a direita)
- Linha toda em *itálico* → frase de abertura centralizada
- > texto → aviso em bege
- Tabelas com | ... |; se a 1ª célula da linha estiver em **negrito**, vira linha de total
- Lista "- **Nome** — descrição" → item com nome em negrito e descrição abaixo
- :::capa ... ::: → capa azul. Linhas: marca:, sobretitulo:, titulo: (use | para quebrar a linha), subtitulo:, info: Rótulo | Valor (várias), lema:
- :::cards ... ::: → cartões. Linha: Rótulo | Valor | Descrição (comece com ! para o cartão azul)
- :::colunas ... ::: → duas colunas (cardápios, listas longas)
- :::escala ... ::: → escala em quadradinhos (titulo:, dias: Dom 01 | Seg 02 | ..., ## grupo, linhas Nome | F/M | 08-17 | F | - ...; intervalo opcional entre parênteses, como 08-17 (12-13), que aparece ao passar o mouse)
- :::checks ... ::: → checagens: ok ou alerta | título | detalhe

2) HTML LIVRE (qualquer estrutura)
Quando os blocos prontos não bastarem, use um bloco :::html com HTML à vontade dentro do capítulo:

:::html
<div class="linha-tempo">
  <div class="etapa feito"><b>Out</b><span>Proposta</span></div>
  <div class="etapa"><b>Nov</b><span>Compras</span></div>
</div>
:::

Pode: div, span, p, títulos, listas, tabelas, img (https), a (links abrem em nova aba), details/summary, progress, e SVG (gráficos, ícones, diagramas: svg, path, rect, circle, line, polyline, polygon, text, g, linearGradient...).
Pode usar class e style em qualquer elemento.
Não pode (é removido): script, iframe, form/input, eventos (onclick...), links javascript:, imagens SVG externas.

3) CSS DO PROJETO (mudar o visual e a estrutura da página)
Use ver_estilo e definir_estilo. O CSS vale só dentro do documento deste projeto, nos dois modos.

Abas de capítulos (por projeto): definir_abas liga ou desliga. Ligado, o modo Página mostra um capítulo por vez, com abas numeradas pelo número no início do título e botões de anterior/próximo. Bom para projetos longos. O PDF sempre mostra tudo.

Arquivos (:::arquivos): biblioteca de PDFs privados do projeto. Os arquivos ficam no bucket privado workspace-files do Supabase, na pasta <projeto>/<pasta>/ (capas em <projeto>/<pasta>/capas/<arquivo>.jpg), e só abrem para quem é da equipe. Nunca coloque arquivos de clientes no GitHub. Linhas: base: /api/arquivo/<projeto>/<pasta> · estilo: capas | lista · depois CÓDIGO | Título | Descrição | arquivo (sem .pdf) | 4 páginas | interno ou restrito. Clicar abre o PDF numa janela por cima da página.
Classes úteis:
- .doc-pagina (modo Página), .secao (cada capítulo no modo Página), .secao-capa (capa no modo Página)
- .folha (cada página A4 no modo PDF), .folha-capa
- .rotulo, h1, h2, h3, .h3-valor, .abertura, table, tr.total, blockquote, .cards-doc, .card-doc, .card-doc.destaque, .colunas, .capa, .capa-titulo
- .bloco-livre (cada bloco :::html)
Variáveis de cor que podem ser trocadas: --doc-navy, --doc-gold, --doc-beige, --doc-ink, --doc-muted, --doc-total, --doc-line, --doc-heading, --doc-paper.
Exemplo:
  .doc-pagina, .folha { --doc-navy: #0f3d3e; --doc-gold: #c8963e; }
  .linha-tempo { display: flex; gap: 12px; }
  .linha-tempo .etapa { flex: 1; padding: 12px; border-top: 4px solid var(--doc-line); }
  .linha-tempo .etapa.feito { border-color: var(--doc-gold); }
Se uma regra não pegar, use um seletor mais específico (ex.: .doc-pagina .secao h1) ou !important.
O modo escuro troca as variáveis só no modo Página; prefira usar as variáveis em vez de cores fixas para funcionar nos dois temas.

4) VERSÃO EM INGLÊS
O português é o original. Cada capítulo pode ter também uma versão em inglês: atualizar_nota com idioma "en" (title = título em inglês, content = Markdown completo em inglês). O rodapé em inglês sai de definir_rodape com idioma "en". O site mostra o seletor PT | EN quando algum capítulo tem tradução; capítulo sem tradução aparece em português. Os textos fixos dos blocos (legenda da escala, "pág. X de Y", balão do intervalo) mudam sozinhos. Na tradução, mantenha a mesma estrutura de blocos, números e nomes de pessoas; em :::escala, traduza titulo:, dias: (Mon 01 | Tue 02 | …) e os ## grupos, sem mexer nas linhas das pessoas.

5) BOAS PRÁTICAS
- Leia o capítulo (ler_nota) antes de alterar e preserve o que não foi pedido.
- Ao mudar um número, refaça as contas que dependem dele em todos os capítulos (e na versão em inglês, se houver).
- Mudanças grandes de estrutura: mostre o plano antes e espere confirmação.
- Para tirar um capítulo use remover_capitulo (pode voltar com restaurar_capitulo).
`.trim();
