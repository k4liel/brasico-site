// Recebe os eventos da Evolution API e grava as conversas do número da Brasico.
// URL configurada na instância da Evolution (Events → Webhook):
//   https://<projeto>.supabase.co/functions/v1/whatsapp-webhook
// com o cabeçalho x-segredo = <wa_segredo do Vault>. (Na URL, ?segredo= também vale, mas aparece nos registros.)
// Grava grupos (@g.us) e conversas individuais (@s.whatsapp.net / @lid). Status, canais e listas são ignorados.
// "messages.set" é o histórico que o WhatsApp manda quando o aparelho é conectado.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EVOLUTION_URL = Deno.env.get("EVOLUTION_URL");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");

type Json = Record<string, any>;
type Conversa = { id: string; nome: string; ativo: boolean };

const ehGrupo = (jid: string) => jid.endsWith("@g.us");
const ehConversa = (jid: unknown): jid is string =>
  typeof jid === "string" && (jid.endsWith("@g.us") || jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"));
const numero = (jid: unknown) =>
  typeof jid === "string" && jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0].split(":")[0] : "";

// A miniatura chega como base64, como Buffer serializado ({type, data}) ou como objeto de bytes
function paraBase64(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v.length < 200_000 ? v : "";
  let bytes: number[] | null = null;
  if (Array.isArray((v as Json).data)) bytes = (v as Json).data;
  else if (typeof v === "object") bytes = Object.values(v as Json).filter((x) => typeof x === "number") as number[];
  if (!bytes?.length || bytes.length > 150_000) return "";
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// Tira o texto legível de cada tipo de mensagem do WhatsApp
function lerMensagem(m: Json | undefined): { tipo: string; texto: string; miniatura: string; ctx: Json | undefined } {
  const r = (tipo: string, texto = "", miniatura = "", ctx?: Json) => ({ tipo, texto, miniatura, ctx });
  if (!m) return r("outro");
  if (m.ephemeralMessage?.message) return lerMensagem(m.ephemeralMessage.message);
  if (m.viewOnceMessage?.message) return lerMensagem(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2?.message) return lerMensagem(m.viewOnceMessageV2.message);
  if (m.documentWithCaptionMessage?.message) return lerMensagem(m.documentWithCaptionMessage.message);
  if (m.editedMessage?.message) return lerMensagem(m.editedMessage.message);
  if (typeof m.conversation === "string") return r("texto", m.conversation);
  if (m.extendedTextMessage) return r("texto", m.extendedTextMessage.text ?? "", "", m.extendedTextMessage.contextInfo);
  if (m.imageMessage) return r("imagem", m.imageMessage.caption ?? "", paraBase64(m.imageMessage.jpegThumbnail), m.imageMessage.contextInfo);
  if (m.videoMessage) return r("video", m.videoMessage.caption ?? "", paraBase64(m.videoMessage.jpegThumbnail), m.videoMessage.contextInfo);
  if (m.audioMessage) return r("audio", "", "", m.audioMessage.contextInfo);
  if (m.documentMessage)
    return r("documento", [m.documentMessage.fileName, m.documentMessage.caption].filter(Boolean).join(" — "), "", m.documentMessage.contextInfo);
  if (m.stickerMessage) return r("figurinha", "", "", m.stickerMessage.contextInfo);
  if (m.locationMessage) return r("local", m.locationMessage.name ?? m.locationMessage.address ?? "");
  if (m.contactMessage) return r("contato", m.contactMessage.displayName ?? "");
  if (m.pollCreationMessage || m.pollCreationMessageV3) {
    const p = m.pollCreationMessage ?? m.pollCreationMessageV3;
    return r("enquete", [p.name, ...(p.options ?? []).map((o: Json) => `• ${o.optionName}`)].join("\n"));
  }
  if (m.reactionMessage) return r("reacao", m.reactionMessage.text ?? "");
  if (m.protocolMessage || m.senderKeyDistributionMessage) return r("sistema");
  return r(Object.keys(m)[0] ?? "outro");
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

// Garante que cada conversa existe; contatos ganham o nome e o telefone da primeira mensagem recebida
async function garantirConversas(instancia: string, novas: Map<string, { nome: string; telefone: string }>) {
  const ids = [...novas.keys()];
  const existentes = new Map<string, Conversa>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("wa_grupos").select("id,nome,ativo").in("id", ids.slice(i, i + 200));
    for (const c of (data ?? []) as Conversa[]) existentes.set(c.id, c);
  }
  const criar: Json[] = [];
  for (const [id, info] of novas) {
    const c = existentes.get(id);
    if (!c) {
      const g = ehGrupo(id) ? await nomeDoGrupo(instancia, id) : null;
      const linha = {
        id,
        tipo: ehGrupo(id) ? "grupo" : "contato",
        nome: g?.nome ?? info.nome,
        descricao: g?.descricao ?? "",
        telefone: info.telefone,
      };
      criar.push(linha);
      existentes.set(id, { id, nome: linha.nome, ativo: true });
    } else if (!c.nome && info.nome && !ehGrupo(id)) {
      await supabase.from("wa_grupos").update({ nome: info.nome, telefone: info.telefone || undefined }).eq("id", id);
    }
  }
  if (criar.length) await supabase.from("wa_grupos").upsert(criar, { onConflict: "id", ignoreDuplicates: true });
  return existentes;
}

async function gravarMensagens(instancia: string, itens: Json[]) {
  const lidas: { jid: string; d: Json; msg: ReturnType<typeof lerMensagem> }[] = [];
  const conversas = new Map<string, { nome: string; telefone: string }>();
  for (const d of itens) {
    const jid = d.key?.remoteJid;
    if (!ehConversa(jid) || !d.key?.id) continue;
    const msg = lerMensagem(d.message);
    if (msg.tipo === "sistema" || msg.tipo === "reacao") continue;
    lidas.push({ jid, d, msg });
    const atual = conversas.get(jid) ?? { nome: "", telefone: "" };
    if (!ehGrupo(jid) && !d.key.fromMe) {
      atual.nome ||= d.pushName ?? "";
      atual.telefone ||= numero(jid) || numero(d.key.senderPn) || numero(d.key.remoteJidAlt);
    }
    conversas.set(jid, atual);
  }
  if (!lidas.length) return 0;

  const existentes = await garantirConversas(instancia, conversas);
  const linhas: Json[] = [];
  for (const { jid, d, msg } of lidas) {
    if (existentes.get(jid)?.ativo === false) continue;
    const ctx = msg.ctx ?? d.contextInfo;
    const ts = Number(d.messageTimestamp?.low ?? d.messageTimestamp);
    linhas.push({
      grupo_id: jid,
      id: d.key.id,
      autor_jid: ehGrupo(jid) ? (d.key.participant ?? d.participant ?? "") : d.key.fromMe ? "" : jid,
      autor_nome: d.key.fromMe ? "" : (d.pushName ?? ""),
      de_nos: !!d.key.fromMe,
      tipo: msg.tipo,
      texto: msg.texto,
      miniatura: msg.miniatura,
      citacao: ctx?.quotedMessage ? lerMensagem(ctx.quotedMessage).texto.slice(0, 300) : "",
      enviada_em: new Date(Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now()).toISOString(),
    });
  }
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase
      .from("wa_mensagens")
      .upsert(linhas.slice(i, i + 500), { onConflict: "grupo_id,id", ignoreDuplicates: true });
    if (error) throw error;
  }
  return linhas.length;
}

async function gravarGrupos(itens: Json[]) {
  for (const g of itens) {
    if (typeof g.id !== "string" || !ehGrupo(g.id)) continue;
    const linha: Json = { id: g.id, tipo: "grupo" };
    if (typeof g.subject === "string") linha.nome = g.subject;
    if (typeof g.desc === "string") linha.descricao = g.desc;
    if (typeof g.pictureUrl === "string" && g.pictureUrl) linha.foto = g.pictureUrl;
    await supabase.from("wa_grupos").upsert(linha, { onConflict: "id" });
  }
}

// Fotos e nomes de contatos (contacts.upsert / contacts.update) e de conversas (chats.upsert).
// Só atualiza quem já tem conversa gravada (a agenda inteira chega aqui, com milhares de contatos).
async function gravarContatos(itens: Json[]) {
  const porJid = new Map<string, Json>();
  for (const c of itens) {
    const jid = c.remoteJid ?? c.id;
    if (ehConversa(jid)) porJid.set(jid, c);
  }
  const ids = [...porJid.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("wa_grupos").select("id,nome,foto").in("id", ids.slice(i, i + 200));
    for (const atual of (data ?? []) as { id: string; nome: string; foto: string }[]) {
      const c = porJid.get(atual.id)!;
      const mudar: Json = {};
      const foto = c.profilePicUrl ?? c.profilePictureUrl;
      if (typeof foto === "string" && foto && foto !== atual.foto) mudar.foto = foto;
      if (!ehGrupo(atual.id) && !atual.nome && c.pushName) mudar.nome = c.pushName;
      if (Object.keys(mudar).length) await supabase.from("wa_grupos").update(mudar).eq("id", atual.id);
    }
  }
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
      const lista = evento === "messages.set" && Array.isArray(corpo.data?.messages) ? corpo.data.messages : dados;
      const n = await gravarMensagens(instancia, lista);
      return Response.json({ gravadas: n });
    }
    if (evento === "groups.upsert" || evento === "groups.update" || evento === "group.update") {
      await gravarGrupos(dados);
      return Response.json({ grupos: dados.length });
    }
    if (evento === "contacts.upsert" || evento === "contacts.update" || evento === "chats.upsert") {
      await gravarContatos(dados);
      return Response.json({ contatos: dados.length });
    }
    return Response.json({ ignorado: evento });
  } catch (e) {
    console.error(e);
    return new Response("Erro ao gravar", { status: 500 });
  }
});
