// Busca na Evolution o nome e a foto de cada conversa do número da Brasico e guarda a foto no
// bucket privado "whatsapp" (fotos/<conversa>.jpg), porque o link do WhatsApp expira em poucas semanas.
// Também traz todos os grupos em que o número está, mesmo os que ainda não têm mensagem.
// Chamada pelo webhook quando aparece conversa nova (corpo { ids: [...] }) e pelo pg_cron uma vez por
// dia (corpo vazio: todas). Autenticação: cabeçalho x-segredo = wa_segredo do Vault.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const BUCKET = "whatsapp";
const INSTANCIA = "brasico";

type Json = Record<string, any>;
type Conversa = { id: string; tipo: string; nome: string; foto: string; foto_arquivo: string };

const ehGrupo = (jid: string) => jid.endsWith("@g.us");
const seguro = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");

// Roda as tarefas de poucas em poucas, para não sobrecarregar a Evolution
async function emLotes<T>(itens: T[], tamanho: number, fazer: (item: T) => Promise<void>) {
  const fila = [...itens];
  await Promise.all(
    Array.from({ length: tamanho }, async () => {
      for (let i = fila.shift(); i !== undefined; i = fila.shift()) {
        try {
          await fazer(i);
        } catch (e) {
          console.error(e);
        }
      }
    }),
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const { data: valido } = await supabase.rpc("wa_conferir_segredo", { p_segredo: req.headers.get("x-segredo") ?? "" });
  if (!valido) return new Response("Não autorizado", { status: 401 });

  const corpo = await req.json().catch(() => ({}));
  const so: string[] | null = Array.isArray(corpo.ids) && corpo.ids.length ? corpo.ids.map(String) : null;

  const { data: evo } = await supabase.rpc("wa_evolution").maybeSingle<{ url: string; chave: string }>();
  if (!evo?.url || !evo?.chave) return new Response("Falta configurar a Evolution no Vault", { status: 503 });
  const base = evo.url.replace(/\/$/, "");
  const cab = { apikey: evo.chave, "Content-Type": "application/json" };

  // 1. Grupos: nome, descrição e link da foto de todos de uma vez
  const fotoDoGrupo = new Map<string, string>();
  const r = await fetch(`${base}/group/fetchAllGroups/${INSTANCIA}?getParticipants=false`, { headers: cab });
  if (r.ok) {
    const grupos = ((await r.json()) as Json[]).filter((g) => typeof g.id === "string" && ehGrupo(g.id));
    const linhas = grupos
      .filter((g) => !so || so.includes(g.id))
      .map((g) => {
        if (typeof g.pictureUrl === "string" && g.pictureUrl) fotoDoGrupo.set(g.id, g.pictureUrl);
        const l: Json = { id: g.id, tipo: "grupo" };
        if (typeof g.subject === "string" && g.subject) l.nome = g.subject;
        if (typeof g.desc === "string") l.descricao = g.desc;
        return l;
      });
    // Mesmo formato no lote (o PostgREST exige): com e sem nome
    for (const lote of [linhas.filter((l) => "nome" in l && "descricao" in l), linhas.filter((l) => "nome" in l && !("descricao" in l))])
      if (lote.length) await supabase.from("wa_grupos").upsert(lote, { onConflict: "id", defaultToNull: false });
  }

  // 2. Conversas a atualizar
  let q = supabase.from("wa_grupos").select("id,tipo,nome,foto,foto_arquivo");
  if (so) q = q.in("id", so);
  const { data } = await q;
  const conversas = (data ?? []) as Conversa[];

  let guardadas = 0;
  let semFoto = 0;
  await emLotes(conversas, 5, async (c) => {
    // Link atual da foto: grupos já vieram acima; contatos, um por um
    let link = fotoDoGrupo.get(c.id) ?? "";
    if (!ehGrupo(c.id)) {
      const p = await fetch(`${base}/chat/fetchProfilePictureUrl/${INSTANCIA}`, {
        method: "POST",
        headers: cab,
        body: JSON.stringify({ number: c.id }),
      });
      if (p.ok) link = String((await p.json())?.profilePictureUrl ?? "");
    }
    const agora = new Date().toISOString();
    if (!link) {
      // Sem foto no WhatsApp (ou escondida pela privacidade): fica com as iniciais
      semFoto++;
      await supabase.from("wa_grupos").update({ foto: "", foto_arquivo: "", foto_em: agora }).eq("id", c.id);
      return;
    }
    const img = await fetch(link);
    if (!img.ok) return;
    const bytes = new Uint8Array(await img.arrayBuffer());
    const caminho = `fotos/${seguro(c.id)}.jpg`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(caminho, bytes, { contentType: img.headers.get("content-type") ?? "image/jpeg", upsert: true });
    if (error) {
      console.error("foto", c.id, error.message);
      return;
    }
    guardadas++;
    await supabase.from("wa_grupos").update({ foto: link, foto_arquivo: caminho, foto_em: agora }).eq("id", c.id);
  });

  return Response.json({ conversas: conversas.length, fotos_guardadas: guardadas, sem_foto: semFoto });
});
