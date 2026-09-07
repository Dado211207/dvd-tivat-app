# Independent review: prototype PR #1

Reviewed: 2026-09-07  
Repository: Dado211207/dvd-tivat-app  
Pull request: https://github.com/Dado211207/dvd-tivat-app/pull/1  
Exact head reviewed: 35a6416fc8e5afc5fc7abc9526d433a99fb3e658  
Base: 307ebba9947313f654677c03c54e72fb2e80695b

## Verdict

Suitable for supervised owner testing as an exercise-only, single-browser prototype. No blocking defect was found in the reviewed call, response, vehicle, closure, persistence or display paths. It is not suitable for operational alerting, real member data, public deployment or store submission.

Keep the PR Draft and unmerged until the owner has used the prototype and the two findings below are resolved or consciously accepted.

## Evidence checked

- PR #1 was open, Draft, mergeable and conflict-free at the time of review: four commits, 57 changed files.
- GitHub Actions run 34112528851 and job 101711786698 completed successfully on the exact head at attempt 1.
- All executed steps succeeded: dependency install, lint, strict TypeScript check, unit tests, build, Chromium installation and browser/accessibility tests. The failure-only report upload was correctly skipped.
- The source contains 37 reducer tests and 10 persistence tests.
- The normal CI browser command excludes the screenshot spec and runs 18 tests in each of two projects: desktop and Pixel 5, for 36 results.
- Dispatcher, member-phone and station-display screenshots were inspected from the exact head.
- Critical source paths sampled: domain types, command union, reducer, selectors, persistence, state binding, shell, dispatcher/member/vehicle/display/history views, browser flows, axe tests and CI workflow.

This review did not rerun the suite locally and does not claim real-device, network-delivery or emergency-grade evidence.

## Strengths confirmed

- The prototype labels itself as a simulation and never claims a notification was delivered.
- Call creation, delivery attempt, member response, vehicle movement, exercise status and activity history are separate records.
- Empty/invalid call input, unknown or duplicate recipients, repeated commands, closed/cancelled responses and independent vehicle state are handled in the domain layer.
- Recipient membership is frozen at call creation.
- Response changes keep revision and timestamp evidence.
- Storage failure and corrupt/unknown stored data show explicit limitations.
- The confirmation preview precedes call creation.
- The mobile member view provides large response controls; the station display prioritizes incident, response and vehicle information.
- Keyboard and automated accessibility coverage are present.
- The build has no backend, accounts, runtime network calls or paid service.

## Findings before owner demonstration

### F1: direct-to-location ordering on the member phone

Severity: medium usability risk, not a data-integrity blocker in a simulation.

In MemberView, Dolazim and Ne mogu submit immediately when tapped. The direct-to-location checkbox appears below the answer buttons in the mobile reading order. A member who naturally taps Dolazim first has already submitted before reaching that choice; selecting direct arrival requires noticing and checking the lower control before choosing Dolazim, or editing the response afterwards.

Expected review: make response submission explicit after answer, ETA and destination choices, or otherwise make the required order unmistakable. Add a mobile browser test for Dolazim + direct-to-location through the intended interaction order.

### F2: browser-test total is described inconsistently

Severity: documentation only.

The exact CI path contains 12 flow tests plus six accessibility tests and runs them in desktop and mobile projects: 36 results. Two screenshot tests are desktop-only and deliberately excluded from CI. PROJECT_STATE describes 38 browser tests “across desktop and phone,” while the latest CI report says 36. State the distinction directly: 36 CI browser/accessibility results plus two local desktop screenshot captures, if both were actually run on this head.

## Owner test checklist

1. Start from a reset and confirm the simulation banner remains visible on every view.
2. Compose a fictional exercise, select overlapping group/individual recipients and verify the preview list has no duplicates.
3. Cancel the preview and prove no exercise was created.
4. Send, switch to one addressed member and answer each response type.
5. Specifically test Dolazim plus direct-to-location and report whether the order feels natural.
6. Switch to a non-recipient and confirm the call is hidden.
7. Change a response and verify totals/history.
8. Depart and return one vehicle; confirm member responses do not move it.
9. Change operational status, inspect the station display, close the exercise and confirm replies are rejected.
10. Reload the browser and confirm state persists; reset and confirm only demo data is restored.
11. On the owner's phone, verify navigation to every tab, no clipped critical text and usable controls at the normal text-size setting.
12. Do not enter real names, phone numbers, incidents or locations.

## Next decision

First fix or explicitly accept F1 and correct F2. Then provide an owner-only preview or clear local start instructions and collect numbered feedback. Do not merge, publicly deploy or expand to real alerts before that review.
