/**
 * Public-safe operating profile for this prototype.
 *
 * These facts were reported by the prototype owner on 2026-09-09 and still
 * need confirmation by DVD Tivat before production use. No private person,
 * phone number, registration plate, address or credential belongs here.
 */
export const SOCIETY_PROFILE = {
  displayName: 'DVD Tivat',
  fullName: 'Dobrovoljno vatrogasno drustvo Tivat',
  reportedMemberCount: 52,
  assemblyPoint: 'Baza DVD Tivat',
  operatingModel: 'Clanovi dolaze od kuce u bazu, preuzimaju opremu i zatim izlaze na teren.',
  currentFallbackChannel: 'Viber grupa',
  supportedPhoneFamilies: ['iPhone', 'Android'] as const,
  confirmation: 'Podaci vlasnika prototipa; ceka potvrdu DVD Tivat.',
} as const;

