/**
 * Normalise a phone number to E.164 (+<country><number>).
 * WhatsApp sends numbers without "+" (e.g. "919876543210").
 * Bare 10-digit numbers are assumed to be Indian (+91) unless another default is given.
 * Returns null when the input cannot be a valid E.164 number.
 */
export function normalizePhone(input: string | null | undefined, defaultCountryCode = '91'): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (!hasPlus) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = defaultCountryCode + digits.slice(1);
    else if (digits.length === 10) digits = defaultCountryCode + digits;
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

/** WhatsApp Cloud API expects recipient numbers without "+". */
export function toWhatsAppRecipient(e164: string): string {
  return e164.replace(/^\+/, '');
}

export function maskPhone(e164: string): string {
  if (e164.length <= 6) return e164;
  return e164.slice(0, 4) + '•'.repeat(e164.length - 7) + e164.slice(-3);
}
