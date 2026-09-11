# AVIIN ATS — Import Candidates (browser extension)

One-click import of a candidate from a LinkedIn profile page into AVIIN ATS. See the implementation plan this was built from for the full backend/architecture rationale.

## Load it locally (development / not yet published)

1. Open `chrome://extensions` in Chrome (or Edge's equivalent `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` folder.
4. The extension icon appears in the toolbar. Pin it for easy access.

## Test the flow end-to-end

1. Click the icon → log in with a real AVIIN ATS account (email/password — same credentials as the web app).
2. Open any real LinkedIn profile page (a URL like `https://www.linkedin.com/in/<slug>`).
3. Click the icon → **Import This Profile**.
   - **First time on a genuinely new profile**: should show "✓ Imported: {name}" with a link to view the new candidate in AVIIN ATS. Confirm in the app that the candidate has `source = linkedin`, the right name/company/location/LinkedIn URL, and a consent record.
   - **Clicking Import again on the same profile**: should show "Matches an existing candidate" with a link to the one just created — confirming duplicate detection works via the LinkedIn URL, and nothing gets created twice.
4. `captured-profiles` in the AVIIN ATS app (linked from the sidebar) shows every capture and still supports manual review/conversion independent of the extension — that flow is unaffected.

## Known limits (v1)

- **LinkedIn only.** Each site's scraper is a self-contained function in `background.js`'s `ADAPTERS` map (one `chrome.scripting.executeScript({func})` call per import — the reliable MV3 pattern for getting a real return value, unlike injecting a separate content-script file and reading a global back in a second call, which turned out not to be reliable enough in practice). Adding Naukri/Foundit later means adding one more `ADAPTERS` entry — nothing else changes.
- **No email/phone scraping.** LinkedIn profiles rarely expose these without an extra click into "Contact info," which this deliberately doesn't do — those fields stay blank on the created candidate rather than being guessed.
- **LinkedIn's DOM changes without notice.** `ADAPTERS.linkedin.scrapeFn` in `background.js` uses a few known selector patterns plus a `document.title` fallback for the name/headline. If LinkedIn changes its markup and imports start coming back empty or with "Could not read this profile," that function is the one place to fix.
- **Not published to the Chrome Web Store.** "Load unpacked" is the only distribution method for now — a real store listing (review process, privacy policy page, screenshots) is a separate future step.
