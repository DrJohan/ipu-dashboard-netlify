import { readFile } from "node:fs/promises";
import { createHash, X509Certificate } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(ROOT, relativePath), "utf8");
const fail = (message) => { throw new Error(message); };

function expectedCategory(ipu) {
  if (ipu <= 50) return "Baik";
  if (ipu <= 100) return "Sederhana";
  if (ipu <= 200) return "Tidak Sihat";
  if (ipu <= 300) return "Sangat Tidak Sihat";
  return "Berbahaya";
}

const [rawData, html, css, app, refreshScript, refreshWorkflow, pagesWorkflow, netlify, inocareLogo, cellmaxLogo, jasIntermediate] = await Promise.all([
  read("public/data/latest.json"),
  read("public/index.html"),
  read("public/styles.css"),
  read("public/app.js"),
  read("scripts/refresh-apims.mjs"),
  read(".github/workflows/refresh-ipu.yml"),
  read(".github/workflows/deploy-pages.yml"),
  read("netlify.toml"),
  readFile(path.join(ROOT, "public/assets/klinik-inocare-wound-care-logo.jpg")),
  readFile(path.join(ROOT, "public/assets/cellmax-logo-source.png")),
  readFile(path.join(ROOT, "certs/globalsign-rsa-ov-ssl-ca-2018.pem"))
]);
const data = JSON.parse(rawData);
const jasCertificate = new X509Certificate(jasIntermediate);

if (data.schemaVersion !== 2) fail("Expected snapshot schema version 2.");
if (data.status !== "ready") fail("Snapshot is not ready.");
if (!data.generatedAt?.endsWith("+08:00")) fail("Snapshot timestamp must use Malaysia time.");
if (data.source?.url !== "https://eqms.doe.gov.my/APIMS/main") fail("Primary source is not the official APIMS portal.");
if (data.stationLatest?.length !== 17) fail("Expected exactly 17 monitored stations.");
if (new Set(data.stationLatest.map((row) => `${row.region}|${row.station}`)).size !== 17) fail("Station keys are not unique.");
if (data.stateSummary?.length !== 5) fail("Expected exactly five regional summaries.");
if (data.generatedAt !== data.stationLatest.map((row) => row.sourceTimestamp).sort().at(-1)) fail("Snapshot timestamp is not the newest source timestamp.");
if (data.stationLatest.some((row, index) => row.rank !== index + 1)) fail("Station ranking is not sequential.");
if (data.stationLatest.some((row, index, rows) => index > 0 && row.ipu > rows[index - 1].ipu)) fail("Station ranking is not descending by IPU.");

for (const row of data.stationLatest) {
  if (!Number.isInteger(row.ipu) || row.ipu < 0) fail(`Invalid IPU for ${row.station}.`);
  if (row.category !== expectedCategory(row.ipu)) fail(`Incorrect category for ${row.station}.`);
  if (!row.sourceTimestamp?.endsWith("+08:00")) fail(`Invalid source timestamp for ${row.station}.`);
}

if (data.stationTrend?.length !== data.stationLatest.length * 8) fail("Expected eight trend points for every monitored station.");
for (const station of data.stationLatest) {
  const points = data.stationTrend.filter((row) => row.region === station.region && row.station === station.station);
  if (points.length !== 8) fail(`${station.station} must have exactly eight trend points.`);
  if (new Set(points.map((row) => row.timestamp)).size !== 8) fail(`${station.station} trend timestamps are not distinct.`);
  if (points.some((row) => !Number.isInteger(row.ipu) || row.ipu < 0 || row.category !== expectedCategory(row.ipu))) {
    fail(`Invalid trend reading for ${station.station}.`);
  }
}

const expectedRegions = ["Selangor", "W.P. Kuala Lumpur", "W.P. Putrajaya", "Perak", "Negeri Sembilan"];
if (JSON.stringify(data.stateSummary.map((row) => row.region)) !== JSON.stringify(expectedRegions)) fail("Regional card order or coverage is incorrect.");
for (const summary of data.stateSummary) {
  const regionRows = data.stationLatest.filter((row) => row.region === summary.region);
  const highest = Math.max(...regionRows.map((row) => row.ipu));
  if (summary.highestIpu !== highest || summary.stationCount !== regionRows.length) fail(`Regional summary is inconsistent for ${summary.region}.`);
}

const requiredHtml = ["Negeri / Wilayah", "Stesen", "operational monitoring", "medical advice", "Phosphor Icons"];
for (const text of requiredHtml) if (!html.includes(text)) fail(`Missing required dashboard text: ${text}`);
if (!html.includes("./assets/klinik-inocare-wound-care-logo.jpg")) fail("The supplied Klinik Inocare logo is not displayed.");
if (!html.includes("./assets/cellmax-logo-source.png")) fail("The supplied Cellmax logo is not displayed.");
if ((html.match(/<select\b/g) || []).length !== 2) fail("The line chart must have exactly two hosted filters.");
if (!app.includes("renderTrendFilters(data)")) fail("Trend filters must be populated from snapshot data.");
if (!app.includes("row.region === state.region")) fail("Trend rows must be restricted to one selected region.");
if (!app.includes("renderStationFilter()")) fail("Station options must update with the selected region.");
for (const color of ["#234173", "#538AC3", "#F7F9FC", "#1E293B", "#64748B", "#C62828"]) {
  if (!css.includes(color)) fail(`Missing Klinik Inocare colour ${color}.`);
}
if (!app.includes('ipu > 100 ? "#C62828"')) fail("Unhealthy station bars must use Error Red.");
if (!app.includes('<span class="alert-label">Tidak Sihat</span>')) fail("Unhealthy station bars must include an explicit warning label.");
if (!app.includes('replace(/\\bOgo\\b/g, "Ogos")')) fail("The Malay month name Ogos must not be abbreviated as Ogo.");
if (!refreshWorkflow.includes('timezone: "Asia/Kuala_Lumpur"')) fail("Workflow timezone is not Asia/Kuala_Lumpur.");
if (!refreshWorkflow.includes('cron: "15 */3 * * *"')) fail("Dashboard refresh must run every three hours.");
if (!refreshWorkflow.includes("NODE_EXTRA_CA_CERTS: certs/globalsign-rsa-ov-ssl-ca-2018.pem")) fail("The JAS TLS intermediate is not configured for the refresh job.");
if (refreshScript.includes("process.exitCode = 0")) fail("An unavailable JAS source must not produce a successful workflow result.");
for (const workflow of [refreshWorkflow, pagesWorkflow]) {
  if (!workflow.includes("actions/configure-pages@v5")) fail("GitHub Pages configuration is missing.");
  if (!workflow.includes("actions/upload-pages-artifact@v4")) fail("GitHub Pages artifact upload is missing.");
  if (!workflow.includes("path: public")) fail("GitHub Pages must publish the public directory.");
  if (!workflow.includes("actions/deploy-pages@v4")) fail("GitHub Pages deployment is missing.");
}
if (!netlify.includes('publish = "public"')) fail("Netlify publish directory is not configured.");
if (jasCertificate.fingerprint256.replaceAll(":", "").toLowerCase() !== "b676ffa3179e8812093a1b5eafee876ae7a6aaf231078dad1bfb21cd2893764a") fail("The approved GlobalSign intermediate certificate has been altered.");
if (!jasCertificate.subject.includes("CN=GlobalSign RSA OV SSL CA 2018")) fail("Unexpected JAS TLS intermediate certificate subject.");
if (createHash("sha256").update(inocareLogo).digest("hex") !== "5199fb0cb19e6db4088ec1b9cc454ff1548360d3312e221d7dfac80517a414c1") fail("The supplied Klinik Inocare logo has been altered.");
if (createHash("sha256").update(cellmaxLogo).digest("hex") !== "146f15b92674c4d3828490f71c04bb4787a92f717bb59010db1fa9c2d233ecca") fail("The supplied Cellmax logo has been altered.");

console.log(`Validated ${data.stationLatest.length} stations, five regions, two dynamic filters and eight trend points per station.`);
