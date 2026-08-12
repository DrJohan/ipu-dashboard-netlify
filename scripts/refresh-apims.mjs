import { appendFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_FILE = path.join(PROJECT_ROOT, "public", "data", "latest.json");
const TIME_ZONE = "Asia/Kuala_Lumpur";
const MYT_OFFSET = "+08:00";
const APIMS_PORTAL = "https://eqms.doe.gov.my/APIMS/main";
const APIMS_API = process.env.APIMS_API_URL || "https://eqms.doe.gov.my/api3/publicportalapims/apitablehourly";
const GOOGLE_SHEET = "https://docs.google.com/spreadsheets/d/1McGmQMW7SexQJvvWOwJd1JAe9PyADt5PsSCK43QgTtE/edit";
const REQUEST_TIMEOUT_MS = Number(process.env.APIMS_REQUEST_TIMEOUT_MS || 20_000);
const FETCH_ATTEMPTS = Number(process.env.APIMS_FETCH_ATTEMPTS || 5);
const SAMPLE_DELAY_MS = Number(process.env.APIMS_SAMPLE_DELAY_MS || 1_500);
const STATE_DELAY_MS = Number(process.env.APIMS_STATE_DELAY_MS || 2_000);

const STATE_IDS = [5, 8, 10, 14];
const EXPECTED_REGIONS = ["Selangor", "W.P. Kuala Lumpur", "Perak", "Negeri Sembilan"];
const STATIONS = [
  { stationId: "CA15W", region: "W.P. Kuala Lumpur", station: "Batu Muda" },
  { stationId: "CA16W", region: "W.P. Kuala Lumpur", station: "Cheras" },
  { stationId: "CA18B", region: "Selangor", station: "Kuala Selangor" },
  { stationId: "CA19B", region: "Selangor", station: "Petaling Jaya" },
  { stationId: "CA20B", region: "Selangor", station: "Shah Alam" },
  { stationId: "CA21B", region: "Selangor", station: "Pelabuhan Klang" },
  { stationId: "CA22B", region: "Selangor", station: "Banting" },
  { stationId: "MCAQM001", region: "Selangor", station: "Johan Setia" },
  { stationId: "CA10A", region: "Perak", station: "Kg. Air Putih, Taiping" },
  { stationId: "CA11A", region: "Perak", station: "Jalan Tasek, Ipoh" },
  { stationId: "CA12A", region: "Perak", station: "S K Jalan Pegoh, Ipoh" },
  { stationId: "CA13A", region: "Perak", station: "Seri Manjung" },
  { stationId: "CA14A", region: "Perak", station: "Tanjung Malim" },
  { stationId: "CA23N", region: "Negeri Sembilan", station: "Nilai" },
  { stationId: "CA24N", region: "Negeri Sembilan", station: "Seremban" },
  { stationId: "CA25N", region: "Negeri Sembilan", station: "Port Dickson" }
];

class ApimsUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ApimsUnavailableError";
  }
}

function localParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function runHour(date = new Date()) {
  const parts = localParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00:00`;
}

function isoMyt(localTimestamp) {
  return `${localTimestamp}${MYT_OFFSET}`;
}

function timestampMs(localTimestamp) {
  const value = Date.parse(isoMyt(localTimestamp));
  if (!Number.isFinite(value)) throw new Error(`Invalid APIMS timestamp: ${localTimestamp}`);
  return value;
}

function categoryFor(ipu) {
  if (ipu <= 50) return "Baik";
  if (ipu <= 100) return "Sederhana";
  if (ipu <= 200) return "Tidak Sihat";
  if (ipu <= 300) return "Sangat Tidak Sihat";
  return "Berbahaya";
}

function validReading(row) {
  const value = Number(row?.API);
  return row?.DATETIME && Number.isInteger(value) && value >= 0 && value <= 999;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorDetails(error) {
  const message = error?.message || String(error);
  const cause = error?.cause;
  if (!cause) return message;
  const causeMessage = cause.message || String(cause);
  const code = cause.code ? ` (${cause.code})` : "";
  return `${message}: ${causeMessage}${code}`;
}

async function fetchJson(url, attempts = FETCH_ATTEMPTS) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "cache-control": "no-cache",
          referer: APIMS_PORTAL,
          "user-agent": "Klinik-Inocare-IPU-Dashboard/1.0"
        },
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const retryDelay = Math.min(12_000, 2_000 * (2 ** (attempt - 1)));
        console.warn(`JAS request attempt ${attempt}/${attempts} failed: ${errorDetails(error)}. Retrying in ${retryDelay / 1_000}s.`);
        await delay(retryDelay);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ApimsUnavailableError(
    `Unable to retrieve ${url} after ${attempts} attempts: ${errorDetails(lastError)}`,
    { cause: lastError }
  );
}

async function retrieveState(stateId, datetime) {
  const sample = async (sampleNumber) => {
    const url = new URL(APIMS_API);
    url.searchParams.set("stateid", String(stateId));
    url.searchParams.set("datetime", datetime);
    url.searchParams.set("_sample", `${Date.now()}-${sampleNumber}`);
    return fetchJson(url);
  };
  // APIMS intermittently drops bursts of parallel requests. Keep the two
  // verification samples independent, but request them sequentially.
  const payloads = [await sample(1)];
  await delay(SAMPLE_DELAY_MS);
  payloads.push(await sample(2));
  const rows = payloads.flatMap((payload) => Array.isArray(payload?.api_table_hourly) ? payload.api_table_hourly : []);
  if (rows.length === 0) {
    throw new Error(`JAS APIMS returned no hourly rows for state ID ${stateId}.`);
  }

  const uniqueRows = new Map();
  for (const row of rows.filter(validReading)) {
    const key = `${row.STATION_ID}|${row.DATETIME}`;
    const existing = uniqueRows.get(key);
    if (existing && Number(existing.API) !== Number(row.API)) {
      throw new Error(`Official JAS responses conflict for ${row.STATION_ID} at ${row.DATETIME}; refusing to publish.`);
    }
    uniqueRows.set(key, row);
  }
  return [...uniqueRows.values()];
}

function latestReading(rows, stationId) {
  return rows
    .filter((row) => row.STATION_ID === stationId && validReading(row))
    .sort((left, right) => timestampMs(right.DATETIME) - timestampMs(left.DATETIME))[0];
}

function latestEight(rows, station) {
  const stationRows = new Map(rows
    .filter((row) => row.STATION_ID === station.stationId && validReading(row))
    .map((row) => [row.DATETIME, row]));
  const points = [...stationRows.values()]
    .sort((left, right) => timestampMs(left.DATETIME) - timestampMs(right.DATETIME))
    .slice(-8)
    .map((row) => ({
      timestamp: isoMyt(row.DATETIME),
      station: station.station,
      region: station.region,
      ipu: Number(row.API),
      category: categoryFor(Number(row.API))
    }));
  if (points.length !== 8) throw new Error(`${station.station} has only ${points.length} valid hourly points; expected 8.`);
  return points;
}

function roundedAverage(values) {
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

async function main() {
  const requestedHour = runHour();
  const stateRows = [];
  for (const [index, stateId] of STATE_IDS.entries()) {
    console.log(`Retrieving verified JAS readings for state ID ${stateId}...`);
    stateRows.push(...await retrieveState(stateId, requestedHour));
    if (index < STATE_IDS.length - 1) await delay(STATE_DELAY_MS);
  }

  const currentRows = STATIONS.map((station) => {
    const source = latestReading(stateRows, station.stationId);
    if (!source) throw new Error(`No valid JAS reading was found for ${station.station} (${station.stationId}).`);
    const ipu = Number(source.API);
    return {
      stationId: station.stationId,
      region: station.region,
      station: station.station,
      ipu,
      category: categoryFor(ipu),
      sourceTimestamp: isoMyt(source.DATETIME)
    };
  });

  const sourceTimes = currentRows.map((row) => Date.parse(row.sourceTimestamp));
  const newestSourceTime = Math.max(...sourceTimes);
  const newestSourceTimestamp = currentRows.reduce((latest, row) => (
    Date.parse(row.sourceTimestamp) > Date.parse(latest) ? row.sourceTimestamp : latest
  ), currentRows[0].sourceTimestamp);
  const oldestSourceTime = Math.min(...sourceTimes);
  const currentRunHour = timestampMs(requestedHour);
  const hour = 60 * 60 * 1_000;

  if (currentRunHour - newestSourceTime > 3 * hour) {
    throw new Error("The newest official JAS reading is more than three hours old; refusing to publish a stale snapshot.");
  }
  if (newestSourceTime - oldestSourceTime > 2 * hour) {
    throw new Error("Station source times differ by more than two hours; refusing to publish an incomplete snapshot.");
  }

  currentRows.sort((left, right) => right.ipu - left.ipu || left.station.localeCompare(right.station));
  currentRows.forEach((row, index) => { row.rank = index + 1; });

  const stateSummary = EXPECTED_REGIONS.map((region) => {
    const rows = currentRows.filter((row) => row.region === region);
    const highest = [...rows].sort((left, right) => right.ipu - left.ipu || left.station.localeCompare(right.station))[0];
    return {
      region,
      highestIpu: highest.ipu,
      highestStation: highest.station,
      category: highest.category,
      averageIpu: roundedAverage(rows.map((row) => row.ipu)),
      stationCount: rows.length,
      unhealthyStations: rows.filter((row) => row.ipu > 100).length
    };
  });

  const klStations = STATIONS.filter((station) => station.region === "W.P. Kuala Lumpur");
  const trend = klStations.flatMap((station) => latestEight(stateRows, station))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || left.station.localeCompare(right.station));

  const snapshot = {
    schemaVersion: 1,
    status: "ready",
    generatedAt: newestSourceTimestamp,
    source: {
      name: "Jabatan Alam Sekitar — APIMS",
      url: APIMS_PORTAL,
      method: "Official APIMS hourly table",
      fallbackUsed: false
    },
    summary: {
      highestIpu: currentRows[0].ipu,
      highestStation: currentRows[0].station,
      averageIpu: roundedAverage(currentRows.map((row) => row.ipu)),
      unhealthyStations: currentRows.filter((row) => row.ipu > 100).length,
      monitoredStations: currentRows.length,
      coveredRegions: EXPECTED_REGIONS.length
    },
    stateSummary,
    stationLatest: currentRows,
    klTrend: trend,
    meta: {
      trendLimit: "Latest 8 verified hourly points per Kuala Lumpur station",
      monitoredRegions: EXPECTED_REGIONS,
      categories: [
        { minimum: 0, maximum: 50, label: "Baik" },
        { minimum: 51, maximum: 100, label: "Sederhana" },
        { minimum: 101, maximum: 200, label: "Tidak Sihat" },
        { minimum: 201, maximum: 300, label: "Sangat Tidak Sihat" },
        { minimum: 301, maximum: null, label: "Berbahaya" }
      ],
      historySheetUrl: GOOGLE_SHEET,
      disclosure: "Published snapshot, not a live connection",
      medicalDisclaimer: "This dashboard supports operational monitoring and is not medical advice."
    }
  };

  const next = `${JSON.stringify(snapshot, null, 2)}\n`;
  let previous = "";
  try { previous = await readFile(OUTPUT_FILE, "utf8"); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (previous) {
    const priorSnapshot = JSON.parse(previous);
    const priorStations = new Map((priorSnapshot.stationLatest || []).map((row) => [row.stationId, row]));
    for (const row of currentRows) {
      const prior = priorStations.get(row.stationId);
      if (prior && Date.parse(row.sourceTimestamp) < Date.parse(prior.sourceTimestamp)) {
        throw new Error(`Official JAS data regressed for ${row.station}: ${row.sourceTimestamp} is older than published ${prior.sourceTimestamp}.`);
      }
    }
  }

  if (previous === next) {
    console.log(`JAS APIMS snapshot ${snapshot.generatedAt} is unchanged.`);
    return;
  }
  await writeFile(OUTPUT_FILE, next, "utf8");
  console.log(`Saved ${currentRows.length} official station readings for ${snapshot.generatedAt}.`);
}

async function cachedSnapshotIsUsable() {
  try {
    const cached = JSON.parse(await readFile(OUTPUT_FILE, "utf8"));
    return cached?.status === "ready"
      && Number.isFinite(Date.parse(cached.generatedAt))
      && Array.isArray(cached.stationLatest)
      && cached.stationLatest.length === STATIONS.length
      && Array.isArray(cached.klTrend)
      && cached.klTrend.length === 16;
  } catch {
    return false;
  }
}

async function writeWorkflowSummary(message) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`, "utf8");
  } catch (error) {
    console.warn(`Unable to write the GitHub job summary: ${errorDetails(error)}`);
  }
}

main().catch(async (error) => {
  if (error instanceof ApimsUnavailableError) {
    const cachedIsUsable = await cachedSnapshotIsUsable();
    if (cachedIsUsable) {
      const message = "⚠️ JAS APIMS could not be reached after all retries. The last verified snapshot was preserved; no data file was changed and no Netlify deployment is required.";
      console.warn(`${message}\n${error.message}`);
      await writeWorkflowSummary(`## IPU refresh skipped\n\n${message}`);
      process.exitCode = 0;
      return;
    }
    console.error("JAS APIMS is unavailable and no complete verified cached snapshot exists. Refusing to publish.");
  }
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
