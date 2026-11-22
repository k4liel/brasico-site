// PDF (DACTE) de um CT-e, montado com o CT-e autorizado guardado em cte_notas (lido do XML oficial).
// Quem pode ver: a mesma regra da tabela cte_notas (RLS: os sócios), pela sessão de quem está logado.
import { createClient } from "@/lib/supabase/server";
import { dactePdf, type CteLinha } from "@/lib/cte/dacte";

export const runtime = "nodejs";

function aviso(texto: string, status: number) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>DACTE</title><body style="font-family:system-ui;padding:32px;color:#232733">` +
      `<h1 style="font-size:18px">Não deu para abrir o PDF deste CT-e</h1><p>${texto}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ empresa: string; chave: string }> }) {
  const { empresa, chave } = await params;
  if (!/^\d{14}$/.test(empresa) || !/^\d{44}$/.test(chave)) return aviso("Chave de CT-e inválida.", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return aviso("Entre no Brasico para ver o CT-e.", 401);
  const { data, error } = await supabase.from("cte_notas").select("*").eq("empresa_cnpj", empresa).eq("chave", chave).maybeSingle();
  if (error) return aviso(error.message, 500);
  if (!data) return aviso("CT-e não encontrado (ou você não tem acesso às notas).", 404);
  try {
    const pdf = await dactePdf(data as unknown as CteLinha);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="DACTE-${data.numero ?? chave}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return aviso(`Não deu para montar o PDF: ${(e as Error).message}`, 500);
  }
}
