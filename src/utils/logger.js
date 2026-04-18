const fs = require("fs");
const path = require("path");
const pino = require("pino");
const pretty = require("pino-pretty");

function resolveLogDir() {
  if (process.env.LOG_DIR) {
    return path.resolve(process.env.LOG_DIR);
  }

  if (process.env.RAILWAY_ENVIRONMENT || fs.existsSync("/data")) {
    return "/data/logs";
  }

  return path.resolve(path.join(__dirname, "../../logs"));
}

const LOG_DIR = resolveLogDir();
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 14);

let currentDateKey = "";
let fileStream = null;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getLogPath(dateKey) {
  return path.join(LOG_DIR, `bot-${dateKey}.log`);
}

function rotateFileStreamIfNeeded() {
  ensureLogDir();

  const nextDateKey = getDateKey();
  if (fileStream && currentDateKey === nextDateKey) {
    return fileStream;
  }

  if (fileStream) {
    fileStream.end();
  }

  currentDateKey = nextDateKey;
  fileStream = pino.destination({
    dest: getLogPath(currentDateKey),
    mkdir: true,
    sync: false,
  });

  cleanupOldLogs();
  return fileStream;
}

function cleanupOldLogs() {
  ensureLogDir();

  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(LOG_DIR);

  for (const file of files) {
    if (!/^bot-\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue;

    const fullPath = path.join(LOG_DIR, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fullPath);
      }
    } catch (_) {}
  }
}

const rotatingFileStream = {
  write(chunk) {
    rotateFileStreamIfNeeded().write(chunk);
  },
};

const prettyStream = pretty({
  colorize: true,
  translateTime: "yyyy-mm-dd HH:MM:ss",
  ignore: "pid,hostname",
});

const logger = pino(
  {
    level: LOG_LEVEL,
    base: undefined,
  },
  pino.multistream([
    { stream: prettyStream },
    { stream: rotatingFileStream },
  ])
);

setInterval(() => {
  rotateFileStreamIfNeeded();
}, 60 * 1000).unref();

rotateFileStreamIfNeeded();

function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, 4) + "****" + phone.slice(-4);
}

module.exports = { logger, maskPhone, LOG_DIR };
