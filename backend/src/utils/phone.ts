/**
 * Normalização única de telefones brasileiros.
 *
 * O projeto tinha 4 implementações divergentes espalhadas (authController,
 * clientPortalController, crmController e whatsappManager). Cada uma gerava um
 * formato diferente para o mesmo número, o que criava clientes duplicados e
 * fazia buscas por telefone falharem silenciosamente.
 *
 * Formato canônico: 55 + DDD (2) + assinante (8 ou 9 dígitos), somente dígitos.
 *
 * Regra do 9º dígito: DDDs de 11 a 28 usam obrigatoriamente 9 dígitos no número
 * do assinante; do 29 em diante o WhatsApp ainda opera com 8 dígitos. Mantemos
 * essa regra em um só lugar para que backend e bot concordem.
 */

const DDD_MIN_WITH_NINTH_DIGIT = 11;
const DDD_MAX_WITH_NINTH_DIGIT = 99;

export function normalizePhone(input: string | null | undefined): string {
  if (!input) return '';

  let digits = String(input).replace(/\D/g, '');
  if (!digits) return '';

  // Remove zeros de discagem nacional (ex.: 0 11 99999-9999)
  digits = digits.replace(/^0+/, '');

  // Identificação de LID (IDs numéricos de 14+ dígitos gerados pelo WhatsApp)
  if (digits.length > 13) {
    if (digits.startsWith('55') && digits.length === 17) {
      return digits.substring(2);
    }
    return digits;
  }

  // Garante o DDI 55. Números com 10 ou 11 dígitos são locais (DDD + assinante).
  if (!digits.startsWith('55') || digits.length <= 11) {
    digits = '55' + digits;
  }

  const ddd = parseInt(digits.substring(2, 4), 10);
  const subscriber = digits.substring(4);

  if (Number.isNaN(ddd)) return digits;

  const usesNinthDigit = ddd >= DDD_MIN_WITH_NINTH_DIGIT && ddd <= DDD_MAX_WITH_NINTH_DIGIT;

  if (usesNinthDigit && subscriber.length === 8) {
    // Faltou o 9: acrescenta.
    return `55${digits.substring(2, 4)}9${subscriber}`;
  }

  if (!usesNinthDigit && subscriber.length === 9 && subscriber.startsWith('9')) {
    // 9 sobrando para DDDs que não o usam: remove.
    return `55${digits.substring(2, 4)}${subscriber.substring(1)}`;
  }

  return digits;
}

/**
 * Compara dois telefones tolerando a presença/ausência do 9º dígito.
 * Substitui o antigo `endsWith(phone.slice(-9))`, que retornava `true` para
 * qualquer telefone quando o valor comparado era vazio ou muito curto.
 */
export function isSamePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const normA = normalizePhone(a);
  const normB = normalizePhone(b);

  // Um telefone inválido nunca casa com nada (fail-secure).
  if (normA.length < 12 || normB.length < 12) return false;

  return normA === normB;
}
