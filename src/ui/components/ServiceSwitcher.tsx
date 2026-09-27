/**
 * The "acting as DVD / acting as SZS" switch (P6, D14).
 *
 * A person who serves in both services - or the installation owner, who
 * administers both - does everything operational for ONE service at a time: the
 * role they hold, the member record they are, the roster they see, the call-outs
 * addressed to them. This is where they choose which. The owner's decision was an
 * EXPLICIT switch, never a silent one, so it lives on a deliberate screen and is a
 * radio group with two large targets rather than something that flips on its own.
 *
 * It shows only when there is a choice to make. A single-service member has one
 * service and nothing to switch, and sees nothing here. The switch is not
 * authority: choosing a service asks the provider to reload, and the role and
 * member for the chosen service come back from the server - a choice the server
 * does not back grants nothing, it just shows that service's no-role state.
 */

import { useState } from 'react';
import { useAccess } from '@/auth/AccessProvider';
import type { OrganizationCode } from '@/auth/directory';
import { useText } from '@/i18n/useText';

export function ServiceSwitcher() {
  const t = useText();
  const { actingService, availableServices, canSwitchService, setActingService } = useAccess();
  const [switching, setSwitching] = useState(false);

  // Nothing to offer unless the person can act in more than one service. This is
  // what keeps a DVD-only (or SZS-only) member's Settings screen unchanged.
  if (!canSwitchService || actingService === null) return null;

  const choose = async (service: OrganizationCode) => {
    if (service === actingService || switching) return;
    setSwitching(true);
    try {
      // The provider persists the choice and reloads; the new service's role and
      // member are read from the server on that reload, never assumed here.
      await setActingService(service);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="settings-acting-service">
      <h2 className="panel__title" id="settings-acting-service">
        {t.settings.actingServiceTitle}
      </h2>
      <p className="muted small">{t.settings.actingServiceLead}</p>

      {/* A radio group, like the language switch: two large targets on a phone,
          each stating the service it selects, rather than a dropdown that hides
          the alternative behind a tap. */}
      <fieldset className="choice-set">
        <legend className="choice-set__legend">{t.settings.actingServiceLegend}</legend>
        <div className="choice-set__options">
          {availableServices.map((service) => (
            <label
              key={service}
              className={`choice${service === actingService ? ' choice--on' : ''}`}
              data-testid={`acting-service-${service}`}
            >
              <input
                type="radio"
                name="acting-service"
                value={service}
                checked={service === actingService}
                disabled={switching}
                onChange={() => void choose(service)}
              />
              <span className="choice__label">{t.accounts.organizationLabel[service]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="muted small" role="status">
        {switching
          ? t.settings.actingServiceSwitching
          : t.settings.actingServiceCurrent.replace(
              '{service}',
              t.accounts.organizationLabel[actingService],
            )}
      </p>
      <p className="muted small">{t.settings.actingServiceHint}</p>
    </section>
  );
}
