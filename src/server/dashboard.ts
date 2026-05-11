import { getDashboardMetrics } from "../db/queries.js";

export function renderDashboard(days = 30): string {
  const m = getDashboardMetrics(days);

  const toolRows = m.eventsByTool.map(t =>
    `<tr><td>${esc(t.tool)}</td><td>${t.count}</td></tr>`
  ).join("");

  const eventRows = m.recentEvents.map(e =>
    `<tr>
      <td>${esc(e.tool)}</td>
      <td>${esc(e.developer)}</td>
      <td>${esc(e.event_type)}</td>
      <td>${esc(e.file_path ?? "—")}</td>
      <td>${formatTime(e.timestamp)}</td>
    </tr>`
  ).join("");

  const commitRows = m.recentCommits.map(c =>
    `<tr>
      <td><code>${esc(c.hash.slice(0, 8))}</code></td>
      <td>${esc(c.author)}</td>
      <td>${esc((c.message ?? "").slice(0, 60))}</td>
      <td>+${c.total_additions} / -${c.total_deletions}</td>
      <td>${formatTime(c.timestamp)}</td>
    </tr>`
  ).join("");

  const attrRows = m.attributionsByTool.map(a =>
    `<tr><td>${esc(a.tool)}</td><td>${esc(a.confidence)}</td><td>${a.count}</td></tr>`
  ).join("");

  const devRows = m.devActivity.map(d =>
    `<tr><td>${esc(d.developer)}</td><td>${d.events}</td><td>${d.commits}</td></tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CodeGov Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1117; color: #e1e4e8; padding: 24px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #f0f6fc; }
    .subtitle { color: #8b949e; margin-bottom: 32px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; }
    .card .label { font-size: 12px; text-transform: uppercase; color: #8b949e; margin-bottom: 4px; }
    .card .value { font-size: 32px; font-weight: 600; color: #58a6ff; }
    h2 { font-size: 18px; margin: 32px 0 12px; color: #f0f6fc; }
    table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
    th { text-align: left; padding: 10px 14px; background: #1c2128; color: #8b949e; font-size: 12px; text-transform: uppercase; border-bottom: 1px solid #30363d; }
    td { padding: 10px 14px; border-bottom: 1px solid #21262d; font-size: 14px; }
    tr:last-child td { border-bottom: none; }
    code { background: #1c2128; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    .empty { color: #8b949e; padding: 40px; text-align: center; }
    .refresh { float: right; font-size: 13px; color: #58a6ff; text-decoration: none; }
    .refresh:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <a class="refresh" href="/dashboard">Refresh</a>
  <h1>CodeGov</h1>
  <p class="subtitle">AI Dev-Tool Governance Dashboard — last ${days} days</p>

  <div class="grid">
    <div class="card">
      <div class="label">Tool Events</div>
      <div class="value">${m.totalEvents}</div>
    </div>
    <div class="card">
      <div class="label">Commits</div>
      <div class="value">${m.totalCommits}</div>
    </div>
    <div class="card">
      <div class="label">Attributions</div>
      <div class="value">${m.totalAttributions}</div>
    </div>
  </div>

  ${m.eventsByTool.length > 0 ? `
  <h2>Events by Tool</h2>
  <table>
    <thead><tr><th>Tool</th><th>Events</th></tr></thead>
    <tbody>${toolRows}</tbody>
  </table>` : ""}

  ${m.devActivity.length > 0 ? `
  <h2>Developer Activity</h2>
  <table>
    <thead><tr><th>Developer</th><th>Tool Events</th><th>Commits</th></tr></thead>
    <tbody>${devRows}</tbody>
  </table>` : ""}

  ${m.attributionsByTool.length > 0 ? `
  <h2>Attributions</h2>
  <table>
    <thead><tr><th>Tool</th><th>Confidence</th><th>Count</th></tr></thead>
    <tbody>${attrRows}</tbody>
  </table>` : ""}

  <h2>Recent Tool Events</h2>
  ${m.recentEvents.length > 0 ? `
  <table>
    <thead><tr><th>Tool</th><th>Developer</th><th>Type</th><th>File</th><th>Time</th></tr></thead>
    <tbody>${eventRows}</tbody>
  </table>` : `<div class="empty">No tool events yet. Point your OTEL exporter at POST /v1/traces to start collecting data.</div>`}

  <h2>Recent Commits</h2>
  ${m.recentCommits.length > 0 ? `
  <table>
    <thead><tr><th>Hash</th><th>Author</th><th>Message</th><th>Changes</th><th>Time</th></tr></thead>
    <tbody>${commitRows}</tbody>
  </table>` : `<div class="empty">No commits yet. Run <code>codegov init</code> to install the post-commit hook.</div>`}
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
