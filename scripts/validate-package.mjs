import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

const [rawData, html, css, app, refreshWorkflow, pagesWorkflow, netlify, approvedLogo] = await Promise.all([
  read("public/data/latest.json"),
  read("public/index.html"),
  read("public/styles.css"),
  read("public/app.js"),
  read(".github/workflows/refresh-ipu.yml"),
  read(".github/workflows/deploy-pages.yml"),
  read("netlify.toml"),
  readFile(path.join(ROOT, "public/assets/klinik-inocare-horizontal-dark.png"))
]);
const data = JSON.parse(rawData);

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
for (const workflow of [refreshWorkflow, pagesWorkflow]) {
  if (!workflow.includes("actions/configure-pages@v5")) fail("GitHub Pages configuration is missing.");
  if (!workflow.includes("actions/upload-pages-artifact@v4")) fail("GitHub Pages artifact upload is missing.");
  if (!workflow.includes("path: public")) fail("GitHub Pages must publish the public directory.");
  if (!workflow.includes("actions/deploy-pages@v4")) fail("GitHub Pages deployment is missing.");
}
if (!netlify.includes('publish = "public"')) fail("Netlify publish directory is not configured.");
if (createHash("sha256").update(approvedLogo).digest("hex") !== "3b12876e993c8da5120199bb1164a42ecc21bd540da3e0d01ef29824de7540c0") fail("The approved Klinik Inocare logo has been altered.");

console.log(`Validated ${data.stationLatest.length} stations, five regions, two dynamic filters and eight trend points per station.`);
