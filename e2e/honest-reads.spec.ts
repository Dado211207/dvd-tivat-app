/**
 * A screen may not say "there is nothing" when it means "I could not look".
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS FILE EXISTS FOR
 * ---------------------------------------------------------------------------
 *
 * A whole-server outage is the easy case: something throws, and every screen
 * already says so. The dangerous case is ONE TABLE a person's role no longer
 * reaches while everything around it keeps answering. Nothing throws, the read
 * returns an empty array, and the screen renders a confident empty result.
 *
 * On the firefighter's screen that empty result reads:
 *
 *     "Nema poziva za vas - Kada vas komandir pozove na intervenciju,
 *      pojavice se ovdje."
 *
 * A firefighter is told there is no incident. That is worse than any error
 * message, worse than a blank screen, and worse than every state the previous
 * two passes fixed, because it is not a failure a person can see.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS BEING ASSERTED, AND WHY IT IS PHRASED THIS WAY
 * ---------------------------------------------------------------------------
 *
 * The contract type is not the fix. The fix is the invariant:
 *
 *     A VIEW MAY NOT RENDER AN EMPTY STATE UNLESS THE READ SUCCEEDED.
 *
 * So each test refuses exactly one table, then asserts two things about the
 * rendered screen: the empty-state wording is ABSENT, and honest failure
 * wording is PRESENT. Asserting only the second would pass on a screen that
 * showed both, which is still a screen telling somebody there is no call-out.
 *
 * Every one of these fails against the behaviour that preceded them: the reads
 * returned `[]` and the screens rendered their empty states with no error at
 * all. That is the point of writing them first.
 */

import { expect, test, type Page } from '@playwright/test';
import { openOperational, type FixtureOptions } from './fixture-server';

const PHONE = { width: 390, height: 844 } as const;

/** The four tables `fetchRecipientFacts` reads. Refusing one is enough. */
const FACTS_TABLE = 'intervention_recipients';

/**
 * Wording that means "there is nothing here", in either language.
 *
 * Deliberately matched on the screens' own sentences rather than on a test id:
 * a test id can be moved onto a failure notice and keep passing while the words
 * a firefighter reads still say the incident does not exist.
 */
const EMPTY_WORDING =
  /nema poziva za vas|no call-outs for you|nema zavrsenih|nothing in the archive/i;

/**
 * Wording that admits a read did not happen, in either language.
 *
 * Each screen already had its own honest sentence for this - the archive says
 * "Arhiva nije ucitana", the firefighter's screen says the server is not
 * reachable, the console distinguishes a refusal from an outage. The fix is not
 * to give them one shared sentence; it is that they must REACH those sentences
 * instead of falling through to an empty state. So this matches all of them.
 */
const FAILURE_WORDING =
  /nije dostupan|nije ucitan|nije moguce|odbio|not available|not loaded|unreachable|refused|could not be read/i;

async function mainText(page: Page): Promise<string> {
  return ((await page.locator('main').textContent()) ?? '').replace(/\s+/g, ' ');
}

/**
 * Opens a screen with the named tables refused, and returns what it rendered.
 *
 * `settledOn` is what makes this deterministic, and it is worth explaining
 * because the first version of this helper was subtly wrong. It waited for the
 * loading line to DISAPPEAR, which is a negative assertion and is satisfied the
 * instant loading stops - including during the gap between the loading line
 * going away and the notice arriving in a later React commit. Alone, the tests
 * passed; in the full parallel suite the machine was slower, that gap widened,
 * and three of them read the screen mid-flight.
 *
 * Waiting for the sentence the screen is going to SETTLE ON removes the race
 * without weakening anything: the assertions still decide which sentence it is,
 * and a screen that settles on the wrong one still fails.
 */
async function openWithRefusal(
  page: Page,
  route: string,
  options: FixtureOptions,
  settledOn: RegExp = new RegExp(`${EMPTY_WORDING.source}|${FAILURE_WORDING.source}`, 'i'),
): Promise<string> {
  await page.setViewportSize(PHONE);
  await openOperational(page, route, options);
  await page.waitForSelector('main');
  await expect(page.locator('main')).toContainText(settledOn, { timeout: 15_000 });
  return mainText(page);
}

// ---------------------------------------------------------------------------

test.describe('a refused interventions read is never shown as "no call-outs"', () => {
  test('on the firefighter screen', async ({ page }) => {
    /*
     * The one proven in the audit. Refusing `interventions` alone left the
     * access check, the roster and availability all answering normally, so
     * nothing threw and the screen said there was no call-out.
     */
    const text = await openWithRefusal(page, 'mobilizacija', {
      role: 'FIREFIGHTER',
      refuseTables: ['interventions'],
    });

    expect(text, 'must not claim there is no call-out').not.toMatch(EMPTY_WORDING);
    expect(text, 'must say the list could not be read').toMatch(FAILURE_WORDING);
    // And nothing pretends to be an incident.
    await expect(page.getByTestId('callout-title')).toHaveCount(0);
    await expect(page.getByTestId('next-action')).toHaveCount(0);
  });

  test('on the commander console', async ({ page }) => {
    const text = await openWithRefusal(page, 'poziv', {
      role: 'COMMANDER',
      refuseTables: ['interventions'],
    });

    expect(text, 'must say the read failed').toMatch(FAILURE_WORDING);
    await expect(page.getByTestId('selected-title')).toHaveCount(0);
    // The response counts describe an intervention that could not be read, so
    // they must not be drawn at all - six zeroes is a claim about a call-out.
    await expect(page.getByTestId('response-bar')).toHaveCount(0);
  });

  test('on the archive', async ({ page }) => {
    const text = await openWithRefusal(page, 'arhiva', {
      role: 'FIREFIGHTER',
      refuseTables: ['interventions'],
    });

    expect(text, 'must not claim the archive is empty').not.toMatch(EMPTY_WORDING);
    expect(text, 'must say the read failed').toMatch(FAILURE_WORDING);
  });
});

// ---------------------------------------------------------------------------

test.describe('a refused facts read is never shown as "you have told them nothing"', () => {
  test('the firefighter status strip does not invent four unrecorded facts', async ({ page }) => {
    /*
     * The worst of the three, because it is not merely absent information - it
     * is a POSITIVE FALSE CLAIM about what this member did. `fetchRecipientFacts`
     * ignored the errors from all four of its queries and used `.data ?? []`, so
     * a refused read rendered a member who had acknowledged, answered and
     * arrived as somebody who had done none of it.
     */
    const text = await openWithRefusal(page, 'mobilizacija', {
      role: 'FIREFIGHTER',
      refuseTables: [FACTS_TABLE],
    });

    expect(text, 'must say the read failed').toMatch(FAILURE_WORDING);
    // Not one fact may be asserted either way from a read that did not happen.
    for (const fact of ['acknowledged', 'answered', 'moving', 'attending']) {
      await expect(page.getByTestId(`fact-${fact}`), fact).toHaveCount(0);
    }
  });

  test('the commander response counts are not drawn from a failed read', async ({ page }) => {
    const text = await openWithRefusal(page, 'poziv', {
      role: 'COMMANDER',
      refuseTables: [FACTS_TABLE],
    });

    expect(text, 'must say the read failed').toMatch(FAILURE_WORDING);
    // "0 dolaze" on a call-out where three people answered is the same lie in
    // a different font.
    await expect(page.getByTestId('response-bar')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------

test.describe('a refused attendance read is never shown as "nobody attended"', () => {
  test('the firefighter is not told their attendance is nothing', async ({ page }) => {
    const text = await openWithRefusal(page, 'mobilizacija', {
      role: 'FIREFIGHTER',
      refuseTables: ['attendance_intervals'],
    });

    expect(text, 'must say the read failed').toMatch(FAILURE_WORDING);
    // The attendance fact in particular: this member has a closed ninety-minute
    // interval, and a failed read must not render as `NO`.
    const attending = page.getByTestId('fact-attending');
    if (await attending.count()) {
      await expect(attending).not.toHaveAttribute('data-mark', 'NO');
    }
  });

  test('the commander is not shown an empty confirmation queue', async ({ page }) => {
    /*
     * The quietest of the three and still serious: a commander who sees an
     * empty pending list concludes there is nothing to confirm, and a
     * firefighter's evening goes uncounted because a read failed.
     */
    const text = await openWithRefusal(page, 'poziv', {
      role: 'COMMANDER',
      refuseTables: ['attendance_intervals'],
    });

    expect(text, 'must say the read failed').toMatch(FAILURE_WORDING);
  });
});

// ---------------------------------------------------------------------------

test.describe('the invariant holds the other way too', () => {
  test('a genuinely empty result still reads as empty, not as a failure', async ({ page }) => {
    /*
     * The other half of the contract, and the reason this is not simply "show an
     * error whenever the list is short". A member with no call-out must still
     * get the calm empty state - turning every quiet evening into an error
     * notice would be its own dishonesty, and would train people to ignore the
     * one that matters.
     */
    const text = await openWithRefusal(page, 'mobilizacija', {
      role: 'FIREFIGHTER',
      interventions: 'NONE',
    });

    expect(text, 'a real empty result says so').toMatch(EMPTY_WORDING);
    expect(text, 'and claims no failure').not.toMatch(FAILURE_WORDING);
    await expect(page.getByTestId('available-yes')).toBeVisible();
  });

  test('a working screen is unaffected', async ({ page }) => {
    const text = await openWithRefusal(
      page,
      'mobilizacija',
      { role: 'FIREFIGHTER' },
      // This screen settles on neither sentence, so it waits for the call-out
      // itself. Waiting for "not loading" here would race exactly as above.
      /Vjezba: provjera opreme/i,
    );

    expect(text).not.toMatch(EMPTY_WORDING);
    expect(text).not.toMatch(FAILURE_WORDING);
    await expect(page.getByTestId('callout-title')).toBeVisible();
    await expect(page.getByTestId('next-action')).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------

/**
 * The same defect one level up, in the gate rather than in a screen.
 *
 * `fetchOwnMemberId` swallowed its error and answered null, and null is also
 * the honest answer for an account genuinely absent from the roster. So the
 * gate rendered the same sentence for both:
 *
 *     "Vas nalog nije povezan sa clanom drustva."
 *
 * That sentence is a claim about the society's roster. Making it without
 * reading the roster is the worst kind of error this application can produce,
 * because it is a plausible statement that sends the person to the wrong place
 * entirely - and it is exactly what the owner of this system read on his own
 * phone before spending an evening on it.
 *
 * `current_member_id()` is `security definer`, so no row policy refuses it per
 * person. A revoked `execute` grant does, with the same 42501, and it would
 * have told EVERY firefighter they were not in the society at once.
 */
const NOT_LINKED_WORDING = /nije povezan sa clanom drustva|not linked to a member of the society/i;

const CHECK_FAILED_WORDING =
  /nismo mogli provjeriti vas clanski zapis|odbio provjeru vaseg clanskog zapisa|could not check your member record|refused to check your member record/i;

test.describe('a refused member check is never shown as "you are not in the society"', () => {
  test('the firefighter screen says the check failed, not that he is not a member', async ({
    page,
  }) => {
    const text = await openWithRefusal(
      page,
      'mobilizacija',
      { role: 'FIREFIGHTER', refuseRpcs: ['current_member_id'] },
      CHECK_FAILED_WORDING,
    );

    expect(text, 'must not claim he is not a member of the society').not.toMatch(
      NOT_LINKED_WORDING,
    );
    expect(text, 'must say the check itself did not happen').toMatch(CHECK_FAILED_WORDING);
    await expect(page.getByTestId('member-check-failed')).toBeVisible();
  });

  test('a refusal still leaves a way out of the screen', async ({ page }) => {
    /*
     * This test originally asserted the OPPOSITE - that a refusal offered no
     * button at all, on the reasoning that pressing one cannot change a
     * server's "no". That was wrong for a dispatch screen: it left a
     * firefighter with no action except killing the application and reopening
     * it, on a phone, during a call-out.
     *
     * The sentence is what stops somebody pressing forever, not the missing
     * button. And the button does real work - `retry` re-reads the access
     * snapshot too, so one press picks up an administrator's fix the moment it
     * lands. What the wording must never do is blame the connection or the
     * roster, and that is what is asserted here.
     */
    await openWithRefusal(
      page,
      'mobilizacija',
      { role: 'FIREFIGHTER', refuseRpcs: ['current_member_id'] },
      CHECK_FAILED_WORDING,
    );

    const notice = page.getByTestId('member-check-failed');
    await expect(notice).toContainText(/odbio|refused/i);
    await expect(notice, 'waiting is named as useless, so nobody sits on it').toContainText(
      /cekanje nece pomoci|waiting will not help/i,
    );
    await expect(
      notice.getByRole('button'),
      'and there is exactly one action, not a dead end',
    ).toHaveCount(1);
  });

  test('an unreachable server does offer retry, and does not blame the roster', async ({
    page,
  }) => {
    const text = await openWithRefusal(
      page,
      'mobilizacija',
      { role: 'FIREFIGHTER', serverFails: 'ACCESS' },
      /./,
    );

    expect(text, 'a server that did not answer is not a roster fact').not.toMatch(
      NOT_LINKED_WORDING,
    );
    expect(text, 'and it says the server is the problem').toMatch(FAILURE_WORDING);
  });
});

test.describe('the gate still lets the people through who belong on the screen', () => {
  /*
   * The half that stops this fix from becoming its own outage. A gate that
   * refuses everybody is trivially honest and completely useless, and the
   * screen guarded here is the one a firefighter opens when the siren goes.
   */
  test('a linked firefighter reaches the call-out', async ({ page }) => {
    const text = await openWithRefusal(
      page,
      'mobilizacija',
      { role: 'FIREFIGHTER' },
      /Vjezba: provjera opreme/i,
    );

    expect(text).not.toMatch(NOT_LINKED_WORDING);
    expect(text).not.toMatch(CHECK_FAILED_WORDING);
    await expect(page.getByTestId('callout-title')).toBeVisible();
    await expect(page.getByTestId('member-check-failed')).toHaveCount(0);
  });

  test('the owner, who is also a firefighter, reaches it too', async ({ page }) => {
    /*
     * The case this whole thread began with. The owner holds OWNER and a member
     * record at once; the gate must not treat holding the top role as a reason
     * to keep him off the screen where he answers a call-out.
     */
    const text = await openWithRefusal(
      page,
      'mobilizacija',
      { role: 'OWNER' },
      /Vjezba: provjera opreme/i,
    );

    expect(text).not.toMatch(NOT_LINKED_WORDING);
    expect(text).not.toMatch(CHECK_FAILED_WORDING);
    await expect(page.getByTestId('callout-title')).toBeVisible();
  });

  test('an account genuinely absent from the roster is still told so plainly', async ({ page }) => {
    /*
     * And the third state has to keep working. An account with no member record
     * must still get the sentence that sends it to an administrator - the fix
     * is that the sentence is now only said when the server actually looked.
     */
    const text = await openWithRefusal(
      page,
      'mobilizacija',
      { role: 'FIREFIGHTER', memberId: null },
      NOT_LINKED_WORDING,
    );

    expect(text, 'a read that succeeded and found nothing still says so').toMatch(
      NOT_LINKED_WORDING,
    );
    expect(text, 'and does not dress it up as a failure').not.toMatch(CHECK_FAILED_WORDING);
  });
});
