const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const path = require("path");
const fs = require("fs");
const pino = require("pino");
const { routeMessage } = require("./router");
const { logger } = require("../utils/logger");
const { setStatus, setQR } = require("./healthcheck");

function resolveSessionDir() {
  if (process.env.SESSION_DIR) {
    return path.resolve(process.env.SESSION_DIR);
  }

  // Railway persistent volumes are typically mounted at /data.
  if (process.env.RAILWAY_ENVIRONMENT || fs.existsSync("/data")) {
    return "/data/auth";
  }

  return path.resolve(path.join(__dirname, "../../auth"));
}

const SESSION_DIR = resolveSessionDir();
const BAILEYS_LOGGER = pino({ level: "silent" });
const BASE_RECONNECT_DELAY = 5_000;
const MAX_RECONNECT_DELAY = 60_000;
const MAX_BAD_MAC_BEFORE_RESET = 5;
const BAD_MAC_WINDOW_MS = 10 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = Number(process.env.WA_WATCHDOG_INTERVAL_MS || 60_000);
const WATCHDOG_DISCONNECTED_MS = Number(process.env.WA_WATCHDOG_DISCONNECTED_MS || 3 * 60 * 1000);
const WATCHDOG_STARTING_MS = Number(process.env.WA_WATCHDOG_STARTING_MS || 2 * 60 * 1000);
const WATCHDOG_CONNECTED_STALE_MS = Number(process.env.WA_WATCHDOG_CONNECTED_STALE_MS || 2 * 60 * 1000);

let reconnectAttempts = 0;
let reconnectTimer = null;
let currentSock = null;
let isStarting = false;
let credsSaveQueue = Promise.resolve();
let badMacCount = 0;
let lastConnectAt = null;
let badMacWindowStartedAt = 0;
let lastActivityAt = Date.now();
let lastConnectionEventAt = Date.now();
let watchdogTimer = null;
let currentState = "starting";
let baileysModulePromise = null;

function getBaileysModule() {
  if (!baileysModulePromise) {
    baileysModulePromise = import("@whiskeysockets/baileys");
  }

  return baileysModulePromise;
}

function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function touchActivity() {
  lastActivityAt = Date.now();
}

function touchConnectionEvent() {
  lastConnectionEventAt = Date.now();
  touchActivity();
}

function cleanupSocket(sock = currentSock) {
  if (!sock) return;

  try {
    sock.ev.removeAllListeners();
  } catch (_) {}

  try {
    sock.ws?.close();
  } catch (_) {}

  if (currentSock === sock) {
    currentSock = null;
  }
}

function getReconnectDelay(attempt) {
  return Math.min(BASE_RECONNECT_DELAY * Math.max(attempt, 1), MAX_RECONNECT_DELAY);
}

function clearSessionDir() {
  if (fs.existsSync(SESSION_DIR)) {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
  }
}

function queueSaveCreds(saveCreds) {
  credsSaveQueue = credsSaveQueue
    .then(() => saveCreds())
    .catch((err) => {
      logger.error({ err: err.message }, "Failed to save WhatsApp credentials");
    });
}

async function recoverCorruptedSession(reason = "session corrupted") {
  logger.warn({ reason }, "Resetting WhatsApp session and requesting new QR");
  clearReconnectTimer();
  cleanupSocket();
  clearSessionDir();
  reconnectAttempts = 0;
  badMacCount = 0;
  badMacWindowStartedAt = 0;
  currentState = "logged_out";
  touchConnectionEvent();
  setStatus("logged_out", { reconnectAttempts: 0, lastDisconnectReason: reason });
  setQR(null);
  reconnectTimer = setTimeout(() => {
    startConnection().catch((err) => {
      logger.error({ err: err.message }, "Failed to restart after session reset");
    });
  }, 2_000);
}

function scheduleReconnect(reasonText) {
  clearReconnectTimer();
  reconnectAttempts += 1;
  const delay = getReconnectDelay(reconnectAttempts);
  currentState = "reconnecting";
  touchConnectionEvent();
  setStatus("reconnecting", {
    reconnectAttempts,
    lastDisconnectReason: reasonText,
  });
  logger.info(
    { reconnectAttempts, delayMs: delay, reason: reasonText },
    "Scheduling WhatsApp reconnect"
  );
  reconnectTimer = setTimeout(() => {
    startConnection().catch((err) => {
      logger.error({ err: err.message }, "Reconnect attempt failed");
      scheduleReconnect("startConnection failed");
    });
  }, delay);
}

async function logoutBot() {
  logger.info("Logout requested via web panel");
  clearReconnectTimer();
  if (currentSock) {
    try {
      await currentSock.logout();
    } catch (_) {}
  }
  cleanupSocket();
  clearSessionDir();
  reconnectAttempts = 0;
  badMacCount = 0;
  badMacWindowStartedAt = 0;
  currentState = "logged_out";
  touchConnectionEvent();
  setStatus("logged_out", { reconnectAttempts: 0 });
  setQR(null);
  reconnectTimer = setTimeout(() => {
    startConnection().catch((err) => {
      logger.error({ err: err.message }, "Failed to restart after logout");
    });
  }, 2_000);
}

async function startConnection() {
  if (isStarting) {
    logger.debug("startConnection skipped because another startup is in progress");
    return currentSock;
  }

  isStarting = true;
  clearReconnectTimer();
  currentState = "starting";
  touchConnectionEvent();

  try {
    ensureSessionDir();

    const {
      default: makeWASocket,
      DisconnectReason,
      useMultiFileAuthState,
      makeCacheableSignalKeyStore,
      fetchLatestBaileysVersion,
    } = await getBaileysModule();

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    logger.info({ version: version.join("."), sessionDir: SESSION_DIR }, "Using Baileys version");
    cleanupSocket();

    const sock = makeWASocket({
      version,
      logger: BAILEYS_LOGGER,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, BAILEYS_LOGGER),
      },
      printQRInTerminal: false,
      browser: ["AyresApparel-Bot", "Chrome", "124.0.0"],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 30_000,
      defaultQueryTimeoutMs: 0,
      retryRequestDelayMs: 2_500,
      qrTimeout: 60_000,
      generateHighQualityLinkPreview: false,
    });

    currentSock = sock;
    currentState = "starting";
    setStatus("starting", { reconnectAttempts, lastDisconnectReason: null });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      touchConnectionEvent();

      if (qr) {
        currentState = "waiting_qr";
        setStatus("waiting_qr", { reconnectAttempts, lastDisconnectReason: null });
        setQR(qr);
        logger.info("QR Code generated, scan with WhatsApp");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "open") {
        reconnectAttempts = 0;
        badMacCount = 0;
        badMacWindowStartedAt = 0;
        lastConnectAt = new Date().toISOString();
        currentState = "connected";
        setStatus("connected", {
          connectedAt: lastConnectAt,
          reconnectAttempts: 0,
          lastDisconnectReason: null,
        });
        setQR(null);
        logger.info("WhatsApp connected successfully");
      }

      if (connection === "close") {
        const boom = lastDisconnect?.error ? new Boom(lastDisconnect.error) : null;
        const reason = boom?.output?.statusCode;
        const reasonText = lastDisconnect?.error?.message || `DisconnectReason:${reason || "unknown"}`;

        logger.warn({ reason, reasonText }, "Connection closed");
        cleanupSocket(sock);
        currentState = "disconnected";
        setStatus("disconnected", {
          reconnectAttempts,
          lastDisconnectReason: reasonText,
        });

        if (reason === DisconnectReason.loggedOut) {
          await recoverCorruptedSession("logged out");
          return;
        }

        if (
          reason === DisconnectReason.connectionReplaced ||
          reason === DisconnectReason.multideviceMismatch
        ) {
          logger.error({ reason }, "WhatsApp session replaced or mismatched, waiting for manual re-login");
          setStatus("logged_out", {
            reconnectAttempts: 0,
            lastDisconnectReason: reasonText,
          });
          setQR(null);
          clearSessionDir();
          reconnectAttempts = 0;
          reconnectTimer = setTimeout(() => {
            startConnection().catch((err) => {
              logger.error({ err: err.message }, "Failed to restart after session replacement");
            });
          }, 3_000);
          return;
        }

        scheduleReconnect(reasonText);
      }
    });

    sock.ev.on("creds.update", () => {
      touchActivity();
      queueSaveCreds(saveCreds);
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      touchActivity();

      for (const msg of messages) {
        try {
          if (msg.key.fromMe) continue;
          await routeMessage(sock, msg);
        } catch (err) {
          const message = err?.message || "";
          logger.error({ err: message, stack: err?.stack }, "Message handling failed");

          if (message.includes("Bad MAC")) {
            registerBadMac();

            if (badMacCount >= MAX_BAD_MAC_BEFORE_RESET) {
              await recoverCorruptedSession("too many Bad MAC decrypt errors");
              return;
            }
          }
        }
      }
    });

    return sock;
  } finally {
    isStarting = false;
  }
}

function requestReconnect(reason = "manual reconnect requested") {
  logger.warn({ reason }, "Manual reconnect requested");
  cleanupSocket();
  scheduleReconnect(reason);
}

function registerBadMac() {
  const now = Date.now();

  if (!badMacWindowStartedAt || now - badMacWindowStartedAt > BAD_MAC_WINDOW_MS) {
    badMacWindowStartedAt = now;
    badMacCount = 0;
  }

  badMacCount += 1;
  touchActivity();
  logger.warn(
    {
      badMacCount,
      badMacWindowMs: BAD_MAC_WINDOW_MS,
    },
    "Detected decrypt Bad MAC error"
  );
}

function getConnectionSnapshot() {
  return {
    currentState,
    reconnectAttempts,
    isStarting,
    lastActivityAt,
    lastConnectionEventAt,
    lastConnectAt,
    hasSocket: !!currentSock,
    wsReadyState: currentSock?.ws?.readyState,
    badMacCount,
    badMacWindowStartedAt,
  };
}

function startConnectionWatchdog() {
  if (watchdogTimer) return;

  watchdogTimer = setInterval(async () => {
    try {
      const now = Date.now();
      const disconnectedFor = now - lastConnectionEventAt;
      const staleFor = now - lastActivityAt;
      const wsReadyState = currentSock?.ws?.readyState;

      if (
        (currentState === "disconnected" || currentState === "reconnecting") &&
        disconnectedFor > WATCHDOG_DISCONNECTED_MS
      ) {
        logger.warn(
          { currentState, disconnectedFor, reconnectAttempts },
          "Watchdog detected prolonged disconnect, forcing reconnect"
        );
        requestReconnect("watchdog prolonged disconnect");
        return;
      }

      if (currentState === "starting" && disconnectedFor > WATCHDOG_STARTING_MS) {
        logger.warn(
          { disconnectedFor, reconnectAttempts },
          "Watchdog detected startup stall, forcing reconnect"
        );
        requestReconnect("watchdog startup stall");
        return;
      }

      if (
        currentState === "connected" &&
        wsReadyState !== undefined &&
        wsReadyState !== 1 &&
        staleFor > WATCHDOG_CONNECTED_STALE_MS
      ) {
        logger.warn(
          { wsReadyState, staleFor },
          "Watchdog detected unhealthy connected socket, forcing reconnect"
        );
        requestReconnect("watchdog unhealthy connected socket");
      }
    } catch (err) {
      logger.error({ err: err.message }, "Watchdog check failed");
    }
  }, WATCHDOG_INTERVAL_MS);

  watchdogTimer.unref();
}

module.exports = {
  startConnection,
  logoutBot,
  requestReconnect,
  startConnectionWatchdog,
  getConnectionSnapshot,
};
