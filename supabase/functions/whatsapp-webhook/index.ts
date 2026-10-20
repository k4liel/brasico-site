// Recebe os eventos da Evolution API e grava as mensagens dos grupos.
// URL configurada na VPS (whatsapp/.env):
//   https://<projeto>.supabase.co/functions/v1/whatsapp-webhook?segredo=<wa_segredo do Vault>
// Só grupos (JID terminando em @g.us). Conversas individuais são ignoradas.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EVOLUTION_URL = Deno.env.get("EVOLUTION_URL");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");

type Json = Record<string, any>;

const ehGrupo = (jid: unknown): jid is string => typeof jid === "string" && jid.endsWith("@g.us");

// Tira o texto legível de cada tipo de mensagem do WhatsApp
function lerMensagem(m: Json | undefined): { tipo: string; texto: string } {
  if (!m) return { tipo: "outro", texto: "" };
  if (m.ephemeralMessage?.message) return lerMensagem(m.ephemeralMessage.message);
  if (m.viewOnceMessage?.message) return lerMensagem(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2?.message) return lerMensagem(m.viewOnceMessageV2.message);
  if (m.documentWithCaptionMessage?.message) return lerMensagem(m.documentWithCaptionMessage.message);
  if (typeof m.conversation === "string") return { tipo: "texto", texto: m.conversation };
  if (m.extendedTextMessage) return { tipo: "texto", texto: m.extendedTextMessage.text ?? "" };
  if (m.imageMessage) return { tipo: "imagem", texto: m.imageMessage.caption ?? "" };
  if (m.videoMessage) return { tipo: "video", texto: m.videoMessage.caption ?? "" };
  if (m.audioMessage) return { tipo: "audio", texto: "" };
  if (m.documentMessage)
    return { tipo: "documento", texto: [m.documentMessage.fileName, m.documentMessage.caption].filter(Boolean).join(" — ") };
  if (m.stickerMessage) return { tipo: "figurinha", texto: "" };
  if (m.locationMessage) return { tipo: "local", texto: m.locationMessage.name ?? m.locationMessage.address ?? "" };
  if (m.contactMessage) return { tipo: "contato", texto: m.contactMessage.displayName ?? "" };
  if (m.pollCreationMessage || m.pollCreationMessageV3) {
    const p = m.pollCreationMessage ?? m.pollCreationMessageV3;
    return { tipo: "enquete", texto: [p.name, ...(p.options ?? []).map((o: Json) => `• ${o.optionName}`)].join("\n") };
  }
  if (m.reactionMessage) return { tipo: "reacao", texto: m.reactionMessage.text ?? "" };
  if (m.protocolMessage || m.senderKeyDistributionMessage) return { tipo: "sistema", texto: "" };
  return { tipo: Object.keys(m)[0] ?? "outro", texto: "" };
}

// Busca o nome do grupo na Evolution (opcional: só se EVOLUTION_URL estiver configurada)
async function nomeDoGrupo(instancia: string, jid: string): Promise<{ nome: string; descricao: string } | null> {
  if (!EVOLUTION_URL || !EVOLUTION_API_KEY) return null;
  try {
    const r = await fetch(
      `${EVOLUTION_URL.replace(/\/$/, "")}/group/findGroupInfos/${encodeURIComponent(instancia)}?groupJid=${encodeURIComponent(jid)}`,
      { headers: { apikey: EVOLUTION_API_KEY } },
    );
    if (!r.ok) return null;
    const g = await r.json();
    return { nome: g.subject ?? "", descricao: g.desc ?? "" };
  } catch {
    return null;
  }
}

async function garantirGrupo(instancia: string, jid: string) {
  const { data } = await supabase.from("wa_grupos").select("id,nome,ativo").eq("id", jid).maybeSingle();
  if (data) return data as { id: string; nome: string; ativo: boolean };
  const info = await nomeDoGrupo(instancia, jid);
  const novo = { id: jid, nome: info?.nome ?? "", descricao: info?.descricao ?? "" };
  await supabase.from("wa_grupos").upsert(novo, { onConflict: "id", ignoreDuplicates: true });
  return { id: jid, nome: novo.nome, ativo: true };
}

async function gravarGrupos(itens: Json[]) {
  for (const g of itens) {
    if (!ehGrupo(g.id)) continue;
    const linha: Json = { id: g.id };
    if (typeof g.subject === "string") linha.nome = g.subject;
    if (typeof g.desc === "string") linha.descricao = g.desc;
    await supabase.from("wa_grupos").upsert(linha, { onConflict: "id" });
  }
}

async function gravarMensagens(instancia: string, itens: Json[]) {
  const linhas: Json[] = [];
  for (const d of itens) {
    const jid = d.key?.remoteJid;
    if (!ehGrupo(jid) || !d.key?.id) continue;
    const { tipo, texto } = lerMensagem(d.message);
    if (tipo === "sistema" || tipo === "reacao") continue;
    const grupo = await garantirGrupo(instancia, jid);
    if (!grupo.ativo) continue;
    const ts = Number(d.messageTimestamp);
    linhas.push({
      grupo_id: jid,
      id: d.key.id,
      autor_jid: d.key.participant ?? d.participant ?? "",
      autor_nome: d.pushName ?? "",
      de_nos: !!d.key.fromMe,
      tipo,
      texto,
      enviada_em: new Date(Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now()).toISOString(),
    });
  }
  if (linhas.length) {
    const { error } = await supabase.from("wa_mensagens").upsert(linhas, { onConflict: "grupo_id,id", ignoreDuplicates: true });
    if (error) throw error;
  }
  return linhas.length;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  const segredo = new URL(req.url).searchParams.get("segredo") ?? req.headers.get("x-segredo") ?? "";
  const { data: valido } = await supabase.rpc("wa_conferir_segredo", { p_segredo: segredo });
  if (!valido) return new Response("Não autorizado", { status: 401 });

  let corpo: Json;
  try {
    corpo = await req.json();
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  // Evolution v2 manda "messages.upsert"; com WEBHOOK_BY_EVENTS pode vir "MESSAGES_UPSERT"
  const evento = String(corpo.event ?? "").toLowerCase().replace(/_/g, ".");
  const instancia = String(corpo.instance ?? "");
  const dados = Array.isArray(corpo.data) ? corpo.data : corpo.data ? [corpo.data] : [];

  try {
    if (evento === "messages.upsert" || evento === "messages.set") {
      const n = await gravarMensagens(instancia, evento === "messages.set" ? (corpo.data?.messages ?? dados) : dados);
      return Response.json({ gravadas: n });
    }
    if (evento === "groups.upsert" || evento === "groups.update" || evento === "group.update") {
      await gravarGrupos(dados);
      return Response.json({ grupos: dados.length });
    }
    return Response.json({ ignorado: evento });
  } catch (e) {
    console.error(e);
    return new Response("Erro ao gravar", { status: 500 });
  }
});
