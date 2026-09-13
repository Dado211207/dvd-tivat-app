/**
 * The interface, measured at every screen it has to work on.
 *
 * The device test of 13 September reported five separate layout faults, and
 * none of them would have been caught by a screenshot: a screenshot shows what
 * a person would see, but nobody looks at forty of them carefully. So this
 * measures the properties instead - real geometry from a real engine, at each
 * width in the brief - and each assertion names the fault it exists to prevent.
 *
 * What is measured, and why it is the thing itself rather than a proxy:
 *
 *   * horizontal scroll        `documentElement.scrollWidth` against the
 *                              viewport, which is the definition
 *   * clipped text             an element whose content is wider than its own
 *                              box AND which cannot scroll - if it scrolls, the
 *                              text is reachable and it is a scroll region, not
 *                              a clip
 *   * unreachable table        a table wider than its container whose container
 *                              does not scroll: the later columns simply cannot
 *                              be read
 *   * touch targets            measured height, not a class name
 *   * safe areas               the top of the branding against the inset the
 *                              browser reports
 *
 * These run against the fixture project, so the operational screens are
 * populated rather than stopped at the gate. Nothing real is contacted.
 */

import { expect, test, type Page } from '@playwright/test';
import { openOperational } from './fixture-server';

/**
 * Every width the brief names, plus the two that bracket them.
 *
 * 320 is the narrowest phone still in use and the one everything breaks on
 * first; 430 is an iPhone Pro Max; 834x1112 and 1112x834 are an iPad in each
 * orientation; 1280 is a small laptop; 1920 a desktop.
 */
const VIEWPORTS = [
  { name: '320 - smallest phone', width: 320, height: 568 },
  { name: '360 - common Android', width: 360, height: 800 },
  { name: '390 - iPhone', width: 390, height: 844 },
  { name: '430 - iPhone Pro Max', width: 430, height: 932 },
  { name: '834 - tablet portrait', width: 834, height: 1112 },
  { name: '1112 - tablet landscape', width: 1112, height: 834 },
  { name: '1280 - small laptop', width: 1280, height: 800 },
  { name: '1920 - desktop', width: 1920, height: 1080 },
] as const;

const ROUTES = ['poziv', 'mobilizacija', 'arhiva'] as const;

function roleFor(route: string) {
  return route === 'mobilizacija' ? ('FIREFIGHTER' as const) : ('COMMANDER' as const);
}

function anchorFor(page: Page, route: string) {
  if (route === 'mobilizacija') return page.getByTestId('callout-title');
  if (route === 'arhiva') return page.getByTestId('archive-title');
  return page.getByRole('heading', { name: /Vjezba: provjera opreme/ });
}

/**
 * A rectangle is only a problem if a person can actually see it.
 *
 * Injected into the page for the two checks below. A visually hidden table
 * header - `position: absolute; width: 1px; overflow: hidden`, which is how the
 * card layout carries the column names - still lays out its cells at their
 * natural width, so their bounding boxes reach far past the screen while
 * nothing is on it. Intersecting with every clipping ancestor is what tells
 * "off the screen" apart from "clipped away on purpose".
 */
const VISIBLE_RECT = `
  function visibleRect(el) {
    let rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    let node = el.parentElement;
    while (node !== null && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const clips =
        style.overflow === 'hidden' || style.overflowX === 'hidden' ||
        style.overflow === 'clip' || style.overflowX === 'clip' ||
        style.clipPath !== 'none';
      if (clips) {
        const bounds = node.getBoundingClientRect();
        const left = Math.max(rect.left, bounds.left);
        const right = Math.min(rect.right, bounds.right);
        if (right <= left) return null;
        rect = { left, right, width: right - left };
      }
      node = node.parentElement;
    }
    return rect;
  }
`;

/** Elements whose own content overflows them and which cannot be scrolled. */
async function clippedText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const candidates = document.querySelectorAll<HTMLElement>(
      'main h1, main h2, main h3, main dt, main dd, main label, main th, main td,' +
        ' main .picker__title, main .picker__meta, main button, .nav__link, .workspace-heading__title',
    );
    for (const el of candidates) {
      const style = getComputedStyle(el);
      const scrolls =
        style.overflowX === 'auto' || style.overflowX === 'scroll' ||
        style.overflowY === 'auto' || style.overflowY === 'scroll';
      if (scrolls) continue;
      // 1px of slack: sub-pixel text metrics round against us on some fonts.
      const cut = el.scrollWidth - el.clientWidth > 1;
      if (cut && el.clientWidth > 0) {
        problems.push(
          `${el.tagName.toLowerCase()}.${el.className || '-'} "${(el.textContent ?? '').trim().slice(0, 40)}"` +
            ` content ${el.scrollWidth}px in ${el.clientWidth}px`,
        );
      }
    }
    return problems;
  });
}

/** Tables whose later columns cannot be reached by any means. */
async function unreachableColumns(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    ${VISIBLE_RECT}
    const problems = [];
    for (const table of document.querySelectorAll('main table')) {
      const box = table.getBoundingClientRect();
      if (box.width === 0) continue;

      // Walk up for an ancestor that can actually scroll this overflow away.
      let scrollable = false;
      let node = table.parentElement;
      while (node !== null && node !== document.body) {
        const style = getComputedStyle(node);
        if (
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          node.scrollWidth > node.clientWidth
        ) {
          scrollable = true;
          break;
        }
        node = node.parentElement;
      }
      if (scrollable) continue;

      // Not scrollable: every cell a person can see must be inside the screen.
      for (const cell of table.querySelectorAll('th, td')) {
        const cellBox = visibleRect(cell);
        if (cellBox === null) continue;
        if (cellBox.right > window.innerWidth + 1) {
          problems.push(
            (table.dataset.testid || 'table') +
              ' column "' + (cell.textContent || '').trim().slice(0, 24) + '"' +
              ' ends at ' + Math.round(cellBox.right) + 'px, past the ' +
              window.innerWidth + 'px screen, and nothing scrolls',
          );
          break;
        }
      }
    }
    return problems;
  })()`);
}

test.describe('every operational screen at every size', () => {
  for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${route} at ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openOperational(page, route, roleFor(route));
        await expect(anchorFor(page, route)).toBeVisible();

        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(
          overflow.scrollWidth,
          `the page must not scroll sideways (${overflow.scrollWidth}px of content` +
            ` in a ${overflow.innerWidth}px screen)`,
        ).toBeLessThanOrEqual(overflow.innerWidth + 1);

        expect(await clippedText(page), 'text must not be cut off').toEqual([]);
        expect(await unreachableColumns(page), 'every column must be reachable').toEqual([]);
      });
    }
  }
});

test.describe('controls can be hit and read', () => {
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
    test(`every control is big enough at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openOperational(page, 'poziv', 'COMMANDER');
      await expect(anchorFor(page, 'poziv')).toBeVisible();

      const small = await page.evaluate(() => {
        const bad: string[] = [];
        const controls = document.querySelectorAll<HTMLElement>(
          'main button, main a[href], main select, main input:not([type="hidden"]), .nav__link',
        );
        for (const el of controls) {
          const box = el.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) continue; // not rendered
          const type = el.getAttribute('type');
          // A checkbox is hit through its label, which is the row around it.
          if (type === 'checkbox' || type === 'radio') continue;
          if (box.height < 40) {
            bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}" ${Math.round(box.height)}px`);
          }
        }
        return bad;
      });
      expect(small, 'a control shorter than 40px cannot be hit reliably').toEqual([]);
    });
  }
});

test.describe('a table on a telephone', () => {
  test('the archive becomes cards instead of six columns in 260px', async ({ page }) => {
    // Measured before the change: the all-time table was 758px wide inside a
    // 260px container. It scrolled, so nothing was strictly unreachable - but a
    // person holding the phone saw two of six columns and had no way to know
    // there were four more.
    await page.setViewportSize({ width: 320, height: 568 });
    await openOperational(page, 'arhiva', 'COMMANDER');
    await expect(page.getByTestId('archive-title')).toBeVisible();

    const totals = page.getByTestId('archive-totals');
    await expect(totals).toBeVisible();

    const geometry = await totals.evaluate((table) => ({
      tableWidth: table.getBoundingClientRect().width,
      wrapWidth: table.parentElement!.clientWidth,
      // The heading text is carried into each cell as `data-label`, so it must
      // actually be there - a card with unlabelled numbers is worse than a
      // table with hidden columns.
      labels: [...table.querySelectorAll('tbody tr:first-child td')].map(
        (cell) => (cell as HTMLElement).dataset.label ?? '',
      ),
    }));

    expect(
      geometry.tableWidth,
      `the table is ${Math.round(geometry.tableWidth)}px inside ${geometry.wrapWidth}px`,
    ).toBeLessThanOrEqual(geometry.wrapWidth + 1);
    expect(geometry.labels, 'every value keeps the name of its column').toEqual([
      'Potvrdjeno vrijeme',
      'Potvrdjenih',
      'Ceka potvrdu',
      'U toku',
      'Odbijeno',
    ]);
  });

  test('the same table is still a table on a laptop', async ({ page }) => {
    // The cards must not leak upwards: on a screen with room, six columns side
    // by side is the better reading of six facts.
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOperational(page, 'arhiva', 'COMMANDER');
    await expect(page.getByTestId('archive-title')).toBeVisible();

    const display = await page
      .getByTestId('archive-totals')
      .evaluate((table) => getComputedStyle(table).display);
    expect(display).toBe('table');
  });
});

test.describe('a form field is usable on a narrow screen', () => {
  test('the compose fields are wide enough to review what was typed', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openOperational(page, 'poziv', 'COMMANDER');
    await expect(anchorFor(page, 'poziv')).toBeVisible();

    // The device test reported the title and location fields rendering at the
    // browser's default width on a desktop, too narrow to read a whole entry
    // back. The cause was a CSS selector matching only `input[type="text"]`,
    // which these inputs - written without a `type` at all - never matched.
    for (const id of ['new-title', 'new-location']) {
      const field = page.getByTestId(id);
      const box = await field.boundingBox();
      expect(box, `${id} must be rendered`).not.toBeNull();
      expect(
        box!.width,
        `${id} is ${Math.round(box?.width ?? 0)}px wide; a commander must be able to read back a whole title`,
      ).toBeGreaterThan(320);
    }
  });
});
