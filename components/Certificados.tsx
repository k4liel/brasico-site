"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

// Certificados digitais (e-CNPJ A1) das empresas: um por raiz do CNPJ, guardado no Vault
// (esocial_cert_<raiz>). São usados pelo eSocial e pela Receita Federal.
type Empresa = {
  id: string; nome: string; cnpj: string | null; cert_titular: string | null; cert_cnpj: string | null;
  cert_emissor: string | null; cert_validade: string | null; cert_atualizado_em: string | null; cert_atualizado_por: string | null;
};

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const dataHora = (iso: string) =>
  `${dia(iso)} às ${new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`;
const cnpjMask = (c: string | null) => (c ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : "");
const diasAte = (iso: string) => Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);

function situacao(e: Empresa): { texto: string; classe: string } {
  if (!e.cert_validade) return { texto: "Sem certificado", classe: "tv-falha" };
  const d = diasAte(e.cert_validade);
  if (d < 0) return { texto: `Venceu em ${dia(e.cert_validade)}`, classe: "tv-falha" };
  if (d <= 30) return { texto: `Vence em ${d} dia${d === 1 ? "" : "s"}`, classe: "tv-revisar" };
  return { texto: `Válido até ${dia(e.cert_validade)}`, classe: "tv-ok" };
}

export default function Certificados({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [carregado, setCarregado] = useState(false);
  const [enviar, setEnviar] = useState<string | null>(null); // id da empresa, ou "nova"
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("esocial_empresas")
      .select("id,nome,cnpj,cert_titular,cert_cnpj,cert_emissor,cert_validade,cert_atualizado_em,cert_atualizado_por")
      .order("ordem").order("nome");
    const lista = (data ?? []) as Empresa[];
    setEmpresas(lista);
    const uids = [...new Set(lista.map((e) => e.cert_atualizado_por).filter(Boolean))] as string[];
    if (uids.length) {
      const { data: perfis } = await supabase.from("profiles").select("id,email,display_name").in("id", uids);
      const r: Record<string, string> = {};
      for (const p of (perfis ?? []) as { id: string; email: string | null; display_name: string | null }[]) {
        r[p.id] = p.display_name || p.email?.split("@")[0] || "Alguém";
      }
      setNomes(r);
    }
    setCarregado(true);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: a } = await supabase.from("esocial_acesso").select("user_id").eq("user_id", userId);
      if (!a?.length) return setAcesso(false);
      setAcesso(true);
      carregar();
    })();
  }, [supabase, userId, carregar]);

  function pronto(nome: string) {
    setEnviar(null);
    setAviso(`Certificado de ${nome} guardado.`);
    carregar();
  }

  if (acesso === false) {
    return (
      <div className="pagina">
        <Topo email={userEmail} ativo="certificados" />
        <main className="miolo"><p className="vazio muted">Você não tem acesso aos certificados digitais.</p></main>
      </div>
    );
  }

  return (
    <div className="pagina">
      <Topo email={userEmail} ativo="certificados" />
      <main className="miolo tv es">
        <div className="es-topo">
          <div>
            <h1>Certificados digitais</h1>
            <p className="muted">O e-CNPJ A1 de cada empresa. É com ele que o Brasico lê o eSocial e a Receita Federal.</p>
          </div>
          <button className="small" onClick={() => setEnviar(enviar === "nova" ? null : "nova")}>Enviar certificado</button>
        </div>

        {aviso && <p className="es-aviso">{aviso}</p>}
        {enviar === "nova" && <EnviarCertificado onFechar={() => setEnviar(null)} onPronto={pronto} />}

        {!carregado ? (
          <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
        ) : empresas.length === 0 ? (
          <section className="es-bloco">
            <p>Nenhum certificado ainda. Envie o arquivo .pfx de uma empresa para começar.</p>
          </section>
        ) : (
          <div className="cert-lista">
            {empresas.map((e) => {
              const s = situacao(e);
              const filial = !!e.cert_cnpj && e.cert_cnpj.slice(8, 12) !== "0001";
              return (
                <section key={e.id} className="es-bloco cert-cartao">
                  <div className="es-linha">
                    <div>
                      <strong className="es-nome">{e.nome}</strong>
                      {e.cnpj && <span className="muted"> · CNPJ {cnpjMask(e.cnpj)}</span>}
                    </div>
                    <span className={`estado ${s.classe}`}>{s.texto}</span>
                  </div>
                  {e.cert_validade ? (
                    <dl className="cert-dados">
                      {e.cert_titular && <><dt>Titular</dt><dd>{e.cert_titular}</dd></>}
                      {e.cert_cnpj && <><dt>CNPJ do certificado</dt><dd>{cnpjMask(e.cert_cnpj)}{filial ? " (filial)" : " (matriz)"}</dd></>}
                      {e.cert_emissor && <><dt>Emitido por</dt><dd>{e.cert_emissor}</dd></>}
                      <dt>Validade</dt><dd>{dia(e.cert_validade)}</dd>
                      {e.cert_atualizado_em && (
                        <><dt>Enviado</dt><dd>{dataHora(e.cert_atualizado_em)}{e.cert_atualizado_por && nomes[e.cert_atualizado_por] ? ` · ${nomes[e.cert_atualizado_por]}` : ""}</dd></>
                      )}
                      <dt>Usado em</dt><dd>RH · eSocial e Receita Federal</dd>
                    </dl>
                  ) : (
                    <p className="muted">Esta empresa ainda não tem certificado.</p>
                  )}
                  {filial && (
                    <p className="es-aviso">Este certificado é de uma filial. O eSocial só libera os dados dos funcionários com o e-CNPJ da matriz (final 0001).</p>
                  )}
                  <div className="es-acoes">
                    <button className="ghost small" onClick={() => setEnviar(enviar === e.id ? null : e.id)}>
                      {e.cert_validade ? "Trocar certificado" : "Enviar certificado"}
                    </button>
                  </div>
                  {enviar === e.id && <EnviarCertificado onFechar={() => setEnviar(null)} onPronto={pronto} />}
                </section>
              );
            })}
          </div>
        )}

        <p className="muted es-nota">
          O arquivo fica guardado no cofre do Supabase; a senha só é usada para abrir o arquivo e não é guardada.
          A empresa é reconhecida pelo CNPJ do certificado (um por raiz do CNPJ). Para renovar, compre o novo na certificadora e envie aqui.
        </p>
      </main>
    </div>
  );
}

function EnviarCertificado({ onFechar, onPronto }: { onFechar: () => void; onPronto: (nome: string) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!arquivo) return;
    setEnviando(true);
    setErro("");
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    fd.append("senha", senha);
    const r = await fetch("/api/esocial/certificado", { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ erro: "Falha de conexão com o site." }));
    setEnviando(false);
    setSenha("");
    if (r.erro) return setErro(r.erro);
    setArquivo(null);
    onPronto(r.nome ?? "a empresa");
  }

  return (
    <section className="es-certificado cert-envio">
      <p className="muted">Escolha o arquivo .pfx (ou .p12) e digite a senha do certificado.</p>
      <form className="es-form" onSubmit={enviar}>
        <input type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(v) => setArquivo(v.target.files?.[0] ?? null)} aria-label="Arquivo do certificado" />
        <input type="password" value={senha} onChange={(v) => setSenha(v.target.value)} placeholder="Senha do certificado" autoComplete="off" aria-label="Senha do certificado" />
        <button className="small" disabled={!arquivo || enviando}>{enviando ? "Conferindo…" : "Guardar certificado"}</button>
        <button type="button" className="ghost small" onClick={onFechar}>Cancelar</button>
      </form>
      {erro && <p className="tv-alerta">{erro}</p>}
    </section>
  );
}
