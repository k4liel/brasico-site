import { createMcpHandler } from "mcp-handler";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { GUIA_FORMATACAO } from "@/lib/guia";

export const maxDuration = 60;

// O conector usa apenas a chave PÚBLICA do Supabase. Toda leitura e gravação
// passa por funções do banco (supabase/mcp_functions.sql) que validam o link
// do Claude e restringem o acesso ao espaço daquele link.
function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

function buildHandler(token: string) {
  const supabase = db();

  async function call(fn: string, args: Record<string, unknown> = {}) {
    const { data, error } = await supabase.rpc(fn, { p_token: token, ...args });
    return text(error ? `Erro: ${error.message}` : data);
  }

  return createMcpHandler(
    (server) => {
      server.tool(
        "resumo_espaco",
        "Visão geral do projeto ativo: equipe, número de capítulos e mudanças recentes.",
        {},
        async () => call("mcp_resumo")
      );

      server.tool(
        "listar_membros",
        "Lista a equipe do projeto (user_id, e-mail, nome).",
        {},
        async () => call("mcp_membros")
      );

      // ---------- Projetos ----------
      server.tool(
        "listar_projetos",
        "Lista os projetos do Brasico e indica qual está ativo nesta conversa. Use primeiro, antes de ler ou editar.",
        {},
        async () => call("mcp_listar_projetos")
      );

      server.tool(
        "usar_projeto",
        "Escolhe o projeto em que você vai trabalhar (as demais ferramentas passam a agir nele). Use o id de listar_projetos.",
        { projeto_id: z.string().uuid() },
        async ({ projeto_id }) => call("mcp_usar_projeto", { p_projeto: projeto_id })
      );

      server.tool(
        "criar_projeto",
        "Cria um projeto novo (toda a equipe já passa a vê-lo) e passa a trabalhar nele. Depois crie os capítulos com criar_nota: \"00 · Capa\", \"01 · ...\", etc.",
        { nome: z.string().min(1), rodape: z.string().optional().describe("Texto do rodapé das páginas do documento") },
        async ({ nome, rodape }) => call("mcp_criar_projeto", { p_nome: nome, p_rodape: rodape ?? null })
      );

      server.tool(
        "renomear_projeto",
        "Muda o nome do projeto ativo.",
        { nome: z.string().min(1) },
        async ({ nome }) => call("mcp_renomear_projeto", { p_nome: nome })
      );

      server.tool(
        "ver_documento",
        "Mostra o documento completo do projeto ativo: todos os capítulos em ordem (id, título, conteúdo), o rodapé e os capítulos removidos.",
        {},
        async () => call("mcp_documento")
      );

      server.tool(
        "definir_rodape",
        "Define o texto do rodapé das páginas do documento do projeto ativo.",
        { rodape: z.string() },
        async ({ rodape }) => call("mcp_definir_rodape", { p_rodape: rodape })
      );

      // ---------- Notas ----------
      server.tool(
        "listar_notas",
        "Lista os capítulos do documento do projeto ativo (sem o conteúdo). Pode filtrar por texto.",
        { busca: z.string().optional() },
        async ({ busca }) => call("mcp_listar_notas", { p_busca: busca ?? null })
      );

      server.tool(
        "ler_nota",
        "Lê o conteúdo completo de um capítulo (Markdown).",
        { id: z.string().uuid() },
        async ({ id }) => call("mcp_ler_nota", { p_id: id })
      );

      server.tool(
        "criar_nota",
        "Cria um capítulo no documento do projeto ativo. Cada nota é um capítulo do documento; o número no início do título define a ordem (ex.: \"03 · Cardápio\"). Conteúdo em Markdown: 1ª linha **N · SEÇÃO** vira a etiqueta dourada; # Título; tabelas com | (1ª célula em negrito = linha de total); linha toda em *itálico* = frase de abertura; > aviso; blocos :::cards (Rótulo | Valor | Descrição, ! no início = cartão azul), :::colunas (duas colunas), :::capa (chaves marca, sobretitulo, titulo, subtitulo, info: Rótulo | Valor, lema), :::escala (grade de escala em quadradinhos coloridos: titulo: …; dias: Dom 01 | Seg 02 | …; ## grupo; linhas Nome | F/M | 08-17 | F | 09-13/17-21 | 19-07 | - …, onde F = folga e - = descanso) e :::checks (status ok ou alerta | título | detalhe), fechados com :::.",
        { title: z.string().min(1), content: z.string() },
        async ({ title, content }) => call("mcp_criar_nota", { p_title: title, p_content: content })
      );

      server.tool(
        "atualizar_nota",
        "Atualiza o título e/ou o conteúdo de um capítulo. O conteúdo enviado substitui o anterior (a versão antiga fica guardada; veja versoes_capitulo). Leia antes com ler_nota (ou ver_documento) e envie a 'versao' que veio na leitura: se outra pessoa mudou o capítulo depois disso, nada é gravado e você precisa ler de novo e juntar as mudanças. Cada nota é um capítulo do documento; o número no início do título define a ordem (ex.: \"03 · Cardápio\"). Conteúdo em Markdown: 1ª linha **N · SEÇÃO** vira a etiqueta dourada; # Título; tabelas com | (1ª célula em negrito = linha de total); linha toda em *itálico* = frase de abertura; > aviso; blocos :::cards (Rótulo | Valor | Descrição, ! no início = cartão azul), :::colunas (duas colunas), :::capa (chaves marca, sobretitulo, titulo, subtitulo, info: Rótulo | Valor, lema), :::escala (grade de escala em quadradinhos coloridos: titulo: …; dias: Dom 01 | Seg 02 | …; ## grupo; linhas Nome | F/M | 08-17 | F | 09-13/17-21 | 19-07 | - …, onde F = folga e - = descanso) e :::checks (status ok ou alerta | título | detalhe), fechados com :::.",
        {
          id: z.string().uuid(),
          versao: z.string().min(1).describe("O campo 'versao' que ler_nota ou ver_documento devolveu para este capítulo"),
          title: z.string().optional(),
          content: z.string().optional(),
        },
        async ({ id, versao, title, content }) =>
          call("mcp_atualizar_nota", { p_id: id, p_versao: versao, p_title: title ?? null, p_content: content ?? null })
      );

      server.tool(
        "versoes_capitulo",
        "Lista as versões anteriores de um capítulo (as 50 mais recentes): quando foram trocadas, por quem e o tamanho. Use para desfazer uma mudança errada.",
        { id: z.string().uuid() },
        async ({ id }) => call("mcp_listar_versoes", { p_ref: id })
      );

      server.tool(
        "versoes_estilo",
        "Lista as versões anteriores do CSS do projeto ativo.",
        {},
        async () => call("mcp_listar_versoes", { p_ref: null })
      );

      server.tool(
        "ler_versao",
        "Mostra o conteúdo de uma versão anterior (de versoes_capitulo ou versoes_estilo).",
        { versao_id: z.number().int() },
        async ({ versao_id }) => call("mcp_ler_versao", { p_versao: versao_id })
      );

      server.tool(
        "restaurar_versao",
        "Volta um capítulo (ou o CSS do projeto) para uma versão anterior. O estado atual também fica guardado, então dá para desfazer. Confirme com o usuário antes.",
        { versao_id: z.number().int() },
        async ({ versao_id }) => call("mcp_restaurar_versao", { p_versao: versao_id })
      );

      server.tool(
        "guia_formatacao",
        "Mostra o guia completo de formatação: blocos prontos, HTML livre (:::html) e CSS do projeto. Leia antes de criar ou reestruturar capítulos.",
        {},
        async () => text(GUIA_FORMATACAO)
      );

      server.tool(
        "ver_estilo",
        "Mostra o CSS próprio do projeto ativo (o visual e a estrutura da página deste projeto).",
        {},
        async () => call("mcp_ver_estilo")
      );

      server.tool(
        "definir_estilo",
        "Substitui o CSS próprio do projeto ativo. Vale só dentro do documento deste projeto, nos modos Página e PDF. Leia antes com ver_estilo e mande o CSS completo. Veja as classes em guia_formatacao. Envie vazio para voltar ao visual padrão.",
        { css: z.string() },
        async ({ css }) => call("mcp_definir_estilo", { p_css: css })
      );

      server.tool(
        "definir_abas",
        "Liga ou desliga as abas de capítulos no projeto ativo. Com abas, o modo Página mostra um capítulo por vez, com uma faixa de abas numeradas e botões de anterior/próximo; sem abas, o documento corre inteiro. Vale só para este projeto. O PDF continua sempre com o documento inteiro.",
        { ativar: z.boolean() },
        async ({ ativar }) => call("mcp_definir_abas", { p_ativar: ativar })
      );

      server.tool(
        "remover_capitulo",
        "Tira um capítulo do documento (fica guardado e pode voltar com restaurar_capitulo).",
        { id: z.string().uuid() },
        async ({ id }) => call("mcp_arquivar_capitulo", { p_id: id, p_remover: true })
      );

      server.tool(
        "restaurar_capitulo",
        "Devolve ao documento um capítulo removido (veja capitulos_removidos em ver_documento).",
        { id: z.string().uuid() },
        async ({ id }) => call("mcp_arquivar_capitulo", { p_id: id, p_remover: false })
      );

      // ---------- Atividade ----------
      server.tool(
        "ver_atividade",
        "Mostra quem mudou o quê no projeto ativo, do mais recente ao mais antigo.",
        { limite: z.number().int().min(1).max(300).optional() },
        async ({ limite }) => call("mcp_ver_atividade", { p_limite: limite ?? 50 })
      );
    },
    {
      instructions:
        "Brasico é a central de projetos compartilhada da equipe. Cada projeto é um documento (capítulos em Markdown) mostrado no site como página ou como PDF no visual de uma proposta, com o histórico de mudanças. Comece com listar_projetos e usar_projeto. Para ler tudo, use ver_documento. Edite capítulos com atualizar_nota (leia antes e envie a 'versao' lida), crie com criar_nota e tire com remover_capitulo. Os projetos são totalmente editáveis: além dos blocos prontos, cada capítulo aceita HTML livre em blocos :::html e cada projeto tem seu próprio CSS (ver_estilo / definir_estilo), então qualquer layout pode ser feito sem mudar o código do site. Antes de criar ou reestruturar, leia guia_formatacao. Tudo o que você muda aparece na hora para toda a equipe, com o selo 'via Claude'.\n\n" +
        "Regras da equipe (duas pessoas, cada uma com o próprio Claude, mexem nos mesmos projetos):\n" +
        "1. Sempre leia o capítulo antes de alterar. Se atualizar_nota disser que o capítulo mudou, leia de novo e junte as mudanças; nunca apague o trabalho do outro.\n" +
        "2. Antes de uma mudança grande, olhe ver_atividade para saber o que o outro fez há pouco.\n" +
        "3. Antes de reestruturar um projeto (renomear, reordenar, remover ou reescrever vários capítulos, trocar o CSS), mostre o plano ao usuário e espere a confirmação.\n" +
        "4. Errou? Toda mudança guarda a versão anterior: versoes_capitulo, ler_versao e restaurar_versao.\n" +
        "5. Arquivos de clientes (PDFs, planilhas, documentos) ficam só no bucket privado workspace-files do Supabase, na pasta <projeto>/<pasta>/, nunca no GitHub.",
    },
    { basePath: "/api", maxDuration: 60 }
  );
}

async function handle(req: Request) {
  const url = new URL(req.url);
  const token =
    url.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return new Response("Token ausente", { status: 401 });

  // Validação rápida antes de abrir a sessão MCP.
  const { error } = await db().rpc("mcp_listar_projetos", { p_token: token });
  if (error) return new Response("Token inválido ou revogado", { status: 401 });

  return buildHandler(token)(req);
}

export { handle as GET, handle as POST, handle as DELETE };
