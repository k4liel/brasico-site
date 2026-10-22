// Recebe o certificado A1 (.pfx + senha) de um sócio logado, confere e guarda no Vault, um por CNPJ
// (função esocial_guardar_certificado, supabase/certificados.sql): a matriz é a usada pelo eSocial; filial fica à parte.
// A senha só é usada para abrir o arquivo; não é guardada nem registrada.
import { createClient } from "@/lib/supabase/server";
import { lerPfx } from "@/lib/esocial/certificado";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ erro: "Entre no Brasico para enviar o certificado." }, { status: 401 });
  const { data: pode } = await supabase.rpc("esocial_pode_ver", { p_user: user.id });
  if (!pode) return Response.json({ erro: "Você não tem acesso ao eSocial." }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  const senha = String(form?.get("senha") ?? "");
  if (!(arquivo instanceof File) || !arquivo.size) return Response.json({ erro: "Escolha o arquivo .pfx do certificado." }, { status: 400 });
  if (arquivo.size > 50 * 1024) return Response.json({ erro: "Arquivo grande demais para um certificado A1." }, { status: 400 });

  try {
    const c = lerPfx(Buffer.from(await arquivo.arrayBuffer()), senha);
    const { data, error } = await supabase.rpc("esocial_guardar_certificado", {
      p_raiz: c.raiz, p_nome: c.nome, p_cnpj: c.cnpj, p_titular: c.titular, p_emissor: c.emissor,
      p_validade: c.validade.toISOString(), p_pem: c.pem,
    });
    if (error) return Response.json({ erro: error.message }, { status: 400 });
    return Response.json(data);
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : "Não consegui ler o certificado." }, { status: 400 });
  }
}
