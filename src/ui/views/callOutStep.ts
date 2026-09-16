/**
 * What this member should do NEXT about one call-out.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A FUNCTION AND NOT FOUR CARDS
 * ---------------------------------------------------------------------------
 *
 * The screen used to show four numbered sections - seen it, answer, movement,
 * attendance - each in its own panel, each with its own explanatory paragraph,
 * all the same size. A member who had already opened the call-out, already
 * answered and already reported being on scene still saw three finished things
 * at full size, and the one thing left to do was the fourth card down, looking
 * exactly like the three above it.
 *
 * At three in the morning, in gloves, one-handed, that is not a screen anybody
 * can read in a few seconds. So the screen asks this function one question -
 * what is left? - shows that one thing large, and reduces everything already
 * done to a line.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FUNCTION DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It does not merge facts. Opening a call-out, answering it, reporting movement
 * and stating attendance stay four separate records, written by four separate
 * commands, and nothing here makes one imply another - the whole schema is
 * built on keeping them apart. This only decides which of them to put in front
 * of somebody first. Every action remains reachable whatever this returns; see
 * the disclosure on the screen itself.
 */

/** The answers a member can give. Mirrors `RESPONSE_ANSWERS` on the server. */
const COMING = ['DOLAZIM', 'DOLAZIM_KASNIJE'] as const;

export type CallOutStep =
  /** They have not told the commander the call-out reached them. */
  | 'ACKNOWLEDGE'
  /** It reached them; they have not said whether they are coming. */
  | 'ANSWER'
  /** They are coming and have not reported setting off or arriving. */
  | 'MOVE'
  /** They are on scene and have not stated attendance. */
  | 'CHECK_IN'
  /** They are checked in; the remaining act is to check out. */
  | 'CHECK_OUT'
  /** Nothing is expected of them right now. */
  | 'DONE';

/**
 * Where this member's attendance record actually stands.
 *
 * NOT a boolean, and the reason matters. It was one - `checkedIn` - and a
 * member who had checked in, worked ninety minutes and checked out again read
 * as `false`, so the status strip told somebody who had been at the incident
 * all evening that their attendance was "ne". The screen was not merging two
 * facts, it was denying one.
 *
 * Four states because the record has four, and the difference between the last
 * two is the whole product: a member's own report is a claim, and a commander
 * confirming it is what turns the claim into participation.
 */
export type AttendanceStanding =
  /** Nothing recorded at all. */
  | 'NONE'
  /** Checked in and still on the task. */
  | 'OPEN'
  /** A closed record that nobody has confirmed yet. */
  | 'PENDING'
  /** A commander confirmed it. This is the one that counts. */
  | 'CONFIRMED';

export interface CallOutState {
  readonly acknowledged: boolean;
  readonly answer: string | null;
  readonly journey: string | null;
  readonly attendance: AttendanceStanding;
  /** False once the intervention is closed or cancelled: nothing is expected. */
  readonly open: boolean;
}

export function nextStep(state: CallOutState): CallOutStep {
  // A closed intervention asks nothing of anybody. The screen still shows the
  // record; it just stops demanding an action for something that is over.
  if (!state.open) return 'DONE';

  // Checked in is checked in whatever else is missing. Somebody standing at an
  // incident must be able to check out in one tap, and must not be asked to
  // tidy up an answer they never gave first.
  //
  // Only `OPEN`: a closed record, confirmed or not, is not something to check
  // out of, and offering it would write a second interval for an evening that
  // already ended.
  if (state.attendance === 'OPEN') return 'CHECK_OUT';

  if (!state.acknowledged) return 'ACKNOWLEDGE';
  if (state.answer === null) return 'ANSWER';

  // "Ne mogu" is a complete answer. Continuing to demand movement from somebody
  // who has said they cannot come would be the screen refusing to believe them.
  if (!(COMING as readonly string[]).includes(state.answer)) return 'DONE';

  // Turning back is also complete. They said they were coming and then said
  // they are not; there is nothing further to ask.
  if (state.journey === 'ODUSTAJEM') return 'DONE';

  if (state.journey === 'NA_LICU_MJESTA') return 'CHECK_IN';
  return 'MOVE';
}

/**
 * Which of the four facts are already recorded.
 *
 * Used for the compact strip that replaced the four cards. Each entry is one
 * fact with its own name, because a member has to be able to see what they have
 * and have not told the commander - that visibility is the reason the four
 * cards existed, and it is the part worth keeping.
 */
export interface FactState {
  readonly key: 'acknowledged' | 'answered' | 'moving' | 'attending';
  /**
   * `PARTIAL` is not decoration. Three of these facts are genuinely a yes or a
   * no - a member either told the commander or did not. Attendance has a third
   * position, recorded and not yet confirmed, and flattening it into either of
   * the other two would state something untrue about somebody's evening.
   */
  readonly mark: 'YES' | 'NO' | 'PARTIAL';
}

function yesNo(recorded: boolean): 'YES' | 'NO' {
  return recorded ? 'YES' : 'NO';
}

export function factStates(state: CallOutState): readonly FactState[] {
  return [
    { key: 'acknowledged', mark: yesNo(state.acknowledged) },
    { key: 'answered', mark: yesNo(state.answer !== null) },
    { key: 'moving', mark: yesNo(state.journey !== null) },
    {
      key: 'attending',
      mark:
        state.attendance === 'CONFIRMED'
          ? 'YES'
          : state.attendance === 'NONE'
            ? 'NO'
            : // OPEN and PENDING alike: there IS a record, and it is not yet
              // participation. Only a commander's confirmation makes it that.
              'PARTIAL',
    },
  ];
}
