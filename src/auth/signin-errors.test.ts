/**
 * What a failed sign-in is allowed to say.
 *
 * Reported from the device test: signing in through Brave failed with "check
 * your e-mail and password", so the person spent their evening checking a
 * password that was perfectly correct. The request had never left the browser -
 * the shield blocked it, and the application could not tell the difference
 * between that and a wrong password.
 *
 * The distinction is not a relaxation of the anti-enumeration rule, it is the
 * rule applied properly:
 *
 *   * A REFUSAL is an answer from the server. Which "no" it was - no such
 *     address, wrong password, too many attempts - stays private, because a
 *     different message for each would turn the sign-in form into a way to test
 *     who belongs to a volunteer fire society.
 *
 *   * A FAILURE TO REACH the server is not an answer at all. The request never
 *     got there to be judged, so saying so reveals nothing about any account.
 *
 * The detection is deliberately narrow: anything that is not clearly a network
 * failure is treated as a refusal. Guessing wrongly in that direction is the
 * only direction that leaks, so the test is written to be conservative.
 */

import { describe, expect, it } from 'vitest';
import {
  GENERIC_CREDENTIAL_ERROR,
  NETWORK_BLOCKED_HINT,
  NETWORK_UNREACHABLE_ERROR,
  isUnreachable,
} from './supabaseClient';

describe('telling "could not reach" from "was refused"', () => {
  it.each([
    // What a browser actually produces when a fetch is blocked or fails.
    // Chrome and Firefox both say this, and a request stopped by a shield is
    // deliberately indistinguishable from one stopped by a dead network.
    new TypeError('Failed to fetch'),
    new TypeError('NetworkError when attempting to fetch resource.'),
    // Safari.
    new TypeError('Load failed'),
    // Node and undici, which is what supabase-js uses outside a browser.
    new TypeError('fetch failed'),
    // A request that was given up on.
    Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
    new Error('Request timed out'),
    // supabase-js wrapping a transport failure.
    { message: 'TypeError: Failed to fetch' },
    'net::ERR_BLOCKED_BY_CLIENT',
  ])('reads %s as unreachable', (error) => {
    expect(isUnreachable(error)).toBe(true);
  });

  it.each([
    // Every one of these is the SERVER answering. None may be distinguishable
    // from the others on screen.
    new Error('Invalid login credentials'),
    new Error('Email not confirmed'),
    new Error('User already registered'),
    // Rate limiting is an answer too, and a distinct message for it would tell
    // somebody probing addresses which ones are worth probing harder.
    new Error('Email rate limit exceeded'),
    new Error('For security purposes, you can only request this after 39 seconds.'),
    { message: 'Database error querying schema' },
    new Error(''),
    null,
    undefined,
  ])('reads %s as a refusal, not a network problem', (error) => {
    expect(isUnreachable(error)).toBe(false);
  });
});

describe('what the three messages may contain', () => {
  const ALL = [GENERIC_CREDENTIAL_ERROR, NETWORK_UNREACHABLE_ERROR, NETWORK_BLOCKED_HINT];

  it('never leaks anything about the project or the request', () => {
    // These are fixed strings and nothing is ever built from an error, which is
    // what makes this checkable at all. A raw Supabase message, a request URL,
    // a key or a token must never reach a screen.
    for (const message of ALL) {
      expect(message).not.toMatch(/supabase|https?:\/\/|sb_publishable|sb_secret|eyJ|apikey|token/i);
      expect(message).not.toMatch(/\b(4\d\d|5\d\d)\b/); // no status codes
      expect(message).not.toMatch(/[A-Z]{2}\d{3}|PGRST|23505/); // no error codes
    }
  });

  it('says nothing about whether the address has an account', () => {
    for (const message of ALL) {
      expect(message).not.toMatch(/ne postoji|nije registrovan|vec postoji|nepoznat(a)? adresa/i);
    }
  });

  it('keeps the credential message about the credentials and nothing else', () => {
    expect(GENERIC_CREDENTIAL_ERROR).toMatch(/email i lozinku/i);
    expect(GENERIC_CREDENTIAL_ERROR).not.toMatch(/server|mrez|internet/i);
  });

  it('says plainly that the request never arrived', () => {
    expect(NETWORK_UNREACHABLE_ERROR).toMatch(/nije stigao do servera/i);
    // And must NOT send somebody off to check a password that is fine.
    expect(NETWORK_UNREACHABLE_ERROR).not.toMatch(/lozink/i);
  });

  it('offers a blocker as one possible cause, not as the cause', () => {
    expect(NETWORK_BLOCKED_HINT).toMatch(/mozda/i);
    expect(NETWORK_BLOCKED_HINT).toMatch(/blokiranje sadrzaja|zastita privatnosti|Brave/i);
    // Never instructs anybody to turn their protection off. That is not advice
    // this application is entitled to give, and it would be poor advice.
    expect(NETWORK_BLOCKED_HINT).not.toMatch(/iskljucite|ugasite|onemogucite/i);
  });

  it('offers something to do next in every case', () => {
    for (const message of ALL) {
      expect(message).toMatch(/pokusa|pitajte|mozete/i);
    }
  });
});
