// Até out/2026, cada mudança feita pelo conector gerava duas linhas no histórico:
// uma "web" sem usuário (do gatilho) e outra "claude" com o usuário.
// O banco já não grava mais a primeira; aqui escondemos as antigas.
type Linha = { user_id: string | null; source: string; entity_id: string | null; created_at: string };

export function semDuplicatas<T extends Linha>(linhas: T[]): T[] {
  const doClaude = new Set(
    linhas.filter((l) => l.source === "claude").map((l) => `${l.entity_id}|${l.created_at}`),
  );
  return linhas.filter(
    (l) => !(l.source === "web" && !l.user_id && doClaude.has(`${l.entity_id}|${l.created_at}`)),
  );
}
