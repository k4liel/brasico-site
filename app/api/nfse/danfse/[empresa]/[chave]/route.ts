// PDF (DANFSe) de uma NFS-e, montado na hora a partir do XML oficial guardado em nfse_notas.xml.
// Quem pode ver: a mesma regra da tabela nfse_notas (RLS: notas_acesso), pela sessão de quem está logado.
import { createClient } from "@/lib/supabase/server";
import { danfsePdf } from "@/lib/nfse/danfse";

export const runtime = "nodejs";

function aviso(texto: string, status: number) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>DANFSe</title><body style="font-family:system-ui;padding:32px;color:#232733">` +
      `<h1 style="font-size:18px">Não deu para abrir o PDF desta NFS-e</h1><p>${texto}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ empresa: string; chave: string }> }) {
  const { empresa, chave } = await params;
  if (!/^\d{14}$/.test(empresa) || !/^\d{50}$/.test(chave)) return aviso("Chave de NFS-e inválida.", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return aviso("Entre no Brasico para ver a nota.", 401);
  const { data, error } = await supabase.from("nfse_notas").select("xml,situacao,numero")
    .eq("empresa_cnpj", empresa).eq("chave", chave).maybeSingle();
  if (error) return aviso(error.message, 500);
  if (!data?.xml) return aviso("NFS-e não encontrada (ou você não tem acesso às notas).", 404);
  try {
    const pdf = await danfsePdf(data.xml, data.situacao);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="DANFSe-${data.numero ?? chave}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return aviso(`O XML desta NFS-e não pôde ser lido: ${(e as Error).message}`, 500);
  }
}
