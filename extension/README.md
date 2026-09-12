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
5. **Already-imported profile:** the button reads "Update From LinkedIn" instead of "Import This Profile" and a warning box shows the existing candidate. Clicking it still re-scrapes and fills in any fields that are currently blank on that candidate (company/location/skills/email/phone) — it never overwrites a field that already has a value, so a manual correction made in the ATS is safe. Useful for candidates created back when a scraper bug left fields empty.
6. **Bulk import:** open a LinkedIn people-search results page (`linkedin.com/search/results/people/...`) and click **Import All Visible Profiles**. This reads only the result cards already rendered on the page (no scrolling/auto-paging) and imports each one as a thin record (name, best-effort headline/location, profile URL — no company/skills/email/phone at that pass). Enrich any of them afterward by opening that profile individually and clicking "Update From LinkedIn". A system notification reports the batch summary (created/updated/already-up-to-date/failed) even if the popup is closed by the time it finishes.
7. **Notifications:** an import (single or bulk) fires a system notification with the outcome, independent of whether the popup is still open — useful since an import can take a couple of seconds (the Contact info click-and-wait, in particular) and the popup closes the instant it loses focus.

## Known limits (v1)

- **LinkedIn only**, plus best-effort Sales Navigator. Each site's scraper is a self-contained function in `background.js`'s `ADAPTERS` map (one `chrome.scripting.executeScript({func})` call per import — the reliable MV3 pattern for getting a real return value, unlike injecting a separate content-script file and reading a global back in a second call, which turned out not to be reliable enough in practice). `ADAPTERS.salesNavigator` reuses the exact same extraction function as a plain profile page (a Sales Navigator Lead page renders the same underlying profile data in different UI chrome) but **this has not been verified against a real Sales Navigator page** — no test account was available while building it. If it comes back with fields missing that a matching `linkedin.com/in/` import gets fine, check the service worker console's `_debug` output first, same as any other extraction gap. Adding Naukri/Foundit later means adding one more `ADAPTERS` entry — nothing else changes.
- **Bulk import is thinner than a single import, and less rigorously pre-verified.** It only reads name/headline/location/profile-URL from each search-result card (no company-page link, no About/Experience text, no Contact info click) — enrich a result afterward with "Update From LinkedIn" on that profile if you need more. Its card-parsing logic also couldn't be fully verified offline the way the single-profile scraper was (that verification relies on the browser's real `innerText` layout behavior, which the offline test tooling used during development can't simulate) — if imported names/headlines look wrong or shifted, or overall the bulk button doesn't look correct, that's the first place to check; capture a service worker console log the same way as any other scraping issue.
- **Email/phone depend on the profile's own privacy settings.** The scraper clicks LinkedIn's real "Contact info" panel and reads whatever it declares there — it never invents a value. Many profiles (especially 2nd/3rd-degree connections) simply don't expose an email or phone to a given viewer; on those, the fields stay blank, same as before — that's LinkedIn's own visibility rule, not a bug here.
- **LinkedIn's DOM changes without notice.** `ADAPTERS.linkedin.scrapeFn` in `background.js` avoids CSS classes/anchor ids where possible (they're auto-generated and change per LinkedIn deploy) in favor of Open Graph meta tags, heading text, and accessibility attributes — but if LinkedIn changes markup enough and imports start coming back empty or with "Could not read this profile," that function is the one place to fix. Its `_debug` output (visible in the service worker's console) reports exactly which extraction step failed.
- **Not published to the Chrome Web Store.** "Load unpacked" is the only distribution method for now — a real store listing (review process, privacy policy page, screenshots) is a separate future step.
