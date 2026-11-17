import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";

// Arquivo de um pedido do grupo COMPRAS (PDF, foto ou planilha), para a aba Listas das Compras.
// Só abre para quem pode ver aquele pedido (sócio, setor de compras ou a própria pessoa): compras_anexo e a política
// "compras leem anexos do pedido" do bucket whatsapp (supabase/compras_pedido_completo.sql).
// /api/compras/anexo?m=<id da mensagem>         → o arquivo (inline)
// /api/compras/anexo?m=<id da mensagem>&ler=1   → planilha lida: { abas: [{ nome, linhas: string[][] }] }

export const runtime = "nodejs";

const TIPOS: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", csv: "text/csv",
};
const PLANILHA = ["xlsx", "xls", "csv", "ods"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const m = url.searchParams.get("m") ?? "";
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(m)) return new Response("Não encontrado", { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Entre no Brasico para ver este arquivo.", { status: 401 });
  const { data: info } = await supabase.rpc("compras_anexo", { p_mensagem: m });
  const a = info as { midia: string; nome: string | null; mime: string | null } | null;
  if (!a?.midia) return new Response("Arquivo não encontrado ou sem acesso.", { status: 404 });
  const { data: blob } = await supabase.storage.from("whatsapp").download(a.midia);
  if (!blob) return new Response("Arquivo não encontrado.", { status: 404 });
  const dados = new Uint8Array(await blob.arrayBuffer());
  const ext = (a.midia.split(".").pop() ?? "").toLowerCase();

  if (url.searchParams.has("ler")) {
    if (!PLANILHA.includes(ext)) return Response.json({ abas: [] });
    const livro = XLSX.read(dados, { type: "array" });
    const abas = livro.SheetNames.map((nome) => {
      const linhas = (XLSX.utils.sheet_to_json<unknown[]>(livro.Sheets[nome], { header: 1, blankrows: false, defval: "" }) as unknown[][])
        .map((l) => l.map((c) => (c == null ? "" : String(c).trim())))
        .filter((l) => l.some((c) => c !== ""));
      // tira colunas vazias no fim
      const largura = Math.max(0, ...linhas.map((l) => { let k = l.length; while (k > 0 && l[k - 1] === "") k--; return k; }));
      return { nome, linhas: linhas.slice(0, 2000).map((l) => l.slice(0, largura)) };
    }).filter((x) => x.linhas.length);
    return Response.json({ abas }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const nome = (a.nome || `arquivo.${ext}`).replace(/["\r\n]/g, "");
  return new Response(dados as BodyInit, {
    headers: {
      "Content-Type": a.mime || TIPOS[ext] || "application/octet-stream",
      "Content-Disposition": `${url.searchParams.has("baixar") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
