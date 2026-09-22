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
