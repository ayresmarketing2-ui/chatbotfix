require("dotenv").config();
const {
  startConnection,
  requestReconnect,
  startConnectionWatchdog,
} = require("./src/core/connection");
const { startHealthServer } = require("./src/core/healthcheck");
const { logger, LOG_DIR } = require("./src/utils/logger");

logger.info("Starting WhatsApp Chatbot (Ayres Apparel)...");
logger.info({
  model: process.env.OLLAMA_MODEL || "gpt-oss:120b-cloud",
  host: process.env.OLLAMA_HOST || "https://ollama.com",
  logDir: LOG_DIR,
});

// Start HTTP health check server FIRST (Railway requires PORT binding)
startHealthServer();
startConnectionWatchdog();

startConnection().catch((err) => {
  logger.error({ err: err.message }, "Fatal error during startup");
  setTimeout(() => {
    requestReconnect("startup failure");
  }, 3000);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down...");
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  logger.error({ err: err.message, stack: err.stack }, "Uncaught exception");
  requestReconnect("uncaught exception");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled rejection");
  requestReconnect("unhandled rejection");
});
