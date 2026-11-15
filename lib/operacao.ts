// Guia da Operação dos hotéis (supabase/operacao_hoteis.sql e operacao_hoteis_trava.sql), lido pelo Claude
// pelo conector (operacao_guia). A ponte das telas (window.brasico) fica em components/hotel/Operacao.tsx.
export const HOTEIS_OPERACAO = ["filha-da-lua", "sempre-vivo"] as const;

export const GUIA_OPERACAO = `# Operação dos hotéis — área de criação

Cada hotel (filha-da-lua, sempre-vivo) tem uma área livre para criar os sistemas do dia a dia: recepção,
governança, CRM, manutenção, o que for. Você cria tabelas, funções e telas inteiras só por este conector.
Toda ferramenta pede o hotel. Só funciona para quem tem a área "Operação do <hotel>" como Editar.

## O banco do hotel
- Seu schema: op_filha_da_lua (ou op_sempre_vivo). Tudo o que você cria vai para lá (não precisa escrever o schema).
- Dados do PMS, só leitura, já filtrados para o hotel: op_filha_da_lua_dados.<visão> — quartos, reservas,
  hospedes, reserva_hospedes, reserva_detalhes, reserva_historico, bloqueios, dias, meses, previsao,
  transacoes, agora, tipos_uh. Veja as colunas com operacao_dados. São dados pessoais de hóspedes (LGPD):
  use só o necessário.
- Rode SQL com operacao_sql (pode mandar vários comandos separados por ;). Pode: CREATE/ALTER/DROP de tabelas,
  visões, índices, tipos, sequências, funções e procedimentos (sql ou plpgsql), gatilhos; SELECT, INSERT,
  UPDATE, DELETE, MERGE, TRUNCATE, CALL.
- Não pode (o banco recusa e desfaz): o schema net, mudar search_path, set_config, EXECUTE dentro de funções
  (SQL montado na hora), SET próprio em função, DO, COPY, comandos de transação ou sessão, GRANT/REVOKE,
  trocar dono, extensões, schemas, papéis, políticas, regras, CREATE TABLE ... AS (crie a tabela e use
  INSERT ... SELECT). O resto do Brasico não existe para você.
- Tudo o que você roda fica registrado com o seu nome. Não há lixeira no seu schema: antes de DROP, confira.

## Funções para as telas (api_*)
- A tela só chama funções do seu schema cujo nome começa com api_, que recebem um jsonb e devolvem jsonb:
    create function api_quartos(p jsonb) returns jsonb language sql as $$ select coalesce(jsonb_agg(...), '[]') from ... $$;
- Dentro delas, eu() devolve quem está usando a tela: {"id", "nome", "nivel"} (nivel "ver" ou "editar").
  Quem só vê roda em modo só leitura: qualquer gravação dá erro para essa pessoa.
- Teste antes com operacao_testar (roda como você).

## Telas
- Uma tela é um documento HTML completo (HTML + CSS + JavaScript; pode usar bibliotecas de CDN como
  cdn.jsdelivr.net). Ela roda numa caixa isolada dentro da página do hotel: não vê a sessão do usuário nem o
  resto do site.
- A ponte com o banco é window.brasico (já vem pronta na tela):
    await brasico.chamar("api_quartos", { ... })   // chama a função api_quartos com o jsonb
    await brasico.eu()                              // { id, nome, nivel }
    brasico.abrir("outra-tela")                     // abre outra tela da Operação do hotel
    brasico.hotel                                   // "filha-da-lua"
    brasico.tema                                    // "claro" ou "escuro" (o tema do site)
- Visual: siga o Brasico (azul-marinho #1c2a48, dourado #b8925a, fundo claro #f7f5f0 e escuro #12161f,
  títulos com fonte serifada). A tela ocupa a largura da página e cresce na altura sozinha.
- Tudo fica DENTRO da Operação do hotel. Cada sistema ou página nova (CRM, governança, recepção, relatórios…)
  é uma TELA nova com slug próprio: aparece no site como subpágina da Operação (menu Hotéis → hotel → Operação →
  a tela) e em /hoteis/<hotel>/operacao/<slug>. Não existe outro lugar do site para criar páginas.
- operacao_salvar_pagina guarda como RASCUNHO (slug, título, descrição, ícone em uma palavra, ordem). A
  equipe só vê depois de operacao_publicar. Quem edita vê o rascunho em /hoteis/<hotel>/operacao/<slug>?rascunho=1.
- Toda versão salva e publicada fica no histórico. operacao_arquivar_pagina tira a tela do menu (nada se apaga).

## Jeito de trabalhar
1. operacao_dados para ver o que existe. 2. Crie as tabelas e as funções api_*. 3. Teste as funções.
4. Salve a tela como rascunho, peça para a pessoa olhar no site e só então publique.
`;
