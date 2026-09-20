/**
 * Can somebody tell where they are and what to do, in a few seconds?
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 *
 * Every other browser spec here checks that a capability works. This one checks
 * that a person can find it. The two fail differently and neither catches the
 * other: a screen can pass every functional assertion in this suite and still
 * open on five blocks of chrome before the incident, four equal-weight cards
 * where three steps are already finished, and a primary action below the fold.
 * That is what it did, and no test said so.
 *
 * So the assertions here are about POSITION, COUNT and ORDER:
 *
 *   * the incident is the first thing in the content area;
 *   * there is exactly ONE element claiming to be the next action;
 *   * that action is inside the first viewport, not below it;
 *   * the four facts stay four separate facts, never merged;
 *   * nothing scrolls sideways at any size.
 *
 * ---------------------------------------------------------------------------
 * THE STATES
 * ---------------------------------------------------------------------------
 *
 * The fixture used to answer exactly one situation - commander, active account,
 * one published call-out - so every browser test looked at the busiest screen
 * this application ever shows. The quiet states are the ones a firefighter
 * actually meets most often and the easiest to ship broken: no call-out
 * running, a limited citizen account, a suspended account, a draft. They are
 * all here.
 *
 * Every name, place and record below is invented. There are no real members,
 * no real incidents and no credentials in this file.
 */

import { expect, test, type Page } from '@playwright/test';
import { openOperational } from './fixture-server';

/** A phone held upright - the size this application is designed around. */
const PHONE = { width: 390, height: 844 } as const;
/** The same phone turned sideways, where vertical room is scarcest. */
const PHONE_LANDSCAPE = { width: 844, height: 390 } as const;
const DESKTOP = { width: 1280, height: 900 } as const;

/**
 * Is this element inside the first screenful, without scrolling?
 *
 * Deliberately not `toBeVisible`: Playwright counts an element below the fold
 * as visible, which is exactly the distinction this file exists to make. A
 * `position: fixed` bar is measured against the viewport too, so the bottom
 * navigation does not falsely pass or fail here.
 */
async function isAboveTheFold(page: Page, testId: string): Promise<boolean> {
  const box = await page.getByTestId(testId).first().boundingBox();
  if (!box) return false;
  const height = page.viewportSize()?.height ?? 0;
  return box.y >= 0 && box.y + box.height <= height;
}

async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

// ---------------------------------------------------------------------------

test.describe('a firefighter with a call-out running', () => {
  test('leads with the incident and one action, both without scrolling', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByTestId('callout-title')).toBeVisible();

    // What happened and where, first.
    expect(await isAboveTheFold(page, 'callout-title'), 'incident title').toBe(true);
    expect(await isAboveTheFold(page, 'callout-location'), 'incident location').toBe(true);

    // Exactly one thing being asked for, and it is reachable without scrolling.
    await expect(page.getByTestId('next-action')).toHaveCount(1);
    expect(await isAboveTheFold(page, 'next-action'), 'the next action').toBe(true);
  });

  test('puts the incident above everything else in the content area', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByTestId('callout-title')).toBeVisible();

    const incident = await page.getByTestId('callout-title').boundingBox();
    const action = await page.getByTestId('next-action').boundingBox();
    const status = await page.getByTestId('my-status').boundingBox();
    const push = await page.getByTestId('push-compact').boundingBox();

    expect(incident).not.toBeNull();
    expect(action).not.toBeNull();
    expect(status).not.toBeNull();
    expect(push, 'the compact push line still exists').not.toBeNull();

    // Incident, then the action, then what they have told the commander. The
    // notification line comes LAST: a fire is not the moment to configure
    // alerts, and five lines of notification setup used to sit above the
    // incident.
    expect(incident!.y).toBeLessThan(action!.y);
    expect(action!.y).toBeLessThan(status!.y);
    expect(status!.y).toBeLessThan(push!.y);
  });

  test('keeps the four facts separate and never infers one from another', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByTestId('my-status')).toBeVisible();

    for (const fact of ['acknowledged', 'answered', 'moving', 'attending']) {
      await expect(page.getByTestId(`fact-${fact}`), fact).toHaveCount(1);
    }

    /*
     * The invariant the whole schema rests on, checked in a real browser.
     *
     * This member reported `NA_LICU_MJESTA` and has an attendance interval that
     * nobody confirmed. Being on scene is a statement about position; attendance
     * is a separate record a commander has to confirm. If `attending` ever reads
     * done here, the screen has begun claiming something on a member's behalf.
     */
    await expect(page.getByTestId('fact-moving')).toHaveAttribute('data-mark', 'YES');
    // `PARTIAL`, never `YES`: a self-declared interval is a claim until a
    // commander confirms it. It is also not `NO` - this member genuinely was
    // there for ninety minutes, and saying otherwise would deny their evening.
    await expect(page.getByTestId('fact-attending')).toHaveAttribute('data-mark', 'PARTIAL');
    await expect(page.getByTestId('fact-attending')).toContainText(/ceka potvrdu/i);
  });

  test('keeps every other action one disclosure away, not gone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    const more = page.getByTestId('more-actions');
    await expect(more).toHaveCount(1);

    // Present in the document while closed - a disclosure, not a deletion.
    await expect(more.getByTestId('journey-KRECEM')).toHaveCount(1);
    await expect(more.getByTestId('change-answer-NE_MOGU')).toHaveCount(1);
  });

  test('shows the incident and the action together on a phone held sideways', async ({ page }) => {
    // Stacked, the incident card alone filled a landscape phone and the action
    // fell off the bottom. Landscape is short, not narrow.
    await page.setViewportSize(PHONE_LANDSCAPE);
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByTestId('callout-title')).toBeVisible();

    expect(await isAboveTheFold(page, 'callout-title'), 'incident title').toBe(true);
    expect(await isAboveTheFold(page, 'next-action'), 'the next action').toBe(true);
    expect(await scrollsSideways(page), 'sideways scrolling').toBe(false);
  });
});

// ---------------------------------------------------------------------------

test.describe('a firefighter with nothing running', () => {
  test('gets a calm empty state and their availability, not an error', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'mobilizacija', {
      role: 'FIREFIGHTER',
      interventions: 'NONE',
    });
    await page.waitForSelector('main');

    // No incident, no demand for an action.
    await expect(page.getByTestId('callout-title')).toHaveCount(0);
    await expect(page.getByTestId('next-action')).toHaveCount(0);

    // The availability control is still there, and OPEN rather than behind a
    // disclosure: it is the one thing a member can usefully do between
    // call-outs.
    await expect(page.getByTestId('available-yes')).toBeVisible();
    await expect(page.getByTestId('availability-disclosure')).toHaveCount(0);
    expect(await scrollsSideways(page)).toBe(false);
  });

  test('offers the full notification panel when there is no call-out to read', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'mobilizacija', {
      role: 'FIREFIGHTER',
      interventions: 'NONE',
    });
    await page.waitForSelector('main');

    // Collapsed during a call-out, open when there is time to read it. Neither
    // shape ever asks the browser for permission on its own - there is no
    // `Notification.requestPermission` without a press, which `push.test.ts`
    // holds to directly.
    await expect(page.getByTestId('push-panel')).toBeVisible();
    await expect(page.getByTestId('push-compact')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------

test.describe('a commander', () => {
  test('lands on the running incident and the response counts, not a blank form', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'poziv', 'COMMANDER');
    await expect(page.getByTestId('selected-title')).toBeVisible();

    expect(await isAboveTheFold(page, 'selected-title'), 'the incident').toBe(true);
    expect(await isAboveTheFold(page, 'response-bar'), 'the response counts').toBe(true);

    // The compose form is present and closed, below the running call-out.
    const composer = page.getByTestId('new-call-out-disclosure');
    await expect(composer).toHaveCount(1);
    const incident = await page.getByTestId('selected-title').boundingBox();
    const form = await composer.boundingBox();
    expect(incident!.y).toBeLessThan(form!.y);
  });

  test('counts each answer separately and never merges on scene into attendance', async ({
    page,
  }) => {
    await openOperational(page, 'poziv', 'COMMANDER');
    await expect(page.getByTestId('response-bar')).toBeVisible();

    // Two invited; one said DOLAZIM, one said NE_MOGU; the first is on scene.
    await expect(page.getByTestId('response-invited')).toContainText('2');
    await expect(page.getByTestId('response-coming')).toContainText('1');
    await expect(page.getByTestId('response-declined')).toContainText('1');
    await expect(page.getByTestId('response-onscene')).toContainText('1');

    // `Na terenu` is a count of reported positions. Attendance is confirmed
    // time and lives on its own tab; this bar must never imply it.
    await expect(page.getByTestId('response-bar')).not.toContainText(/prisustv|attendance/i);
  });

  test('shows four tabs on one row on a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'poziv', 'COMMANDER');
    await expect(page.getByTestId('cmd-tab-poziv')).toBeVisible();

    const tops = await Promise.all(
      ['poziv', 'pregled', 'prisustvo', 'vozila'].map(async (id) => {
        const box = await page.getByTestId(`cmd-tab-${id}`).boundingBox();
        return Math.round(box!.y);
      }),
    );
    // Wrapped, `Vozila` sat alone on a second row and read as a separate group
    // of controls. Four tabs, one row.
    expect(new Set(tops).size, `tab tops: ${tops.join(', ')}`).toBe(1);
    expect(await scrollsSideways(page)).toBe(false);
  });

  test('with no intervention at all, says so instead of showing an empty console', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'poziv', {
      role: 'COMMANDER',
      interventions: 'NONE',
    });
    await page.waitForSelector('main');

    await expect(page.getByTestId('selected-title')).toHaveCount(0);
    await expect(page.getByTestId('response-bar')).toHaveCount(0);
    // With nothing running the form is the task, so it is open rather than
    // behind a disclosure - and the picker disappears, because there is nothing
    // to pick between.
    await expect(page.getByTestId('new-title')).toBeVisible();
    await expect(page.getByTestId('intervention-picker')).toHaveCount(0);
  });

  test('never tells a commander their own draft is closed', async ({ page }) => {
    /*
     * The card shows "this intervention is closed and cannot be changed" for a
     * finished intervention. That was read off `isOpenStatus`, which answers a
     * different question - is this RUNNING - and a draft is not running either.
     * So a commander looking at the draft they were about to publish was told it
     * was closed. The firefighter's screen never sees a draft, so sharing one
     * card between the two roles is what surfaced it.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await openOperational(page, 'poziv', { role: 'COMMANDER', interventions: 'DRAFT' });
    await expect(page.getByTestId('selected-title')).toBeVisible();

    await expect(page.getByText(/zatvorena i vise se ne mijenja/i)).toHaveCount(0);
    // And the publishing sequence is offered, which it would not be if the
    // screen genuinely believed this were over.
    await expect(page.getByTestId('recipient-picker')).toBeVisible();
  });

  test('reviews what is about to be sent without repeating the card above it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOperational(page, 'poziv', { role: 'COMMANDER', interventions: 'DRAFT' });
    await expect(page.getByTestId('recipient-picker')).toBeVisible();

    await page.getByTestId('recipient-picker').getByRole('checkbox').first().check();
    await page.getByTestId('to-review').click();

    const review = page.getByTestId('publish-review');
    await expect(review).toBeVisible();
    // Says what and to whom...
    await expect(page.getByTestId('review-what')).toContainText('Nacrt: dimnjak');
    await expect(page.getByTestId('review-count')).toContainText('1');
    await expect(page.getByTestId('review-names')).toContainText('Ivo Vatrogasac');
    // ...and never says provider acceptance is a telephone ringing.
    await expect(review).toContainText(/ne znaci|does not mean|nije dokaz|is not proof/i);

    // Exactly one incident card on the screen. It used to render a second full
    // copy inside the review step, directly below the first.
    await expect(page.locator('.incident')).toHaveCount(1);
  });

  test('keeps a typed draft while an intervention is running', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'poziv', {
      role: 'COMMANDER',
      interventions: 'PUBLISHED_AND_DRAFT',
    });
    await expect(page.getByTestId('selected-title')).toBeVisible();

    // The published one wins the landing selection even though the draft is
    // newer: a commander opens this console to run the call-out they are
    // running, not to finish a note.
    await expect(page.getByTestId('selected-title')).toContainText('Vjezba');

    // Two records, so the switcher appears - and is not labelled "optional".
    const picker = page.getByTestId('intervention-picker');
    await expect(picker).toBeVisible();
    const switcher = page.locator('.switcher');
    await expect(switcher).not.toContainText(/nije obavezno|optional/i);

    // Type into the composer, cross to another tab and come back. Losing this
    // is the fault `live-updates.spec.ts` exists for; it is re-checked here
    // because the panels around it moved.
    await page.getByTestId('new-call-out-disclosure').locator(':scope > summary').click();
    await page.getByTestId('new-title').fill('Izmisljeni nacrt za test');
    await page.getByTestId('cmd-tab-pregled').click();
    await page.getByTestId('cmd-tab-poziv').click();
    await expect(page.getByTestId('new-title')).toHaveValue('Izmisljeni nacrt za test');
  });
});

// ---------------------------------------------------------------------------

test.describe('the refusals are as readable as the screens', () => {
  test('a suspended account is told so, and is shown no operational data', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'mobilizacija', {
      role: 'FIREFIGHTER',
      accountStatus: 'SUSPENDED',
    });
    await page.waitForSelector('main');

    await expect(page.getByText(/pristup je ukinut/i).first()).toBeVisible();
    await expect(page.getByTestId('callout-title')).toHaveCount(0);
    await expect(page.getByTestId('next-action')).toHaveCount(0);
    expect(await scrollsSideways(page)).toBe(false);
  });

  test('a citizen account is told what its limited access means', async ({ page }) => {
    /*
     * A signed-in account with NO DVD operational role. New registrations are
     * citizens, and an SZS-only account has the same null DVD role, so the gate
     * must describe the DVD boundary rather than claim the account failed.
     */
    await page.setViewportSize(PHONE);
    await openOperational(page, 'mobilizacija', { role: null, accountStatus: 'ACTIVE' });
    await page.waitForSelector('main');

    await expect(page.getByText(/nema DVD operativnu ulogu/i).first()).toBeVisible();
    await expect(page.getByTestId('callout-title')).toHaveCount(0);
    // Not an error: the limited citizen/service state is intentional.
    await expect(page.locator('.notice--error')).toHaveCount(0);
  });

  test('a signed-out person is offered the way in, not an error', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'mobilizacija', {
      role: 'FIREFIGHTER',
      signedIn: false,
    });
    await page.waitForSelector('main');

    await expect(page.getByText(/prijav|sign in/i).first()).toBeVisible();
    await expect(page.getByTestId('callout-title')).toHaveCount(0);
  });

  test('a server it cannot reach is said plainly, and nothing is guessed', async ({ page }) => {
    /*
     * The access check itself fails, so the gate does not know who this is.
     *
     * It must show NOTHING operational rather than a best guess: stale data on
     * an intervention is worse than a blank screen, and a screen that renders
     * a call-out it could not verify is a screen that will one day show the
     * wrong one to the wrong person.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await openOperational(page, 'mobilizacija', {
      role: 'FIREFIGHTER',
      serverFails: 'ACCESS',
    });
    await page.waitForSelector('main');

    await expect(page.getByText(/server nije dostupan/i).first()).toBeVisible();
    await expect(page.getByTestId('callout-title')).toHaveCount(0);
    await expect(page.getByTestId('next-action')).toHaveCount(0);
    // And a way to try again, because the condition is temporary.
    await expect(page.getByRole('button', { name: /pokusaj ponovo/i })).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
  });

  test('a refused read is not reported as an outage', async ({ page }) => {
    /*
     * The gate succeeds and the TABLE READS are refused by policy. Those are
     * different facts and they ask different things of the person: an outage is
     * waited out, a refusal means somebody changed what this account may see.
     * Flattening them into one message would send a commander to wait for a
     * server that is working perfectly.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await openOperational(page, 'poziv', { role: 'COMMANDER', serverFails: 'READS' });
    await page.waitForSelector('main');

    await expect(page.getByText(/odbio/i).first()).toBeVisible();
    await expect(page.getByTestId('selected-title')).toHaveCount(0);
    expect(await scrollsSideways(page)).toBe(false);
  });

  test('says it is still checking rather than showing an empty screen', async ({ page }) => {
    /*
     * The loading state had never been looked at in a browser, because the
     * fixture answered instantly and it existed for a frame. Holding the reads
     * makes it observable - and it matters: a blank operational screen and a
     * screen that is still loading look identical, and only one of them is a
     * reason to reach for the telephone instead.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await openOperational(page, 'mobilizacija', { role: 'FIREFIGHTER', slowMs: 1500 });

    const status = page.getByRole('status').filter({ hasText: /ucitavanje|provjera/i }).first();
    await expect(status).toBeVisible();

    // And it resolves into the real screen rather than staying there.
    await expect(page.getByTestId('callout-title')).toBeVisible({ timeout: 15_000 });
    await expect(status).toHaveCount(0);
  });

  test('says the device is offline, in the language being read', async ({ page }) => {
    /*
     * This bar was hardcoded Montenegrin and appears on EVERY operational
     * screen - so on an English screen, in the one state where being understood
     * matters most, it was the only thing not in the reader's language.
     */
    await page.setViewportSize({ width: 390, height: 844 });
    await openOperational(page, 'mobilizacija', { role: 'FIREFIGHTER', language: 'en' });
    await expect(page.getByTestId('callout-title')).toBeVisible();

    await page.context().setOffline(true);
    // `useOnline` listens for the event; the context switch fires it.
    await expect(page.getByTestId('offline-bar')).toBeVisible();
    await expect(page.getByTestId('offline-bar')).toContainText('This device is offline');
    // Says what it MEANS for the work in hand, not merely that a flag flipped.
    await expect(page.getByTestId('offline-bar')).toContainText(/will not be saved/i);

    await page.context().setOffline(false);
  });

  test('says the device is offline in Crnogorski too', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByTestId('callout-title')).toBeVisible();

    await page.context().setOffline(true);
    await expect(page.getByTestId('offline-bar')).toContainText(/nije na mrezi/i);
    await expect(page.getByTestId('offline-bar')).toContainText(/nece biti sacuvano/i);

    await page.context().setOffline(false);
  });

  test('settings stay reachable to somebody the gate refuses', async ({ page }) => {
    // The one person most in need of a refusal message they can read is the one
    // who cannot change its language, if language sits behind the gate.
    await page.setViewportSize(PHONE);
    await openOperational(page, 'podesavanja', {
      role: 'FIREFIGHTER',
      accountStatus: 'SUSPENDED',
    });
    await expect(page.getByTestId('language-en')).toBeVisible();
    await expect(page.getByTestId('language-me')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------

test.describe('both languages, same shape', () => {
  test('the firefighter screen keeps its order and its one action in English', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'mobilizacija', {
      role: 'FIREFIGHTER',
      language: 'en',
    });
    await expect(page.getByTestId('callout-title')).toBeVisible();

    await expect(page.getByTestId('next-action')).toHaveCount(1);
    expect(await isAboveTheFold(page, 'next-action'), 'the next action').toBe(true);
    expect(await scrollsSideways(page), 'sideways scrolling').toBe(false);

    /*
     * The member-entered record is NOT translated, and must not be.
     *
     * A title, a location and an instruction are what somebody typed about a
     * real incident. Translating them would be inventing a second version of an
     * operational record.
     */
    await expect(page.getByTestId('callout-title')).toContainText('Vjezba: provjera opreme');
    await expect(page.getByTestId('callout-location')).toContainText('Poligon iznad Donje Lastve');
  });

  test('the commander console keeps four tabs on one row in English', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openOperational(page, 'poziv', { role: 'COMMANDER', language: 'en' });
    await expect(page.getByTestId('cmd-tab-poziv')).toBeVisible();

    // The English labels are longer. `Attendance` is the one that would wrap.
    const tops = await Promise.all(
      ['poziv', 'pregled', 'prisustvo', 'vozila'].map(async (id) => {
        const box = await page.getByTestId(`cmd-tab-${id}`).boundingBox();
        return Math.round(box!.y);
      }),
    );
    expect(new Set(tops).size, `tab tops: ${tops.join(', ')}`).toBe(1);
    expect(await scrollsSideways(page)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

test.describe('every size, no sideways scrolling', () => {
  for (const [name, size] of [
    ['phone portrait', PHONE],
    ['phone landscape', PHONE_LANDSCAPE],
    ['desktop', DESKTOP],
  ] as const) {
    test(`${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      for (const route of ['mobilizacija', 'poziv', 'arhiva', 'podesavanja']) {
        await openOperational(page, route, 'OWNER');
        await page.waitForSelector('main');
        expect(await scrollsSideways(page), `${route} at ${name}`).toBe(false);
      }
    });
  }
});

// ---------------------------------------------------------------------------

test.describe('the keyboard reaches the same screen', () => {
  test('tabbing from the top arrives at the next action without a trap', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    await expect(page.getByTestId('check-in')).toBeVisible();

    // Walk forward from the document start and record where focus lands. The
    // ceiling is generous on purpose: this asserts the button is REACHABLE, not
    // that it sits at a particular index, which would break on any nav change.
    let reached = false;
    for (let i = 0; i < 40 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') === 'check-in',
      );
    }
    expect(reached, 'the next action is reachable by keyboard').toBe(true);

    // And it is the real control, so pressing it is how it is used.
    await expect(page.getByTestId('check-in')).toBeFocused();
  });

  test('the focused control is visibly focused', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openOperational(page, 'mobilizacija', 'FIREFIGHTER');
    const button = page.getByTestId('check-in');
    await button.focus();

    const outline = await button.evaluate((el) => {
      const style = getComputedStyle(el);
      return `${style.outlineStyle} ${style.outlineWidth} ${style.boxShadow}`;
    });
    // Either a real outline or a focus ring drawn as a shadow; what must not
    // happen is `outline: none` with nothing in its place.
    expect(outline, outline).not.toMatch(/^none 0px none$/);
  });
});
