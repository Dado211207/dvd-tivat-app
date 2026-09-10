# First owner test checklist

Purpose: verify that the prototype is clear, consistent and comfortable before it is shown to DVD
Tivat. This is a **simulation-only** test. It must never be used for a real call-out.

Tester: ____________________  Date: __________  Build/head: ____________________

Device: ____________________  OS/browser: ____________________

## 0. Safety boundary before starting

Pass only if all of the following are true:

- The page visibly says **SIMULACIJA**.
- No real member name, telephone number, address, vehicle plate, incident or photograph is entered.
- The test uses one browser and one tab. No cross-device synchronisation is expected.
- **Viber grupa** remains the real existing fallback; this prototype does not connect to it.
- Nobody interprets **Pregledaj i posalji** as a real notification. The expected delivery state is
  **Isporuka nije pokusana**.

Stop the test immediately if the application claims a notification was delivered, makes a real
call, displays private data, or loses the simulation warning.

## 1. Fresh start and navigation

| # | Action | Expected result | Pass |
|---|---|---|:---:|
| 1.1 | Run `npm ci`, then `npm run dev`; open the local Vite address. | **Dezurni** opens directly with the simulation strip visible. | ☐ |
| 1.2 | Open every item in the seven-item menu. | Dojava gradjana, Dezurni, Clan, Vozila, Prikaz u bazi, Clanovi and Istorija all open without an error. | ☐ |
| 1.3 | Resize to a narrow phone window. | Navigation remains usable and the page has no sideways document scroll. | ☐ |
| 1.4 | Use Tab through the page. | Focus is visible; dialogs can be cancelled without a mouse. | ☐ |

## 2. Core call-out exercise

Use only these fictional values:

- Title: `Vjezba: provjera opreme`
- Instruction: `Okupljanje u bazi DVD Tivat. Ponijeti zastitnu opremu.`
- Incident location: `Probni poligon (izmisljeno)`
- Group: `Nosioci IDA aparata`

| # | Action | Expected result | Pass |
|---|---|---|:---:|
| 2.1 | Prepare the exercise and select the group. | The selected count is shown and duplicate members are not counted twice. | ☐ |
| 2.2 | Press **Pregledaj i posalji**. | A review dialog shows the exact recipients and puts **Baza DVD Tivat** before the fictional incident location. Nothing is recorded yet. | ☐ |
| 2.3 | Cancel the dialog once, then open and confirm it. | Cancel records nothing; confirm creates one open exercise and one call. | ☐ |
| 2.4 | Read the delivery notice. | It says **Isporuka nije pokusana**; no answer is fabricated. | ☐ |
| 2.5 | As fictional member Ivan Radulovic, choose **Dolazim** and submit. | The draft is reviewed before submission; one response appears and states that the member comes to the base first. | ☐ |
| 2.6 | As fictional member Petar Krivokapic, choose **Dolazim kasnije**, 30 min, and submit. | The duty view shows one coming, one delayed and the remaining people unanswered. | ☐ |
| 2.7 | Change that delayed answer to **Ne mogu**. | The same member's answer changes; no second response row is created. | ☐ |

## 3. Vehicle and incident state

| # | Action | Expected result | Pass |
|---|---|---|:---:|
| 3.1 | Record MAN-1 departure and confirm. | MAN-1 is out; TERENAC-1 remains in the base. Member responses do not change. | ☐ |
| 3.2 | Set **Ekipa krenula**, then **Na terenu**. | The incident state changes only after each explicit action. | ☐ |
| 3.3 | Open **Prikaz u bazi**. | The active exercise, response totals and vehicle states are legible at a distance. | ☐ |
| 3.4 | Record MAN-1 return. | MAN-1 is back in the base; the incident does not close automatically. | ☐ |
| 3.5 | Close with reason `Probna vjezba zavrsena`. | Confirmation is required; the exercise moves to history. | ☐ |

## 4. Local citizen report and administration

| # | Action | Expected result | Pass |
|---|---|---|:---:|
| 4.1 | Enter an invented citizen report and review it. | The screen repeatedly says it is local and has not reached DVD Tivat. | ☐ |
| 4.2 | Use the reviewed report to prepare a call draft. | It prefills fields only; recipients and normal confirmation are still required. | ☐ |
| 4.3 | Open **Clanovi** as a non-admin actor. | Editing is unavailable and described as a simulated permission. | ☐ |
| 4.4 | Switch to fictional administrator Marko Perovic and add an invented group/member. | The record is local, contains no contact details and appears in the fictional roster. | ☐ |
| 4.5 | Mark that member inactive. | History remains; the member is excluded from new recipient selection. | ☐ |

## 5. Persistence, reset and phone checks

Repeat the phone portion once at approximately **390 x 844** (iPhone pressure) and once at
**412 x 915** (Android pressure).

| # | Action | Expected result | Pass |
|---|---|---|:---:|
| 5.1 | Refresh after recording the fictional exercise. | This browser restores its local state. | ☐ |
| 5.2 | Open a second private/incognito window. | It does not share the first window's state. | ☐ |
| 5.3 | Check Dezurni, Clan, Vozila and the confirmation dialog at both phone sizes. | Text is readable, controls are at least finger-sized, no action is hidden or clipped. | ☐ |
| 5.4 | In Istorija, use the confirmed demo reset. | Only this prototype's current storage is reset and the fictional seed returns. | ☐ |

## 6. Test result

- ☐ PASS — suitable for the first presentation as a workflow prototype.
- ☐ PASS WITH CHANGES — presentation may proceed after the listed issues are corrected.
- ☐ FAIL — do not present until blocking issues are corrected.

Blocking issues:

1. ____________________________________________________________________________
2. ____________________________________________________________________________
3. ____________________________________________________________________________

For every issue record: screen, device/browser, exact steps, expected result, actual result and a
screenshot containing fictional data only. Use [TEST_FEEDBACK_FORM.md](./TEST_FEEDBACK_FORM.md).
