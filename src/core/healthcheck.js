const express = require("express");
const QRCode = require("qrcode");
const { logger } = require("../utils/logger");

const app = express();
const PORT = process.env.PORT || 3000;

let botStatus = {
  status: "starting",
  connectedAt: null,
  reconnectAttempts: 0,
  lastDisconnectReason: null,
};
let currentQR = null;

function setStatus(status, data = {}) {
  botStatus = { ...botStatus, status, ...data };
}

function setQR(qrString) {
  currentQR = qrString;
}

// ─── API Endpoints ────────────────────────────────────────────────────────────

app.get("/api/status", (req, res) => {
  res.json({
    status: botStatus.status,
    connectedAt: botStatus.connectedAt,
    uptimeSeconds: Math.floor(process.uptime()),
    reconnectAttempts: botStatus.reconnectAttempts,
    lastDisconnectReason: botStatus.lastDisconnectReason,
    hasQR: !!currentQR,
  });
});

app.get("/api/qr", async (req, res) => {
  if (!currentQR) {
    return res.status(404).json({ error: "No QR available" });
  }
  try {
    const png = await QRCode.toBuffer(currentQR, { width: 300, margin: 2 });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: "QR generation failed" });
  }
});

app.post("/api/logout", async (req, res) => {
  // Lazy require to avoid circular dependency at module load time
  const { logoutBot } = require("./connection");
  res.json({ ok: true, message: "Logout initiated" });
  setTimeout(() => logoutBot(), 300);
});

// ─── Health endpoints ─────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  const ok = botStatus.status === "connected";
  res.status(ok ? 200 : 503).json({ ok, status: botStatus.status });
});

// ─── Web Panel ────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ayres Apparel — Bot Panel</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 32px;
      padding: 24px;
    }
    h1 {
      font-size: 1.6rem;
      font-weight: 700;
      color: #f1f5f9;
      letter-spacing: -0.5px;
    }
    h1 span { color: #22d3ee; }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 16px;
      padding: 32px;
      width: 100%;
      max-width: 380px;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 24px;
    }
    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
    }
    .badge-connected { background: #064e3b; color: #34d399; }
    .badge-connected .dot { background: #34d399; animation: pulse 2s infinite; }
    .badge-waiting { background: #1c1917; color: #fbbf24; }
    .badge-waiting .dot { background: #fbbf24; }
    .badge-other { background: #1e1b4b; color: #a5b4fc; }
    .badge-other .dot { background: #a5b4fc; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    #qr-section { display: none; }
    #qr-section img {
      border-radius: 12px;
      border: 4px solid #334155;
      width: 260px;
      height: 260px;
    }
    .qr-hint {
      margin-top: 14px;
      font-size: 0.82rem;
      color: #94a3b8;
      line-height: 1.5;
    }

    #connected-section { display: none; }
    .connected-info {
      font-size: 0.9rem;
      color: #94a3b8;
      margin-bottom: 24px;
      line-height: 1.8;
    }
    .connected-info strong { color: #e2e8f0; }

    #loading-section .spinner {
      width: 48px; height: 48px;
      border: 4px solid #334155;
      border-top-color: #22d3ee;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text { color: #64748b; font-size: 0.9rem; }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 28px;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 600;
      transition: opacity 0.2s, transform 0.1s;
    }
    .btn:active { transform: scale(0.97); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-danger:hover:not(:disabled) { background: #b91c1c; }

    .footer {
      font-size: 0.78rem;
      color: #475569;
    }
  </style>
</head>
<body>

  <h1>Ayres Apparel &mdash; <span>Bot Panel</span></h1>

  <div class="card">
    <div id="status-badge" class="status-badge badge-other">
      <div class="dot"></div>
      <span id="status-text">Memuat...</span>
    </div>

    <!-- Loading -->
    <div id="loading-section">
      <div class="spinner"></div>
      <div class="loading-text">Menghubungkan ke server...</div>
    </div>

    <!-- QR Section -->
    <div id="qr-section">
      <img id="qr-img" src="" alt="QR Code WhatsApp" />
      <div class="qr-hint">
        Buka WhatsApp &rarr; <strong>Perangkat Tertaut</strong><br />
        &rarr; Tautkan Perangkat &rarr; Scan QR di atas
      </div>
    </div>

    <!-- Connected Section -->
    <div id="connected-section">
      <div class="connected-info" id="connected-info"></div>
      <button class="btn btn-danger" id="btn-logout" onclick="doLogout()">
        &#x23CF; Logout Bot
      </button>
    </div>
  </div>

  <div class="footer">Auto-refresh setiap 3 detik</div>

<script>
  let lastQRTime = 0;

  function fmt(isoStr) {
    if (!isoStr) return '-';
    return new Date(isoStr).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  }

  function fmtUptime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? h + 'j ' + m + 'm ' + sec + 'd' : m + 'm ' + sec + 'd';
  }

  function setBadge(status) {
    const badge = document.getElementById('status-badge');
    const text = document.getElementById('status-text');
    badge.className = 'status-badge';
    const labels = {
      connected: ['Terhubung', 'badge-connected'],
      waiting_qr: ['Menunggu Scan QR', 'badge-waiting'],
      starting: ['Memulai...', 'badge-other'],
      reconnecting: ['Menghubungkan ulang...', 'badge-other'],
      disconnected: ['Terputus', 'badge-other'],
      logged_out: ['Logged Out', 'badge-other'],
    };
    const [label, cls] = labels[status] || [status, 'badge-other'];
    badge.classList.add(cls);
    text.textContent = label;
  }

  async function poll() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();

      setBadge(data.status);
      document.getElementById('loading-section').style.display = 'none';

      if (data.status === 'waiting_qr' && data.hasQR) {
        document.getElementById('qr-section').style.display = 'block';
        document.getElementById('connected-section').style.display = 'none';
        // Refresh QR image (bust cache)
        document.getElementById('qr-img').src = '/api/qr?t=' + Date.now();

      } else if (data.status === 'connected') {
        document.getElementById('qr-section').style.display = 'none';
        document.getElementById('connected-section').style.display = 'block';
        document.getElementById('connected-info').innerHTML =
          'Terhubung sejak: <strong>' + fmt(data.connectedAt) + '</strong><br />' +
          'Uptime: <strong>' + fmtUptime(data.uptimeSeconds) + '</strong>';

      } else {
        document.getElementById('qr-section').style.display = 'none';
        document.getElementById('connected-section').style.display = 'none';
        document.getElementById('loading-section').style.display = 'block';
        document.querySelector('.loading-text').textContent =
          'Status: ' + data.status + ' — menunggu...';
      }
    } catch (e) {
      setBadge('disconnected');
    }
  }

  async function doLogout() {
    const btn = document.getElementById('btn-logout');
    btn.disabled = true;
    btn.textContent = 'Logout...';
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch (_) {}
    setTimeout(() => { btn.disabled = false; btn.innerHTML = '&#x23CF; Logout Bot'; }, 4000);
  }

  poll();
  setInterval(poll, 3000);
</script>
</body>
</html>`);
});

// ─── Start server ─────────────────────────────────────────────────────────────

function startHealthServer() {
  app.listen(PORT, () => {
    logger.info({ port: PORT }, `Health check server running — open http://localhost:${PORT}`);
  });
}

module.exports = { startHealthServer, setStatus, setQR };
