# WhatsApp Chatbot - Ayres Apparel

Bot WhatsApp berbasis `Baileys` + AI (`Ollama API`) untuk membalas chat customer secara otomatis. Dilengkapi fitur kirim gambar katalog, size chart, dan contoh desain.

---

## Struktur Project

```
chatbot_wa/
├── index.js                    # Entry point
├── knowledge-base.json         # Knowledge base CS (Ayres Apparel)
├── .env / .env.example         # Konfigurasi environment
├── gambar/
│   ├── katalog/
│   │   ├── katalog classic Adi Vira/
│   │   ├── katalog classic Cakra Vega/
│   │   ├── katalog pro Bima Sena/
│   │   └── katalog pro Garuda Vastra/
│   ├── Size Chart/
│   └── hasil_design/
└── src/
    ├── ai/
    │   ├── ollama.js           # Integrasi Ollama API + history chat
    │   └── prompt.js           # System prompt builder dari knowledge base
    ├── core/
    │   ├── connection.js       # Koneksi Baileys + QR login
    │   ├── healthcheck.js      # HTTP health server (Express)
    │   └── router.js           # Message router (command → image → AI)
    ├── handlers/
    │   ├── commandHandler.js   # Rule-based commands + kirim gambar
    │   └── aiHandler.js        # Handler fallback ke AI
    └── utils/
        ├── logger.js           # Logging via pino
        └── throttle.js         # Rate limiting + random delay
```

---

## 1. Persiapan

Pastikan sudah terpasang:
- Node.js `>= 18`
- npm
- Akun WhatsApp yang akan dipakai untuk bot
- API key Ollama

---

## 2. Install dependency

```bash
cd chatbot_wa
npm install
```

---

## 3. Setup environment

Copy file contoh env:

```bash
cp .env.example .env
```

Isi nilai di `.env`:

```env
# Ollama AI
OLLAMA_HOST=https://ollama.com
OLLAMA_KEY=your_ollama_api_key_here
OLLAMA_MODEL=gpt-oss:120b-cloud

# Bot
AI_TIMEOUT=25000
MAX_HISTORY=10

# Rate Limiting (anti-ban)
RATE_LIMIT_MAX=10
RATE_LIMIT_WINDOW=60000
REPLY_DELAY_MIN=800
REPLY_DELAY_MAX=2000

# Logging
LOG_LEVEL=info

# Session (Railway: /data/auth, Local: ./auth)
SESSION_DIR=./auth
```

---

## 4. Siapkan folder gambar

Taruh gambar di folder yang sesuai (format: `.jpg`, `.jpeg`, `.png`, `.webp`):

| Folder | Isi |
|---|---|
| `gambar/katalog/katalog classic Adi Vira/` | Foto katalog Classic Adi Vira |
| `gambar/katalog/katalog classic Cakra Vega/` | Foto katalog Classic Cakra Vega |
| `gambar/katalog/katalog pro Bima Sena/` | Foto katalog Pro Bima Sena |
| `gambar/katalog/katalog pro Garuda Vastra/` | Foto katalog Pro Garuda Vastra |
| `gambar/Size Chart/` | Gambar size chart jersey |
| `gambar/hasil_design/` | Foto contoh hasil desain jersey |

Gambar pertama di setiap folder akan diberi caption otomatis, gambar berikutnya dikirim tanpa caption.

---

## 5. Jalankan bot

```bash
npm start
```

Mode development (auto-restart):

```bash
npm run dev
```

---

## 6. Scan QR WhatsApp

Saat pertama kali jalan, terminal menampilkan QR code.

1. Buka WhatsApp di HP.
2. Masuk ke **Perangkat tertaut > Tautkan perangkat**.
3. Scan QR yang muncul di terminal.

Jika sukses, log akan menunjukkan status `connected`.

---

## 7. Health Check

Bot menyediakan HTTP server untuk monitoring:

- `GET http://localhost:3000/` — status dasar
- `GET http://localhost:3000/health` — return `200` jika status `connected`

Digunakan Railway untuk memastikan service hidup.

---

## 8. Perintah yang Dikenali Bot

Bot mengecek command rule-based **sebelum** meneruskan ke AI.

| Pesan Customer | Respons Bot |
|---|---|
| `ping` | `pong` |
| `menu` / `halo` / `hi` / `hello` | Pesan sambutan |
| `reset` / `/reset` | Reset history percakapan |
| `admin` | Handoff ke admin |
| `katalog` / `catalog` / `list jersey` / `model jersey` / dll | Tampilkan menu 4 kategori katalog |
| *(pilih kategori)* `1`–`4` atau nama katalog | Kirim gambar katalog yang dipilih |
| `size chart` / `ukuran jersey` / `ukuran baju` / dll | Kirim gambar size chart |
| `contoh desain` / `hasil desain` / `referensi design` / dll | Kirim foto contoh hasil desain |
| Pesan lainnya | Diteruskan ke AI (Ollama) |

### Alur katalog (2 langkah):
1. Customer ketik `katalog` → bot tampilkan 4 pilihan.
2. Customer ketik angka (`1`–`4`) atau nama katalog → bot kirim foto katalog.

---

## 9. Knowledge Base

File `knowledge-base.json` berisi informasi CS Ayres Apparel (layanan, harga, produksi, pengiriman, dll).

Untuk update konten, edit file tersebut langsung atau gunakan Admin UI (`chatbot_ui/`).

---

## 10. Deploy ke Railway

Lihat panduan lengkap di: **`README-DEPLOY.md`**

Ringkasan:
- Persistent volume di `/data/auth` untuk menyimpan sesi WhatsApp.
- Set `SESSION_DIR=/data/auth` di environment Railway.
- Railway otomatis menjalankan `npm start` via `Procfile`.
- Detail langkah deploy ada di `README-DEPLOY.md`.

---

## 11. Troubleshooting

**QR tidak muncul:**
- Pastikan proses tidak crash saat startup.
- Hapus folder sesi `auth/` lalu jalankan ulang.

**Status `logged_out`:**
- Sesi terputus, bot akan generate QR baru.
- Scan ulang QR terbaru.

**Bot tidak mengirim gambar:**
- Pastikan folder `gambar/` ada dan berisi file gambar.
- Cek log error untuk path gambar yang bermasalah.

**Bot balas error AI:**
- Cek `OLLAMA_HOST`, `OLLAMA_KEY`, dan koneksi internet.
- Pastikan model `OLLAMA_MODEL` tersedia di endpoint.

**Port bentrok:**
- Ubah `PORT` di environment sebelum menjalankan bot.

**Rate limit terlalu ketat:**
- Sesuaikan `RATE_LIMIT_MAX` dan `RATE_LIMIT_WINDOW` di `.env`.
