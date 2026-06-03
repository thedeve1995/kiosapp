import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';
import { LogOut, Calculator, FileCheck2, Loader2, History, AlertOctagon, Plus, ChevronRight, ChevronLeft, Check, TrendingUp, TrendingDown, Minus, Package } from 'lucide-react';
import { db } from '../lib/firebase';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { collection, onSnapshot, doc, query, where, addDoc, serverTimestamp, writeBatch, getDocs, limit, orderBy } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';

const STEPS = [
  { id: 1, label: 'Rekap Shift', icon: TrendingUp },
  { id: 2, label: 'Input Stok', icon: Package },
  { id: 3, label: 'Hitung Kas', icon: Calculator },
];

export default function Closing() {
  const { shift, user, setUser } = useStore();
  const navigate = useNavigate();

  const [step, setStep]           = useState(1);
  const [balances, setBalances]   = useState({ cash: 0 });
  const [shiftTrans, setShiftTrans] = useState([]);
  const [products, setProducts]   = useState([]);
  const [actualCash, setActualCash] = useState('');
  const [loading, setLoading]     = useState(false);
  const [ownerWA, setOwnerWA]     = useState('');
  const [finalStocks, setFinalStocks]       = useState({});
  const [transferAmounts, setTransferAmounts] = useState({});

  // Fetch owner WA
  useEffect(() => {
    const fetchOwner = async () => {
      const q = query(collection(db, 'users'), where('role', '==', 'owner'), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) setOwnerWA(snap.docs[0].data().whatsapp || '');
    };
    fetchOwner();
  }, []);

  // Sync Data
  useEffect(() => {
    const unsubBal = onSnapshot(doc(db, 'balances', 'current'), (d) => {
      if (d.exists()) setBalances(d.data());
    });
    const q = query(collection(db, 'transactions'), orderBy('timestamp', 'desc'), limit(500));
    const unsubTrans = onSnapshot(q, (snap) => {
      const allData = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      setShiftTrans(allData.filter(t => !t.closed && t.status !== 'cancelled' && t.type !== 'adjustment'));
    });
    const unsubProd = onSnapshot(collection(db, 'products'), (snapshot) => {
      if (!snapshot.empty) setProducts(snapshot.docs.map(doc => ({ firebaseId: doc.id, ...doc.data() })));
      else setProducts([]);
    });
    return () => { unsubBal(); unsubTrans(); unsubProd(); };
  }, [shift]);

  const shiftSales = shiftTrans;

  const { realPemasukan, realPengeluaran, realProfit, kasbonBaru, kasbonDilunasi, digitalTransfer } = shiftSales.reduce((acc, t) => {
    if (t.type === 'pelunasan_kasbon') {
      acc.kasbonDilunasi += (t.total || 0);
      acc.realPemasukan  += (t.total || 0);
      return acc;
    }
    t.items?.forEach(item => {
      const q = item.qty || 1;
      const total = item.total || (item.price * q);
      const fee   = (item.fee || 0) * q;
      const nominal = (item.nominal || 0) * q;
      if (item.action === 'tarik') {
        acc.realPengeluaran += nominal;
        if (item.feePaidVia === 'cash')     acc.realPemasukan += fee;
        else if (item.feePaidVia === 'transfer') { acc.realPemasukan += fee; acc.digitalTransfer += fee; }
      } else if (item.action === 'restock' || t.type === 'expenditure') {
        acc.realPengeluaran += total;
      } else {
        if (t.paymentMethod === 'kasbon')      acc.kasbonBaru += total;
        else if (t.paymentMethod === 'transfer') { acc.realPemasukan += total; acc.digitalTransfer += total; }
        else acc.realPemasukan += total;
      }
    });
    const transProfit = (t.type === 'expenditure') ? 0 : (t.items?.length > 0
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
  }, { realPemasukan: 0, realPengeluaran: 0, realProfit: 0, kasbonBaru: 0, kasbonDilunasi: 0, digitalTransfer: 0 });

  const physicalProducts = useMemo(() =>
    products.filter(p => p.type === 'stok').sort((a, b) => {
      const catA = (a.category || '').toLowerCase();
      const catB = (b.category || '').toLowerCase();
      if (catA !== catB) return catA.localeCompare(catB);
      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    }), [products]);

  let physicalPemasukan = 0;
  let physicalProfit = 0;
  const physicalSalesLog = [];
  physicalProducts.forEach(p => {
    const endStock = finalStocks[p.firebaseId] !== undefined ? Number(finalStocks[p.firebaseId]) : p.stock;
    const sold = Math.max(0, p.stock - endStock);
    if (sold > 0) {
      const revenue = sold * (p.price || 0);
      const profit  = (p.price - (p.costPrice || 0)) * sold;
      physicalPemasukan += revenue;
      physicalProfit    += profit;
      physicalSalesLog.push({ name: p.name, sold, revenue, profit });
    }
  });

  const finalPemasukan = realPemasukan + physicalPemasukan + kasbonBaru;
  const finalProfit    = realProfit + physicalProfit;

  const totalPhysicalTransfer = physicalProducts.reduce((sum, p) => sum + (parseFloat(transferAmounts[p.firebaseId]) || 0), 0);
  const modalAwalShift = balances.modalShift || 1000000;
  const expectedCash   = modalAwalShift + finalPemasukan - realPengeluaran - totalPhysicalTransfer - digitalTransfer - kasbonBaru;

  const rawSetoran  = (parseFloat(actualCash) || 0) - modalAwalShift;
  const setoran     = Math.max(0, rawSetoran);
  const selisih     = (parseFloat(actualCash) || 0) - expectedCash;
  const isBelowModal = rawSetoran < 0;
  const keterangan  = isBelowModal ? "Tidak ada yang bisa di setor karena cash yang ada di pakai lagi untuk modal walaupun di bawah modal awal." : "";

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
      const closingRef = doc(collection(db, 'shift_closings'));
      const closingData = {
        shift, user: user.name, modalAwal: modalAwalShift,
        pemasukan: realPemasukan, pengeluaran: realPengeluaran,
        expectedCash, actualCash: parseFloat(actualCash), selisih, setoran,
        totalProfit: finalProfit, kasbonBaru, kasbonDilunasi, note: keterangan,
        timestamp: serverTimestamp(), physicalSales: physicalSalesLog
      };
      batch.set(closingRef, closingData);

      Object.entries(finalStocks).forEach(([prodId, count]) => {
        batch.update(doc(db, 'products', prodId), { stock: Number(count) });
      });

      shiftSales.forEach(t => {
        batch.update(doc(db, 'transactions', t.id), { closed: true, closingId: closingRef.id });
      });

      physicalProducts.forEach(p => {
        const endStock = finalStocks[p.firebaseId] !== undefined ? Number(finalStocks[p.firebaseId]) : p.stock;
        const sold = Math.max(0, p.stock - endStock);
        if (sold > 0) {
          const revenue = sold * (p.price || 0);
          const profit  = (p.price - (p.costPrice || 0)) * sold;
          const transferAmt = parseFloat(transferAmounts[p.firebaseId]) || 0;
          batch.set(doc(collection(db, 'transactions')), {
            type: 'stok', status: 'success', user: user.name, shift,
            timestamp: serverTimestamp(), closed: true, closingId: closingRef.id,
            total: revenue, profit,
            paymentMethod: transferAmt >= revenue ? 'transfer' : (transferAmt > 0 ? 'mixed' : 'cash'),
            items: [{ name: p.name, qty: sold, price: p.price, costPrice: p.costPrice || 0, total: revenue, action: 'sale', type: 'stok', firebaseId: p.firebaseId }]
          });
        }
      });

      const balanceRef   = doc(db, 'balances', 'current');
      const newCashBalance    = parseFloat(actualCash) - setoran;
      const newSeabankBalance = (balances.seabank || 0) + totalPhysicalTransfer;
      batch.update(balanceRef, { cash: newCashBalance, seabank: newSeabankBalance });

      await batch.commit();

      // WhatsApp text
      const digitalSummary = shiftSales.reduce((acc, t) => {
        if (t.type === 'expenditure') { acc.expenses += (t.total || 0); return acc; }
        const key = t.items?.[0]?.action === 'tarik' ? 'Tarik Tunai' : 'TopUp/Jasa';
        if (!acc.groups[key]) acc.groups[key] = { count: 0, volume: 0, profit: 0 };
        acc.groups[key].count  += 1;
        acc.groups[key].volume += (t.total || 0);
        acc.groups[key].profit += (t.profit || 0);
        return acc;
      }, { groups: {}, expenses: 0 });

      const digitalText  = Object.entries(digitalSummary.groups).map(([name, data]) => `- ${name}: ${data.count} tx (Laba: Rp ${data.profit.toLocaleString()})`).join('\n');
      const physicalText = physicalSalesLog.length > 0 ? physicalSalesLog.map(s => `- ${s.name}: ${s.sold}x (Laba: Rp ${s.profit.toLocaleString()})`).join('\n') : '- (Tidak ada penjualan fisik)';
      const restockNeeded = physicalProducts.filter(p => (finalStocks[p.firebaseId] !== undefined ? Number(finalStocks[p.firebaseId]) : p.stock) < 3);
      const restockText  = restockNeeded.length > 0 ? restockNeeded.map(p => { const sisa = (finalStocks[p.firebaseId] !== undefined ? Number(finalStocks[p.firebaseId]) : p.stock); return `- ${p.name} (Sisa: ${sisa}). Modal: Rp ${(p.costPrice || 0).toLocaleString()}/unit`; }).join('\n') : '- (Stok masih aman semua)';

      const waText = `*LAPORAN CLOSING SESI*\n--------------------------\nPetugas: ${user.name}\nShift: ${shift}\nTanggal: ${new Date().toLocaleDateString('id-ID')}\n\n*PENJUALAN FISIK (STOK):*\n${physicalText}\nSubtotal Laba Fisik: Rp ${physicalProfit.toLocaleString()}\n\n*RINGKASAN DIGITAL:*\n${digitalText}\nSubtotal Laba Digital: Rp ${realProfit.toLocaleString()}\n\n*PENGELUARAN (CASH OUT):*\n- Total: Rp ${realPengeluaran.toLocaleString()}\n\n*TARGET BELANJA (STOK TIPIS):*\n${restockText}\n\n*REKAPITULASI AKHIR:*\nModal Awal: Rp ${modalAwalShift.toLocaleString()}\n${kasbonBaru > 0 ? `Piutang (Kasbon Baru): Rp ${kasbonBaru.toLocaleString()}\n` : ''}${kasbonDilunasi > 0 ? `Pelunasan Kasbon (Masuk Laci): Rp ${kasbonDilunasi.toLocaleString()}\n` : ''}Sistem Final (Expected): Rp ${expectedCash.toLocaleString()}\nFisik Laci: Rp ${parseFloat(actualCash).toLocaleString()}\nSelisih: ${selisih > 0 ? '+' : ''}Rp ${selisih.toLocaleString()}\n--------------------------\n*ESTIMASI TOTAL LABA: Rp ${finalProfit.toLocaleString()}*\n*SETORAN KE OWNER: Rp ${setoran.toLocaleString()}*${isBelowModal ? `\n\n_Keterangan: ${keterangan}_` : ''}\n\nTerima kasih.`;

      // PDF
      try {
        const docPdf  = new jsPDF();
        const reportDate = new Date().toLocaleDateString('id-ID');
        docPdf.setFontSize(18); docPdf.setFont("helvetica", "bold");
        docPdf.text('Laporan Closing Kios Finance', 14, 20);
        docPdf.setFontSize(11); docPdf.setFont("helvetica", "normal");
        docPdf.text(`Petugas : ${user.name}`, 14, 30);
        docPdf.text(`Shift   : ${shift}`, 14, 36);
        docPdf.text(`Tanggal : ${reportDate}`, 14, 42);
        docPdf.setFontSize(14); docPdf.setFont("helvetica", "bold");
        docPdf.text('Ringkasan Digital', 14, 55);
        const digitalTableBody = Object.entries(digitalSummary.groups).map(([name, data]) => [name, `${data.count} tx`, `Rp ${data.profit.toLocaleString()}`]);
        autoTable(docPdf, { startY: 60, head: [['Kategori', 'Transaksi', 'Laba (Rp)']], body: digitalTableBody.length > 0 ? digitalTableBody : [['(Tidak ada data)', '-', '-']], theme: 'grid', headStyles: { fillColor: [99, 102, 241] }, bodyStyles: { fontSize: 10 }, margin: { left: 14 } });
        let nextY = docPdf.lastAutoTable.finalY + 15;
        docPdf.setFontSize(14); docPdf.text('Penjualan Fisik (Stok)', 14, nextY);
        const physTableBody = physicalSalesLog.map(log => [log.name, `${log.sold} pcs`, `Rp ${log.revenue.toLocaleString()}`, `Rp ${log.profit.toLocaleString()}`]);
        autoTable(docPdf, { startY: nextY + 5, head: [['Produk', 'Terjual', 'Omset (Rp)', 'Laba (Rp)']], body: physTableBody.length > 0 ? physTableBody : [['(Tidak ada penjualan fisik)', '-', '-', '-']], theme: 'grid', headStyles: { fillColor: [245, 158, 11] }, bodyStyles: { fontSize: 10 }, margin: { left: 14 } });
        nextY = docPdf.lastAutoTable.finalY + 15;
        if (nextY > 250) { docPdf.addPage(); nextY = 20; }
        docPdf.setFontSize(14); docPdf.text('Rekapitulasi Akhir', 14, nextY);
        docPdf.setFontSize(11); docPdf.setFont("helvetica", "normal");
        docPdf.text(`Modal Awal     : Rp ${modalAwalShift.toLocaleString()}`, 14, nextY + 8);
        docPdf.text(`Pengeluaran    : Rp ${realPengeluaran.toLocaleString()}`, 14, nextY + 14);
        let yt = nextY + 20;
        if (kasbonBaru > 0) { docPdf.text(`Piutang (Kasbon Baru): Rp ${kasbonBaru.toLocaleString()}`, 14, yt); yt += 6; }
        if (kasbonDilunasi > 0) { docPdf.text(`Pelunasan Masuk: Rp ${kasbonDilunasi.toLocaleString()}`, 14, yt); yt += 6; }
        docPdf.text(`Sistem Final   : Rp ${expectedCash.toLocaleString()}`, 14, yt); yt += 6;
        docPdf.text(`Fisik Laci     : Rp ${parseFloat(actualCash).toLocaleString()}`, 14, yt); yt += 6;
        const selisihStr = selisih > 0 ? `+Rp ${selisih.toLocaleString()}` : `-Rp ${Math.abs(selisih).toLocaleString()}`;
        docPdf.setFont("helvetica", "bold");
        docPdf.setTextColor(selisih === 0 ? 16 : 244, selisih === 0 ? 185 : 63, selisih === 0 ? 129 : 94);
        docPdf.text(`Selisih        : ${selisihStr}`, 14, yt); yt += 10;
        docPdf.setTextColor(0, 0, 0);
        docPdf.text(`Estimasi Total Laba : Rp ${finalProfit.toLocaleString()}`, 14, yt); yt += 6;
        docPdf.text(`Setoran ke Owner    : Rp ${setoran.toLocaleString()}`, 14, yt);
        docPdf.save(`Closing_${shift}_${new Date().getTime()}.pdf`);
      } catch (e) { console.error("Failed to generate PDF:", e); }

      const confirmWA = window.confirm(`Closing ${shift} Berhasil! Laporan PDF otomatis diunduh.\n\n${isBelowModal ? keterangan : `Silakan serahkan setoran Rp ${setoran.toLocaleString()} ke Owner.`} \n\nKirim laporan rincian ke WhatsApp Owner?`);
      if (confirmWA) {
        const waLink = ownerWA ? `https://wa.me/${ownerWA}?text=${encodeURIComponent(waText)}` : `https://wa.me/?text=${encodeURIComponent(waText)}`;
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

  // ======================== JSX ========================
  return (
    <div className="min-h-full bg-slate-900 pb-4">
      {/* Step Indicator */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800/80 px-4 py-3">
        <div className="flex items-center justify-center gap-0 max-w-sm mx-auto">
          {STEPS.map((s, idx) => {
            const isActive   = step === s.id;
            const isDone     = step > s.id;
            return (
              <div key={s.id} className="flex items-center">
                <button
                  onClick={() => isDone && setStep(s.id)}
                  className={`flex flex-col items-center gap-1 transition-all ${isDone ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                    isActive ? 'bg-indigo-600 shadow-lg shadow-indigo-500/30' :
                    isDone   ? 'bg-emerald-500/20 border border-emerald-500/40' :
                               'bg-slate-800 border border-slate-700/50'
                  }`}>
                    {isDone ? <Check size={16} className="text-emerald-400" /> :
                      <s.icon size={16} className={isActive ? 'text-white' : 'text-slate-500'} />}
                  </div>
                  <span className={`text-[9px] font-black uppercase tracking-widest ${isActive ? 'text-indigo-400' : isDone ? 'text-emerald-400' : 'text-slate-600'}`}>
                    {s.label}
                  </span>
                </button>
                {idx < STEPS.length - 1 && (
                  <div className={`w-10 h-px mx-2 mb-4 transition-colors ${isDone ? 'bg-emerald-500/40' : 'bg-slate-700'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        <AnimatePresence mode="wait">

          {/* ════════════ STEP 1: Rekap Shift ════════════ */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {/* Hero summary card */}
              <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-3xl p-5 text-white relative overflow-hidden shadow-xl shadow-indigo-500/20">
                <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
                <div className="absolute -left-4 -bottom-8 w-24 h-24 bg-violet-500/20 rounded-full blur-xl" />
                <p className="text-xs font-black opacity-70 uppercase tracking-widest mb-0.5 text-center">Tutup Sesi</p>
                <h2 className="text-lg font-black text-center mb-5 uppercase tracking-widest">{shift}</h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Modal Awal', value: modalAwalShift, color: 'text-white' },
                    { label: 'Total Masuk', value: finalPemasukan, color: 'text-emerald-300' },
                    { label: 'Total Keluar', value: realPengeluaran, color: 'text-red-300' },
                    { label: 'Est. Laba', value: finalProfit, color: 'text-yellow-300', italic: true },
                  ].map(item => (
                    <div key={item.label} className="bg-white/10 rounded-2xl p-3 text-center border border-white/10">
                      <p className="text-[9px] opacity-60 uppercase tracking-widest mb-1">{item.label}</p>
                      <p className={`font-black text-sm ${item.color} ${item.italic ? 'italic' : ''}`}>
                        Rp {item.value.toLocaleString()}
                      </p>
                    </div>
                  ))}
                  <div className="bg-white/20 rounded-2xl p-3 col-span-2 text-center border border-white/20">
                    <p className="text-[9px] opacity-70 uppercase tracking-widest mb-1 font-black">Expected Cash (Sistem)</p>
                    <p className="font-black text-2xl text-yellow-300 italic">Rp {expectedCash.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              {/* Digital Transactions summary */}
              <div className="bg-slate-800 border border-slate-700/50 rounded-3xl p-5">
                <h3 className="font-black text-white text-sm mb-4 flex items-center gap-2">
                  <History size={16} className="text-indigo-400" /> Transaksi Digital
                  <span className="ml-auto text-[10px] font-bold text-slate-500 bg-slate-700 px-2 py-0.5 rounded-full">{shiftSales.length} tx</span>
                </h3>
                {shiftSales.length === 0 ? (
                  <p className="text-center text-slate-600 text-xs py-4 italic">Belum ada transaksi di shift ini</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {shiftSales.slice(0, 20).map(t => (
                      <div key={t.id} className="flex justify-between items-center py-2 border-b border-slate-700/40">
                        <div>
                          <p className="text-[11px] text-slate-300 font-bold truncate max-w-[180px]">{t.items?.map(it => it.name).join(', ')}</p>
                          <p className="text-[9px] text-slate-600">{t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '--'}</p>
                        </div>
                        <p className={`text-xs font-black ${t.type === 'expenditure' ? 'text-red-400' : 'text-white'}`}>
                          {t.type === 'expenditure' ? '-' : ''}Rp {(t.total || 0).toLocaleString()}
                        </p>
                      </div>
                    ))}
                    {shiftSales.length > 20 && <p className="text-center text-slate-600 text-[10px] italic">+{shiftSales.length - 20} transaksi lainnya...</p>}
                  </div>
                )}
              </div>

              {/* Kasbon info */}
              {(kasbonBaru > 0 || kasbonDilunasi > 0) && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 space-y-2">
                  {kasbonBaru > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-amber-400 font-bold text-xs">📝 Kasbon Baru</span>
                      <span className="text-amber-400 font-black">Rp {kasbonBaru.toLocaleString()}</span>
                    </div>
                  )}
                  {kasbonDilunasi > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-emerald-400 font-bold text-xs">✓ Kasbon Dilunasi</span>
                      <span className="text-emerald-400 font-black">Rp {kasbonDilunasi.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}

              <button onClick={() => setStep(2)}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-500/25 transition-all active:scale-[0.98]">
                Lanjut: Input Stok Akhir <ChevronRight size={18} />
              </button>
            </motion.div>
          )}

          {/* ════════════ STEP 2: Input Stok Akhir ════════════ */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <div className="bg-slate-800 border border-slate-700/50 rounded-3xl p-5">
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 bg-amber-500/15 rounded-xl flex items-center justify-center">
                    <Package size={18} className="text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-black text-white text-sm">Input Sisa Stok Akhir</h3>
                    <p className="text-[10px] text-slate-500 font-bold">Hitung barang di rak satu per satu</p>
                  </div>
                </div>
              </div>

              {physicalProducts.length === 0 ? (
                <div className="text-center py-12 text-slate-600">
                  <Package size={36} className="mx-auto mb-3 text-slate-700" />
                  <p className="text-sm font-bold">Tidak ada produk stok</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {physicalProducts.map(p => {
                    const endStock = finalStocks[p.firebaseId] !== undefined ? Number(finalStocks[p.firebaseId]) : p.stock;
                    const sold     = Math.max(0, p.stock - endStock);
                    return (
                      <div key={p.firebaseId} className="bg-slate-800 border border-slate-700/50 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-black text-white">{p.name}</p>
                              {sold > 0 && <span className="text-[9px] font-black bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-lg border border-emerald-500/20">Terjual: {sold}</span>}
                            </div>
                            <p className="text-[10px] text-slate-600 font-bold mt-0.5">Stok Sistem: {p.stock}</p>
                          </div>
                          <div className="flex items-center gap-2 ml-3 shrink-0">
                            <button onClick={() => setFinalStocks({...finalStocks, [p.firebaseId]: Math.max(0, (Number(finalStocks[p.firebaseId] ?? p.stock)) - 1)})} className="w-8 h-8 rounded-xl bg-slate-700 text-slate-300 flex items-center justify-center hover:bg-slate-600 active:scale-90 transition-all">
                              <Minus size={14} />
                            </button>
                            <input
                              type="number"
                              placeholder={p.stock.toString()}
                              className="w-14 px-1 py-2 bg-slate-900 border border-slate-700 rounded-xl text-center font-black text-sm text-indigo-400 focus:outline-none focus:border-indigo-500"
                              value={finalStocks[p.firebaseId] ?? ''}
                              onChange={e => setFinalStocks({...finalStocks, [p.firebaseId]: e.target.value})}
                            />
                            <button onClick={() => setFinalStocks({...finalStocks, [p.firebaseId]: (Number(finalStocks[p.firebaseId] ?? p.stock)) + 1})} className="w-8 h-8 rounded-xl bg-slate-700 text-slate-300 flex items-center justify-center hover:bg-slate-600 active:scale-90 transition-all">
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>
                        {sold > 0 && (
                          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-3 py-2 flex items-center gap-2">
                            <div className="flex-1">
                              <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Bayar via Transfer (Rp)</p>
                              <p className="text-[9px] text-slate-500 font-bold">Max: Rp {(sold * (p.price||0)).toLocaleString()}</p>
                            </div>
                            <input
                              type="number" placeholder="0" min="0" max={sold * (p.price || 0)}
                              className="w-24 px-2 py-1.5 bg-slate-900 border border-indigo-500/30 rounded-xl text-center font-black text-sm text-indigo-400 focus:outline-none focus:border-indigo-500"
                              value={transferAmounts[p.firebaseId] ?? ''}
                              onChange={e => setTransferAmounts({...transferAmounts, [p.firebaseId]: e.target.value})}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {physicalSalesLog.length > 0 && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4">
                  <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-2">Penjualan Fisik Terdeteksi</p>
                  {physicalSalesLog.map(s => (
                    <div key={s.name} className="flex justify-between text-xs font-bold py-1 border-b border-emerald-500/10">
                      <span className="text-slate-300">{s.name} ×{s.sold}</span>
                      <span className="text-emerald-400">+Rp {s.revenue.toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-black mt-2 pt-2 border-t border-emerald-500/20">
                    <span className="text-slate-300">Total</span>
                    <span className="text-emerald-400">Rp {physicalPemasukan.toLocaleString()}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setStep(1)} className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 font-bold py-3.5 rounded-2xl transition-all">
                  <ChevronLeft size={16} /> Kembali
                </button>
                <button onClick={() => setStep(3)} className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-2xl shadow-lg shadow-indigo-500/25 transition-all">
                  Lanjut <ChevronRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {/* ════════════ STEP 3: Hitung Kas & Submit ════════════ */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              {/* Summary quick view */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Expected', value: expectedCash, color: 'text-indigo-400' },
                  { label: 'Pemasukan', value: finalPemasukan, color: 'text-emerald-400' },
                  { label: 'Pengeluaran', value: realPengeluaran, color: 'text-red-400' },
                ].map(s => (
                  <div key={s.label} className="bg-slate-800 border border-slate-700/50 rounded-2xl p-3 text-center">
                    <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-1">{s.label}</p>
                    <p className={`text-xs font-black ${s.color}`}>Rp {s.value.toLocaleString()}</p>
                  </div>
                ))}
              </div>

              <form onSubmit={handleClosing} className="space-y-4">
                <div className="bg-slate-800 border border-slate-700/50 rounded-3xl p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 bg-blue-500/15 rounded-xl flex items-center justify-center">
                      <Calculator size={18} className="text-blue-400" />
                    </div>
                    <div>
                      <h3 className="font-black text-white text-sm">Hitung Fisik Laci</h3>
                      <p className="text-[10px] text-slate-500 font-bold">Masukkan total uang yang ada di laci</p>
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Uang Fisik Aktual (Rp)</label>
                    <input
                      type="number" required
                      value={actualCash}
                      onChange={e => setActualCash(e.target.value)}
                      className="w-full px-4 py-4 bg-slate-900 border-2 border-slate-700 focus:border-indigo-500 rounded-2xl text-3xl font-black text-white text-center transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* Result breakdown */}
                {actualCash !== '' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-slate-800 border border-slate-700/50 rounded-3xl p-5 space-y-3">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Rekapitulasi Akhir</h4>

                    {totalPhysicalTransfer > 0 && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-indigo-400 font-bold flex items-center gap-1.5"><span>💳</span> Transfer Fisik (ke Bank)</span>
                        <span className="font-black text-indigo-400">Rp {totalPhysicalTransfer.toLocaleString()}</span>
                      </div>
                    )}

                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 text-sm font-bold">Setoran ke Owner</span>
                      <span className={`font-black text-xl ${isBelowModal ? 'text-slate-500' : 'text-emerald-400'}`}>
                        Rp {setoran.toLocaleString()}
                      </span>
                    </div>

                    {isBelowModal && (
                      <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl text-[11px] text-amber-400 font-bold leading-relaxed">
                        ⚠️ Uang fisik di bawah modal awal. Seluruh cash akan digunakan kembali untuk modal shift berikutnya.
                      </div>
                    )}

                    <div className="flex justify-between items-center pt-3 border-t border-slate-700/50">
                      <span className="text-slate-400 text-sm font-bold">Selisih Fisik vs Sistem</span>
                      <span className={`font-black text-lg ${selisih === 0 ? 'text-emerald-400' : selisih > 0 ? 'text-blue-400' : 'text-red-400'}`}>
                        {selisih > 0 ? '+' : ''}{selisih.toLocaleString()}
                      </span>
                    </div>
                    {selisih !== 0 && (
                      <p className="text-xs text-red-400 font-bold bg-red-500/10 border border-red-500/20 p-2.5 rounded-xl">
                        ⚠ Selisih wajib dipertanggungjawabkan ke Owner.
                      </p>
                    )}
                    {selisih === 0 && (
                      <p className="text-xs text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl text-center">
                        ✓ Kas cocok!
                      </p>
                    )}
                  </motion.div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setStep(2)} className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 font-bold py-4 rounded-2xl transition-all">
                    <ChevronLeft size={16} /> Kembali
                  </button>
                  <button
                    type="submit"
                    disabled={loading || actualCash === ''}
                    className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-500/25 transition-all active:scale-[0.98] disabled:opacity-40"
                  >
                    {loading ? <><Loader2 size={18} className="animate-spin" /> Memproses...</> : <><FileCheck2 size={18} /> Closing</>}
                  </button>
                </div>
              </form>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
