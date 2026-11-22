// PDF (DANFE NFC-e, bobina de 80 mm) de uma venda, montado com os dados da TOTVS guardados em nfce_notas.
// Quem pode ver: a mesma regra da tabela nfce_notas (RLS: os sócios), pela sessão de quem está logado.
import { createClient } from "@/lib/supabase/server";
import { danfcePdf, type NotaNfce } from "@/lib/nfce/danfce";

export const runtime = "nodejs";

function aviso(texto: string, status: number) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>NFC-e</title><body style="font-family:system-ui;padding:32px;color:#232733">` +
      `<h1 style="font-size:18px">Não deu para abrir o PDF desta NFC-e</h1><p>${texto}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ unidade: string; venda: string }> }) {
  const { unidade, venda } = await params;
  const chaveVenda = decodeURIComponent(venda);
  if (!/^[a-z0-9_]{2,40}$/.test(unidade) || !chaveVenda || chaveVenda.length > 120) return aviso("Venda inválida.", 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return aviso("Entre no Brasico para ver a nota.", 401);
  const { data, error } = await supabase.from("nfce_notas")
    .select("chave,numero,serie,situacao,emissao,protocolo,cupom,caixa,consumidor_identificado,valor,subtotal,servico,desconto,acrescimo,troco,icms,pis,cofins,cbs,ibs,itens,pagamentos,cancelamento,emitente_cnpj")
    .eq("unidade_id", unidade).eq("chave_venda", chaveVenda).maybeSingle();
  if (error) return aviso(error.message, 500);
  if (!data) return aviso("Venda não encontrada (ou você não tem acesso às notas).", 404);
  const cnpj = (data.emitente_cnpj as string | null) ?? "";
  const { data: emp } = await supabase.from("fiscal_empresas").select("razao,apelido,municipio,uf").eq("cnpj", cnpj).maybeSingle();
  try {
    const pdf = await danfcePdf(data as unknown as NotaNfce, {
      nome: (emp?.razao as string | undefined) ?? (emp?.apelido as string | undefined) ?? "Emitente",
      cnpj,
      municipio: emp?.municipio ? `${emp.municipio}${emp.uf ? ` - ${emp.uf}` : ""}` : null,
    });
    const nome = data.chave ? `NFCe-${data.numero ?? data.chave}` : `Venda-${data.cupom ?? ""}`;
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nome}.pdf"`,
        "Cache-Control": "private, max-age=600",
      },
    });
  } catch (e) {
    return aviso(`Não deu para montar o PDF: ${(e as Error).message}`, 500);
  }
}
