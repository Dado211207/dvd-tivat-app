# Guide delivery — 4 October 2026

The owner rejected illustrated phone interfaces and supplied actual iPhone footage.
The approved direction is real iPhone installation footage; Android installation
and app usage may be written guides. Desktop usage recording is optional.

This package:
- Uses the supplied iPhone recording with the previously selected Clear narration.
- Masks contacts, names, profile photos and status-bar details.
- Ends on the Add dialog, before the private Home Screen appears.
- Replaces the rejected Android and usage MP4s with android.html and koriscenje.html.
- Grounds Android installation in Google Chrome Help, checked 2026-10-04.
- Documents actual one-tap responses, ETA selection, service selection, automatic
  recipients, separate movement/attendance, commander confirmation, optional
  close report and owner membership preparation from the current source.

Validation: site unit tests and production guide build pass. This is a local
review package, not a verified public deployment. No app/database deployment or
operational callout was performed. Publication branch: codex/real-guides, based on PR #83 head 1bd87ef.
The GitHub commit contains only guide changes; local rejected video renderers
and their draft assets are not included.

Build only the guide:
`npm run build:site -- --app-url https://firenexa-app.netlify.app/`

Deploy only the resulting dist-site directory to the existing guide site.
Do not use the app's netlify.toml build/publish settings for that upload.
