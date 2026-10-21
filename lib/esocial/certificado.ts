// Lê o certificado digital A1 (.pfx) do eSocial: devolve o PEM (certificado, cadeia e chave)
// e os dados que aparecem na tela (CNPJ, nome, emissor, validade). A senha só é usada aqui.
import forge from "node-forge";

export type CertificadoLido = {
  pem: string; // certificado da empresa + cadeia + chave privada, em PEM
  cnpj: string;
  raiz: string;
  nome: string;
  titular: string;
  emissor: string;
  validade: Date;
};

const OID_CNPJ = "2.16.76.1.3.3"; // ICP-Brasil: CNPJ no nome alternativo do e-CNPJ

// CNPJ do e-CNPJ: no fim do nome ("EMPRESA LTDA:12345678000190") ou no campo ICP-Brasil do certificado
function cnpjDe(cert: forge.pki.Certificate): string | null {
  const cn = String(cert.subject.getField("CN")?.value ?? "");
  const m = cn.match(/:([A-Z0-9]{12}\d{2})$/);
  if (m) return m[1];
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const oid = forge.asn1.oidToDer(OID_CNPJ).getBytes();
  const i = der.indexOf(oid);
  if (i < 0) return null;
  const m2 = der.slice(i, i + 60).match(/[A-Z0-9]{12}\d{2}/);
  return m2 ? m2[0] : null;
}

export function lerPfx(pfx: Buffer, senha: string): CertificadoLido {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
  } catch {
    throw new Error("Não consegui abrir o certificado. Confira se o arquivo é o .pfx (ou .p12) e se a senha está certa.");
  }

  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const chave = chaves.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!chave) throw new Error("O arquivo não tem a chave privada. Exporte o certificado A1 com a chave.");

  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  // O certificado da empresa é o que tem a mesma chave pública da chave privada
  const proprio = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(chave.n));
  if (!proprio) throw new Error("Não achei o certificado que corresponde à chave dentro do arquivo.");

  const cnpj = cnpjDe(proprio);
  if (!cnpj) throw new Error("Este certificado não é um e-CNPJ (não traz CNPJ). Use o certificado A1 da empresa.");
  const validade = proprio.validity.notAfter;
  if (validade.getTime() <= Date.now()) throw new Error("Este certificado já venceu.");

  const cn = String(proprio.subject.getField("CN")?.value ?? "");
  const nome = cn.replace(/:[A-Z0-9]{12}\d{2}$/, "").trim() || cnpj;
  const emissor = String(proprio.issuer.getField("CN")?.value ?? "");
  const cadeia = certs.filter((c) => c !== proprio);
  const pem = [proprio, ...cadeia].map((c) => forge.pki.certificateToPem(c)).join("") + forge.pki.privateKeyToPem(chave);

  return { pem, cnpj, raiz: cnpj.slice(0, 8), nome, titular: cn, emissor, validade };
}

// Separa o PEM guardado em certificado da empresa, cadeia completa e chave
export function partesPem(pem: string) {
  const certs = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\s*/g) ?? [];
  const chave = pem.match(/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+?-----END (RSA )?PRIVATE KEY-----\s*/)?.[0] ?? "";
  const certificado = certs[0];
  if (!certificado || !chave) throw new Error("Certificado guardado está incompleto. Envie o .pfx de novo pela tela do eSocial.");
  return { certificado, cadeia: certs.join(""), chave };
}
