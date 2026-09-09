# DVD Tivat prototype demonstration

Audience: the owner first, then a small discussion with the society. Allow **10–12 minutes**.
This is a workflow prototype, not an operational alerting system.

## Prepare

1. Use the exact reviewed branch head recorded in `docs/ai/PROJECT_STATE.md`. Do not assume an
   unmerged prototype slice is already on `main`. Run `npm ci`, then `npm run dev`. Open the local
   HTTP address printed by Vite. Do not open `dist/index.html` directly. No deployment or paid
   service is necessary.
2. Use one browser and one tab. This prototype does not synchronise across tabs, phones or computers.
3. Keep all names and locations fictional. The role menu changes a simulated actor; it is not a login.
4. If you need a fresh demonstration, use the confirmed reset in **Istorija** only after deciding
   that the existing local demonstration records are no longer needed. Do not clear unrelated site data.
5. Try the script yourself once. Leave the on-screen simulation label visible when presenting.

Opening sentence:

> Ovo je personalizovani prototip za DVD Tivat. Pokazuje kako bismo pripremili vjezbu i pratili
> odzive. Sve osobe i podaci su izmisljeni. Obavjestenja se jos ne salju.

## Walk through one exercise

| Time | Exact action | What to point out |
|---|---|---|
| 0:00 | Open **Dezurni**. Show the DVD Tivat overview and seven navigation options. | Counts refer to fictional records, not operational readiness. Vehicle count means recorded as in the station, not mechanically ready. |
| 0:45 | Enter title `Vjezba: provjera opreme`, instructions `Okupljanje na probnom poligonu. Ponijeti zastitnu opremu.`, incident location `Probni poligon (izmisljeno)`. | Incident and reporter locations are separate. Neither is automatically obtained from GPS. |
| 1:30 | Select **Nosioci IDA aparata**, then **Pregledaj i posalji**. Read the message and four recipients; confirm. | Review happens before recording the call. No recipient is automatically marked as answered or notified. |
| 2:15 | In **Simulirani ucesnik**, choose **Ivan Radulovic**, open **Clan**, select **Dolazim**, then submit the response. | Choosing an answer creates a draft. Only explicit submission records it in this browser. |
| 3:00 | Switch to **Petar Krivokapic**, choose **Dolazim kasnije**, select **30 min**, then submit. Leave two people unanswered. | Silence, refusal and delayed arrival are different facts. The time bands still need the society's confirmation. |
| 3:45 | Return to **Dezurni**. | Show 1 coming, 1 delayed, 0 refusals, 2 unanswered. Delivery still reads **Isporuka nije pokusana**. |
| 4:30 | Open **Vozila**. Record **NV-1** departure and confirm. Return to **Dezurni**, then separately select **Ekipa krenula** and show **Prikaz u domu**. | A person's answer, a vehicle departure and the exercise status are independent actions. |
| 5:30 | Open **Vozila** and record NV-1's return. In **Dezurni**, choose **Zatvori vjezbu**, enter `Probna vjezba zavrsena`, and confirm. | Explain the confirmation before closing and the independent vehicle return. |
| 6:15 | Open **Istorija** and inspect the exercise and activity log. Refresh once. | Saved local records survive a normal refresh. A second device still has its own unrelated data. |
| 7:00 | Resize the browser to a phone width and show **Clan** and the seven-item menu. | This is responsive browser UI, not evidence of native push notifications or app-store readiness. |

## Review the two optional prototype slices

Use these after the core exercise, not as proof of an operational alert channel.

1. Open **Dojava gradjana**, enter an invented report and typed place, and optionally exercise the
   explicit location button with test coordinates. Review the exact dialog, save locally, then mark
   it reviewed in the authorised simulation. Confirm that using it creates only a dispatcher draft:
   recipients and the normal message preview are still required before a call record can exist.
2. Open **Clanovi** as a non-admin simulated actor and show the locked explanation. Switch to the
   fictional administrator **Marko Perovic**, add an invented group, vehicle and member, then mark
   that member inactive. Confirm that the member remains in history but is not offered as a new
   recipient. Never enter a real name, telephone, address or registration.

## Owner's review before presenting

- Can you find every screen without explanation on both desktop and phone?
- Is it unmistakable that a saved citizen report is local and has not reached DVD Tivat?
- Is it unmistakable that the admin role selector is a demonstration control rather than a login?
- Are the text sizes, contrast and buttons comfortable for you in light and dark mode?
- Does **Tab** show a clear focus outline? Does **Preskoci na sadrzaj** leave the current screen intact?
- Does changing the simulated member discard an unsent response instead of passing it to someone else?
- Can you cancel a confirmation without recording the action?
- Do saved data return after refresh, and are storage warnings visible when the browser refuses writes?
- Note the screen, exact steps and expected result for each change you want. Use fictional data in screenshots.

## Ask the society

1. Will only DVD Tivat use this, or is use by another society a real future requirement?
2. Who may initiate a call and who may change the exercise/incident status?
3. Which existing alerting/dispatch arrangements must the application work alongside?
4. Which responses, arrival bands, groups and vehicle fields fit their actual routine?
5. What would make this more useful to them than continuing with the reference product?

Single-society use is the owner's current expectation, **not a confirmed requirement**. Keep the
full questions in [PRODUCT_PLAN.md §G](./PRODUCT_PLAN.md#g-questions-for-the-meeting-with-the-society).
Do not promise a delivery date, alarm reliability, operating cost or store approval before those
requirements are agreed. Record the meeting's decisions in `docs/ai/WORK_LOG.md` and update
`docs/ai/PROJECT_STATE.md` so a new coding session can resume without this conversation.
