# Brasico

Central de projetos onde a equipe conecta o próprio Claude. Os Claudes criam e editam; o site mostra cada projeto como um **documento no visual de uma proposta**, em modo Página ou PDF, atualizando ao vivo.

| Camada | Serviço | Onde |
|---|---|---|
| Código | GitHub | `k4liel/brasico-site` (público) |
| Banco, login, arquivos | Supabase | projeto **Brasico** (`doajznzouxxqbqkvsclv`) |
| Site | Vercel | projeto **brasico** → https://brasico.vercel.app |
| IA | Claude | conector MCP em `/api/mcp` |

Tecnologia: Next.js 15 (App Router) · React 19 · TypeScript · Supabase (Postgres + RLS + Realtime + Storage) · MCP.

> **Este repositório é público.** Aqui fica só o código do site. Conteúdo dos projetos, dados de clientes e arquivos (PDFs, planilhas, documentos) ficam no Supabase, protegidos por login.

---

## Como trabalhamos

| O que mudar | Por onde | Quando aparece |
|---|---|---|
| Conteúdo, visual e estrutura de um projeto | Conector **Brasico** no Claude | Na hora, sem mexer no código |
| Funções novas do site | Código neste repositório, branch `main` | ~1 min depois do push (a Vercel publica sozinha) |
| Arquivos de clientes (PDFs, planilhas, documentos) | Bucket privado `workspace-files`, pasta `<projeto>/<pasta>/` | Na hora |

### Regras para os dois Claudes
- **Antes de mudar código:** baixar a versão mais nova (`git pull`), fazer mudanças pequenas, enviar para a `main` e acompanhar o deploy na Vercel até ficar pronto.
- **Antes de mudar um capítulo:** ler o capítulo. Antes de uma mudança grande: olhar **Mudanças** no projeto. Antes de reestruturar: mostrar o plano.
- **Nunca no GitHub:** arquivos de clientes, propostas, dados de banco (`seed`), senhas, chaves. O `.gitignore` já bloqueia `privado/`, `*.pdf`, `supabase/seed_*.sql` e `.env*`.
- **Nunca** usar a chave `service_role` do Supabase, nem apagar dados do banco sem pedido explícito.

---

## Como usar o site

O site é só para **ver**. Quem cria, edita e organiza é o Claude de cada um.

1. **Entrar:** e-mail e senha (ou link por e-mail).
2. **Projetos:** a página inicial mostra os projetos, com quem mexeu por último.
3. **Dentro do projeto:** o documento em dois jeitos de ver — **Página** (largura da tela) ou **PDF** (folhas A4) — e os botões **Sumário** e **Mudanças**, que abrem painéis por cima e somem quando fechados. Atualiza sozinho quando qualquer Claude mexe.
4. **Claude e equipe:** cada pessoa gera o próprio link e cola no Claude em *Configurações → Conectores → Adicionar conector personalizado*. Um link vale para todos os projetos. Na mesma página, convide o sócio: quem está na equipe vê todos os projetos, inclusive os novos.

Exemplos de pedido ao Claude: “liste meus projetos no Brasico”, “crie o projeto Carnaval 2027 com capa e cardápio”, “no projeto X, refaça o capítulo de custos”.

### Formatação dos capítulos (o Claude já sabe)

A referência completa está em `lib/guia.ts` e chega ao Claude pela ferramenta `guia_formatacao`.

| Escreva | Vira |
|---|---|
| `**3 · RÉVEILLON**` na 1ª linha | Etiqueta dourada da seção |
| `# Título` / `## Subtítulo` / `### Bloco — R$ 1.000` | Títulos (o valor depois de — fica à direita) |
| tabela com `\|`; 1ª célula em **negrito** | Linha de total destacada |
| `*frase toda em itálico*` | Frase de abertura centralizada |
| `> texto` | Aviso em bege |
| `:::cards` … `:::` | Cartões de indicadores (`!` no início = azul) |
| `:::colunas` … `:::` | Duas colunas |
| `:::escala` … `:::` | Escala em quadradinhos coloridos |
| `:::checks` … `:::` | Checagens com ✓ ou ! |
| `:::arquivos` … `:::` | Biblioteca de PDFs do projeto (do bucket privado) |
| `:::capa` … `:::` | Capa azul-marinho |
| `:::html` … `:::` | HTML livre (sem scripts) |

O número no começo do título (`03 · Cardápio`) define a ordem. Cada projeto também pode ter CSS próprio (`ver_estilo` / `definir_estilo`).

---

## Ferramentas do Claude

| Ferramenta | O que faz |
|---|---|
| `listar_projetos`, `usar_projeto`, `criar_projeto`, `renomear_projeto` | Projetos |
| `ver_documento`, `definir_rodape`, `definir_abas` | Documento inteiro, rodapé e abas |
| `listar_notas`, `ler_nota`, `criar_nota`, `atualizar_nota` | Capítulos |
| `remover_capitulo`, `restaurar_capitulo` | Tirar/devolver capítulo (nada se perde) |
| `guia_formatacao`, `ver_estilo`, `definir_estilo` | Formatação e CSS do projeto |
| `resumo_espaco`, `listar_membros`, `ver_atividade` | Visão geral, equipe, histórico |

Tudo o que o Claude faz aparece em *Mudanças* com o selo **via Claude**.

---

## Segurança

- **RLS ativo** em todas as tabelas: só membros do projeto leem ou escrevem os dados.
- Arquivos no bucket **privado** `workspace-files`, entregues por `/api/arquivo/...` só para quem está logado e é da equipe do projeto.
- Os links do Claude são guardados só como hash (SHA-256). Trate cada link como uma senha e revogue se vazar.
- **Nenhuma chave secreta** no projeto: só a URL e a chave pública (`anon`) do Supabase, que são feitas para ficar no navegador. O conector do Claude acessa o banco só por funções `mcp_*` que validam o link.
- Recomendado: 2FA no GitHub, na Vercel e no Supabase.

---

## Desenvolvimento local

```bash
cp .env.example .env.local   # preencha com a URL e a chave pública do Supabase
npm install
npm run dev                  # http://localhost:3000
```

Cada push na branch `main` publica automaticamente na Vercel. O GitHub Actions roda checagem de tipos e build em cada push.

## Estrutura

```
app/                               páginas, rota do Claude (app/api/[transport]) e dos arquivos (app/api/arquivo)
components/                        telas do site
lib/                               Supabase, Markdown, blocos livres, guia de formatação
supabase/schema.sql                banco + segurança
supabase/mcp_functions.sql         funções do conector do Claude
supabase/*.sql                     demais mudanças já aplicadas no banco
docs/PASSO_A_PASSO.md              guia de operação
```
