import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';
import { LogOut, Calculator, FileCheck2, Loader2, History, AlertOctagon, Sparkles, Plus } from 'lucide-react';
import { db } from '../lib/firebase';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
// import { generateClosingInsight } from '../lib/ai';
import { collection, onSnapshot, doc, query, where, addDoc, serverTimestamp, writeBatch, getDocs, limit, orderBy } from 'firebase/firestore';

export default function Closing() {
  const { shift, user, setUser } = useStore();
  const navigate = useNavigate();
  
  const [balances, setBalances] = useState({ cash: 0 });
  const [shiftTrans, setShiftTrans] = useState([]);
  const [products, setProducts] = useState([]);
  const [actualCash, setActualCash] = useState('');
  const [loading, setLoading] = useState(false);
  const [ownerWA, setOwnerWA] = useState('');
  const [finalStocks, setFinalStocks] = useState({}); // { productId: count }
  const [transferAmounts, setTransferAmounts] = useState({}); // { productId: Rp amount paid via transfer }

  // Ambil nomor WA Owner untuk tujuan pengiriman laporan
  useEffect(() => {
    const fetchOwner = async () => {
       const q = query(collection(db, 'users'), where('role', '==', 'owner'), limit(1));
       const snap = await getDocs(q);
       if (!snap.empty) {
          setOwnerWA(snap.docs[0].data().whatsapp || '');
       }
    };
    fetchOwner();
  }, []);

  // Sync Data Realtime
  useEffect(() => {
    const unsubBal = onSnapshot(doc(db, 'balances', 'current'), (d) => {
       if (d.exists()) setBalances(d.data());
    });

    const today = new Date();
    today.setHours(0,0,0,0);
    
    // Optimasi Reads: Ambil 500 transaksi terbaru, filter manual status dan 'closed' di sisi client
    // agar kita tidak membaca ribuan histori data lama.
    const q = query(collection(db, 'transactions'), orderBy('timestamp', 'desc'), limit(500));
    
    const unsubTrans = onSnapshot(q, (snap) => {
      const allData = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      // Filter histori terbaru yang BUKAN dibatalkan, BELUM closed, dan BUKAN adjustment
      setShiftTrans(
        allData.filter(t => !t.closed && t.status !== 'cancelled' && t.type !== 'adjustment')
      );
    });

    // Ambil produk untuk rekap stok
    const unsubProd = onSnapshot(collection(db, 'products'), (snapshot) => {
      if (!snapshot.empty) {
        setProducts(snapshot.docs.map(doc => ({ firebaseId: doc.id, ...doc.data() })));
      } else {
        setProducts([]);
      }
    });

    return () => { unsubBal(); unsubTrans(); unsubProd(); };
  }, [shift]);

  // Semua transaksi yang belum di-close akan masuk ke laporan ini
  const shiftSales = shiftTrans;
  
  // Filter penyesuaian saldo manual oleh Owner (untuk modal awal tetap gunakan data hari ini)
  // Atau bisa juga tidak pakai adjustment lagi jika modal sudah baku
  const relevantAdjustments = []; 

  const { realPemasukan, realPengeluaran, realProfit, kasbonBaru, kasbonDilunasi } = shiftSales.reduce((acc, t) => {
    // Tangani Pelunasan Piutang
    if (t.type === 'pelunasan_kasbon') {
      acc.kasbonDilunasi += (t.total || 0);
      acc.realPemasukan += (t.total || 0); // Masuk laci
      return acc;
    }

    t.items?.forEach(item => {
      const q = item.qty || 1;
      const total = item.total || (item.price * q);
      const fee = (item.fee || 0) * q;
      const nominal = (item.nominal || 0) * q;
      
      if (item.action === 'tarik') {
        acc.realPengeluaran += nominal;
        if (item.feePaidVia === 'cash') {
          acc.realPemasukan += fee;
        }
      } else if (item.action === 'restock' || t.type === 'expenditure') {
        acc.realPengeluaran += total;
      } else {
        if (t.paymentMethod === 'kasbon') {
          acc.kasbonBaru += total; // barang keluar, hutang nambah, laci tidak nambah
        } else {
          acc.realPemasukan += total;
        }
      }
    });

    const transProfit = (t.type === 'expenditure') 
      ? 0 
      : (t.items && t.items.length > 0 
          ? t.items.reduce((sum, it) => {
              const q = Number(it.qty) || 1;
              if (it.action === 'tarik') return sum + ((Number(it.fee) || 0) * q);
              if (it.action === 'restock') return sum;
              const cost = Number(it.costPrice) || 0;
              return sum + (cost > 0 ? (Number(it.price || 0) - cost) * q : 0);
            }, 0)
          : (Number(t.profit) || 0));
    acc.realProfit += transProfit;

    return acc;
  }, { realPemasukan: 0, realPengeluaran: 0, realProfit: 0, kasbonBaru: 0, kasbonDilunasi: 0 });

  // Add physical stock sales calculation
  const physicalProducts = useMemo(() => {
    return products
      .filter(p => p.type === 'stok')
      .sort((a, b) => {
        const catA = (a.category || '').toLowerCase();
        const catB = (b.category || '').toLowerCase();
        if (catA !== catB) return catA.localeCompare(catB);
        return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
      });
  }, [products]);

  let physicalPemasukan = 0;
  let physicalProfit = 0;
  const physicalSalesLog = [];

  physicalProducts.forEach(p => {
    const endStock = finalStocks[p.firebaseId] !== undefined ? Number(finalStocks[p.firebaseId]) : p.stock;
    const sold = Math.max(0, p.stock - endStock);
    if (sold > 0) {
      const revenue = sold * (p.price || 0);
      const profit = (p.price - (p.costPrice || 0)) * sold;
      physicalPemasukan += revenue;
      physicalProfit += profit;
      physicalSalesLog.push({ name: p.name, sold, revenue, profit });
    }
  });

  // Final Pemasukan (Omset) untuk laporan, termasuk Kasbon (karena barang udah hitung keluar)
  const finalPemasukan = realPemasukan + physicalPemasukan + kasbonBaru; // Total Uang + Hutang
  const finalProfit = realProfit + physicalProfit;

  const totalAdjustment = relevantAdjustments.reduce((acc, adj) => {
    return acc + (adj.current?.cash || 0) - (adj.previous?.cash || 0);
  }, 0);

  // Total transfer dari penjualan fisik (untuk koreksi expectedCash & update Seabank)
  const totalPhysicalTransfer = physicalProducts.reduce((sum, p) => {
    return sum + (parseFloat(transferAmounts[p.firebaseId]) || 0);
  }, 0);

  // Pakai Modal Shift yang sudah diset baku oleh Owner
  const modalAwalShift = balances.modalShift || 1000000;
  // expectedCash dikurangi penjualan yang masuk via transfer dan kasbon (bukan ke kas)
  const expectedCash = modalAwalShift + finalPemasukan - realPengeluaran - totalPhysicalTransfer - kasbonBaru;
  
  const rawSetoran = (parseFloat(actualCash) || 0) - modalAwalShift;
  const setoran = Math.max(0, rawSetoran);
  const selisih = (parseFloat(actualCash) || 0) - expectedCash;
  const isBelowModal = rawSetoran < 0;
  const keterangan = isBelowModal 
    ? "Tidak ada yang bisa di setor karena cash yang ada di pakai lagi untuk modal walaupun di bawah modal awal."
    : "";

  const handleClosing = async (e) => {
    e.preventDefault();
    if (!actualCash) return alert("Masukkan actual cash fisik!");
    
    if (selisih !== 0) {
       const confirm = window.confirm(`Peringatan! Terjadi selisih Rp ${selisih.toLocaleString()}. Karyawan wajib lapor ke owner. Lanjut?`);
       if (!confirm) return;
    }

    setLoading(true);
    try {
      const batch = writeBatch(db);
      
      // 1. Simpan Laporan Closing ke Firestore untuk Audit Admin
      const closingRef = doc(collection(db, 'shift_closings'));
      const closingData = {
        shift,
        user: user.name,
        modalAwal: modalAwalShift,
        pemasukan: realPemasukan,
        pengeluaran: realPengeluaran,
        expectedCash,
        actualCash: parseFloat(actualCash),
        selisih,
        setoran,
        totalProfit: finalProfit,
        kasbonBaru,
        kasbonDilunasi,
        note: keterangan,
        timestamp: serverTimestamp(),
        physicalSales: physicalSalesLog
      };

      batch.set(closingRef, closingData);

      // 1b. Update Product Stocks to their Manual Final Count
      Object.entries(finalStocks).forEach(([prodId, count]) => {
        const pRef = doc(db, 'products', prodId);
        batch.update(pRef, { stock: Number(count) });
      });

      // 1c. Tandai transaksi digital sebagai "closed"
      shiftSales.forEach(t => {
        const tRef = doc(db, 'transactions', t.id);
        batch.update(tRef, { closed: true, closingId: closingRef.id });
      });

      // 1d. OTOMATIS: Buat transaksi individu untuk setiap penjualan fisik (selisih stok)
      physicalProducts.forEach(p => {
        const endStock = finalStocks[p.firebaseId] !== undefined ? Number(finalStocks[p.firebaseId]) : p.stock;
        const sold = Math.max(0, p.stock - endStock);
        
        if (sold > 0) {
          const revenue = sold * (p.price || 0);
          const profit = (p.price - (p.costPrice || 0)) * sold;
          const transferAmt = parseFloat(transferAmounts[p.firebaseId]) || 0;
          
          const physTransRef = doc(collection(db, 'transactions'));
          batch.set(physTransRef, {
            type: 'stok',
            status: 'success',
            user: user.name,
            shift,
            timestamp: serverTimestamp(),
            closed: true, // Langsung closed
            closingId: closingRef.id,
            total: revenue,
            profit: profit,
            paymentMethod: transferAmt >= revenue ? 'transfer' : (transferAmt > 0 ? 'mixed' : 'cash'),
            items: [{
              name: p.name,
              qty: sold,
              price: p.price,
              costPrice: p.costPrice || 0,
              total: revenue,
              action: 'sale',
              type: 'stok',
              firebaseId: p.firebaseId
            }]
          });
        }
      });

      // 2. POTONG KAS GLOBAL (RESET BALANCES UNTUK SHIFT BERIKUTNYA)
      // Jika setoran > 0, kita sisakan modalAwalShift. Jika setoran 0 (below modal), kita sisakan actualCash.
      const balanceRef = doc(db, 'balances', 'current');
      const newCashBalance = parseFloat(actualCash) - setoran;
      // Tambahkan penerimaan transfer fisik ke Seabank
      const newSeabankBalance = (balances.seabank || 0) + totalPhysicalTransfer;
      batch.update(balanceRef, { cash: newCashBalance, seabank: newSeabankBalance });

      await batch.commit();

      // Generate AI Insight (async, non-blocking)
      const productSales = {};
      shiftSales.forEach(t => {
        t.items?.forEach(it => {
          productSales[it.name] = (productSales[it.name] || 0) + (it.qty || 1);
        });
      });
      const topProducts = Object.entries(productSales)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, qty]) => `${name} (${qty}x)`)
        .join(', ');

      let aiInsight = null;
      /* AI Fitur dimatikan
      try {
        aiInsight = await generateClosingInsight({
          user: user.name,
          shift,
          modalAwal: modalAwalShift,
          pemasukan: realPemasukan,
          pengeluaran: realPengeluaran,
          profit: realProfit,
          actualCash: parseFloat(actualCash),
          expectedCash,
          selisih,
          setoran,
          transCount: shiftSales.length,
          topProducts
        });
      } catch (e) {
        console.warn('AI Insight skipped:', e.message);
      }
      */
      const aiSection = aiInsight ? `*AI INSIGHT (BETA)*:\n_${aiInsight}_\n\n` : "";

      // Summarize Digital Transactions by Category/Action
      const digitalSummary = shiftSales.reduce((acc, t) => {
        if (t.type === 'expenditure') {
           acc.expenses += (t.total || 0);
           return acc;
        }
        
        // Group by first item action or name
        const key = t.items?.[0]?.action === 'tarik' ? 'Tarik Tunai' : 'TopUp/Jasa';
        if (!acc.groups[key]) acc.groups[key] = { count: 0, volume: 0, profit: 0 };
        
        acc.groups[key].count += 1;
        acc.groups[key].volume += (t.total || 0);
        acc.groups[key].profit += (t.profit || 0);
        return acc;
      }, { groups: {}, expenses: 0 });

      const digitalText = Object.entries(digitalSummary.groups).map(([name, data]) => {
        return `- ${name}: ${data.count} tx (Laba: Rp ${data.profit.toLocaleString()})`;
      }).join('\n');

      const physicalText = physicalSalesLog.length > 0 
        ? physicalSalesLog.map(s => `- ${s.name}: ${s.sold}x (Laba: Rp ${s.profit.toLocaleString()})`).join('\n')
        : '- (Tidak ada penjualan fisik)';

      // Low Stock Analysis (Restock Recommendations)
      const restockNeeded = physicalProducts.filter(p => (finalStocks[p.firebaseId] !== undefined ? Number(finalStocks[p.firebaseId]) : p.stock) < 3);
      const restockText = restockNeeded.length > 0
        ? restockNeeded.map(p => {
             const sisa = (finalStocks[p.firebaseId] !== undefined ? Number(finalStocks[p.firebaseId]) : p.stock);
             return `- ${p.name} (Sisa: ${sisa}). Modal: Rp ${(p.costPrice || 0).toLocaleString()}/unit`;
          }).join('\n')
        : '- (Stok masih aman semua)';

      const waText = `*LAPORAN CLOSING SESI*\n` +
        `--------------------------\n` +
        `Petugas: ${user.name}\n` +
        `Shift: ${shift}\n` +
        `Tanggal: ${new Date().toLocaleDateString('id-ID')}\n\n` +
        `*PENJUALAN FISIK (STOK):*\n` +
        `${physicalText}\n` +
        `Subtotal Laba Fisik: Rp ${physicalProfit.toLocaleString()}\n\n` +
        `*RINGKASAN DIGITAL:*\n` +
        `${digitalText}\n` +
        `Subtotal Laba Digital: Rp ${realProfit.toLocaleString()}\n\n` +
        `*PENGELUARAN (CASH OUT):*\n` +
        `- Total: Rp ${realPengeluaran.toLocaleString()}\n\n` +
        `*TARGET BELANJA (STOK TIPIS):*\n` +
        `${restockText}\n\n` +
        `*REKAPITULASI AKHIR:*\n` +
        `Modal Awal: Rp ${modalAwalShift.toLocaleString()}\n` +
        (kasbonBaru > 0 ? `Piutang (Kasbon Baru): Rp ${kasbonBaru.toLocaleString()}\n` : ``) +
        (kasbonDilunasi > 0 ? `Pelunasan Kasbon (Masuk Laci): Rp ${kasbonDilunasi.toLocaleString()}\n` : ``) +
        `Sistem Final (Expected): Rp ${expectedCash.toLocaleString()}\n` +
        `Fisik Laci: Rp ${parseFloat(actualCash).toLocaleString()}\n` +
        `Selisih: ${selisih > 0 ? '+' : ''}Rp ${selisih.toLocaleString()}\n` +
        `--------------------------\n` +
        aiSection +
        `*ESTIMASI TOTAL LABA: Rp ${finalProfit.toLocaleString()}*\n` +
        `*SETORAN KE OWNER: Rp ${setoran.toLocaleString()}*\n` +
        (isBelowModal ? `\n_Keterangan: ${keterangan}_` : "") +
        `\n\nTerima kasih.`;

      // Generate PDF Document
      try {
         const docPdf = new jsPDF();
         const reportDate = new Date().toLocaleDateString('id-ID');
         
         // Title
         docPdf.setFontSize(18);
         docPdf.setFont("helvetica", "bold");
         docPdf.text('Laporan Closing Kios Finance', 14, 20);
         
         // Header Info
         docPdf.setFontSize(11);
         docPdf.setFont("helvetica", "normal");
         docPdf.text(`Petugas : ${user.name}`, 14, 30);
         docPdf.text(`Shift   : ${shift}`, 14, 36);
         docPdf.text(`Tanggal : ${reportDate}`, 14, 42);
         
         // Table: Ringkasan Digital
         docPdf.setFontSize(14);
         docPdf.setFont("helvetica", "bold");
         docPdf.text('Ringkasan Digital', 14, 55);
         
         const digitalTableBody = Object.entries(digitalSummary.groups).map(([name, data]) => [
            name, 
            `${data.count} tx`, 
            `Rp ${data.profit.toLocaleString()}`
         ]);
         
         autoTable(docPdf, {
            startY: 60,
            head: [['Kategori', 'Transaksi', 'Laba (Rp)']],
            body: digitalTableBody.length > 0 ? digitalTableBody : [['(Tidak ada data)', '-', '-']],
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185], fontSize: 10 },
            bodyStyles: { fontSize: 10 },
            margin: { left: 14 }
         });

         // Table: Penjualan Fisik
         let nextY = docPdf.lastAutoTable.finalY + 15;
         docPdf.setFontSize(14);
         docPdf.text('Penjualan Fisik (Stok)', 14, nextY);
         
         const physTableBody = physicalSalesLog.map(log => [
            log.name,
            `${log.sold} pcs`,
            `Rp ${log.revenue.toLocaleString()}`,
            `Rp ${log.profit.toLocaleString()}`
         ]);

         autoTable(docPdf, {
            startY: nextY + 5,
            head: [['Produk', 'Terjual', 'Omset (Rp)', 'Laba (Rp)']],
            body: physTableBody.length > 0 ? physTableBody : [['(Tidak ada penjualan fisik)', '-', '-', '-']],
            theme: 'grid',
            headStyles: { fillColor: [243, 156, 18], fontSize: 10 },
            bodyStyles: { fontSize: 10 },
            margin: { left: 14 }
         });

         // Rekapitulasi Akhir
         nextY = docPdf.lastAutoTable.finalY + 15;
         
         // Ensure we don't go out of bounds
         if(nextY > 250) {
            docPdf.addPage();
            nextY = 20;
         }

         docPdf.setFontSize(14);
         docPdf.text('Rekapitulasi Akhir', 14, nextY);
         
         docPdf.setFontSize(11);
         docPdf.setFont("helvetica", "normal");
         docPdf.text(`Modal Awal     : Rp ${modalAwalShift.toLocaleString()}`, 14, nextY + 8);
         docPdf.text(`Pengeluaran    : Rp ${realPengeluaran.toLocaleString()}`, 14, nextY + 14);
         let yt = nextY + 20;
         if (kasbonBaru > 0) {
            docPdf.text(`Piutang (Kasbon Baru): Rp ${kasbonBaru.toLocaleString()}`, 14, yt); yt += 6;
         }
         if (kasbonDilunasi > 0) {
            docPdf.text(`Pelunasan Masuk: Rp ${kasbonDilunasi.toLocaleString()}`, 14, yt); yt += 6;
         }
         docPdf.text(`Sistem Final   : Rp ${expectedCash.toLocaleString()}`, 14, yt); yt += 6;
         docPdf.text(`Fisik Laci     : Rp ${parseFloat(actualCash).toLocaleString()}`, 14, yt); yt += 6;
         
         const selisihStr = selisih > 0 ? `+Rp ${selisih.toLocaleString()}` : `-Rp ${Math.abs(selisih).toLocaleString()}`;
         docPdf.setFont("helvetica", "bold");
         docPdf.setTextColor(selisih === 0 ? 46 : 231, selisih === 0 ? 204 : 76, selisih === 0 ? 113 : 60);
         docPdf.text(`Selisih        : ${selisihStr}`, 14, yt); yt += 10;
         
         docPdf.setTextColor(0, 0, 0); // reset color
         docPdf.text(`Estimasi Total Laba : Rp ${finalProfit.toLocaleString()}`, 14, yt); yt += 6;
         docPdf.text(`Setoran ke Owner    : Rp ${setoran.toLocaleString()}`, 14, yt);

         docPdf.save(`Closing_${shift}_${new Date().getTime()}.pdf`);
      } catch(e) {
         console.error("Failed to generate PDF:", e);
      }

      const confirmWA = window.confirm(`Closing ${shift} Berhasil! Laporan PDF otomatis diunduh.\n\n${isBelowModal ? keterangan : `Silakan serahkan setoran Rp ${setoran.toLocaleString()} ke Owner.`} \n\nKirim laporan rincian ke WhatsApp Owner?`);
      
      if (confirmWA) {
        const waLink = ownerWA 
          ? `https://wa.me/${ownerWA}?text=${encodeURIComponent(waText)}`
          : `https://wa.me/?text=${encodeURIComponent(waText)}`;
        window.open(waLink, '_blank');
      }

      setUser(null); 
      navigate('/login');
    } catch (error) {
       console.error(error);
       alert("Gagal menyimpan laporan closing. Silakan coba lagi.");
    } finally {
       setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 pb-20">
      <div className="max-w-md mx-auto space-y-6">
        
        {/* Header Report Dashboard */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
           <div className="absolute -right-10 -top-10 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
           <h2 className="text-sm font-bold opacity-80 uppercase tracking-widest mb-1 text-center">Tutup Sesi</h2>
           <p className="text-2xl font-black text-center mb-6 uppercase tracking-widest">{shift}</p>
           
            <div className="grid grid-cols-2 gap-4">
               <div className="bg-white/10 p-2 rounded-xl text-center">
                 <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-tighter">Modal Sesi</p>
                 <p className="font-bold text-base">Rp {modalAwalShift.toLocaleString()}</p>
               </div>
               <div className="bg-white/10 p-2 rounded-xl text-center">
                 <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-tighter">Masuk (Sales)</p>
                 <p className="font-bold text-base text-emerald-300">+ Rp {finalPemasukan.toLocaleString()}</p>
               </div>
               <div className="bg-white/10 p-2 rounded-xl text-center">
                 <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-tighter">Keluar (Cashout)</p>
                 <p className="font-bold text-base text-red-300">- Rp {realPengeluaran.toLocaleString()}</p>
               </div>
                <div className="bg-white/10 p-2 rounded-xl text-center">
                  <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-tighter text-yellow-100 italic">Estimasi Laba</p>
                  <p className="font-bold text-base text-yellow-300 italic">Rp {finalProfit.toLocaleString()}</p>
                </div>
                <div className="bg-white/20 p-2 rounded-xl border border-white/20 col-span-2 shadow-inner text-center">
                  <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-tighter font-black">Detail Penjualan Fisik</p>
                  <p className="font-bold text-xs text-emerald-200">Rp {physicalPemasukan.toLocaleString()}</p>
                </div>
                <div className="bg-white/20 p-2 rounded-xl border border-white/20 col-span-2 shadow-inner">
                  <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-tighter font-black text-center">Sistem (Final)</p>
                  <p className="font-black text-2xl text-yellow-300 italic text-center">Rp {expectedCash.toLocaleString()}</p>
                </div>
            </div>
        </div>

        {/* ===================== SECTION: INPUT STOK AKHIR ===================== */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
           <div className="flex items-center gap-3 mb-6">
              <div className="bg-amber-100 p-2 rounded-xl text-amber-600">
                <Plus size={20} />
              </div>
              <h3 className="font-bold text-slate-800 text-lg">Input Sisa Stok Akhir</h3>
           </div>
           <p className="text-[10px] text-slate-400 font-bold mb-4 uppercase tracking-widest italic leading-tight">Hitung sisa barang di rak satu per satu.</p>
           
           <div className="space-y-4">
              {physicalProducts.map(p => {
                const endStock = finalStocks[p.firebaseId] !== undefined ? Number(finalStocks[p.firebaseId]) : p.stock;
                const sold = Math.max(0, p.stock - endStock);
                return (
                 <div key={p.firebaseId} className="flex flex-col gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                     <div className="flex items-center justify-between">
                        <div className="flex-1">
                           <div className="flex items-center gap-2">
                             <p className="text-xs font-black text-slate-800">{p.name}</p>
                             {sold > 0 && <span className="text-[9px] font-black bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-lg">Terjual: {sold}</span>}
                           </div>
                           <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Stok Awal di Sistem: {p.stock}</p>
                        </div>
                        <div className="flex items-center gap-3">
                           <input 
                             type="number" 
                             placeholder="0"
                             className="w-16 px-2 py-2 bg-white border border-slate-200 rounded-xl text-center font-black text-sm text-blue-600"
                             value={finalStocks[p.firebaseId] ?? ''}
                             onChange={e => setFinalStocks({...finalStocks, [p.firebaseId]: e.target.value})}
                           />
                        </div>
                     </div>
                     {/* Transfer input: tampil saat ada penjualan */}
                     {sold > 0 && (
                       <div className="flex items-center gap-3 bg-blue-50 rounded-xl px-3 py-2 border border-blue-100">
                         <div className="flex-1">
                           <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Bayar via Transfer (Rp)</p>
                           <p className="text-[9px] text-slate-400 font-bold">Max: Rp {(sold * (p.price||0)).toLocaleString()}</p>
                         </div>
                         <input
                           type="number"
                           placeholder="0"
                           min="0"
                           max={sold * (p.price || 0)}
                           className="w-24 px-2 py-1.5 bg-white border border-blue-200 rounded-xl text-center font-black text-sm text-blue-600"
                           value={transferAmounts[p.firebaseId] ?? ''}
                           onChange={e => setTransferAmounts({...transferAmounts, [p.firebaseId]: e.target.value})}
                         />
                       </div>
                     )}
                  </div>
                );
              })}
           </div>
        </div>

        {/* Transaction Detail Audit List */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 overflow-hidden">
           <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                 <div className="bg-blue-100 p-2 rounded-xl text-blue-600">
                   <History size={18} />
                 </div>
                 <h3 className="font-bold text-slate-800 text-lg">Rincian Transaksi Shift</h3>
              </div>
              <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-3 py-1 rounded-full uppercase tracking-widest">{shiftSales.length} Transaksi</span>
           </div>

           <div className="max-h-72 overflow-y-auto space-y-3 -mx-2 px-2">
              {shiftSales.length === 0 ? (
                <p className="text-center py-10 text-slate-400 text-xs italic">Belum ada transaksi di shift ini.</p>
              ) : (
                shiftSales.map(t => (
                  <div key={t.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex justify-between items-center group hover:bg-white hover:shadow-sm transition-all">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">
                          {t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleTimeString('id-id', { hour: '2-digit', minute: '2-digit'}) : '...'}
                        </span>
                        {t.items?.[0]?.action === 'tarik' && (
                          <span className="text-[8px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase">Tarik Tunai</span>
                        )}
                      </div>
                      <p className="text-xs font-bold text-slate-700 leading-none truncate max-w-[150px]">
                        {t.items?.map(it => `${it.name} (x${it.qty})`).join(', ')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                        <p className={`font-black text-sm italic ${(['tarik', 'restock'].includes(t.items?.[0]?.action) || t.type === 'expenditure') ? 'text-red-500' : 'text-slate-900'}`}>
                           {(['tarik', 'restock'].includes(t.items?.[0]?.action) || t.type === 'expenditure') ? '-' : ''}Rp {(t.total || 0).toLocaleString()}
                        </p>
                        {t.profit !== undefined && t.profit > 0 && (
                          <p className="text-[10px] font-bold text-amber-500 italic leading-none mt-0.5">Laba: Rp {t.profit.toLocaleString()}</p>
                        )}
                    </div>
                  </div>
                ))
              )}
           </div>
           
           <div className="mt-6 pt-6 border-t border-slate-100 space-y-3">
              {totalAdjustment !== 0 && (
                <div className="flex justify-between items-center bg-amber-50 p-3 rounded-xl border border-amber-100">
                  <div className="flex items-center gap-2 text-amber-700">
                    <AlertOctagon size={14} />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Penyesuaian Owner</span>
                  </div>
                  <span className={`text-xs font-black ${totalAdjustment > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {totalAdjustment > 0 ? '+' : ''}Rp {totalAdjustment.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-end">
                 <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Akumulasi Penjualan (Digital + Fisik)</p>
                    <p className="text-xl font-black text-blue-600 tracking-tight italic">Rp {finalPemasukan.toLocaleString()}</p>
                 </div>
              </div>
           </div>
        </div>

        {/* Input Fisik */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
           <div className="flex items-center gap-3 mb-6">
              <div className="bg-blue-100 p-2 rounded-xl text-blue-600">
                <Calculator size={20} />
              </div>
              <h3 className="font-bold text-slate-800 text-lg">Hitung Fisik Laci</h3>
           </div>
           
           <form onSubmit={handleClosing} className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-2">Uang Fisik Aktual (Rp)</label>
                <input
                  type="number"
                  required
                  value={actualCash}
                  onChange={e => setActualCash(e.target.value)}
                  className="w-full px-4 py-4 bg-slate-50 border-2 border-slate-200 focus:border-blue-500 rounded-2xl text-2xl font-black text-slate-900 transition-all text-center tracking-wider"
                  placeholder="0"
                />
              </div>

              {actualCash !== '' && (
                <div className="space-y-3 bg-slate-50 rounded-2xl p-4 border border-slate-100">
                   {totalPhysicalTransfer > 0 && (
                     <div className="flex justify-between items-center text-sm font-bold">
                       <span className="text-blue-500">💳 Transfer Fisik (ke Bank)</span>
                       <span className="font-black text-blue-600">Rp {totalPhysicalTransfer.toLocaleString()}</span>
                     </div>
                   )}
                   <div className="flex justify-between items-center text-sm font-bold">
                      <span className="text-slate-500">Setoran ke Owner</span>
                      <span className={`font-extrabold text-lg ${isBelowModal ? 'text-slate-400' : 'text-blue-600'}`}>
                        Rp {setoran.toLocaleString()}
                      </span>
                   </div>
                   
                   {isBelowModal && (
                     <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 text-[10px] text-amber-700 font-bold leading-relaxed">
                        ⚠️ Uang fisik di bawah modal awal. Seluruh cash akan digunakan kembali untuk modal shift berikutnya (Tidak ada setoran).
                     </div>
                   )}

                    <div className="flex justify-between items-center text-sm font-bold pt-3 border-t border-slate-200">
                       <span className="text-slate-500">Selisih Fisik vs Sistem</span>
                       <span className={`font-black text-base ${selisih === 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {selisih > 0 ? '+' : ''}{selisih.toLocaleString()}
                       </span>
                    </div>
                   {selisih !== 0 && (
                     <p className="text-xs text-red-500 mt-2 font-medium bg-red-50 p-2 rounded-lg border border-red-100">
                        ⚠ Selisih wajib dipertanggungjawabkan ke Owner.
                     </p>
                   )}
                </div>
              )}

              <button 
                type="submit" 
                disabled={loading || actualCash === ''}
                className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 active:scale-95 transition-all shadow-xl shadow-slate-900/20 disabled:opacity-50"
              >
                {loading ? 'Memproses...' : <><FileCheck2 size={20} /> Konfirmasi Closing</>}
              </button>
           </form>
        </div>
      </div>
    </div>
  );
}
