const axios = require("axios");
const { buildSystemPrompt } = require("./prompt");
const { logger } = require("../utils/logger");

const OLLAMA_HOST = process.env.OLLAMA_HOST || "https://ollama.com";
const OLLAMA_KEY = process.env.OLLAMA_KEY || "";
const MODEL_NAME = process.env.OLLAMA_MODEL || "gpt-oss:120b-cloud";
const AI_TIMEOUT = parseInt(process.env.AI_TIMEOUT || "25000"); // 25 seconds
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_AI || "5");
const MAX_RETRIES = parseInt(process.env.AI_MAX_RETRIES || "2");

// Simple semaphore to limit concurrent AI requests
let activeRequests = 0;
const waitQueue = [];

function acquireSemaphore() {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitQueue.push(resolve));
}

function releaseSemaphore() {
  if (waitQueue.length > 0) {
    waitQueue.shift()();
  } else {
    activeRequests--;
  }
}

// In-memory conversation history: phone -> messages[]
const historyMap = new Map();
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || "10");

function getHistory(phone) {
  return historyMap.get(phone) || [];
}

function addToHistory(phone, role, content) {
  const history = getHistory(phone);
  history.push({ role, content });
  // Keep only last MAX_HISTORY messages
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
  historyMap.set(phone, history);
}

function clearHistory(phone) {
  historyMap.delete(phone);
}

async function askAI(phone, userMessage) {
  // Build message array with system prompt + history + new user message
  const systemPrompt = buildSystemPrompt();
  const history = getHistory(phone);

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  await acquireSemaphore();
  try {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await axios.post(
          `${OLLAMA_HOST}/api/chat`,
          {
            model: MODEL_NAME,
            messages,
            stream: false,
            options: {
              temperature: 0.7,
              num_predict: 500,
            },
          },
          {
            headers: {
              "Content-Type": "application/json",
              ...(OLLAMA_KEY ? { Authorization: `Bearer ${OLLAMA_KEY}` } : {}),
            },
            timeout: AI_TIMEOUT,
          }
        );

        const assistantReply =
          response.data?.message?.content ||
          response.data?.choices?.[0]?.message?.content || // OpenAI-compatible fallback
          "";

        if (!assistantReply) {
          throw new Error("Empty response from AI");
        }

        // Save to history
        addToHistory(phone, "user", userMessage);
        addToHistory(phone, "assistant", assistantReply);

        return assistantReply.trim();
      } catch (err) {
        if (axios.isAxiosError(err) && err.code === "ECONNABORTED") {
          logger.warn({ phone }, "AI request timed out");
          throw new Error("TIMEOUT");
        }

        lastErr = err;
        const status = err.response?.status;
        const isRetryable = !status || status >= 500 || status === 429;

        if (!isRetryable || attempt === MAX_RETRIES) {
          logger.error({ err: err.message }, "AI request failed");
          throw err;
        }

        const delay = 1000 * (attempt + 1);
        logger.warn({ attempt: attempt + 1, status, delay }, "AI request retrying...");
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr;
  } finally {
    releaseSemaphore();
  }
}

module.exports = { askAI, clearHistory };
