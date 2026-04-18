const { handleCommand } = require("../handlers/commandHandler");
const { handleAI } = require("../handlers/aiHandler");
const { isRateLimited, randomDelay } = require("../utils/throttle");
const { logger, maskPhone } = require("../utils/logger");
const fs = require("fs");
const path = require("path");

// Per-phone processing queue — prevents race conditions when same user sends multiple msgs
const phoneQueues = new Map();

function enqueueForPhone(phone, fn) {
  const prev = phoneQueues.get(phone) || Promise.resolve();
  const next = prev.then(fn).catch(() => {});
  phoneQueues.set(phone, next);
  next.finally(() => {
    if (phoneQueues.get(phone) === next) phoneQueues.delete(phone);
  });
  return next;
}

// Route incoming message to appropriate handler
async function routeMessage(sock, msg) {
  try {
    const jid = msg.key.remoteJid;

    // Skip group messages (only handle private chats)
    if (jid.endsWith("@g.us")) {
      logger.debug({ jid }, "Skipping group message");
      return;
    }

    // Skip broadcast and status
    if (jid === "status@broadcast" || jid.includes("broadcast")) return;

    // Deteksi apakah pesan berisi media (gambar/video/dokumen/sticker)
    const isMediaMessage =
      !!msg.message?.imageMessage ||
      !!msg.message?.videoMessage ||
      !!msg.message?.documentMessage ||
      !!msg.message?.stickerMessage;

    // Extract text from message
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      "";

    // Jika pesan berupa media tanpa caption, balas dengan pesan admin follow-up
    if (isMediaMessage && (!text || text.trim() === "")) {
      const phone = jid.replace("@s.whatsapp.net", "");
      logger.info(
        { phone: maskPhone(phone) },
        "Media message received, replying with admin follow-up",
      );
      await randomDelay();
      await sendMessage(
        sock,
        jid,
        "Baik kak, referensi desainnya sudah kami terima 😊\nNanti admin kami yang akan chat kembali untuk bantu proses selanjutnya ya 🙏",
      );
      return;
    }

    if (!text || text.trim() === "") {
      logger.debug({ jid: maskPhone(jid) }, "Empty message, skipping");
      return;
    }

    const phone = jid.replace("@s.whatsapp.net", "");
    logger.info(
      { phone: maskPhone(phone), text: text.slice(0, 80) },
      "Incoming message",
    );

    // Rate limit check
    if (isRateLimited(phone)) {
      logger.warn({ phone: maskPhone(phone) }, "Rate limited");
      await sendMessage(
        sock,
        jid,
        "Kak, kamu terlalu banyak kirim pesan. Tunggu sebentar ya 😊",
      );
      return;
    }

    // Simulate typing delay (human-like)
    await randomDelay();

    // Check command rules first
    const commandResult = handleCommand(phone, text);
    if (commandResult.handled) {
      logger.info(
        { phone: maskPhone(phone) },
        `Command handled: "${text.slice(0, 30)}"`,
      );
      if (commandResult.type === "image") {
        // Kirim pesan teks terlebih dahulu jika ada
        if (commandResult.text) {
          await sendMessage(sock, jid, commandResult.text);
          await new Promise((r) => setTimeout(r, 400));
        }
        const sentCount = await sendImages(sock, jid, commandResult.images);
        if (sentCount === 0) {
          await sendMessage(
            sock,
            jid,
            "Maaf kak, gambar belum berhasil terkirim. Coba ulangi sekali lagi atau ketik admin ya 🙏",
          );
        }
      } else {
        await sendMessage(sock, jid, commandResult.reply);
      }
      return;
    }

    // Fall through to AI — enqueued per phone to avoid concurrent requests for same user
    await enqueueForPhone(phone, async () => {
      const aiResult = await handleAI(phone, text);

      // AI bisa return string (teks) atau object { type: 'image', images, text }
      if (aiResult && typeof aiResult === "object" && aiResult.type === "image") {
        if (aiResult.text) {
          await sendMessage(sock, jid, aiResult.text);
          await new Promise((r) => setTimeout(r, 400));
        }
        const sentCount = await sendImages(sock, jid, aiResult.images);
        if (sentCount === 0) {
          await sendMessage(
            sock,
            jid,
            "Maaf kak, gambar belum berhasil terkirim. Coba ulangi sekali lagi atau ketik admin ya 🙏",
          );
        }
      } else {
        await sendMessage(sock, jid, aiResult);
      }
    });
  } catch (err) {
    logger.error({ err: err.message }, "routeMessage error");
  }
}

async function sendMessage(sock, jid, text) {
  try {
    await sock.sendMessage(jid, { text });
  } catch (err) {
    logger.error({ jid, err: err.message }, "Failed to send message");
  }
}

async function sendImages(sock, jid, images) {
  let sentCount = 0;

  for (const img of images) {
    try {
      if (!img?.path || !fs.existsSync(img.path)) {
        logger.error({ jid, path: img?.path }, "Image file not found");
        continue;
      }

      const ext = path.extname(img.path).toLowerCase();
      const mimetype = getImageMimeType(ext);

      await sock.sendMessage(jid, {
        image: { url: img.path },
        caption: img.caption || "",
        mimetype,
        fileName: path.basename(img.path),
      });
      sentCount += 1;

      // Small delay between multiple images (anti-spam)
      if (images.length > 1) await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      logger.error(
        { jid, path: img.path, err: err.message },
        "Failed to send image",
      );
    }
  }

  return sentCount;
}

function getImageMimeType(ext) {
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".png":
    default:
      return "image/png";
  }
}

module.exports = { routeMessage };
