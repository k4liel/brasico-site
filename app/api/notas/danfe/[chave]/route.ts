// PDF (DANFE) de uma nota, montado na hora a partir do XML oficial guardado em notas.xml.
// Quem pode ver: a mesma regra da tabela notas (RLS: notas_acesso), pela sessão de quem está logado.
import { createClient } from "@/lib/supabase/server";
import { danfePdf } from "@/lib/notas/danfe";

export const runtime = "nodejs";

function aviso(texto: string, status: number) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>DANFE</title><body style="font-family:system-ui;padding:32px;color:#232733">` +
      `<h1 style="font-size:18px">Não deu para abrir o PDF desta nota</h1><p>${texto}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ chave: string }> }) {
  const { chave } = await params;
  if (!/^\d{44}$/.test(chave)) return aviso("Chave de nota inválida.", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return aviso("Entre no Brasico para ver a nota.", 401);
  const { data, error } = await supabase.from("notas").select("xml,completa,origem").eq("chave", chave).maybeSingle();
  if (error) return aviso(error.message, 500);
  if (!data) return aviso("Nota não encontrada (ou você não tem acesso às notas).", 404);
  if (!data.completa || !data.xml?.includes("infNFe"))
    return aviso("Só o resumo desta nota chegou da SEFAZ até agora. O PDF fica pronto quando a nota completa chegar (depois da ciência da operação).", 409);
  try {
    const pdf = await danfePdf(data.xml);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="DANFE-${chave}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return aviso(`O XML desta nota não pôde ser lido: ${(e as Error).message}`, 500);
  }
}
