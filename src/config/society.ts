/**
 * Public-safe operating profile for this prototype.
 *
 * These operating facts were confirmed first-hand on 2026-09-09 by the
 * prototype owner, who is a DVD Tivat firefighter-rescuer. Future application
 * permissions and formal adoption are separate decisions. No private person,
 * phone number, registration plate, address or credential belongs here.
 */
export const SOCIETY_PROFILE = {
  displayName: 'DVD Tivat',
  fullName: 'Dobrovoljno vatrogasno drustvo Tivat',
  confirmedMemberCount: 52,
  assemblyPoint: 'Baza DVD Tivat',
  operatingModel: 'Clanovi dolaze od kuce u bazu, preuzimaju opremu i zatim izlaze na teren.',
  currentFallbackChannel: 'Viber grupa',
  supportedPhoneFamilies: ['iPhone', 'Android'] as const,
  confirmation: 'Operativne podatke potvrdio clan DVD Tivat.',
} as const;
