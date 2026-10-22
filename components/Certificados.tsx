"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Topo from "./Topo";

// Certificados digitais (e-CNPJ A1): um por CNPJ completo (tabela certificados, supabase/certificados.sql).
// O da matriz (final 0001) é o que o eSocial e a Receita Federal usam; o de uma filial fica guardado
// à parte e nunca substitui o da matriz.
type Certificado = {
  cnpj: string; raiz: string; matriz: boolean; nome: string; titular: string | null; emissor: string | null;
  validade: string; atualizado_em: string; atualizado_por: string | null;
};
type Empresa = { id: string; nome: string };
type Grupo = { raiz: string; nome: string; certs: Certificado[] };

const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
const dataHora = (iso: string) =>
  `${dia(iso)} às ${new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`;
const cnpjMask = (c: string | null) => (c ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : "");
const diasAte = (iso: string) => Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);

function situacao(validade: string): { texto: string; classe: string } {
  const d = diasAte(validade);
  if (d < 0) return { texto: `Venceu em ${dia(validade)}`, classe: "tv-falha" };
  if (d <= 30) return { texto: `Vence em ${d} dia${d === 1 ? "" : "s"}`, classe: "tv-revisar" };
  return { texto: `Válido até ${dia(validade)}`, classe: "tv-ok" };
}

export default function Certificados({ userId, userEmail }: { userId: string; userEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [certs, setCerts] = useState<Certificado[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [carregado, setCarregado] = useState(false);
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    const [c, e] = await Promise.all([
      supabase.from("certificados").select("cnpj,raiz,matriz,nome,titular,emissor,validade,atualizado_em,atualizado_por").order("cnpj"),
      supabase.from("esocial_empresas").select("id,nome").order("ordem").order("nome"),
    ]);
    const lista = (c.data ?? []) as Certificado[];
    setCerts(lista);
    setEmpresas((e.data ?? []) as Empresa[]);
    const uids = [...new Set(lista.map((x) => x.atualizado_por).filter(Boolean))] as string[];
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

  // Uma caixa por empresa (raiz do CNPJ): matriz primeiro, depois as filiais
  const grupos = useMemo(() => {
    const g = new Map<string, Grupo>();
    for (const e of empresas) g.set(e.id, { raiz: e.id, nome: e.nome, certs: [] });
    for (const c of certs) {
      if (!g.has(c.raiz)) g.set(c.raiz, { raiz: c.raiz, nome: c.nome, certs: [] });
      g.get(c.raiz)!.certs.push(c);
    }
    for (const x of g.values()) x.certs.sort((a, b) => Number(b.matriz) - Number(a.matriz) || a.cnpj.localeCompare(b.cnpj));
    return [...g.values()];
  }, [certs, empresas]);

  function pronto(r: { nome: string; cnpj?: string; matriz?: boolean }) {
    setAviso(r.matriz === false
      ? `Certificado da filial ${cnpjMask(r.cnpj ?? "")} (${r.nome}) guardado. O da matriz continua o mesmo.`
      : `Certificado da matriz de ${r.nome} guardado.`);
    carregar();
  }

  function irParaEnvio() {
    const q = document.getElementById("cert-envio");
    q?.scrollIntoView({ behavior: "smooth", block: "start" });
    q?.querySelector("input")?.focus({ preventScroll: true });
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
            <p className="muted">Os e-CNPJ A1 da matriz e das filiais. O da matriz é o que o Brasico usa para ler o eSocial e a Receita Federal.</p>
          </div>
        </div>

        {/* Único lugar de envio: o CNPJ do arquivo diz de qual empresa e se é matriz ou filial */}
        <EnviarCertificado onPronto={pronto} />
        {aviso && <p className="es-aviso">{aviso}</p>}

        {!carregado ? (
          <div className="es-esqueleto" aria-hidden="true"><i /><i /><i /></div>
        ) : grupos.length === 0 ? (
          <section className="es-bloco">
            <p>Nenhum certificado ainda. Envie o arquivo .pfx de uma empresa para começar.</p>
          </section>
        ) : (
          <div className="cert-lista">
            {grupos.map((g) => {
              const temMatriz = g.certs.some((c) => c.matriz);
              return (
                <section key={g.raiz} className="es-bloco cert-cartao">
                  <div className="es-linha">
                    <strong className="es-nome">{g.nome}</strong>
                    <span className="muted">{g.certs.length} certificado{g.certs.length === 1 ? "" : "s"}</span>
                  </div>
                  {!temMatriz && (
                    <div className="cert-item cert-falta">
                      <span className="cert-tipo">Matriz</span>
                      <span>Sem o certificado da matriz. Sem ele o eSocial e a Receita Federal não funcionam para esta empresa.</span>
                      <button className="ghost small" onClick={irParaEnvio}>Enviar</button>
                    </div>
                  )}
                  {g.certs.map((c) => {
                    const s = situacao(c.validade);
                    return (
                      <div key={c.cnpj} className="cert-item">
                        <div className="es-linha">
                          <div>
                            <span className={c.matriz ? "cert-tipo matriz" : "cert-tipo"}>{c.matriz ? "Matriz" : "Filial"}</span>
                            <strong>CNPJ {cnpjMask(c.cnpj)}</strong>
                          </div>
                          <span className={`estado ${s.classe}`}>{s.texto}</span>
                        </div>
                        <dl className="cert-dados">
                          {c.titular && <><dt>Titular</dt><dd>{c.titular}</dd></>}
                          {c.emissor && <><dt>Emitido por</dt><dd>{c.emissor}</dd></>}
                          <dt>Enviado</dt>
                          <dd>{dataHora(c.atualizado_em)}{c.atualizado_por && nomes[c.atualizado_por] ? ` · ${nomes[c.atualizado_por]}` : ""}</dd>
                          <dt>Usado em</dt>
                          <dd>{c.matriz ? "RH · eSocial e Receita Federal" : "Guardado (ainda não usado pelo site)"}</dd>
                        </dl>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}

        <p className="muted es-nota">
          Cada CNPJ tem o seu certificado: o de uma filial nunca substitui o da matriz. Enviar de novo o mesmo CNPJ troca só aquele
          (é assim que se renova). O arquivo fica no cofre do Supabase; a senha só é usada para abrir o arquivo e não é guardada.
        </p>
      </main>
    </div>
  );
}

function EnviarCertificado({ onPronto }: { onPronto: (r: { nome: string; cnpj?: string; matriz?: boolean }) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!arquivo) return;
    const form = ev.currentTarget as HTMLFormElement;
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
    form.reset();
    onPronto({ nome: r.nome ?? "a empresa", cnpj: r.cnpj, matriz: r.matriz });
  }

  return (
    <section className="es-bloco es-certificado cert-envio" id="cert-envio">
      <h2>Enviar ou trocar certificado</h2>
      <p className="muted">Escolha o arquivo .pfx (ou .p12) e digite a senha. O CNPJ do certificado diz de qual empresa ele é
        e se é da matriz ou de uma filial; cada um fica guardado separado.</p>
      <form className="es-form" onSubmit={enviar}>
        <input type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(v) => setArquivo(v.target.files?.[0] ?? null)} aria-label="Arquivo do certificado" />
        <input type="password" value={senha} onChange={(v) => setSenha(v.target.value)} placeholder="Senha do certificado" autoComplete="off" aria-label="Senha do certificado" />
        <button className="small" disabled={!arquivo || enviando}>{enviando ? "Conferindo…" : "Guardar certificado"}</button>
      </form>
      {erro && <p className="tv-alerta">{erro}</p>}
    </section>
  );
}
