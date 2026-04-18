# Deploy ke Railway

Panduan ini khusus untuk bot WhatsApp `Baileys` di repo ini. Targetnya adalah proses bot tetap hidup, session tidak hilang, dan QR tidak perlu scan ulang setiap restart normal.

## Kenapa Railway

Railway lebih cocok dibanding Vercel untuk project ini karena:

- Bot berjalan sebagai proses Node.js long-running, bukan function stateless.
- Session WhatsApp disimpan sebagai file multi-file auth.
- Bot butuh koneksi keluar yang stabil untuk WhatsApp dan API AI.

## 1. Persiapan Repo

Pastikan file berikut sudah ada di repo:

- `index.js`
- `package.json`
- `railway.toml`
- `Procfile`

Repo ini sudah memenuhi syarat tersebut.

## 2. Buat Project Railway

1. Login ke Railway.
2. Buat project baru.
3. Pilih `Deploy from GitHub repo`.
4. Pilih repository ini.

Railway akan mendeteksi aplikasi Node.js dan menjalankan `node index.js`.

## 3. Tambahkan Persistent Volume

Ini langkah paling penting.

1. Masuk ke service bot di Railway.
2. Buka menu `Volumes`.
3. Tambahkan volume baru.
4. Mount path: `/data`

Dengan mount ini:

- session WhatsApp akan disimpan di `/data/auth`
- log file akan disimpan di `/data/logs`

Tanpa volume, bot berisiko minta scan QR ulang saat instance diganti atau restart.

## 4. Set Environment Variables

Set variable berikut di Railway:

```env
OLLAMA_HOST=https://ollama.com
OLLAMA_KEY=your_ollama_api_key_here
OLLAMA_MODEL=gpt-oss:120b-cloud

AI_TIMEOUT=25000
MAX_HISTORY=10

RATE_LIMIT_MAX=10
RATE_LIMIT_WINDOW=60000
REPLY_DELAY_MIN=800
REPLY_DELAY_MAX=2000

LOG_LEVEL=info

# Optional overrides
SESSION_DIR=/data/auth
LOG_DIR=/data/logs

WA_WATCHDOG_INTERVAL_MS=60000
WA_WATCHDOG_DISCONNECTED_MS=180000
WA_WATCHDOG_STARTING_MS=120000
WA_WATCHDOG_CONNECTED_STALE_MS=120000
```

Catatan:

- `PORT` tidak perlu diisi manual kecuali ada kebutuhan khusus. Railway akan inject sendiri.
- Jika volume `/data` sudah terpasang, `SESSION_DIR` dan `LOG_DIR` akan otomatis fallback ke `/data/auth` dan `/data/logs`.

## 5. Health Check

Repo ini menggunakan health check pada path `/` lewat `railway.toml`.

Alasannya:

- endpoint `/` selalu hidup selama proses Node masih sehat
- bot tidak akan dianggap gagal hanya karena sedang `waiting_qr` atau `reconnecting`

Ini penting untuk fase awal saat pertama kali scan QR.

## 6. Deploy Pertama

Setelah deploy pertama berhasil:

1. Buka URL service Railway.
2. Akses halaman root `/`.
3. Tunggu status `Menunggu Scan QR`.
4. Scan QR WhatsApp dari ponsel.
5. Pastikan status berubah menjadi `Terhubung`.

## 7. Verifikasi Setelah Login

Cek endpoint berikut:

- `/`
- `/api/status`
- `/health`

Ekspektasi:

- `/api/status` menampilkan `connected`
- `/health` mengembalikan `200` saat bot sudah tersambung

## 8. Checklist Stabilitas

- Gunakan volume di `/data`
- Jangan hapus isi `/data/auth` kecuali memang ingin login ulang
- Pastikan `OLLAMA_HOST` dan `OLLAMA_KEY` valid
- Pantau log Railway untuk error `logged out`, `Bad MAC`, atau restart berulang
- Hindari deploy berulang saat sesi belum stabil

## 9. Jika QR Tidak Muncul

Periksa:

- deploy sukses dan process `node index.js` benar-benar jalan
- log tidak menunjukkan crash startup
- `OLLAMA_*` tidak menyebabkan proses gagal di awal
- panel root `/` bisa dibuka

Jika session rusak, hapus folder `/data/auth` dari volume lalu deploy ulang agar QR baru dibuat.

## 10. Jika Bot Sering Disconnect

Periksa:

- volume benar-benar mounted di `/data`
- tidak ada instance ganda yang login dengan nomor sama
- WhatsApp account tidak login di banyak environment sekaligus
- koneksi ke Railway region yang dipakai cukup stabil

Jika ini bot yang benar-benar mission-critical, Railway masih layak, tapi VPS tetap memberi kontrol lebih tinggi.
