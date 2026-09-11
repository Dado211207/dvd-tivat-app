/**
 * A guard that renders its children only for a role the SERVER confirmed.
 *
 * Two things this is not. It is not security - the server refuses the same
 * requests whether or not this component rendered, and that refusal is the
 * control. And it is not a check of anything local: the role comes from
 * `current_dvd_role()` through the access provider, so a suspended account loses
 * the screen on its next reload without the browser being asked to co-operate.
 *
 * What it is for is not offering somebody a screen whose every action would be
 * refused, and saying plainly why, instead of showing an empty table that looks
 * like there is no data.
 */

import type { ReactNode } from 'react';
import { accessObstacle, type OperationalRole } from '@/auth/access';
import { useAccess } from '@/auth/AccessProvider';
import { Notice } from './primitives';

export interface RequireRoleProps {
  readonly allow: readonly OperationalRole[];
  readonly children: ReactNode;
  /** Shown instead of the default explanation when access is refused. */
  readonly refused?: ReactNode;
}

export function RequireRole({ allow, children, refused }: RequireRoleProps) {
  const { access, reload } = useAccess();
  const obstacle = accessObstacle(access);

  if (obstacle === null && access.kind === 'SIGNED_IN' && access.role !== null) {
    if (allow.includes(access.role)) return <>{children}</>;
  }

  if (refused !== undefined) return <>{refused}</>;

  switch (obstacle) {
    case 'LOADING':
      return <p role="status">Provjeravam pristup na serveru...</p>;
    case 'NOT_CONFIGURED':
      return (
        <Notice tone="info">
          Server nije podesen u ovoj verziji, pa se prava pristupa ne mogu provjeriti.
        </Notice>
      );
    case 'SIGN_IN_REQUIRED':
      return <Notice tone="info">Prijavite se da biste vidjeli ovaj dio.</Notice>;
    case 'SERVER_UNREACHABLE':
      return (
        <>
          <Notice tone="error">
            Server nije dostupan, pa se prava pristupa ne mogu provjeriti. Aplikacija zato ne
            prikazuje nista - nedostupna provjera nije isto sto i dozvola.
          </Notice>
          <button className="btn" type="button" onClick={() => void reload()}>
            Pokusaj ponovo
          </button>
        </>
      );
    case 'ACCOUNT_BROKEN':
      return <Notice tone="error">Profil ovog naloga nije pronaden na serveru.</Notice>;
    case 'SUSPENDED':
      return <Notice tone="error">Pristup ovom nalogu je ukinut.</Notice>;
    case 'PROFILE_REQUIRED':
      return <Notice tone="warn">Zavrsite profil da biste nastavili.</Notice>;
    case 'AWAITING_APPROVAL':
    case null:
      return (
        <Notice tone="info">
          Ovaj dio je namijenjen drugoj ulozi. Server ne salje njegove podatke ovom nalogu.
        </Notice>
      );
  }
}
