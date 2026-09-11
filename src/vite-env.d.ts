/// <reference types="vite/client" />

/**
 * Build-time configuration.
 *
 * Only public values belong here. Anything prefixed `VITE_` is inlined into the
 * browser bundle by Vite, so a secret placed in one is published to every
 * visitor. The Supabase SECRET key must never be given a `VITE_` name.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  /** The publishable key. Public by design; grants nothing without a session. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
