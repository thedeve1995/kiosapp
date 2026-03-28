import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';
import { LogOut, Calculator, FileCheck2, Loader2, History, AlertOctagon } from 'lucide-react';
import { db } from '../lib/firebase';
import { collection, onSnapshot, doc, query, where, addDoc, serverTimestamp, writeBatch, getDocs, limit } from 'firebase/firestore';

export default function Closing() {
  const { shift, user, setUser } = useStore();
  const navigate = useNavigate();
  
  const [balances, setBalances] = useState({ cash: 0 });
  const [shiftTrans, setShiftTrans] = useState([]);
  const [actualCash, setActualCash] = useState('');
  const [loading, setLoading] = useState(false);
  const [ownerWA, setOwnerWA] = useState('');

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
    
    // Ambil semua transaksi yang BELUM di-close (label 'closed' tidak ada atau false)
    const q = query(collection(db, 'transactions'), where('status', '!=', 'cancelled'));
    
    const unsubTrans = onSnapshot(q, (snap) => {
      const allData = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      // Filter hanya yang belum di-close
      setShiftTrans(allData.filter(t => !t.closed && t.type !== 'adjustment'));
    });

    return () => { unsubBal(); unsubTrans(); };
  }, [shift]);

  // Semua transaksi yang belum di-close akan masuk ke laporan ini
  const shiftSales = shiftTrans;
  
  // Filter penyesuaian saldo manual oleh Owner (untuk modal awal tetap gunakan data hari ini)
  // Atau bisa juga tidak pakai adjustment lagi jika modal sudah baku
  const relevantAdjustments = []; 

  const { realPemasukan, realPengeluaran, realProfit } = shiftSales.reduce((acc, t) => {
    t.items?.forEach(item => {
      const q = item.qty || 1;
      const total = item.total || (item.price * q);
      const fee = (item.fee || 0) * q;
      const nominal = (item.nominal || 0) * q;
      
      // LOGIKA KAS FISIK:
      // Untuk Tarik Tunai: Uang keluar laci adalah NOMINAL.
      // Jika Fee dibayar Cash, maka Uang masuk laci adalah Fee.
      if (item.action === 'tarik') {
        acc.realPengeluaran += nominal;
        if (item.feePaidVia === 'cash') {
          acc.realPemasukan += fee;
        }
      } else if (item.action === 'restock' || t.type === 'expenditure') {
        acc.realPengeluaran += total;
      } else {
        // Penjualan barang stok atau Top Up (Pelanggan kasih cash senilai total)
        acc.realPemasukan += total;
      }
    });

    // Profit logic (use the precalculated profit if available, else calculate)
    if (t.type === 'expenditure') {
       acc.realProfit += (t.profit || 0);
    } else {
       t.items?.forEach(item => {
          const q = item.qty || 1;
          const cost = item.costPrice !== undefined ? item.costPrice : item.price;
          if (item.action === 'tarik') {
             acc.realProfit += (item.price - item.nominal) * q;
          } else {
             acc.realProfit += (item.price - cost) * q;
          }
       });
    }

    return acc;
  }, { realPemasukan: 0, realPengeluaran: 0, realProfit: 0 });

  const totalAdjustment = relevantAdjustments.reduce((acc, adj) => {
    return acc + (adj.current?.cash || 0) - (adj.previous?.cash || 0);
  }, 0);

  // Pakai Modal Shift yang sudah diset baku oleh Owner
  const modalAwalShift = balances.modalShift || 1000000;
  const expectedCash = modalAwalShift + realPemasukan - realPengeluaran;
  
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
        totalProfit: realProfit,
        note: keterangan,
        timestamp: serverTimestamp()
      };

      batch.set(closingRef, closingData);

      // 1b. Tandai transaksi sebagai "closed" agar tidak masuk ke shift berikutnya
      shiftSales.forEach(t => {
        const tRef = doc(db, 'transactions', t.id);
        batch.update(tRef, { closed: true, closingId: closingRef.id });
      });

      // 2. POTONG KAS GLOBAL (RESET BALANCES UNTUK SHIFT BERIKUTNYA)
      // Jika setoran > 0, kita sisakan modalAwalShift. Jika setoran 0 (below modal), kita sisakan actualCash.
      const balanceRef = doc(db, 'balances', 'current');
      const newCashBalance = parseFloat(actualCash) - setoran;
      batch.update(balanceRef, { cash: newCashBalance });

      await batch.commit();

      // Format WhatsApp Report
      const transText = shiftSales.map(t => {
        const time = t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleTimeString('id-id', { hour: '2-digit', minute: '2-digit'}) : '...';
        const items = t.items?.map(it => `${it.name} (x${it.qty})`).join(', ');
        const sign = (['tarik', 'restock'].includes(t.items?.[0]?.action) || t.type === 'expenditure') ? '-' : '+';
        return `[${time}] ${sign}Rp ${(t.total || 0).toLocaleString()}\n_${items}_`;
      }).join('\n');

      const waText = `*LAPORAN CLOSING SHIFT*\n` +
        `--------------------------\n` +
        `Petugas: ${user.name}\n` +
        `Shift: ${shift}\n` +
        `Tanggal: ${new Date().toLocaleDateString('id-ID')}\n\n` +
        `*RINCIAN TRANSAKSI:*\n` +
        `${transText}\n\n` +
        `*REKAPITULASI:*\n` +
        `Modal Baku: Rp ${modalAwalShift.toLocaleString()}\n` +
        `Penjualan: +Rp ${realPemasukan.toLocaleString()}\n` +
        `Pengeluaran: -Rp ${realPengeluaran.toLocaleString()}\n` +
        `Sistem: Rp ${expectedCash.toLocaleString()}\n` +
        `Fisik Laci: Rp ${parseFloat(actualCash).toLocaleString()}\n\n` +
        `Estimasi Laba Shift: *Rp ${realProfit.toLocaleString()}*\n` +
        `Selisih: ${selisih > 0 ? '+' : ''}Rp ${selisih.toLocaleString()}\n` +
        `--------------------------\n` +
        `*SETORAN KE OWNER: Rp ${setoran.toLocaleString()}*\n` +
        (isBelowModal ? `\n_Keterangan: ${keterangan}_` : "") +
        `\n\nTerima kasih.`;

      const confirmWA = window.confirm(`Closing Shift ${shift} Berhasil! \n\n${isBelowModal ? keterangan : `Silakan serahkan setoran Rp ${setoran.toLocaleString()} ke Owner.`} \n\nKirim laporan rincian ke WhatsApp Owner?`);
      
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
           <h2 className="text-sm font-bold opacity-80 uppercase tracking-widest mb-1 text-center">Tutup Shift</h2>
           <p className="text-2xl font-black text-center mb-6 uppercase tracking-widest">{shift}</p>
           
            <div className="grid grid-cols-2 gap-4">
               <div className="bg-white/10 p-2 rounded-xl text-center">
                 <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-tighter">Modal Shift</p>
                 <p className="font-bold text-base">Rp {modalAwalShift.toLocaleString()}</p>
               </div>
               <div className="bg-white/10 p-2 rounded-xl text-center">
                 <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-tighter">Masuk (Sales)</p>
                 <p className="font-bold text-base text-emerald-300">+ Rp {realPemasukan.toLocaleString()}</p>
               </div>
               <div className="bg-white/10 p-2 rounded-xl text-center">
                 <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-tighter">Keluar (Cashout)</p>
                 <p className="font-bold text-base text-red-300">- Rp {realPengeluaran.toLocaleString()}</p>
               </div>
               <div className="bg-white/10 p-2 rounded-xl text-center">
                 <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-tighter text-yellow-100 italic">Estimasi Laba</p>
                 <p className="font-bold text-base text-yellow-300 italic">Rp {realProfit.toLocaleString()}</p>
               </div>
               <div className="bg-white/20 p-2 rounded-xl border border-white/20 col-span-2 shadow-inner">
                 <p className="text-[10px] opacity-70 mb-0.5 uppercase tracking-tighter font-black text-center">Sistem (Final)</p>
                 <p className="font-black text-2xl text-yellow-300 italic text-center">Rp {expectedCash.toLocaleString()}</p>
               </div>
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
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Akumulasi Penjualan (Shift)</p>
                    <p className="text-xl font-black text-blue-600 tracking-tight italic">Rp {realPemasukan.toLocaleString()}</p>
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
