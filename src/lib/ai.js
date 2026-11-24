import { db } from './firebase';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-lite'; // ganti jika model tidak tersedia di API key-mu (mis. 'gemini-2.5-flash-lite')

// Batas aman dokumen yang dibaca per panggilan tool (jaga biaya Firestore reads)
const MAX_DOCS = 2000;

const SYSTEM_PROMPT_CHAT = `Kamu adalah "Asisten AI Kios Finance", analis bisnis cerdas untuk sebuah kios/konter pulsa & gas.
Tugasmu adalah menjawab pertanyaan Owner tentang data bisnis mereka secara ringkas, akurat, dan dalam Bahasa Indonesia.

Aturan:
- Untuk pertanyaan tentang periode/tanggal tertentu (mis. "bulan lalu", "Mei", "minggu ini"), perbandingan antar-waktu, atau data historis di luar ringkasan 500 transaksi terbaru, WAJIB panggil tool yang tersedia (get_sales_summary / get_product_sales) untuk mengambil data akurat langsung dari database. Jangan menebak angka historis.
- Untuk pertanyaan soal data terkini/hari ini, cukup pakai ringkasan yang diberikan tanpa memanggil tool.
- Setelah memanggil tool, ringkas hasilnya dengan bahasa yang mudah dipahami. Jika hasil tool punya "truncated": true, sebutkan bahwa data terlalu banyak sehingga hanya sebagian terbaru yang dihitung.
- Jawab HANYA berdasarkan data (ringkasan atau hasil tool). Jangan mengarang angka.
- Gunakan format angka Indonesia (titik untuk ribuan, contoh: 1.500.000).
- Jawab singkat dan langsung (maksimal 3-4 kalimat) kecuali diminta detail.
- Gunakan emoji secukupnya untuk membuat jawaban lebih friendly (📊💰📈).
- Jangan gunakan markdown formatting yang kompleks; gunakan teks biasa agar mudah dibaca di chat bubble.`;

const SYSTEM_PROMPT_INSIGHT = `Kamu adalah analis bisnis singkat untuk kios/konter.
Tugasmu: buat insight 2-3 kalimat SINGKAT dari data closing shift yang diberikan.
Fokus pada: performa penjualan, selisih kas, dan saran actionable jika ada.
Gunakan Bahasa Indonesia. Gunakan emoji (📊💰📈⚠️). Jangan panjang. Format teks biasa (untuk WhatsApp).`;

// ============================ TOOLS (Function Calling) ============================

const CHAT_TOOLS = [{
  functionDeclarations: [
    {
      name: 'get_sales_summary',
      description: 'Ambil ringkasan penjualan langsung dari database Firestore untuk rentang tanggal tertentu (bisa lintas bulan/tahun, TIDAK dibatasi 500 transaksi). Mengembalikan total transaksi, pemasukan, pengeluaran, laba, serta produk terlaris (qty) dan produk dengan laba terbanyak. Pakai untuk pertanyaan tentang periode tertentu atau perbandingan waktu.',
      parameters: {
        type: 'OBJECT',
        properties: {
          startDate: { type: 'STRING', description: 'Tanggal mulai, format YYYY-MM-DD' },
          endDate: { type: 'STRING', description: 'Tanggal akhir (inklusif), format YYYY-MM-DD' },
        },
        required: ['startDate', 'endDate'],
      },
    },
    {
      name: 'get_product_sales',
      description: 'Ambil statistik penjualan satu produk dari database (total terjual, total laba, omzet, tanggal penjualan pertama & terakhir, perkiraan jumlah hari). Bisa dibatasi rentang tanggal (opsional).',
      parameters: {
        type: 'OBJECT',
        properties: {
          productName: { type: 'STRING', description: 'Nama produk; boleh sebagian, pencocokan tidak case-sensitive' },
          startDate: { type: 'STRING', description: 'Opsional. Tanggal mulai YYYY-MM-DD' },
          endDate: { type: 'STRING', description: 'Opsional. Tanggal akhir YYYY-MM-DD' },
        },
        required: ['productName'],
      },
    },
  ],
}];

function itemProfit(it) {
  const q = Number(it.qty) || 1;
  if (it.action === 'tarik') return (Number(it.fee) || 0) * q;
  const cost = Number(it.costPrice) || 0;
  return cost > 0 ? (Number(it.price || 0) - cost) * q : 0;
}

async function fetchTransactionsInRange(startDate, endDate) {
  const constraints = [];
  if (startDate) constraints.push(where('timestamp', '>=', new Date(`${startDate}T00:00:00`)));
  if (endDate) constraints.push(where('timestamp', '<=', new Date(`${endDate}T23:59:59`)));
  constraints.push(orderBy('timestamp', 'desc'));
  constraints.push(limit(MAX_DOCS));
  const snap = await getDocs(query(collection(db, 'transactions'), ...constraints));
  return snap.docs.map(d => d.data());
}

async function getSalesSummary({ startDate, endDate }) {
  const docs = await fetchTransactionsInRange(startDate, endDate);
  const valid = docs.filter(t => t.status !== 'cancelled' && t.status !== 'voided_by_audit' && t.type !== 'adjustment');
  let pemasukan = 0, pengeluaran = 0, laba = 0;
  const prod = {};
  valid.forEach(t => {
    if (t.type === 'expenditure') pengeluaran += Number(t.total) || 0;
    else pemasukan += Number(t.total) || 0;

    if (t.items?.length) {
      t.items.forEach(it => {
        if (it.action === 'restock' || t.type === 'expenditure') return;
        const p = itemProfit(it);
        laba += p;
        const q = Number(it.qty) || 1;
        const s = prod[it.name] || (prod[it.name] = { qty: 0, laba: 0 });
        s.qty += q;
        s.laba += p;
      });
    } else if (t.type !== 'expenditure') {
      laba += Number(t.profit) || 0;
    }
  });
  const byQty = Object.entries(prod).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5)
    .map(([n, s]) => ({ produk: n, qty: s.qty, laba: Math.round(s.laba) }));
  const byLaba = Object.entries(prod).sort((a, b) => b[1].laba - a[1].laba).slice(0, 5)
    .map(([n, s]) => ({ produk: n, laba: Math.round(s.laba), qty: s.qty }));
  return {
    periode: `${startDate} s/d ${endDate}`,
    totalTransaksi: valid.length,
    totalPemasukan: Math.round(pemasukan),
    totalPengeluaran: Math.round(pengeluaran),
    totalLaba: Math.round(laba),
    terlarisByQty: byQty,
    terbanyakLaba: byLaba,
    truncated: docs.length >= MAX_DOCS,
  };
}

async function getProductSales({ productName, startDate, endDate }) {
  const docs = await fetchTransactionsInRange(startDate, endDate);
  const term = (productName || '').toLowerCase();
  let qty = 0, laba = 0, omzet = 0, first = null, last = null;
  docs.filter(t => t.status !== 'cancelled' && t.status !== 'voided_by_audit' && t.type !== 'adjustment').forEach(t => {
    const ts = t.timestamp?.seconds ? t.timestamp.seconds * 1000 : null;
    (t.items || []).forEach(it => {
      if (!it.name || !it.name.toLowerCase().includes(term)) return;
      const q = Number(it.qty) || 1;
      qty += q;
      laba += itemProfit(it);
      omzet += Number(it.total) || (Number(it.price || 0) * q);
      if (ts) { if (first === null || ts < first) first = ts; if (last === null || ts > last) last = ts; }
    });
  });
  const fmt = ms => ms ? new Date(ms).toLocaleDateString('id-ID') : null;
  const days = (first && last) ? Math.max(1, Math.round((last - first) / 86400000) + 1) : null;
  return {
    produk: productName,
    totalTerjual: qty,
    totalLaba: Math.round(laba),
    totalOmzet: Math.round(omzet),
    penjualanPertama: fmt(first),
    penjualanTerakhir: fmt(last),
    rentangHari: days,
    truncated: docs.length >= MAX_DOCS,
  };
}

const CHAT_EXECUTORS = {
  get_sales_summary: getSalesSummary,
  get_product_sales: getProductSales,
};

// ============================ Gemini API ============================

async function postGemini(body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error: ${response.status}`);
  }
  return response.json();
}

/**
 * Panggil Gemini dengan dukungan multi-turn function calling.
 * Jika `tools` & `executors` diberikan, model bisa memanggil fungsi dan kita
 * eksekusi (query Firestore), lalu kirim hasilnya kembali sampai model menjawab.
 */
async function callGemini(systemPrompt, userText, { tools, executors } = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error('API key Gemini belum diatur (set VITE_GEMINI_API_KEY di .env, lalu restart dev server).');
  }

  const contents = [{ role: 'user', parts: [{ text: userText }] }];
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
  };
  if (tools) body.tools = tools;

  // Maksimal beberapa putaran agar tidak loop tak berujung
  for (let i = 0; i < 5; i++) {
    const data = await postGemini(body);

    if (data.promptFeedback?.blockReason) {
      throw new Error(`Permintaan diblokir Gemini: ${data.promptFeedback.blockReason}`);
    }

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const fcParts = parts.filter(p => p.functionCall);

    if (fcParts.length && executors) {
      contents.push(candidate.content);
      const responseParts = [];
      for (const p of fcParts) {
        const { name, args } = p.functionCall;
        let result;
        try {
          result = executors[name] ? await executors[name](args || {}) : { error: `Fungsi ${name} tidak dikenal` };
        } catch (e) {
          result = { error: e.message || 'Gagal mengambil data' };
        }
        responseParts.push({ functionResponse: { name, response: result } });
      }
      contents.push({ role: 'function', parts: responseParts });
      continue; // kirim lagi ke model dengan hasil fungsi
    }

    const text = parts.map(p => p.text || '').join('').trim();
    if (text) return text;
    throw new Error('Gemini tidak mengembalikan jawaban.');
  }

  throw new Error('AI terlalu banyak memanggil fungsi tanpa memberi jawaban akhir.');
}

/**
 * Generate chat response for Admin AI Assistant (dengan akses tool ke Firestore)
 */
export async function generateChatResponse(userMessage, contextData) {
  try {
    const contextText = buildContextText(contextData);
    const now = new Date();
    const todayStr = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const isoToday = now.toISOString().split('T')[0];
    const systemPrompt = `${SYSTEM_PROMPT_CHAT}\n\nTanggal hari ini: ${todayStr} (${isoToday}).\n\nRingkasan data terkini (hanya 500 transaksi terbaru — untuk data historis gunakan tool):\n${contextText}`;
    return await callGemini(systemPrompt, userMessage, { tools: CHAT_TOOLS, executors: CHAT_EXECUTORS });
  } catch (error) {
    console.error('AI Chat Error:', error);
    throw new Error(error.message || 'Gagal mendapatkan respons AI. Coba lagi nanti.');
  }
}

/**
 * Generate closing insight for WhatsApp report (tanpa tool)
 */
export async function generateClosingInsight(closingData) {
  try {
    const userPrompt = `Data Closing Shift:
- Petugas: ${closingData.user}
- Shift: ${closingData.shift}
- Modal Baku: Rp ${closingData.modalAwal?.toLocaleString()}
- Total Penjualan (Masuk): Rp ${closingData.pemasukan?.toLocaleString()}
- Total Pengeluaran (Keluar): Rp ${closingData.pengeluaran?.toLocaleString()}
- Estimasi Laba: Rp ${closingData.profit?.toLocaleString()}
- Uang Fisik di Laci: Rp ${closingData.actualCash?.toLocaleString()}
- Uang Seharusnya (Sistem): Rp ${closingData.expectedCash?.toLocaleString()}
- Selisih: Rp ${closingData.selisih?.toLocaleString()}
- Setoran ke Owner: Rp ${closingData.setoran?.toLocaleString()}
- Jumlah Transaksi: ${closingData.transCount}
${closingData.topProducts ? `- Produk Terlaris: ${closingData.topProducts}` : ''}

Buat insight singkat (2-3 kalimat):`;

    return await callGemini(SYSTEM_PROMPT_INSIGHT, userPrompt);
  } catch (error) {
    console.error('AI Insight Error:', error);
    return null; // Return null = fallback, no insight in report
  }
}

/**
 * Build context text from app data for chat
 */
function buildContextText(data) {
  const { transactions = [], products = [], balances = {}, closings = [] } = data;

  // Filter valid transactions
  const validTrans = transactions.filter(t => t.status !== 'cancelled' && t.status !== 'voided_by_audit' && t.type !== 'adjustment');

  // Today's stats
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTrans = validTrans.filter(t => {
    const d = t.timestamp ? new Date(t.timestamp.seconds * 1000) : null;
    return d && d >= todayStart;
  });

  const todayRevenue = todayTrans.reduce((s, t) => s + (t.total || 0), 0);
  const todayProfit = todayTrans.reduce((s, t) => {
    if (t.items?.length > 0) {
      return s + t.items.reduce((sum, it) => {
        const q = Number(it.qty) || 1;
        if (it.action === 'tarik') return sum + ((Number(it.fee) || 0) * q);
        const cost = Number(it.costPrice) || 0;
        return sum + (cost > 0 ? (Number(it.price || 0) - cost) * q : 0);
      }, 0);
    }
    return s + (Number(t.profit) || 0);
  }, 0);

  // Product summary
  const stockProducts = products.filter(p => p.type === 'stok');
  const lowStock = stockProducts.filter(p => p.stock !== undefined && p.stock <= 3);

  // Analitik per produk: jumlah terjual, laba, rentang tanggal
  const prodStats = {};
  let minTs = null, maxTs = null;
  validTrans.forEach(t => {
    const ts = t.timestamp?.seconds ? t.timestamp.seconds * 1000 : null;
    if (ts) { if (minTs === null || ts < minTs) minTs = ts; if (maxTs === null || ts > maxTs) maxTs = ts; }
    t.items?.forEach(it => {
      const name = it.name;
      if (!name) return;
      const q = Number(it.qty) || 1;
      let profit;
      if (it.action === 'tarik') profit = (Number(it.fee) || 0) * q;
      else { const cost = Number(it.costPrice) || 0; profit = cost > 0 ? (Number(it.price || 0) - cost) * q : 0; }
      const s = prodStats[name] || (prodStats[name] = { qty: 0, profit: 0, first: null, last: null });
      s.qty += q;
      s.profit += profit;
      if (ts) { if (s.first === null || ts < s.first) s.first = ts; if (s.last === null || ts > s.last) s.last = ts; }
    });
  });

  const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString('id-ID') : '-';
  const daySpan = (a, b) => (a && b) ? Math.max(1, Math.round((b - a) / 86400000) + 1) : 1;

  const entries = Object.entries(prodStats);
  const topQty = entries.slice().sort((a, b) => b[1].qty - a[1].qty).slice(0, 5)
    .map(([name, s]) => `${name}: ${s.qty}x, laba Rp ${Math.round(s.profit).toLocaleString()} (${fmtDate(s.first)}–${fmtDate(s.last)}, ~${daySpan(s.first, s.last)} hari)`)
    .join('\n  ');
  const topProfit = entries.slice().sort((a, b) => b[1].profit - a[1].profit).slice(0, 5)
    .map(([name, s]) => `${name}: Rp ${Math.round(s.profit).toLocaleString()} (${s.qty}x)`)
    .join(', ');

  const totalDays = daySpan(minTs, maxTs);
  const avgPerDay = totalDays ? Math.round(validTrans.length / totalDays) : validTrans.length;

  // Recent closings
  const recentClosings = closings.slice(0, 3);
  const closingText = recentClosings.map(c =>
    `  - ${c.user} | ${c.shift} | Setoran: Rp ${c.setoran?.toLocaleString()} | Laba: Rp ${c.totalProfit?.toLocaleString()} | Selisih: Rp ${c.selisih?.toLocaleString()}`
  ).join('\n');

  return `
📊 RINGKASAN HARI INI:
- Jumlah transaksi hari ini: ${todayTrans.length}
- Total pemasukan hari ini: Rp ${todayRevenue.toLocaleString()}
- Estimasi laba hari ini: Rp ${todayProfit.toLocaleString()}

💰 SALDO TERKINI:
- Cash: Rp ${(balances.cash || 0).toLocaleString()}
- APK: Rp ${(balances.apk || 0).toLocaleString()}
- SeaBank: Rp ${(balances.seabank || 0).toLocaleString()}
- Modal Shift (Baku): Rp ${(balances.modalShift || 0).toLocaleString()}

🗓️ RENTANG DATA TRANSAKSI:
- Periode: ${fmtDate(minTs)} s/d ${fmtDate(maxTs)} (~${totalDays} hari, rata-rata ${avgPerDay} transaksi/hari)
- Cakupan: ${validTrans.length} transaksi terbaru (maksimal 500). Angka "all time" terbatas pada data ini.

📦 PRODUK (${products.length} total):
- Produk stok: ${stockProducts.length}
- Stok rendah (≤3): ${lowStock.length > 0 ? lowStock.map(p => `${p.name} (${p.stock})`).join(', ') : 'Tidak ada'}
- Laba terbanyak per produk: ${topProfit || 'Belum ada data'}
- Terlaris (qty) + rentang waktu tiap produk:
  ${topQty || 'Belum ada data'}

📋 CLOSING TERAKHIR:
${closingText || '  Belum ada data closing'}

📈 TOTAL KESELURUHAN (dari ${validTrans.length} transaksi tersimpan):
- Total pemasukan: Rp ${validTrans.filter(t => t.type !== 'expenditure').reduce((s, t) => s + (t.total || 0), 0).toLocaleString()}
- Total pengeluaran: Rp ${validTrans.filter(t => t.type === 'expenditure').reduce((s, t) => s + (t.total || 0), 0).toLocaleString()}
`.trim();
}
