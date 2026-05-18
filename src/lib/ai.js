const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT_CHAT = `Kamu adalah "Asisten AI Kios Finance", analis bisnis cerdas untuk sebuah kios/konter pulsa & gas.
Tugasmu adalah menjawab pertanyaan Owner tentang data bisnis mereka secara ringkas, akurat, dan dalam Bahasa Indonesia.

Aturan:
- Jawab HANYA berdasarkan data yang diberikan di context. Jangan mengarang angka.
- Gunakan format angka Indonesia (titik untuk ribuan, contoh: 1.500.000).
- Jawab singkat dan langsung (maksimal 3-4 kalimat) kecuali diminta detail.
- Jika data tidak cukup untuk menjawab, katakan dengan jujur.
- Gunakan emoji secukupnya untuk membuat jawaban lebih friendly (📊💰📈).
- Jangan gunakan markdown formatting yang kompleks; gunakan teks biasa agar mudah dibaca di chat bubble.`;

const SYSTEM_PROMPT_INSIGHT = `Kamu adalah analis bisnis singkat untuk kios/konter.
Tugasmu: buat insight 2-3 kalimat SINGKAT dari data closing shift yang diberikan.
Fokus pada: performa penjualan, selisih kas, dan saran actionable jika ada.
Gunakan Bahasa Indonesia. Gunakan emoji (📊💰📈⚠️). Jangan panjang. Format teks biasa (untuk WhatsApp).`;

/**
 * Call OpenAI Chat Completions API
 */
async function callOpenAI(messages) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Generate chat response for Admin AI Assistant
 */
export async function generateChatResponse(userMessage, contextData) {
  try {
    const contextText = buildContextText(contextData);

    const messages = [
      { role: 'system', content: `${SYSTEM_PROMPT_CHAT}\n\nBerikut data bisnis terkini:\n${contextText}` },
      { role: 'user', content: userMessage },
    ];

    return await callOpenAI(messages);
  } catch (error) {
    console.error('AI Chat Error:', error);
    throw new Error('Gagal mendapatkan respons AI. Coba lagi nanti.');
  }
}

/**
 * Generate closing insight for WhatsApp report
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

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT_INSIGHT },
      { role: 'user', content: userPrompt },
    ];

    return await callOpenAI(messages);
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
  const validTrans = transactions.filter(t => t.status !== 'cancelled' && t.type !== 'adjustment');
  
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

  // Sales frequency  
  const productSales = {};
  validTrans.forEach(t => {
    t.items?.forEach(it => {
      productSales[it.name] = (productSales[it.name] || 0) + (it.qty || 1);
    });
  });
  const topSelling = Object.entries(productSales)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, qty]) => `${name} (${qty}x)`)
    .join(', ');

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

📦 PRODUK (${products.length} total):
- Produk stok: ${stockProducts.length}
- Stok rendah (≤3): ${lowStock.length > 0 ? lowStock.map(p => `${p.name} (${p.stock})`).join(', ') : 'Tidak ada'}
- Produk terlaris (all time): ${topSelling || 'Belum ada data'}

📋 CLOSING TERAKHIR:
${closingText || '  Belum ada data closing'}

📈 TOTAL KESELURUHAN (dari ${validTrans.length} transaksi tersimpan):
- Total pemasukan: Rp ${validTrans.filter(t => t.type !== 'expenditure').reduce((s, t) => s + (t.total || 0), 0).toLocaleString()}
- Total pengeluaran: Rp ${validTrans.filter(t => t.type === 'expenditure').reduce((s, t) => s + (t.total || 0), 0).toLocaleString()}
`.trim();
}
