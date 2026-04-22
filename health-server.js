const http = require("http");
const https = require("https");
const fs = require("fs");
const net = require("net");

const PORT = Number(process.env.PUBLIC_PORT || 7861);
const TARGET_PORT = Number(process.env.N8N_PORT || 5678);
const TARGET_HOST = "127.0.0.1";
const SYNC_STATUS_FILE = "/tmp/hugging8n-sync-status.json";
const APP_BASE = "/app";
const startTime = Date.now();

function parseRequestUrl(url) {
  try {
    return new URL(url, "http://localhost");
  } catch {
    return new URL("http://localhost/");
  }
}

function getStatus() {
  try {
    if (fs.existsSync(SYNC_STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(SYNC_STATUS_FILE, "utf8"));
    }
  } catch {}
  return {
    status: "unknown",
    message: "Initial startup...",
    timestamp: new Date().toISOString(),
  };
}

function renderDashboard(data) {
  const { status } = data.sync;
  const getBadge = (status) => {
    let cls = "status-offline";
    if (
      status === "success" ||
      status === "configured" ||
      status === "restored" ||
      status === "synced"
    )
      cls = "status-online";
    if (status === "syncing" || status === "restoring") cls = "status-syncing";
    return `<div class="status-badge ${cls}">${cls === "status-online" ? '<div class="pulse"></div>' : ""}${String(status).toUpperCase()}</div>`;
  };

  const keepAwakeHtml = data.isPrivate
    ? `<div class="helper-summary"><strong>Private Space detected.</strong> External monitors cannot access private health URLs.</div>`
    : `
        <div id="uptimerobot-flow">
            <p class="helper-text">Setup a free monitor to prevent this Space from sleeping.</p>
            <div class="input-group">
                <input type="password" id="ur-key" placeholder="UptimeRobot Main API Key">
                <button id="ur-btn" onclick="setupMonitor()">Set Up Monitor</button>
            </div>
            <p id="ur-status"></p>
        </div>
    `;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hugging8n Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0f172a;
            --card: #1e293b;
            --accent: #6366f1;
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --success: #22c55e;
            --warning: #f59e0b;
            --error: #ef4444;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg);
            color: var(--text);
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
        }
        .dashboard {
            background: var(--card);
            width: 100%;
            max-width: 500px;
            padding: 40px;
            border-radius: 24px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            text-align: center;
            border: 1px solid rgba(255,255,255,0.05);
        }
        h1 { font-size: 2.5rem; margin-bottom: 8px; letter-spacing: -1px; }
        .subtitle { color: var(--text-muted); margin-bottom: 32px; font-weight: 300; }
        
        .stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 24px;
        }
        .stat-card {
            background: rgba(255,255,255,0.03);
            padding: 20px;
            border-radius: 16px;
            text-align: left;
        }
        .stat-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px; }
        .stat-value { font-size: 1.25rem; font-weight: 600; }

        .sync-box {
            background: rgba(255,255,255,0.03);
            padding: 24px;
            border-radius: 16px;
            margin-bottom: 32px;
            text-align: left;
            position: relative;
        }
        .sync-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .status-badge {
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 0.7rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .status-online { background: rgba(34, 197, 94, 0.2); color: var(--success); }
        .status-syncing { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
        .status-offline { background: rgba(239, 68, 68, 0.2); color: var(--error); }
        
        .pulse {
            width: 8px;
            height: 8px;
            background: currentColor;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { transform: scale(0.95); opacity: 0.7; }
            70% { transform: scale(1.5); opacity: 0; }
            100% { transform: scale(0.95); opacity: 0; }
        }

        .btn-primary {
            display: block;
            width: 100%;
            padding: 18px;
            background: var(--accent);
            color: white;
            text-decoration: none;
            border-radius: 16px;
            font-weight: 600;
            font-size: 1.1rem;
            transition: all 0.2s;
            box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.4);
            margin-bottom: 32px;
        }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 20px 25px -5px rgba(99, 102, 241, 0.4); }

        .keep-alive {
            border-top: 1px solid rgba(255,255,255,0.05);
            padding-top: 24px;
            text-align: left;
        }
        .keep-alive h3 { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px; }
        .helper-text { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 16px; }
        .input-group { display: flex; gap: 8px; }
        input {
            flex: 1;
            background: #0f172a;
            border: 1px solid rgba(255,255,255,0.1);
            padding: 12px;
            border-radius: 12px;
            color: white;
            font-family: inherit;
        }
        button#ur-btn {
            background: rgba(255,255,255,0.05);
            border: none;
            color: white;
            padding: 0 16px;
            border-radius: 12px;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.85rem;
        }
        button#ur-btn:hover { background: rgba(255,255,255,0.1); }
        #ur-status { font-size: 0.8rem; margin-top: 8px; }
    </style>
</head>
<body>
    <div class="dashboard">
        <h1>🔗 Hugging8n</h1>
        <p class="subtitle">Workflow Automation Space</p>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-label">Uptime</div>
                <div class="stat-value">${data.uptimeHuman}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">n8n Port</div>
                <div class="stat-value">${TARGET_PORT}</div>
            </div>
        </div>

        <div class="sync-box">
            <div class="sync-header">
                <div class="stat-label">Sync Status</div>
                ${getBadge(data.sync.status)}
            </div>
            <div class="stat-value" style="font-size: 1rem; margin-bottom: 4px;">Last Activity: ${data.sync.timestamp.split('.')[0]}Z</div>
            <div class="stat-label" style="text-transform: none;">${data.sync.message}</div>
        </div>

        <a href="/app/" target="_blank" class="btn-primary">Open n8n Editor</a>

        <div class="keep-alive">
            <h3>Keep Alive</h3>
            ${keepAwakeHtml}
        </div>
    </div>

    <script>
        async function setupMonitor() {
            const key = document.getElementById('ur-key').value;
            const btn = document.getElementById('ur-btn');
            const status = document.getElementById('ur-status');
            if (!key) return alert('Please enter an API key');
            
            btn.disabled = true;
            btn.innerText = 'Setting up...';
            
            try {
                const res = await fetch('/uptimerobot/setup', {
                    method: 'POST',
                    body: JSON.stringify({ apiKey: key })
                });
                const data = await res.json();
                status.innerText = data.message;
                status.style.color = res.ok ? '#22c55e' : '#ef4444';
            } catch (e) {
                status.innerText = 'Connection error.';
                status.style.color = '#ef4444';
            } finally {
                btn.disabled = false;
                btn.innerText = 'Set Up Monitor';
            }
        }
    </script>
</body>
</html>`;
}

async function resolveSpaceIsPrivate(req) {
  const host = req.headers.host || "";
  const match = host.match(/^([^.]+)-([^.]+)\.hf\.space$/);
  if (!match) return false;
  const user = match[1];
  const space = match[2];

  const params = new URLSearchParams(req.url.split("?")[1] || "");
  const token = params.get("__sign");
  if (!token) return false;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString(),
    );
    const sub = payload.sub || "";
    const match_sub = sub.match(/^\/spaces\/([^/]+)\/([^/]+)$/);
    if (!match_sub) return false;
    return new Promise((resolve) => {
      https
        .get(
          `https://huggingface.co/api/spaces/${match_sub[1]}/${match_sub[2]}`,
          { headers: { "User-Agent": "Hugging8n" } },
          (res) => {
            resolve(
              res.statusCode === 401 ||
                res.statusCode === 403 ||
                res.statusCode === 404,
            );
          },
        )
        .on("error", () => resolve(false));
    });
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = parseRequestUrl(req.url);
  const pathname = url.pathname;

  // 1. Dashboard Routes
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok", ...getStatus() }));
  }
  if (pathname === "/status") {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    return res.end(
      JSON.stringify({
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        sync: getStatus(),
      }),
    );
  }
  if (pathname === "/uptimerobot/setup" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { apiKey } = JSON.parse(body);
        const host = req.headers.host;
        const monitorUrl = `https://${host}/health`;
        const post = (p, d) =>
          new Promise((res, rej) => {
            const r = https.request(
              {
                hostname: "api.uptimerobot.com",
                port: 443,
                path: p,
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
              },
              (r) => {
                let b = "";
                r.on("data", (c) => (b += c));
                r.on("end", () => res(JSON.parse(b)));
              },
            );
            r.on("error", rej);
            r.write(new URLSearchParams(d).toString());
            r.end();
          });

        const existing = await post("/v2/getMonitors", {
          api_key: apiKey,
          format: "json",
        });
        if (existing.monitors?.some((m) => m.url === monitorUrl)) {
          res.writeHead(200);
          return res.end(
            JSON.stringify({ message: "Monitor already exists." }),
          );
        }
        const created = await post("/v2/newMonitor", {
          api_key: apiKey,
          format: "json",
          type: "1",
          friendly_name: `Hugging8n ${host}`,
          url: monitorUrl,
          interval: "300",
        });
        if (created.stat === "ok") {
          res.writeHead(200);
          return res.end(
            JSON.stringify({ message: "Monitor created successfully!" }),
          );
        }
        res.writeHead(400);
        res.end(
          JSON.stringify({
            message: created.error?.message || "Failed to create monitor.",
          }),
        );
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ message: "Invalid request." }));
      }
    });
    return;
  }
  if (pathname === "/" || pathname === "/dashboard") {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const isPrivate = await resolveSpaceIsPrivate(req);
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(
      renderDashboard({
        uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        sync: getStatus(),
        isPrivate,
      }),
    );
  }

  // 2. n8n Routing Logic (Namespace-based Proxy)
  // These are the prefixes n8n uses. If it matches, we proxy to n8n at ROOT.
  const isN8nPath =
    pathname.startsWith("/static/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/rest/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/webhook/") ||
    pathname.startsWith("/home/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/logout") ||
    pathname.startsWith("/nodes/") ||
    pathname.startsWith("/healthz");

  // Special case: /app/ redirects to /home/workflows
  if (pathname === "/app" || pathname === "/app/") {
    res.writeHead(302, { Location: "/home/workflows" });
    return res.end();
  }

  if (isN8nPath) {
    const proxyHeaders = {
      ...req.headers,
      host: `127.0.0.1:${TARGET_PORT}`,
      "x-forwarded-for": req.socket.remoteAddress,
      "x-forwarded-host": req.headers.host,
      "x-forwarded-proto": "https",
    };

    const proxyReq = http.request(
      {
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        path: pathname + url.search,
        method: req.method,
        headers: proxyHeaders,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", () => {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "starting", message: "n8n is initializing..." }));
    });

    req.pipe(proxyReq);
    return;
  }

  // 3. Fallback: Redirect anything else to Dashboard
  res.writeHead(302, { Location: "/" });
  res.end();
});

server.on("upgrade", (req, socket, head) => {
  const url = parseRequestUrl(req.url);
  const proxyPath = url.pathname;
  const proxySocket = net.connect(TARGET_PORT, TARGET_HOST, () => {
    proxySocket.write(
      `${req.method} ${proxyPath}${url.search} HTTP/${req.httpVersion}\r\n`,
    );
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      proxySocket.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
    }
    proxySocket.write("\r\n");
    if (head && head.length) proxySocket.write(head);
    proxySocket.pipe(socket).pipe(proxySocket);
  });
  proxySocket.on("error", () => socket.destroy());
});

server.listen(PORT, "0.0.0.0", () =>
  console.log(`Namespace Proxy on ${PORT} -> n8n on ${TARGET_PORT}`),
);
