// Simple per-user rate limiter to avoid WhatsApp ban
const rateLimitMap = new Map(); // phone -> { count, resetAt }

const RATE_LIMIT = {
  max: parseInt(process.env.RATE_LIMIT_MAX || "10"),       // max messages
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || "60000"), // per 60 seconds
};

// Minimum delay between bot responses (ms) to appear human-like
const REPLY_DELAY_MIN = parseInt(process.env.REPLY_DELAY_MIN || "800");
const REPLY_DELAY_MAX = parseInt(process.env.REPLY_DELAY_MAX || "2000");

function isRateLimited(phone) {
  const now = Date.now();
  const entry = rateLimitMap.get(phone);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(phone, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return false;
  }

  if (entry.count >= RATE_LIMIT.max) {
    return true;
  }

  entry.count++;
  return false;
}

function randomDelay() {
  const ms = Math.floor(
    Math.random() * (REPLY_DELAY_MAX - REPLY_DELAY_MIN) + REPLY_DELAY_MIN
  );
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [phone, entry] of rateLimitMap.entries()) {
    if (now >= entry.resetAt) rateLimitMap.delete(phone);
  }
}, 5 * 60 * 1000);

module.exports = { isRateLimited, randomDelay };
