import { describe, expect, it } from 'vitest';
import { isValidProfileBirthDate, normalizeProfilePhone } from './profile';

describe('required profile guidance', () => {
  it.each([
    ['067 123-456', '+38267123456'],
    ['+382 (69) 222-333', '+38269222333'],
    ['00382 67 123 456', '+38267123456'],
    ['38267123456', '+38267123456'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeProfilePhone(input)).toBe(expected);
  });

  it.each(['', 'abc067123456', '67123456', '+012345678', '+382'])('refuses %s', (input) => {
    expect(normalizeProfilePhone(input)).toBeNull();
  });

  it('accepts only real past dates', () => {
    expect(isValidProfileBirthDate('1995-04-23', '2026-09-20')).toBe(true);
    expect(isValidProfileBirthDate('2027-01-01', '2026-09-20')).toBe(false);
    expect(isValidProfileBirthDate('2026-02-30', '2026-09-20')).toBe(false);
    expect(isValidProfileBirthDate('1899-12-31', '2026-09-20')).toBe(false);
  });
});
