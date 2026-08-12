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

const [rawData, html, css, app, workflow, netlify, approvedLogo] = await Promise.all([
  read("public/data/latest.json"),
  read("public/index.html"),
  read("public/styles.css"),
  read("public/app.js"),
  read(".github/workflows/refresh-ipu.yml"),
  read("netlify.toml"),
  readFile(path.join(ROOT, "public/assets/klinik-inocare-horizontal-dark.png"))
]);
const data = JSON.parse(rawData);

if (data.status !== "ready") fail("Snapshot is not ready.");
if (!data.generatedAt?.endsWith("+08:00")) fail("Snapshot timestamp must use Malaysia time.");
if (data.source?.url !== "https://eqms.doe.gov.my/APIMS/main") fail("Primary source is not the official APIMS portal.");
if (data.stationLatest?.length !== 16) fail("Expected exactly 16 monitored stations.");
if (new Set(data.stationLatest.map((row) => `${row.region}|${row.station}`)).size !== 16) fail("Station keys are not unique.");
if (data.stateSummary?.length !== 4) fail("Expected exactly four regional summaries.");
if (data.generatedAt !== data.stationLatest.map((row) => row.sourceTimestamp).sort().at(-1)) fail("Snapshot timestamp is not the newest source timestamp.");
if (data.stationLatest.some((row, index) => row.rank !== index + 1)) fail("Station ranking is not sequential.");
if (data.stationLatest.some((row, index, rows) => index > 0 && row.ipu > rows[index - 1].ipu)) fail("Station ranking is not descending by IPU.");

for (const row of data.stationLatest) {
  if (!Number.isInteger(row.ipu) || row.ipu < 0) fail(`Invalid IPU for ${row.station}.`);
  if (row.category !== expectedCategory(row.ipu)) fail(`Incorrect category for ${row.station}.`);
  if (!row.sourceTimestamp?.endsWith("+08:00")) fail(`Invalid source timestamp for ${row.station}.`);
}

for (const station of ["Batu Muda", "Cheras"]) {
  const points = data.klTrend.filter((row) => row.station === station);
  if (points.length !== 8) fail(`${station} must have exactly eight trend points.`);
  if (new Set(points.map((row) => row.timestamp)).size !== 8) fail(`${station} trend timestamps are not distinct.`);
}

const expectedRegions = ["Selangor", "W.P. Kuala Lumpur", "Perak", "Negeri Sembilan"];
if (JSON.stringify(data.stateSummary.map((row) => row.region)) !== JSON.stringify(expectedRegions)) fail("Regional card order or coverage is incorrect.");
for (const summary of data.stateSummary) {
  const regionRows = data.stationLatest.filter((row) => row.region === summary.region);
  const highest = Math.max(...regionRows.map((row) => row.ipu));
  if (summary.highestIpu !== highest || summary.stationCount !== regionRows.length) fail(`Regional summary is inconsistent for ${summary.region}.`);
}

const requiredHtml = ["Negeri / Wilayah", "Stesen", "operational monitoring", "medical advice", "Phosphor Icons"];
for (const text of requiredHtml) if (!html.includes(text)) fail(`Missing required dashboard text: ${text}`);
if ((html.match(/<select\b/g) || []).length !== 2) fail("The line chart must have exactly two hosted filters.");
if (!html.includes('<option value="W.P. Kuala Lumpur">') || !html.includes('<option value="Batu Muda">') || !html.includes('<option value="Cheras">')) fail("The restricted Kuala Lumpur filter options are incomplete.");
for (const color of ["#234173", "#538AC3", "#F7F9FC", "#1E293B", "#64748B", "#C62828"]) {
  if (!css.includes(color)) fail(`Missing Klinik Inocare colour ${color}.`);
}
if (!app.includes('ipu > 100 ? "#C62828"')) fail("Unhealthy station bars must use Error Red.");
if (!app.includes('<span class="alert-label">Tidak Sihat</span>')) fail("Unhealthy station bars must include an explicit warning label.");
if (!workflow.includes('timezone: "Asia/Kuala_Lumpur"')) fail("Workflow timezone is not Asia/Kuala_Lumpur.");
if (!netlify.includes('publish = "public"')) fail("Netlify publish directory is not configured.");
if (createHash("sha256").update(approvedLogo).digest("hex") !== "3b12876e993c8da5120199bb1164a42ecc21bd540da3e0d01ef29824de7540c0") fail("The approved Klinik Inocare logo has been altered.");

console.log(`Validated ${data.stationLatest.length} stations, four regions, two filters and eight trend points per KL station.`);
