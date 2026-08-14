# Klinik Inocare IPU Dashboard — Netlify package

This repository is ready for GitHub continuous deployment to Netlify. It retrieves verified hourly readings directly from the official Jabatan Alam Sekitar (JAS) APIMS portal for W.P. Kuala Lumpur, W.P. Putrajaya, Selangor, Perak and Negeri Sembilan.

## What updates automatically

- GitHub Actions runs at 01:15, 09:15 and 17:15 Asia/Kuala_Lumpur. The 15-minute offset gives the official hourly table time to settle.
- `scripts/refresh-apims.mjs` retrieves and validates the official APIMS hourly tables.
- Only a genuinely changed snapshot updates `public/data/latest.json`.
- The workflow commits that one file to `main`.
- Netlify detects the commit and publishes the refreshed dashboard.
- If the source is unchanged, incomplete, stale or unavailable, no commit and no Netlify deployment occurs.
- If APIMS is unreachable after all retries, the workflow finishes successfully with an **IPU refresh skipped** notice and preserves the last complete verified snapshot. Invalid, stale, incomplete or conflicting responses still fail the workflow.

The separate Google Sheet history continues to be maintained by the existing automation. This repository intentionally contains no Google credentials.

## 1. Upload this package to GitHub

Create an empty GitHub repository and upload **the contents of this folder**, preserving hidden folders such as `.github`.

The root of the repository must contain:

```text
.github/
netlify.toml
package.json
package-lock.json
public/
scripts/
```

Do not upload only the `public` folder and do not place this package inside another nested folder.

## 2. Connect the repository to Netlify

1. In Netlify, select **Add new project → Import an existing project**.
2. Select GitHub and authorise the repository.
3. Choose this repository.
4. Set the production branch to `main`.
5. Netlify reads `netlify.toml`; confirm the publish directory is `public` and there is no build command.
6. Select **Deploy**.

Every subsequent data commit from the workflow will trigger Netlify continuous deployment automatically.

## 3. Test the refresh once

1. Open the GitHub repository.
2. Select **Actions → Refresh IPU dashboard**.
3. Select **Run workflow**.
4. Open the workflow log and confirm both `npm run refresh` and `npm test` pass. If APIMS is temporarily unreachable, the run will show **IPU refresh skipped** in its summary and keep the previous verified dashboard data.
5. If JAS has published a newer snapshot, GitHub will create a commit and Netlify will deploy it.

If GitHub reports that workflow write access is restricted, open **Settings → Actions → General → Workflow permissions**, select **Read and write permissions**, and save. Organisation policy may require an administrator to change this.

## Local verification

Node.js 20 or later is required.

```bash
npm ci
npm run refresh
npm test
```

To preview the static files locally:

```bash
npx netlify dev
```

or serve the `public` directory with any static web server.

## Data safeguards

- The monitored-station registry is explicit and limited to 17 reviewed stations.
- Every station keeps its actual JAS source timestamp.
- A station can lag the latest published timestamp by up to two hours; a larger gap stops publication.
- A source more than three hours behind the scheduled run stops publication.
- Two independent official responses are reconciled; conflicting values for the same station and source hour stop publication.
- A station timestamp can never move backwards from the already published snapshot.
- Missing readings are never converted to zero.
- IPU above 100 is always displayed in Klinik Inocare Error Red `#C62828`, with a warning icon and `Tidak Sihat` label.
- The Kuala Lumpur chart contains exactly eight verified readings each for Batu Muda and Cheras.

## Important files

- `public/index.html` — accessible dashboard structure.
- `public/styles.css` — Klinik Inocare design system and responsive layout.
- `public/app.js` — filters, native SVG line chart, bar chart and sortable table.
- `public/data/latest.json` — current published snapshot.
- `scripts/refresh-apims.mjs` — official source retrieval and validation.
- `.github/workflows/refresh-ipu.yml` — eight-hour schedule.
- `netlify.toml` — Netlify publishing and cache rules.

## Source and limitations

Primary source: [JAS APIMS](https://eqms.doe.gov.my/APIMS/main).

The refresh script uses the public hourly-table endpoints called by the official APIMS portal. If JAS changes those endpoints, the workflow will fail safely instead of deploying fabricated or stale values. The dashboard is a published operational snapshot and not a live connection or medical advice.

Phosphor Icons are included under the MIT License. DM Sans and Inter font files are included under the SIL Open Font License.
