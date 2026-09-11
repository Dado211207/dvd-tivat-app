#!/usr/bin/env node
/**
 * Fails the build if a secret ever reaches the browser bundle.
 *
 * Vite inlines every `VITE_*` variable into the output, so a secret given one of
 * those names is published to every visitor - silently, with no error and no
 * warning. The source-level test in `src/config/accountReadiness.test.ts` checks
 * the repository; this checks the artifact that actually ships, which is the only
 * place the mistake would become real.
 *
 * The publishable key and the project URL ARE expected here. They are public by
 * design and grant nothing on their own: the anonymous database role holds no
 * table privilege and no executable function in this schema.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? 'dist';

/** Each pattern is something that must never appear in a shipped file. */
const FORBIDDEN = [
  { name: 'Supabase secret key', pattern: /sb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: 'service_role JWT', pattern: /"role"\s*:\s*"service_role"/ },
  // A JWT payload is base64url, so the literal string above will not appear in
  // an encoded token. This is the encoded form of `"role":"service_role"`.
  { name: 'service_role JWT (encoded)', pattern: /InJvbGUiOiJzZXJ2aWNlX3JvbGUi/ },
  { name: 'assigned service role key', pattern: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'`]?\S/ },
];

function* filesUnder(directory) {
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* filesUnder(path);
    else yield path;
  }
}

const files = [...filesUnder(ROOT)];
if (files.length === 0) {
  console.error(`No build output found in "${ROOT}". Run the build first.`);
  process.exit(2);
}

const offenders = [];
for (const file of files) {
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const { name, pattern } of FORBIDDEN) {
    if (pattern.test(contents)) offenders.push(`${file}: ${name}`);
  }
}

if (offenders.length > 0) {
  console.error('A secret reached the browser bundle:');
  for (const offender of offenders) console.error(`  - ${offender}`);
  console.error('\nRemove it and rotate the key. Never give a secret a VITE_ name.');
  process.exit(1);
}

console.log(`Checked ${files.length} built files: no secret key in the bundle.`);
