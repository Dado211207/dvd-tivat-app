/**
 * The one question the firefighter's screen asks: what is left to do?
 *
 * Every case below is a real position a member can be in during a call-out, and
 * the assertion is what the screen puts in front of them at that moment. Get one
 * of these wrong and somebody standing at an incident is shown the wrong button
 * in the dark.
 */

import { describe, expect, it } from 'vitest';
import { factStates, nextStep, type CallOutState } from './callOutStep';

const fresh: CallOutState = {
  acknowledged: false,
  answer: null,
  journey: null,
  attendance: 'NONE',
  open: true,
};

describe('the next thing to do, in order', () => {
  it('asks first whether the call-out even reached them', () => {
    // The commander's first question is not "are you coming", it is "did this
    // get to you at all". They are different facts and this is the first.
    expect(nextStep(fresh)).toBe('ACKNOWLEDGE');
  });

  it('then asks for an answer', () => {
    expect(nextStep({ ...fresh, acknowledged: true })).toBe('ANSWER');
  });

  it('then asks them to report movement', () => {
    expect(nextStep({ ...fresh, acknowledged: true, answer: 'DOLAZIM' })).toBe('MOVE');
    expect(nextStep({ ...fresh, acknowledged: true, answer: 'DOLAZIM_KASNIJE' })).toBe('MOVE');
  });

  it('keeps asking for movement until they are on scene', () => {
    for (const journey of ['KRECEM', 'U_PUTU']) {
      expect(
        nextStep({ ...fresh, acknowledged: true, answer: 'DOLAZIM', journey }),
        journey,
      ).toBe('MOVE');
    }
  });

  it('asks for attendance once they are on scene', () => {
    expect(
      nextStep({ ...fresh, acknowledged: true, answer: 'DOLAZIM', journey: 'NA_LICU_MJESTA' }),
    ).toBe('CHECK_IN');
  });

  it('offers checking out once they are checked in', () => {
    expect(
      nextStep({
        ...fresh,
        acknowledged: true,
        answer: 'DOLAZIM',
        journey: 'NA_LICU_MJESTA',
        attendance: 'OPEN',
      }),
    ).toBe('CHECK_OUT');
  });
});

describe('an answer that ends the sequence', () => {
  it('asks nothing further of somebody who said they cannot come', () => {
    // Continuing to demand movement from a member who has said "Ne mogu" is the
    // screen refusing to believe them.
    expect(nextStep({ ...fresh, acknowledged: true, answer: 'NE_MOGU' })).toBe('DONE');
  });

  it('asks nothing further of somebody who turned back', () => {
    expect(
      nextStep({ ...fresh, acknowledged: true, answer: 'DOLAZIM', journey: 'ODUSTAJEM' }),
    ).toBe('DONE');
  });

  it('asks nothing at all once the intervention is closed', () => {
    // The record stays readable; the demand for an action stops.
    expect(nextStep({ ...fresh, open: false })).toBe('DONE');
    expect(
      nextStep({ ...fresh, acknowledged: true, answer: 'DOLAZIM', open: false }),
    ).toBe('DONE');
  });
});

describe('somebody standing at the incident', () => {
  it('can check out in one tap even if every earlier fact is missing', () => {
    /*
     * A commander can check a member in from their own console, so a member can
     * legitimately be checked in having never opened the call-out on their own
     * phone. Asking that person to acknowledge a call-out before they may check
     * out would be the screen tidying its own sequence at the expense of the one
     * person who is actually at the fire.
     */
    expect(nextStep({ ...fresh, attendance: 'OPEN' })).toBe('CHECK_OUT');
    expect(nextStep({ ...fresh, attendance: 'OPEN', answer: 'NE_MOGU' })).toBe('CHECK_OUT');
  });

  it('never offers checking out of a record that already closed', () => {
    /*
     * Only an OPEN interval is something to check out of. A closed one - waiting
     * on a commander or already confirmed - is an evening that ended, and
     * offering "Odjavi se" there would write a second interval for it.
     */
    for (const attendance of ['PENDING', 'CONFIRMED'] as const) {
      expect(
        nextStep({
          ...fresh,
          acknowledged: true,
          answer: 'DOLAZIM',
          journey: 'NA_LICU_MJESTA',
          attendance,
        }),
        attendance,
      ).not.toBe('CHECK_OUT');
    }
  });
});

describe('what the member has and has not told the commander', () => {
  it('reports all four facts separately, never merged', () => {
    // The reason the four cards existed. Keeping this visible is the part worth
    // keeping; giving each one a full panel was not.
    const midway: CallOutState = {
      acknowledged: true,
      answer: 'DOLAZIM',
      journey: null,
      attendance: 'NONE',
      open: true,
    };
    expect(factStates(midway)).toEqual([
      { key: 'acknowledged', mark: 'YES' },
      { key: 'answered', mark: 'YES' },
      { key: 'moving', mark: 'NO' },
      { key: 'attending', mark: 'NO' },
    ]);
  });

  it('never infers one fact from another', () => {
    /*
     * The invariant the whole schema rests on. Being on scene is not attendance;
     * answering is not arriving. If this ever starts marking a fact YES that
     * nobody recorded, the screen has begun claiming something on a member's
     * behalf.
     */
    const onSceneNotCheckedIn: CallOutState = {
      acknowledged: true,
      answer: 'DOLAZIM',
      journey: 'NA_LICU_MJESTA',
      attendance: 'NONE',
      open: true,
    };
    const facts = factStates(onSceneNotCheckedIn);
    expect(facts.find((f) => f.key === 'attending')?.mark, 'on scene is not attendance').toBe('NO');
    expect(facts.find((f) => f.key === 'moving')?.mark).toBe('YES');
  });

  it('always reports exactly the four facts, in order', () => {
    expect(factStates(fresh).map((f) => f.key)).toEqual([
      'acknowledged',
      'answered',
      'moving',
      'attending',
    ]);
  });
});

describe('attendance is never flattened into yes or no', () => {
  /*
   * The defect this three-state mark exists to fix.
   *
   * A member who checked in, worked ninety minutes and checked out again had no
   * OPEN interval, so a boolean read `false` and the status strip told them
   * their attendance was "ne". They had been at the incident all evening. The
   * screen was not merging two facts, it was denying one.
   */
  const worked = (attendance: CallOutState['attendance']): CallOutState => ({
    acknowledged: true,
    answer: 'DOLAZIM',
    journey: 'NA_LICU_MJESTA',
    attendance,
    open: true,
  });

  const markFor = (state: CallOutState) =>
    factStates(state).find((f) => f.key === 'attending')?.mark;

  it('says PARTIAL for a closed record nobody has confirmed', () => {
    expect(markFor(worked('PENDING'))).toBe('PARTIAL');
  });

  it('says PARTIAL while they are still on the task', () => {
    // Recorded, and not yet participation: only confirmation makes it that.
    expect(markFor(worked('OPEN'))).toBe('PARTIAL');
  });

  it('says YES only once a commander has confirmed it', () => {
    expect(markFor(worked('CONFIRMED'))).toBe('YES');
  });

  it('says NO only when there is genuinely no record', () => {
    expect(markFor(worked('NONE'))).toBe('NO');
  });

  it('keeps the other three facts a plain yes or no', () => {
    // They really are booleans - a member either told the commander or did not -
    // and giving them a third state would be inventing ambiguity that the
    // records do not have.
    const marks = factStates(worked('PENDING'))
      .filter((f) => f.key !== 'attending')
      .map((f) => f.mark);
    expect(marks.every((m) => m === 'YES' || m === 'NO')).toBe(true);
  });
});
