"use strict";

const SERIES_COLORS = {
  "Batu Muda": "#234173",
  Cheras: "#538AC3"
};

const REGION_ICONS = {
  Selangor: "icon-buildings",
  "W.P. Kuala Lumpur": "icon-gauge",
  Perak: "icon-tree",
  "Negeri Sembilan": "icon-compass"
};

const dateTimeFormatter = new Intl.DateTimeFormat("ms-MY", {
  timeZone: "Asia/Kuala_Lumpur",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

const shortTimeFormatter = new Intl.DateTimeFormat("ms-MY", {
  timeZone: "Asia/Kuala_Lumpur",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

const state = {
  data: null,
  station: "All",
  sortKey: "rank",
  sortDirection: "asc"
};

const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : `${dateTimeFormatter.format(date)} MYT`;
}

function formatShortTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : shortTimeFormatter.format(date);
}

function toneFor(ipu) {
  if (ipu > 100) return "unhealthy";
  if (ipu <= 50) return "good";
  return "moderate";
}

function icon(name, extraClass = "") {
  return `<span class="ph-icon ${name} ${extraClass}" aria-hidden="true"></span>`;
}

function categoryMarkup(category, ipu) {
  const tone = toneFor(ipu);
  const warning = ipu > 100 ? icon("icon-warning-circle") : "";
  return `<span class="category-pill ${tone}">${warning}${escapeHtml(category)}</span>`;
}

function validateData(data) {
  if (!data || data.status !== "ready") throw new Error("Snapshot data belum sedia.");
  if (!Array.isArray(data.stationLatest) || data.stationLatest.length === 0) throw new Error("Tiada bacaan stesen dalam snapshot.");
  if (!Array.isArray(data.stateSummary) || data.stateSummary.length !== 4) throw new Error("Ringkasan negeri tidak lengkap.");
  if (!Array.isArray(data.klTrend)) throw new Error("Data trend Kuala Lumpur tidak tersedia.");
  return data;
}

function renderHeader(data) {
  byId("snapshot-time").textContent = formatDateTime(data.generatedAt);
  byId("coverage-count").textContent = `${data.summary.monitoredStations} stesen · ${data.summary.coveredRegions} wilayah`;

  const status = byId("overall-status");
  const unhealthy = data.summary.unhealthyStations;
  status.classList.toggle("is-alert", unhealthy > 0);
  status.innerHTML = unhealthy > 0
    ? `<span class="status-dot" aria-hidden="true"></span><span>${unhealthy} stesen melebihi IPU 100</span>`
    : `<span class="status-dot" aria-hidden="true"></span><span>Tiada stesen melebihi IPU 100</span>`;
}

function renderRegionCards(data) {
  byId("region-cards").innerHTML = data.stateSummary.map((region) => {
    const tone = toneFor(region.highestIpu);
    const regionIcon = REGION_ICONS[region.region] || "icon-map-trifold";
    return `
      <article class="region-card" data-tone="${tone}">
        <div class="region-card-top">
          <div>
            <p class="eyebrow">Negeri / Wilayah</p>
            <h3>${escapeHtml(region.region)}</h3>
          </div>
          <span class="region-icon ph-icon ${regionIcon}" aria-hidden="true"></span>
        </div>
        <div class="region-reading"><strong>${region.highestIpu}</strong><span>IPU tertinggi</span></div>
        <p class="highest-station">${escapeHtml(region.highestStation)}</p>
        ${categoryMarkup(region.category, region.highestIpu)}
        <div class="region-metrics">
          <div><span>Purata IPU</span><strong>${region.averageIpu}</strong></div>
          <div><span>Stesen dipantau</span><strong>${region.stationCount}</strong></div>
        </div>
      </article>`;
  }).join("");
}

function renderContext(data) {
  const panel = byId("context-panel");
  const heading = byId("context-heading");
  const content = byId("context-content");
  const unhealthy = data.stationLatest.filter((row) => row.ipu > 100);
  panel.classList.toggle("is-alert", unhealthy.length > 0);

  if (unhealthy.length === 0) {
    heading.textContent = "Tiada stesen dalam julat Tidak Sihat";
    content.innerHTML = `
      <p>Teruskan pemantauan biasa dan semak semula selepas snapshot seterusnya, terutamanya jika aktiviti luar dirancang.</p>
      <p class="context-disclaimer">Dashboard ini menyokong operational monitoring dan bukan medical advice.</p>`;
    return;
  }

  heading.textContent = `${unhealthy.length} stesen memerlukan perhatian`;
  const items = unhealthy.map((row) => `<li><strong>${escapeHtml(row.station)}</strong>, ${escapeHtml(row.region)} — IPU ${row.ipu} (${escapeHtml(row.category)})</li>`).join("");
  content.innerHTML = `
    <p>Pengurusan patut menyemak rancangan kerja luar, makluman kepada kakitangan dan perkembangan nasihat rasmi untuk stesen berikut:</p>
    <ul>${items}</ul>
    <p class="context-disclaimer">Dashboard ini menyokong operational monitoring dan bukan medical advice.</p>`;
}

function trendRows() {
  if (state.station === "All") return state.data.klTrend;
  return state.data.klTrend.filter((row) => row.station === state.station);
}

function renderTrendSummary(rows) {
  const stations = [...new Set(rows.map((row) => row.station))];
  byId("trend-summary").innerHTML = stations.map((station) => {
    const points = rows.filter((row) => row.station === station).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const latest = points.at(-1);
    return `<span class="summary-chip"><i style="--series-color:${SERIES_COLORS[station]}"></i>${escapeHtml(station)}: IPU ${latest?.ipu ?? "—"}</span>`;
  }).join("") + `<span>${rows.length} titik disahkan dipaparkan</span>`;
}

function niceStep(maxValue) {
  if (maxValue <= 120) return 20;
  if (maxValue <= 200) return 40;
  if (maxValue <= 350) return 50;
  return 100;
}

function renderTrendChart() {
  const rows = trendRows();
  renderTrendSummary(rows);

  const width = 980;
  const height = 380;
  const margin = { top: 30, right: 28, bottom: 58, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const minTime = Math.min(...rows.map((row) => new Date(row.timestamp).valueOf()));
  const maxTime = Math.max(...rows.map((row) => new Date(row.timestamp).valueOf()));
  const dataMax = Math.max(...rows.map((row) => row.ipu));
  const step = niceStep(Math.max(110, dataMax + 8));
  const yMax = Math.ceil(Math.max(110, dataMax + 8) / step) * step;
  const timeSpan = Math.max(1, maxTime - minTime);
  const x = (timestamp) => margin.left + ((new Date(timestamp).valueOf() - minTime) / timeSpan) * plotWidth;
  const y = (ipu) => margin.top + plotHeight - (ipu / yMax) * plotHeight;
  const stationNames = [...new Set(rows.map((row) => row.station))];

  const yTicks = [];
  for (let value = 0; value <= yMax; value += step) yTicks.push(value);
  const horizontalGrid = yTicks.map((value) => `
    <line class="chart-grid-line" x1="${margin.left}" y1="${y(value)}" x2="${width - margin.right}" y2="${y(value)}"></line>
    <text class="chart-axis-label" x="${margin.left - 12}" y="${y(value) + 4}" text-anchor="end">${value}</text>`).join("");

  const timestamps = [...new Set(rows.map((row) => row.timestamp))].sort((a, b) => new Date(a) - new Date(b));
  const labelStride = timestamps.length > 8 ? 2 : 1;
  const xLabels = timestamps.map((timestamp, index) => {
    if (index % labelStride !== 0 && index !== timestamps.length - 1) return "";
    return `<text class="chart-axis-label" x="${x(timestamp)}" y="${height - 24}" text-anchor="middle">${escapeHtml(formatShortTime(timestamp))}</text>`;
  }).join("");

  const threshold = `
    <line class="chart-threshold" x1="${margin.left}" y1="${y(100)}" x2="${width - margin.right}" y2="${y(100)}"></line>
    <text class="chart-threshold-label" x="${width - margin.right}" y="${y(100) - 8}" text-anchor="end">Ambang Tidak Sihat: 100</text>`;

  const series = stationNames.map((station) => {
    const stationRows = rows.filter((row) => row.station === station).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const color = SERIES_COLORS[station];
    const points = stationRows.map((row) => `${x(row.timestamp)},${y(row.ipu)}`).join(" ");
    const circles = stationRows.map((row) => `
      <circle class="chart-point" style="--series-color:${color}" cx="${x(row.timestamp)}" cy="${y(row.ipu)}" r="5">
        <title>${escapeHtml(station)} · ${formatDateTime(row.timestamp)} · IPU ${row.ipu} (${escapeHtml(row.category)})</title>
      </circle>`).join("");
    return `<polyline class="chart-line" style="--series-color:${color}" points="${points}"></polyline>${circles}`;
  }).join("");

  byId("trend-chart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" aria-labelledby="trend-svg-title trend-svg-desc">
      <title id="trend-svg-title">Trend IPU bagi ${escapeHtml(stationNames.join(" dan "))}</title>
      <desc id="trend-svg-desc">Lapan bacaan sejam terkini bagi setiap stesen Kuala Lumpur yang dipilih. Garisan putus-putus menandakan ambang IPU 100.</desc>
      ${horizontalGrid}
      ${threshold}
      ${series}
      ${xLabels}
      <text class="chart-axis-label" x="15" y="${margin.top}" transform="rotate(-90 15 ${margin.top})">IPU</text>
    </svg>`;

  byId("trend-legend").innerHTML = stationNames.map((station) => `
    <span class="legend-item"><i class="legend-swatch" style="--series-color:${SERIES_COLORS[station]}"></i>${escapeHtml(station)}</span>`).join("") +
    `<span class="legend-item"><i class="legend-swatch" style="--series-color:#C62828"></i>Ambang Tidak Sihat</span>`;
}

function renderBars(data) {
  const sorted = [...data.stationLatest].sort((left, right) => right.ipu - left.ipu || left.station.localeCompare(right.station));
  const maxIpu = Math.max(100, ...sorted.map((row) => row.ipu));
  byId("station-bars").innerHTML = sorted.map((row) => {
    const ipu = row.ipu;
    const color = ipu > 100 ? "#C62828" : ipu <= 50 ? "#2E7D32" : "#538AC3";
    const warning = ipu > 100 ? `${icon("icon-warning-circle")}<span class="alert-label">Tidak Sihat</span>` : "";
    const width = Math.max(2, (ipu / maxIpu) * 100).toFixed(2);
    return `
      <div class="bar-row" aria-label="${escapeHtml(row.station)}, ${escapeHtml(row.region)}, IPU ${ipu}, ${escapeHtml(row.category)}">
        <div class="bar-label"><strong>${escapeHtml(row.station)}</strong><span>${escapeHtml(row.region)}</span></div>
        <div class="bar-track"><div class="bar-fill" style="--bar-width:${width}%;--bar-color:${color}"></div></div>
        <div class="bar-value">${warning}<span>${ipu}</span></div>
      </div>`;
  }).join("");
}

function compareRows(left, right, key) {
  if (["rank", "ipu"].includes(key)) return left[key] - right[key];
  if (key === "sourceTimestamp") return new Date(left[key]) - new Date(right[key]);
  return String(left[key]).localeCompare(String(right[key]), "ms", { sensitivity: "base" });
}

function renderTable() {
  const rows = [...state.data.stationLatest].sort((left, right) => {
    const result = compareRows(left, right, state.sortKey);
    return state.sortDirection === "asc" ? result : -result;
  });

  byId("station-table").innerHTML = rows.map((row) => `
    <tr>
      <td>${row.rank}</td>
      <td>${escapeHtml(row.region)}</td>
      <td class="station-name">${escapeHtml(row.station)}</td>
      <td class="table-ipu">${row.ipu}</td>
      <td>${categoryMarkup(row.category, row.ipu)}</td>
      <td class="source-time-cell">${formatDateTime(row.sourceTimestamp)}</td>
    </tr>`).join("");

  document.querySelectorAll(".sort-button").forEach((button) => {
    const isActive = button.dataset.sort === state.sortKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-sort", isActive ? (state.sortDirection === "asc" ? "ascending" : "descending") : "none");
    const arrow = button.querySelector("span");
    if (arrow) arrow.textContent = isActive ? (state.sortDirection === "asc" ? "↑" : "↓") : "↕";
  });
}

function installInteractions() {
  byId("state-filter").addEventListener("change", () => renderTrendChart());
  byId("station-filter").addEventListener("change", (event) => {
    state.station = event.target.value;
    renderTrendChart();
  });

  document.querySelectorAll(".sort-button").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (state.sortKey === key) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDirection = ["rank", "ipu"].includes(key) ? "desc" : "asc";
      }
      renderTable();
    });
  });
}

function renderDashboard(data) {
  state.data = data;
  renderHeader(data);
  renderRegionCards(data);
  renderContext(data);
  renderTrendChart();
  renderBars(data);
  renderTable();
  installInteractions();
}

async function loadDashboard() {
  try {
    const response = await fetch(`./data/latest.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Permintaan data gagal (HTTP ${response.status}).`);
    renderDashboard(validateData(await response.json()));
  } catch (error) {
    byId("dashboard-error").hidden = false;
    byId("error-message").textContent = error.message || "Cuba muat semula halaman ini sebentar lagi.";
    byId("overall-status").innerHTML = `<span class="status-dot" aria-hidden="true"></span><span>Snapshot tidak tersedia</span>`;
    byId("overall-status").classList.add("is-alert");
  }
}

loadDashboard();
