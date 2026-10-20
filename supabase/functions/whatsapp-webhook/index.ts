// Recebe os eventos da Evolution API e grava as conversas do número da Brasico.
// URL configurada na instância da Evolution (Events → Webhook):
//   https://<projeto>.supabase.co/functions/v1/whatsapp-webhook
// com o cabeçalho x-segredo = <wa_segredo do Vault>. (Na URL, ?segredo= também vale, mas aparece nos registros.)
// Grava grupos (@g.us) e conversas individuais (@s.whatsapp.net / @lid). Status, canais e listas são ignorados.
// Com "Webhook base64" ligado na Evolution, cada mídia chega inteira (message.base64) e é guardada no
// bucket privado "whatsapp". "messages.set" é o histórico que o WhatsApp manda quando o aparelho é conectado.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EVOLUTION_URL = Deno.env.get("EVOLUTION_URL");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
const BUCKET = "whatsapp";

type Json = Record<string, any>;
type Conversa = { id: string; nome: string; ativo: boolean };
type Lida = { tipo: string; texto: string; miniatura: string; ctx: Json | undefined; midia: Json | undefined };

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
const inteiro = (v: unknown) => {
  const n = Number((v as Json)?.low ?? v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

// Campos técnicos que vêm junto com o conteúdo e não são a mensagem
const TECNICOS = new Set(["messageContextInfo", "senderKeyDistributionMessage", "base64", "mediaUrl"]);

// Tira o texto legível de cada tipo de mensagem do WhatsApp (e a parte da mídia, quando houver)
function lerMensagem(m: Json | undefined): Lida {
  const r = (tipo: string, texto = "", miniatura = "", ctx?: Json, midia?: Json): Lida => ({ tipo, texto, miniatura, ctx, midia });
  if (!m) return r("outro");
  if (m.ephemeralMessage?.message) return lerMensagem(m.ephemeralMessage.message);
  if (m.viewOnceMessage?.message) return lerMensagem(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2?.message) return lerMensagem(m.viewOnceMessageV2.message);
  if (m.documentWithCaptionMessage?.message) return lerMensagem(m.documentWithCaptionMessage.message);
  if (m.editedMessage?.message) return lerMensagem(m.editedMessage.message);
  if (typeof m.conversation === "string") return r("texto", m.conversation);
  if (m.extendedTextMessage) return r("texto", m.extendedTextMessage.text ?? "", "", m.extendedTextMessage.contextInfo);
  if (m.imageMessage)
    return r("imagem", m.imageMessage.caption ?? "", paraBase64(m.imageMessage.jpegThumbnail), m.imageMessage.contextInfo, m.imageMessage);
  if (m.videoMessage)
    return r("video", m.videoMessage.caption ?? "", paraBase64(m.videoMessage.jpegThumbnail), m.videoMessage.contextInfo, m.videoMessage);
  if (m.audioMessage) return r("audio", "", "", m.audioMessage.contextInfo, m.audioMessage);
  if (m.documentMessage)
    return r("documento", m.documentMessage.caption ?? "", paraBase64(m.documentMessage.jpegThumbnail), m.documentMessage.contextInfo, m.documentMessage);
  if (m.stickerMessage) return r("figurinha", "", "", m.stickerMessage.contextInfo, m.stickerMessage);
  if (m.locationMessage) return r("local", m.locationMessage.name ?? m.locationMessage.address ?? "");
  if (m.contactMessage) return r("contato", m.contactMessage.displayName ?? "");
  if (m.pollCreationMessage || m.pollCreationMessageV3) {
    const p = m.pollCreationMessage ?? m.pollCreationMessageV3;
    return r("enquete", [p.name, ...(p.options ?? []).map((o: Json) => `• ${o.optionName}`)].join("\n"));
  }
  if (m.reactionMessage) return r("reacao", m.reactionMessage.text ?? "");
  // Edições, votos de enquete e avisos internos: não são mensagens novas
  if (m.protocolMessage || m.secretEncryptedMessage || m.pollUpdateMessage) return r("sistema");
  const chave = Object.keys(m).find((k) => !TECNICOS.has(k));
  return r(chave ?? "sistema");
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "application/pdf": "pdf",
};
const seguro = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");

// Guarda a mídia inteira no bucket privado e devolve os dados para a linha da mensagem
async function guardarMidia(jid: string, id: string, msg: Lida, base64: string) {
  const mime = String(msg.midia?.mimetype ?? "application/octet-stream").split(";")[0].trim();
  const nome = String(msg.midia?.fileName ?? "");
  const ext = EXT[mime] ?? (nome.includes(".") ? seguro(nome.split(".").pop()!) : "bin");
  const caminho = `${seguro(jid)}/${seguro(id)}.${ext}`;
  const bytes = decodeBase64(base64.replace(/^data:[^,]+,/, ""));
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, bytes, { contentType: mime, upsert: true });
  if (error) {
    console.error("mídia", caminho, error.message);
    return null;
  }
  return { midia: caminho, midia_mime: mime, midia_bytes: bytes.length };
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
  const lidas: { jid: string; d: Json; msg: Lida }[] = [];
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
      atual.telefone ||= numero(jid) || numero(d.key.remoteJidAlt) || numero(d.key.senderPn);
    }
    conversas.set(jid, atual);
  }
  if (!lidas.length) return 0;

  const existentes = await garantirConversas(instancia, conversas);
  const linhas: Json[] = [];
  const completar: Json[] = [];
  for (const { jid, d, msg } of lidas) {
    if (existentes.get(jid)?.ativo === false) continue;
    const ctx = msg.ctx ?? d.contextInfo;
    const ts = inteiro(d.messageTimestamp);
    const telefone = d.key.fromMe
      ? ""
      : ehGrupo(jid)
        ? numero(d.key.participantAlt) || numero(d.key.participant) || numero(d.participant) || numero(d.key.senderPn)
        : numero(jid) || numero(d.key.remoteJidAlt) || numero(d.key.senderPn);
    const linha: Json = {
      grupo_id: jid,
      id: d.key.id,
      autor_jid: ehGrupo(jid) ? (d.key.participant ?? d.participant ?? "") : d.key.fromMe ? "" : jid,
      autor_nome: d.key.fromMe ? "" : (d.pushName ?? ""),
      autor_telefone: telefone,
      de_nos: !!d.key.fromMe,
      tipo: msg.tipo,
      texto: msg.texto,
      miniatura: msg.miniatura,
      citacao: ctx?.quotedMessage ? lerMensagem(ctx.quotedMessage).texto.slice(0, 300) : "",
      midia_nome: String(msg.midia?.fileName ?? ""),
      midia_segundos: inteiro(msg.midia?.seconds),
      midia_bytes: inteiro(msg.midia?.fileLength),
      enviada_em: new Date(ts ? ts * 1000 : Date.now()).toISOString(),
    };
    // Mídia completa (com "Webhook base64" ligado na Evolution, ou enviada pelo importador)
    const base64 = d.message?.base64 ?? d.base64;
    if (msg.midia && typeof base64 === "string" && base64.length > 0) {
      const g = await guardarMidia(jid, d.key.id, msg, base64);
      if (g) Object.assign(linha, g);
    }
    linhas.push(linha);
    completar.push({
      grupo_id: jid, id: d.key.id, autor_telefone: telefone,
      midia: linha.midia ?? "", midia_mime: linha.midia_mime ?? "", midia_nome: linha.midia_nome,
      midia_bytes: linha.midia_bytes, midia_segundos: linha.midia_segundos,
    });
  }
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase
      .from("wa_mensagens")
      .upsert(linhas.slice(i, i + 500), { onConflict: "grupo_id,id", ignoreDuplicates: true, defaultToNull: false });
    if (error) throw error;
  }
  // Mensagens que já existiam ganham o telefone do autor e a mídia, sem perder o resto
  for (let i = 0; i < completar.length; i += 500) {
    const { error } = await supabase.rpc("wa_completar_mensagens", { p: completar.slice(i, i + 500) });
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

// Agenda (wa_contatos) e fotos/nomes das conversas: contacts.upsert / contacts.update / chats.upsert.
// A agenda inteira chega aqui, com milhares de contatos: grava em lote.
async function gravarContatos(itens: Json[]) {
  const porJid = new Map<string, Json>();
  for (const c of itens) {
    const jid = c.remoteJid ?? c.id;
    if (ehConversa(jid) && !ehGrupo(jid)) porJid.set(jid, c);
  }
  const agenda = [...porJid].map(([jid, c]) => {
    // Participantes de grupo vêm como …@lid com o número em phoneNumber/jid
    const linha: Json = { id: jid, updated_at: new Date().toISOString() };
    const tel = numero(jid) || numero(c.phoneNumber) || numero(c.jid) || numero(c.remoteJidAlt);
    if (tel) linha.telefone = tel;
    if (c.pushName) linha.nome = c.pushName;
    const foto = c.profilePicUrl ?? c.profilePictureUrl;
    if (typeof foto === "string" && foto) linha.foto = foto;
    return linha;
  });
  // Upsert em grupos com as mesmas colunas (o PostgREST exige o mesmo formato no lote)
  const formatos = new Map<string, Json[]>();
  for (const l of agenda) {
    const k = Object.keys(l).sort().join(",");
    formatos.set(k, [...(formatos.get(k) ?? []), l]);
  }
  for (const lote of formatos.values())
    for (let i = 0; i < lote.length; i += 500)
      await supabase.from("wa_contatos").upsert(lote.slice(i, i + 500), { onConflict: "id", defaultToNull: false });

  // Conversas já gravadas: foto nova e nome, se ainda não tiver
  const ids = [...porJid.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("wa_grupos").select("id,nome,foto,telefone").in("id", ids.slice(i, i + 200));
    for (const atual of (data ?? []) as { id: string; nome: string; foto: string; telefone: string }[]) {
      const c = porJid.get(atual.id)!;
      const mudar: Json = {};
      const foto = c.profilePicUrl ?? c.profilePictureUrl;
      if (typeof foto === "string" && foto && foto !== atual.foto) mudar.foto = foto;
      if (!atual.nome && c.pushName) mudar.nome = c.pushName;
      if (!atual.telefone && numero(atual.id)) mudar.telefone = numero(atual.id);
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
