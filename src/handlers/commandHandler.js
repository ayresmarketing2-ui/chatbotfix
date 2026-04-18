const { clearHistory } = require("../ai/ollama");
const path = require("path");
const fs = require("fs");

const GAMBAR_DIR = path.join(__dirname, "../../gambar");
const ADMIN_IMAGE_FOLLOWUP_REPLY =
  "Baik kak, nanti akan ada admin yang memberikan updatean selanjutnya.";
const JERSEY_DESIGN_IG_LINK = "https://www.instagram.com/ayres.sportswear/";
const DESIGN_SPECIFIC_REPLY =
  "Kalau contoh yang spesifik nanti admin akan menghubungi lagi ya kak. Mungkin bisa lihat contoh hasil design juga di link IG kami: " +
  JERSEY_DESIGN_IG_LINK;
const EXPRESS_REPLY =
  "Untuk paket express tersedia opsi 1 hari (+Rp75.000), 3 hari (+Rp50.000), 5 hari (+Rp30.000), dan 7 hari (+Rp15.000) ya kak. " +
  "Note: penerimaan express menyesuaikan load produksi, jadi tidak semua request express bisa kami terima. " +
  "Nanti admin akan bantu cek dulu ke bagian produksi ya.";

// Rule-based commands checked BEFORE sending to AI
// Returns { handled: true, reply: string }
//       | { handled: true, type: 'image', text?: string, images: [{path, caption}] }
//       | { handled: false }

// State: track users who are awaiting katalog category selection
const katalogState = new Map(); // phone -> 'awaiting_katalog'

// State: track users who are awaiting pricelist jersey selection
const pricelistJerseyState = new Map(); // phone -> 'awaiting_pricelist_jersey'

const PRICELIST_JERSEY_CATEGORIES = [
  {
    id: 1,
    name: "Paket Standar",
    folder: "Paket Standar",
    keywords: ["standar", "standard", "1"],
  },
  {
    id: 2,
    name: "Paket Classic",
    folder: "Paket Classic",
    keywords: ["classic", "klasik", "2"],
  },
  {
    id: 3,
    name: "Paket Pro",
    folder: "Paket Pro",
    keywords: ["pro", "3"],
  },
  {
    id: 4,
    name: "Warrior Combat",
    folder: "Warrior Combat",
    keywords: ["warrior", "combat", "4"],
  },
  {
    id: 5,
    name: "Nusantara",
    folder: "Nusantara",
    keywords: ["nusantara", "5"],
  },
  {
    id: 6,
    name: "Tambahan",
    folder: "Tambahan",
    keywords: ["tambahan", "extra", "biaya tambahan", "6"],
  },
];

const KATALOG_CATEGORIES = [
  {
    id: 1,
    name: "Classic Adi Vira",
    folder: "katalog classic Adi Vira",
    keywords: ["adi vira", "adivira", "pilih 1", "nomor 1", "katalog 1"],
  },
  {
    id: 2,
    name: "Classic Cakra Vega",
    folder: "katalog classic Cakra Vega",
    keywords: ["cakra vega", "cakravega", "pilih 2", "nomor 2", "katalog 2"],
  },
  {
    id: 3,
    name: "Pro Bima Sena",
    folder: "katalog pro Bima Sena",
    keywords: ["bima sena", "bimasena", "pilih 3", "nomor 3", "katalog 3"],
  },
  {
    id: 4,
    name: "Pro Garuda Vastra",
    folder: "katalog pro Garuda Vastra",
    keywords: [
      "garuda vastra",
      "garudavastra",
      "pilih 4",
      "nomor 4",
      "katalog 4",
    ],
  },
];

// ─── Helper: Load semua gambar dari subfolder GAMBAR_DIR ──────────────────────
function getImagesFromFolder(folderName, firstCaption = "") {
  const folderPath = path.join(GAMBAR_DIR, folderName);
  if (!fs.existsSync(folderPath)) return [];
  const files = fs
    .readdirSync(folderPath)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
  return files.map((f, i) => ({
    path: path.join(folderPath, f),
    caption: i === 0 ? firstCaption : "",
  }));
}

// ─── Helper: Kembalikan response image, atau fallback teks jika folder kosong ─
function imageResponse(folderName, text, _fallbackMsg, firstCaption = "") {
  const images = getImagesFromFolder(folderName, firstCaption);
  if (images.length > 0) {
    return { handled: true, type: "image", text, images };
  }
  return { handled: true, reply: ADMIN_IMAGE_FOLLOWUP_REPLY };
}

// ─── Helper: Katalog ──────────────────────────────────────────────────────────
function getKatalogImages(folder, categoryName) {
  const folderPath = path.join(GAMBAR_DIR, "katalog", folder);
  if (!fs.existsSync(folderPath)) return [];
  const files = fs
    .readdirSync(folderPath)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
  return files.map((f, i) => ({
    path: path.join(folderPath, f),
    caption:
      i === 0
        ? `Ini katalog *${categoryName}* kak! 🔥\n\nSemua desain katalog kami tersedia dalam versi *lengan pendek* ya kak, tapi kalau mau *lengan panjang* juga bisa dibuatkan.\nKalau ada yang cocok, langsung kabarin kami ya 😊`
        : "",
  }));
}

function clearKatalogState(phone) {
  katalogState.delete(phone);
}

function clearPricelistJerseyState(phone) {
  pricelistJerseyState.delete(phone);
}

function getPricelistJerseyImages(subfolder, categoryName) {
  const folderPath = path.join(GAMBAR_DIR, "Pricelist Jersey", subfolder);
  if (!fs.existsSync(folderPath)) return [];
  const files = fs
    .readdirSync(folderPath)
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();
  return files.map((f, i) => ({
    path: path.join(folderPath, f),
    caption:
      i === 0
        ? `Ini pricelist *${categoryName}* kak! 💰\n\nKalau ada pertanyaan lebih lanjut, langsung tanya ya 😊`
        : "",
  }));
}

// ─── Main handler ─────────────────────────────────────────────────────────────
function handleCommand(phone, text) {
  const lower = text.trim().toLowerCase();

  // ── Ping ────────────────────────────────────────────────────────────────────
  if (lower === "ping") {
    return { handled: true, reply: "pong 🏓" };
  }

  // ── Greeting / Menu ──────────────────────────────────────────────────────────
  const greetingKeywords = [
    "halo",
    "hai",
    "helo",
    "hello",
    "hi ",
    "hi,",
    "menu",
    "selamat pagi",
    "selamat siang",
    "selamat sore",
    "selamat malam",
    "assalamualaikum",
    "permisi",
    "p a g i",
  ];
  if (
    lower === "hi" ||
    lower === "menu" ||
    greetingKeywords.some((k) => lower.includes(k))
  ) {
    return {
      handled: true,
      reply:
        "Perkenalkan, saya *Zexo*, AI asisten CS yang akan membantu kakak ketika CS tidak berada di jam kerja 😊\n\n" +
        "Halo kak! Selamat datang di Ayres Apparel 👋\n\n" +
        "Ada yang bisa saya bantu? Mau bikin jersey untuk apa atau butuh info produk dulu?",
    };
  }

  // ── Reset ────────────────────────────────────────────────────────────────────
  if (lower === "reset" || lower === "/reset") {
    clearHistory(phone);
    clearKatalogState(phone);
    clearPricelistJerseyState(phone);
    return {
      handled: true,
      reply: "Okey, percakapan kita mulai dari awal ya 🙂",
    };
  }

  // ── Admin ────────────────────────────────────────────────────────────────────
  if (lower === "admin") {
    return {
      handled: true,
      reply:
        "Baik kak, saya hubungkan ke admin dulu ya. Mohon tunggu sebentar 🙏",
    };
  }

  // ── Order Intent — diprioritaskan sebelum semua state check ──────────────────
  // Jika customer menyatakan niat mau pesan, clear semua state dan arahkan ke proses order
  const orderIntentKeywords = [
    "mau pesan",
    "mau order",
    "ingin pesan",
    "ingin order",
    "saya pesan",
    "mau beli",
    "ingin beli",
    "saya order",
    "mulai pesan",
    "lanjut pesan",
    "lanjut order",
    "proses order",
    "mau lanjut",
    "lanjut aja",
    "oke pesan",
    "ok pesan",
    "jadi pesan",
  ];
  if (orderIntentKeywords.some((k) => lower.includes(k))) {
    clearKatalogState(phone);
    clearPricelistJerseyState(phone);
    return {
      handled: true,
      reply:
        "Siap kak! Biar kami bantu susun ordernya, boleh info dulu beberapa hal berikut ya 😊\n\n" +
        "1. Jersey untuk olahraga apa atau keperluan apa? (bola, futsal, volley, kelas, komunitas, dll.)\n" +
        "2. Qty yang dibutuhkan?\n" +
        "3. Mau atasan saja, setelan full-print, atau setelan dengan celana polyflex?\n" +
        "4. Sudah punya desain atau mau pakai katalog / bantu desain dari kami?\n" +
        "5. Bahan / tier yang diinginkan? (Standard, Classic, Pro, atau ada fitur khusus seperti UV-Protective, Silvertech, dsb.)\n" +
        "6. Perlu custom nama, nomor, logo atau sponsor?\n" +
        "7. Ukuran (dewasa, kids, big size, atau boxy)?\n" +
        "8. Deadline pemakaian atau tanggal berapa jersey harus selesai?\n" +
        "9. Alamat pengiriman (kota) dan ekspedisi pilihan?\n\n" +
        "Kasih tahu ya, nanti kami hitungkan harganya dan berikan estimasi produksi. 🙏",
    };
  }

  // ── Pricelist Jersey: step 2 — user sedang memilih paket ─────────────────────
  const expressKeywords = [
    "express",
    "ekspres",
    "urgent",
    "produksi cepat",
    "proses cepat",
    "sehari jadi",
    "1 hari",
    "3 hari",
    "5 hari",
    "7 hari",
  ];
  if (expressKeywords.some((k) => lower.includes(k))) {
    clearKatalogState(phone);
    clearPricelistJerseyState(phone);
    return {
      handled: true,
      reply: EXPRESS_REPLY,
    };
  }

  if (pricelistJerseyState.get(phone) === "awaiting_pricelist_jersey") {
    const matched = PRICELIST_JERSEY_CATEGORIES.find((cat) =>
      cat.keywords.some((kw) => lower.includes(kw)),
    );
    if (matched) {
      pricelistJerseyState.delete(phone);
      const images = getPricelistJerseyImages(matched.folder, matched.name);
      if (images.length > 0) {
        return {
          handled: true,
          type: "image",
          text:
            `Ini pricelist *${matched.name}* ya kak 😊\n\n` +
            "Kalau mau lihat paket lain, ketik *pricelist* lagi ya.\n" +
            "Ada yang ingin ditanyakan? Langsung kabarin kami 🙏",
          images,
        };
      }
      return {
        handled: true,
        reply: ADMIN_IMAGE_FOLLOWUP_REPLY,
      };
    }
    // Pilihan tidak dikenali, tanya ulang
    return {
      handled: true,
      reply:
        "Maaf kak, pilihannya tidak dikenali 😅\n\n" +
        "Silakan ketik angka atau nama paket:\n" +
        "1️⃣ Paket Standar\n" +
        "2️⃣ Paket Classic\n" +
        "3️⃣ Paket Pro\n" +
        "4️⃣ Warrior Combat\n" +
        "5️⃣ Nusantara\n" +
        "6️⃣ Tambahan",
    };
  }

  // ── Deteksi konteks order — dipakai di beberapa cek di bawah ─────────────────
  const orderContextKeywordsGlobal = [
    "hitungkan",
    "tolong hitung",
    "hitung harga",
    "pemesanan",
    "mau pesan",
    "mau order",
    "ingin pesan",
    "ingin order",
    "sudah dikirim",
    "foto katalog",
    "mengikuti katalog",
    "sesuai katalog",
    "pakai katalog",
    "dari katalog",
    "ikutin katalog",
    "pcs",
    "stel",
    "qty",
    "pasang jersey",
    "deadline",
    "size xl",
    "size l",
    "size m",
    "size s",
    "nama dan nomor",
    "custom nama",
    "nomor punggung",
  ];
  const isOrderContextGlobal = orderContextKeywordsGlobal.some((k) =>
    lower.includes(k),
  );

  // ── Katalog: step 2 — user sedang memilih kategori ───────────────────────────
  if (katalogState.get(phone) === "awaiting_katalog") {
    // Jika ternyata user mengirim detail order, batalkan state katalog dan teruskan ke AI
    if (isOrderContextGlobal) {
      katalogState.delete(phone);
      return { handled: false };
    }
    const matched = KATALOG_CATEGORIES.find((cat) =>
      cat.keywords.some((kw) => lower.includes(kw)),
    );
    if (matched) {
      katalogState.delete(phone);
      const images = getKatalogImages(matched.folder, matched.name);
      if (images.length > 0) {
        return { handled: true, type: "image", images };
      }
      return {
        handled: true,
        reply: ADMIN_IMAGE_FOLLOWUP_REPLY,
      };
    }
    return {
      handled: true,
      reply:
        "Maaf kak, pilihannya tidak dikenali 😅\n\n" +
        "Silakan ketik nama katalog yang diinginkan:\n" +
        "• *Adi Vira*\n" +
        "• *Cakra Vega*\n" +
        "• *Bima Sena*\n" +
        "• *Garuda Vastra*",
    };
  }

  // ── Katalog: step 1 — user minta katalog ─────────────────────────────────────
  const katalogKeywords = [
    "katalog",
    "catalog",
    "daftar jersey",
    "pilihan jersey",
    "model jersey",
  ];

  if (!isOrderContextGlobal && katalogKeywords.some((k) => lower.includes(k))) {
    // Jika nama katalog spesifik sudah disebut di pesan yang sama, langsung kirim gambarnya
    const directKatalogMatch = KATALOG_CATEGORIES.find((cat) =>
      cat.keywords.some((kw) => lower.includes(kw)),
    );
    if (directKatalogMatch) {
      katalogState.delete(phone);
      const images = getKatalogImages(directKatalogMatch.folder, directKatalogMatch.name);
      if (images.length > 0) {
        return { handled: true, type: "image", images };
      }
      return { handled: true, reply: ADMIN_IMAGE_FOLLOWUP_REPLY };
    }

    katalogState.set(phone, "awaiting_katalog");
    return {
      handled: true,
      reply:
        "Hai kak! Kami punya 4 pilihan katalog jersey 🏀\n\n" +
        "1️⃣ Classic Adi Vira\n" +
        "2️⃣ Classic Cakra Vega\n" +
        "3️⃣ Pro Bima Sena\n" +
        "4️⃣ Pro Garuda Vastra\n\n" +
        "Ketik nama katalog yang ingin kamu lihat ya kak 😊\n\n" +
        "Untuk katalog design juga boleh cek di Instagram kami ya kak, disitu lengkap 😊\n" +
        "https://www.instagram.com/ayres.sportswear/",
    };
  }

  // ── Katalog: direct name mention tanpa state (misal: "cakra vega" langsung) ──
  const directCatalogRequest = KATALOG_CATEGORIES.find((cat) =>
    cat.keywords.some((kw) => lower.includes(kw)),
  );
  if (
    directCatalogRequest &&
    !isOrderContextGlobal &&
    /(gambar|foto|contoh|lihat|minta|kirim|katalog)/i.test(lower)
  ) {
    katalogState.delete(phone);
    const images = getKatalogImages(directCatalogRequest.folder, directCatalogRequest.name);
    if (images.length > 0) {
      return { handled: true, type: "image", images };
    }
    return { handled: true, reply: ADMIN_IMAGE_FOLLOWUP_REPLY };
  }

  // ── Size Chart Boxy (cek SEBELUM size chart biasa) ───────────────────────────
  const sizeBoxyKeywords = [
    "size chart boxy",
    "sizechart boxy",
    "ukuran boxy",
    "size boxy",
    "boxy size chart",
    "boxy size",
    "chart boxy",
    "ukuran baju boxy",
    "tabel ukuran boxy",
  ];
  if (sizeBoxyKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Size Chart Boxy",
      "Ini size chart jersey *boxy* Ayres Apparel kak! 📏\n\n" +
        "Jersey boxy punya potongan yang lebih longgar dan tampilan lebih kasual.\n" +
        "Kalau masih bingung mau pilih ukuran berapa, jangan ragu tanya ya 😊",
      "Maaf kak, size chart boxy belum tersedia. Hubungi admin untuk info ukuran ya 🙏",
    );
  }

  // ── Size Chart reguler ────────────────────────────────────────────────────────
  const sizeKeywords = [
    "size chart",
    "sizechart",
    "ukuran baju",
    "ukuran jersey",
    "tabel ukuran",
    "size baju",
    "size jersey",
    "ukuran size",
    "chart size",
    "minta ukuran",
    "lihat ukuran",
    "info ukuran",
  ];
  if (sizeKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Size Chart",
      "Ini size chart jersey Ayres Apparel kak! 📏\n\n" +
        "Tersedia dari size kids (anak-anak), dewasa reguler, sampai big size.\n" +
        "Kalau masih bingung pilih ukuran yang pas, jangan ragu tanya ya 😊",
      "Maaf kak, size chart belum tersedia saat ini. Hubungi admin untuk info ukuran ya 🙏",
    );
  }

  // ── Alur Pemesanan ────────────────────────────────────────────────────────────
  const alurKeywords = [
    "alur pemesanan",
    "alur order",
    "cara pesan",
    "cara order",
    "langkah pesan",
    "langkah order",
    "prosedur pesan",
    "prosedur order",
    "gimana cara pesan",
    "gimana order",
    "cara beli",
    "proses pesan",
    "proses order",
    "tahapan order",
    "tahapan pesan",
    "bagaimana pesan",
    "bagaimana order",
    "mau pesan gimana",
    "mau order gimana",
    "order gimana",
  ];
  if (alurKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Alur pemesanan",
      "Berikut alur pemesanan jersey Ayres Apparel ya kak 😊\n\n" +
        "Singkatnya begini:\n" +
        "1️⃣ Konsultasi kebutuhan (jenis jersey, qty, deadline)\n" +
        "2️⃣ Pilih desain dari katalog atau ajukan desain sendiri\n" +
        "3️⃣ DP desain Rp100.000 untuk mulai proses\n" +
        "4️⃣ Revisi desain hingga fix (maks 3x revisi)\n" +
        "5️⃣ DP produksi minimal 70% dari total tagihan\n" +
        "6️⃣ Produksi 21 hari kerja setelah ACC proofing\n" +
        "7️⃣ Pelunasan → barang dikemas & dikirim 🚚\n\n" +
        "Detail lengkapnya ada di gambar berikut ya kak 👇",
      "Maaf kak, gambar alur pemesanan belum tersedia. Hubungi admin untuk info lebih lanjut ya 🙏",
    );
  }

  // ── Bahan ─────────────────────────────────────────────────────────────────────
  const bahanKeywords = [
    "jenis bahan",
    "bahan apa",
    "bahannya",
    "bahan jersey",
    "bahan kain",
    "material jersey",
    "kain jersey",
    "info bahan",
    "pilihan bahan",
    "bahan drifit",
    "bahan kaos",
    "bahan yang",
    "tipe bahan",
    "bahan tersedia",
    "spek bahan",
    "spesifikasi bahan",
  ];
  if (bahanKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Bahan",
      "Jersey Ayres Apparel menggunakan bahan drifit polyester berkualitas kak 😊\n\n" +
        "Ada beberapa tier pilihan bahan:\n" +
        "🔹 *Standard Package* — ringan, nyaman, cocok aktivitas sehari-hari\n" +
        "🔹 *Classic Package* — kualitas lebih baik dengan fitur tambahan\n" +
        "🔹 *Pro Package* — premium, sirkulasi udara optimal\n" +
        "🔹 *Warrior Combat* — tier tertinggi, fitur paling lengkap\n\n" +
        "Semua bahan bersifat adem, menyerap keringat, dan warna tahan luntur karena pakai teknik sublimasi.\n\n" +
        "Detailnya ada di gambar berikut kak 👇",
      "Maaf kak, info gambar bahan belum tersedia. Hubungi admin untuk rekomendasi bahan ya 🙏",
    );
  }

  // ── Jenis Kerah ───────────────────────────────────────────────────────────────
  const kerahKeywords = [
    "jenis kerah",
    "pilihan kerah",
    "model kerah",
    "tipe kerah",
    "kerahnya",
    "bentuk kerah",
    "kerah apa",
    "kerah yang",
    "kerah jersey",
    "kerah baju",
  ];
  if (kerahKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "jenis kerah",
      "Jersey Ayres bisa custom jenis kerah sesuai kebutuhan kak 😊\n\n" +
        "Ada beberapa pilihan bentuk kerah yang tersedia. Tinggal pilih sesuai selera tim ya!\n\n" +
        "Cek gambar berikut untuk melihat pilihan lengkapnya 👇",
      "Maaf kak, gambar jenis kerah belum tersedia. Hubungi admin untuk info lebih lanjut ya 🙏",
    );
  }

  // ── Logo 3D ───────────────────────────────────────────────────────────────────
  const logo3dKeywords = [
    "logo 3d",
    "3d logo",
    "logo timbul",
    "bordir logo",
    "contoh logo 3d",
    "logo 3 dimensi",
    "logo tiga dimensi",
    "logo emboss",
    "lihat logo 3d",
    "contoh 3d",
    "3d",
  ];
  if (logo3dKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Logo 3d",
      "Ini contoh logo 3D yang bisa ditambahkan pada jersey kak ✨\n\n" +
        "Logo 3D memberikan tampilan lebih premium dan eksklusif dibanding logo printing biasa.\n" +
        "Cocok untuk tim atau instansi yang ingin tampil lebih profesional 🔥\n\n" +
        "⚠️ *Penting:* Logo 3D *tidak tersedia untuk orderan satuan* ya kak.\n\n" +
        "Berikut ketentuan logo 3D:\n\n" +
        "🔹 *Tatami* — Minimal 6 pcs, tambahan Rp 20.000/pcs\n" +
        "   ✅ Order 12 pcs ke atas: *FREE logo tatami!*\n\n" +
        "🔹 *Flock* — Minimal 6 pcs, tambahan Rp 25.000/pcs\n\n" +
        "🔹 *Rubber* — Minimal 30 pcs, tambahan Rp 30.000/pcs\n\n" +
        "Untuk info lebih lanjut bisa konfirmasi ke admin ya kak 🙏",
      "Maaf kak, contoh gambar logo 3D belum tersedia. Hubungi admin untuk info lebih lanjut ya 🙏",
    );
  }

  // ── Pola / Pattern ────────────────────────────────────────────────────────────
  const polaKeywords = [
    "pola",
    "pattern",
    "motif jersey",
    "motif baju",
    "motif desain",
    "pilihan motif",
    "referensi motif",
    "contoh motif",
  ];
  if (polaKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Pola",
      "Untuk pola jersey, ada dua pilihan kak 😊\n\n" +
        "1️⃣ *Katalog Pola* — pilih dari pola yang sudah kami sediakan. Ada berbagai motif siap pakai yang tinggal dikombinasikan dengan warna dan identitas tim kakak.\n\n" +
        "2️⃣ *Full Custom* — kalau mau pola unik yang belum ada di katalog, tim desain Ayres bisa bantu buatkan dari nol. Cukup kirimkan ide, referensi gambar, atau konsep yang diinginkan.\n\n" +
        "Perlu diingat ya kak, kalau pola custom dari referensi, hasilnya mungkin tidak bisa 100% sama persis — tapi tim kami akan semaksimal mungkin menyesuaikan 🙏\n\n" +
        "Ini contoh referensi pola yang tersedia 👇",
      "Maaf kak, gambar pola belum tersedia. Hubungi admin untuk info lebih lanjut ya 🙏",
    );
  }

  // ── Pricelist Jersey ──────────────────────────────────────────────────────────
  const pricelistJerseyKeywords = [
    "pricelist jersey",
    "price list jersey",
    "pricelist baju",
    "daftar harga jersey",
    "harga paket jersey",
    "lihat pricelist",
    "minta pricelist",
    "kirim pricelist",
    "pricelist dong",
    "harga jersey",
    "harga baju",
    "info harga jersey",
    "cek harga jersey",
    "pricelist paket",
    "harga paket",
  ];
  if (pricelistJerseyKeywords.some((k) => lower.includes(k))) {
    pricelistJerseyState.set(phone, "awaiting_pricelist_jersey");
    return {
      handled: true,
      reply:
        "Hai kak! Berikut pilihan pricelist jersey Ayres Apparel 💰\n\n" +
        "1️⃣ Paket Standar\n" +
        "2️⃣ Paket Classic\n" +
        "3️⃣ Paket Pro\n" +
        "4️⃣ Warrior Combat\n" +
        "5️⃣ Nusantara\n" +
        "6️⃣ Tambahan\n\n" +
        "Ketik angka atau nama paket yang ingin kamu lihat ya kak 😊",
    };
  }

  // ── Pricelist Jaket ───────────────────────────────────────────────────────────
  const pricelistJaketKeywords = [
    "jaket",
    "jacket",
    "harga jaket",
    "pricelist jaket",
    "price jaket",
    "harga jacket",
    "pricelist jacket",
    "price list jaket",
    "price list jacket",
    "jaket berapa",
    "jaket harganya",
    "info jaket",
    "daftar harga jaket",
  ];
  if (pricelistJaketKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Pricelist Jaket",
      "Berikut pricelist jaket dari Ayres Apparel kak 😊\n\n" +
        "Jaket juga bisa custom desain sesuai kebutuhan tim atau komunitas ya.\n" +
        "Kalau ada pertanyaan soal spesifikasi, bahan, atau ketersediaan, langsung tanya aja 🙏\n\n" +
        "Detail harganya ada di sini 👇",
      "Maaf kak, gambar pricelist jaket belum tersedia. Hubungi admin untuk info harga ya 🙏",
    );
  }

  // ── Pricelist Makloon ─────────────────────────────────────────────────────────
  const pricelistMakloonKeywords = [
    "makloon",
    "maklun",
    "maklon",
    "pricelist makloon",
    "harga makloon",
    "price makloon",
    "jasa makloon",
    "layanan makloon",
    "makloon berapa",
    "daftar harga makloon",
    "info makloon",
  ];
  if (pricelistMakloonKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Pricelist Makloon",
      "Berikut informasi pricelist layanan makloon dari Ayres Apparel kak 😊\n\n" +
        "Layanan makloon tersedia untuk kamu yang sudah punya bahan sendiri dan hanya butuh proses produksinya saja.\n" +
        "Cocok untuk brand atau reseller yang mau produksi dalam jumlah banyak dengan biaya lebih efisien 💪\n\n" +
        "Detail harganya ada di sini 👇",
      "Maaf kak, gambar pricelist makloon belum tersedia. Hubungi admin untuk info lebih lanjut ya 🙏",
    );
  }

  // ── Promo ─────────────────────────────────────────────────────────────────────
  const promoKeywords = [
    "promo",
    "promosi",
    "diskon",
    "potongan harga",
    "penawaran",
    "special offer",
  ];
  if (promoKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Promo",
      "Berikut kak untuk promo bulan ini, mau pilih paket yang mana nih kak sebelum kehabisan 😁",
      "Maaf kak, info gambar promo belum tersedia. Hubungi admin untuk promo terkini ya 🙏",
    );
  }

  // ── COD ────────────────────────────────────────────────────────────────────────
  const codKeywords = [
    "cod",
    "cash on delivery",
    "bayar di tempat",
    "bayar ditempat",
    "bayar langsung",
    "bayar waktu terima",
    "bayar saat terima",
  ];
  if (codKeywords.some((k) => lower.includes(k))) {
    return {
      handled: true,
      reply:
        "Mohon maaf kak, sampai saat ini kita masih belum bisa melayani atau menerima pembayaran yang bersifat COD ya kak 🙏\n\n" +
        "Untuk pembayaran bisa melalui transfer bank BCA atau QRIS ya kak 😊",
    };
  }

  // ── Reseller ──────────────────────────────────────────────────────────────────
  const resellerKeywords = [
    "reseller",
    "mau jadi reseller",
    "harga reseller",
    "program reseller",
    "jadi reseller",
    "daftar reseller",
    "gabung reseller",
    "info reseller",
    "syarat reseller",
    "agen ayres",
  ];
  if (resellerKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Reseller",
      "Info program reseller Ayres Apparel ada di sini kak 😊\n\n" +
        "Reseller akan mendapatkan harga khusus setelah melakukan order sebanyak 2 kali.\n" +
        "Cocok untuk kamu yang mau bisnis jersey dengan modal kecil tapi keuntungan menarik 💰\n\n" +
        "Untuk syarat dan detail lengkapnya, cek gambar berikut ya 👇",
      "Maaf kak, gambar info reseller belum tersedia. Hubungi admin untuk info program reseller ya 🙏",
    );
  }

  // ── Referensi Warna ───────────────────────────────────────────────────────────
  const warnaKeywords = [
    "referensi warna",
    "pilihan warna",
    "warna bahan",
    "warna kain",
    "warna tersedia",
    "warna apa",
    "warna aja",
    "katalog warna",
    "lihat warna",
    "warna yang ada",
    "warna jersey",
    "warna baju",
    "daftar warna",
    "minta warna",
    "info warna",
  ];
  if (warnaKeywords.some((k) => lower.includes(k))) {
    return imageResponse(
      "Warna",
      "Berikut referensi pilihan warna bahan yang tersedia di Ayres Apparel kak 🎨\n\n" +
        "Yang perlu diketahui:\n" +
        "🖨️ *Warna printing* — tidak ada batasan, bisa semua warna sesuai desain\n" +
        "🧵 *Warna bahan dasar* — tersedia beberapa pilihan saja seperti yang ada di gambar\n\n" +
        "Kalau ada warna spesifik yang kamu inginkan, bisa dikonsultasikan dulu ya kak 😊",
      "Maaf kak, gambar referensi warna belum tersedia. Hubungi admin untuk info warna ya 🙏",
    );
  }

  // ── Contoh desain / hasil design ─────────────────────────────────────────────
  const designKeywords = [
    "contoh design",
    "contoh desain",
    "minta contoh desain",
    "minta contoh design",
    "boleh minta contoh",
    "minta contoh",
    "contoh dong",
    "ada contoh",
    "hasil design",
    "hasil desain",
    "referensi design",
    "referensi desain",
    "contoh jersey",
    "lihat desain",
    "lihat design",
  ];
  if (designKeywords.some((k) => lower.includes(k))) {
    return {
      handled: true,
      reply: DESIGN_SPECIFIC_REPLY,
    };
  }

  // ── Referensi desain via foto / forward ──────────────────────────────────────
  // ── Pertanyaan tentang foto/gambar yang dikirim customer ─────────────────────
  const tanyaFotoKeywords = [
    "di foto ini",
    "di gambar ini",
    "di foto tersebut",
    "di gambar tersebut",
    "foto ini bahan",
    "gambar ini bahan",
    "foto ini pakai",
    "gambar ini pakai",
    "foto tadi",
    "gambar tadi",
    "foto yang",
    "gambar yang",
    "ini bahan apa",
    "ini pakai bahan",
    "ini jersey apa",
    "ini tipe apa",
    "ini paket apa",
    "ini model apa",
    "ini jenis apa",
    "yg di foto",
    "yg di gambar",
    "yang di foto",
    "yang di gambar",
    "kalo di foto",
    "kalau di foto",
    "kalo di gambar",
    "kalau di gambar",
  ];
  if (tanyaFotoKeywords.some((k) => lower.includes(k))) {
    return {
      handled: true,
      reply: "Baik kak, nanti saya tanyakan ke admin ya 🙏",
    };
  }

  const referensiDesainKeywords = [
    "seperti ini bisa",
    "kayak gini bisa",
    "kayak ini bisa",
    "model seperti ini",
    "model kayak ini",
    "mau seperti ini",
    "mau kayak ini",
    "bisa seperti ini",
    "bisa kayak gini",
    "desain seperti ini",
    "desain kayak ini",
    "referensi ini",
    "contoh seperti ini",
    "mau yang seperti",
    "mau yang kayak",
    "bisa bikin seperti",
    "bisa bikin kayak",
    "mirip seperti ini",
    "mirip kayak ini",
    "seperti foto ini",
    "seperti gambar ini",
  ];
  if (referensiDesainKeywords.some((k) => lower.includes(k))) {
    return {
      handled: true,
      reply:
        "Baik kak, referensi desainnya sudah kami terima 😊\nNanti admin kami yang akan chat kembali untuk bantu proses selanjutnya ya 🙏",
    };
  }

  // ── Fallback gambar tidak tersedia + blacklist ───────────────────────────────
  // Fallback: user minta gambar/foto tetapi tidak terpetakan ke folder gambar yang ada
  const unknownImageRequestKeywords = [
    "kirim gambar",
    "kirim foto",
    "kirimkan gambar",
    "kirimkan foto",
    "minta gambar",
    "minta foto",
    "boleh minta gambar",
    "boleh minta foto",
    "share gambar",
    "share foto",
    "lihat gambar",
    "lihat foto",
    "contoh gambar",
    "contoh foto",
    "gambar jersey",
    "foto jersey",
  ];
  if (unknownImageRequestKeywords.some((k) => lower.includes(k))) {
    return {
      handled: true,
      reply: ADMIN_IMAGE_FOLLOWUP_REPLY,
    };
  }

  const blacklist = ["judi", "togel", "porn", "bokep", "scam"];
  if (blacklist.some((word) => lower.includes(word))) {
    return {
      handled: true,
      reply: "Maaf, saya tidak bisa membantu untuk hal tersebut.",
    };
  }

  return { handled: false };
}

module.exports = {
  handleCommand,
  clearKatalogState,
  clearPricelistJerseyState,
};
