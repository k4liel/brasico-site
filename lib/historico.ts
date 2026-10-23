// Até out/2026, cada mudança feita pelo conector gerava duas linhas no histórico:
// uma "web" sem usuário (do gatilho) e outra "claude" com o usuário.
// O banco já não grava mais a primeira; aqui escondemos as antigas.
type Linha = { user_id: string | null; source: string; entity_id: string | null; created_at: string };

// Gravar a tradução de um capítulo ("06 · Orçamento (alemão)") é feito sempre no fim e não é edição do
// conteúdo: não aparece em Mudanças nem conta como última edição
const TRADUCAO = /\((inglês|polonês|francês|alemão)\)$/;
export const ehTraducao = (l: { details?: string | null }) => TRADUCAO.test(l.details ?? "");

export function semDuplicatas<T extends Linha>(linhas: T[]): T[] {
  const doClaude = new Set(
    linhas.filter((l) => l.source === "claude").map((l) => `${l.entity_id}|${l.created_at}`),
  );
  return linhas.filter(
    (l) => !(l.source === "web" && !l.user_id && doClaude.has(`${l.entity_id}|${l.created_at}`)),
  );
}
