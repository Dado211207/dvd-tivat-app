/**
 * The one place that sounds a newly-arrived call-out, on WHATEVER route is open.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS APP-LEVEL, AND THE ONLY ALARM
 * ---------------------------------------------------------------------------
 *
 * The sound a person chose is for "a call-out just arrived for me". That is true
 * on the firefighter's screen and equally true while they are reading the archive
 * or changing a setting. So the listener lives once, above the router, rather than
 * inside a screen that only some routes mount. The screen-local alarm that used to
 * live in `MobilisationView` is gone, so one arrival makes exactly one sound.
 *
 * ---------------------------------------------------------------------------
 * WHAT DECIDES WHETHER IT SOUNDS - AND WHAT NEVER DOES
 * ---------------------------------------------------------------------------
 *
 * - **A member alert, from the server.** It sounds only a call-out this account's
 *   MEMBER was actually paged for, read from `intervention_recipients` in that
 *   member's own service. It resolves the member per service through
 *   `current_member_id_in`, so an account with no member record in a service
 *   (the installation owner) has nothing to be alerted about there, however much
 *   they may administer it. The acting-service selector is never consulted: a
 *   dual-service member hears a call-out addressed to either of their services
 *   even while acting in the other; a single-service member never hears the other.
 * - **The choice, live and per account.** Default off, so nobody is made suddenly
 *   noisy. When off, nothing below is mounted at all - no realtime channel, no
 *   reads. Changing the choice on Settings takes effect at once
 *   (`useAlarmSound`); switching account on a shared device remounts this whole
 *   subtree (keyed by user id), discarding the previous account's baseline,
 *   member ids and subscription, and reading only the new account's choice.
 * - **A real baseline.** The call-outs already open when this starts never sound;
 *   only one that appears AFTER the first successful read does. A refused or
 *   failed read is not a baseline and not an empty success - it changes nothing.
 * - **Foreground only, autoplay-safe.** It plays only while the tab is visible; a
 *   hidden or closed tab is the device's own push notification's job, not this.
 *   A play the browser blocks (autoplay) returns without a sound and never throws,
 *   so nothing about the call-out workflow depends on the audio succeeding.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccess } from '@/auth/AccessProvider';
import type { OrganizationCode } from '@/auth/directory';
import { organizationIdOf } from '@/auth/serviceContext';
import { fetchAddressedOpenInterventionIds, fetchOwnMemberId } from '@/auth/operations';
import { useLiveOperations } from '@/auth/live';
import { ALARM_SOUND_OFF, playAlarmSound } from './alarmSounds';
import { useAlarmSound } from './useAlarmSound';
import { useCallOutAlarm } from './useCallOutAlarm';

/** A distinct realtime scope so this never shares a screen's `ops:<id>` channel. */
const ALARM_SCOPE = 'ops:member-alarm';

export function CallOutAlarm() {
  const { access } = useAccess();
  // Nobody signed in, nothing to be alerted about. Keyed by user id below, so a
  // change of account tears the whole listener down and builds a fresh one.
  if (access.kind !== 'SIGNED_IN') return null;
  return (
    <AlarmGate
      key={access.userId}
      userId={access.userId}
      availableServices={access.availableServices}
    />
  );
}

function AlarmGate({
  userId,
  availableServices,
}: {
  userId: string;
  availableServices: readonly OrganizationCode[];
}) {
  const soundId = useAlarmSound(userId);
  // Off is the whole listener being absent: no channel, no reads, no baseline.
  // Turning it on mounts a fresh listener, so the call-outs already open at that
  // moment become its baseline and do not sound.
  if (soundId === ALARM_SOUND_OFF) return null;
  return <ActiveAlarm availableServices={availableServices} soundId={soundId} />;
}

function ActiveAlarm({
  availableServices,
  soundId,
}: {
  availableServices: readonly OrganizationCode[];
  soundId: string;
}) {
  const { openIds, ready, watchedCount } = useAddressedOpenCallOuts(availableServices);
  const [plays, setPlays] = useState(0);

  const play = useCallback((id: string) => {
    // Foreground only. A hidden tab is not where a person is looking; the device's
    // own notification sound covers the app-closed/backgrounded case.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    setPlays((count) => count + 1);
    // Never throws; returns false when audio is blocked or unavailable.
    void playAlarmSound(id);
  }, []);

  useCallOutAlarm(openIds, soundId, play, ready);

  // A hidden, honest signal: it states real listener state (armed, how many
  // services it watches, how many alarms have fired) so a browser test can see
  // the foreground sound fire on any route. It shows nothing to a person.
  return (
    <span
      data-testid="callout-alarm"
      data-ready={ready ? 'true' : 'false'}
      data-watching={watchedCount}
      data-plays={plays}
      data-sound={soundId}
      hidden
    />
  );
}

interface AddressedState {
  readonly openIds: readonly string[];
  readonly ready: boolean;
}

/**
 * The open call-outs this account was paged for, across the services it is a
 * MEMBER of, kept current by realtime.
 *
 * Two steps, both server-backed and identity-guarded. First it resolves the
 * member id in each available service (`current_member_id_in`), keeping only the
 * services that answer with one - so an owner with no member record watches
 * nothing. Then it reads the OPEN call-outs those members were sent and unions
 * them. A realtime notice re-reads through the same policy-checked query; a
 * refused or failed read leaves the last good state untouched rather than
 * inventing an empty one.
 */
function useAddressedOpenCallOuts(availableServices: readonly OrganizationCode[]): {
  openIds: readonly string[];
  ready: boolean;
  watchedCount: number;
} {
  const [members, setMembers] = useState<readonly { org: string; memberId: string }[] | null>(null);
  const [state, setState] = useState<AddressedState>({ openIds: [], ready: false });

  const mounted = useRef(true);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const svcKey = [...availableServices].join(',');

  // Resolve the member id per available service. A new identity (svcKey change,
  // or a remount on account switch) bumps the generation so a late answer from
  // the previous resolution is ignored.
  useEffect(() => {
    const ticket = ++generation.current;
    void (async () => {
      const orgIds =
        svcKey === ''
          ? []
          : svcKey.split(',').map((code) => organizationIdOf(code as OrganizationCode));
      const answers = await Promise.all(orgIds.map((org) => fetchOwnMemberId(org)));
      if (!mounted.current || ticket !== generation.current) return;
      const watched: { org: string; memberId: string }[] = [];
      answers.forEach((answer, index) => {
        const org = orgIds[index];
        if (org !== undefined && answer.ok && answer.value) {
          watched.push({ org, memberId: answer.value });
        }
      });
      setMembers(watched);
    })();
  }, [svcKey]);

  const membersRef = useRef(members);
  membersRef.current = members;

  const read = useCallback(async () => {
    const current = membersRef.current;
    if (current === null) return; // members not resolved yet
    const ticket = generation.current;
    if (current.length === 0) {
      // A member of no watched service (owner): a real, successful "nothing
      // addressed to me" - a baseline that can never produce a new id.
      if (mounted.current) setState({ openIds: [], ready: true });
      return;
    }
    const reads = await Promise.all(
      current.map((watch) => fetchAddressedOpenInterventionIds(watch.org, watch.memberId)),
    );
    if (!mounted.current || ticket !== generation.current) return;
    // A refusal or outage is not an empty archive: keep the last good baseline.
    if (reads.some((result) => !result.ok)) return;
    const union = [...new Set(reads.flatMap((result) => (result.ok ? [...result.value] : [])))];
    setState({ openIds: union, ready: true });
  }, []);

  // Read once members are known, then on every realtime notice.
  useEffect(() => {
    if (members !== null) void read();
  }, [members, read]);

  useLiveOperations({
    enabled: true,
    interventionId: null,
    scope: ALARM_SCOPE,
    onChange: () => void read(),
  });

  return { openIds: state.openIds, ready: state.ready, watchedCount: members?.length ?? 0 };
}
