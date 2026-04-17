import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { db } from '../lib/firebase';
import { collection, onSnapshot, doc, setDoc, query, where, serverTimestamp, addDoc, updateDoc, increment, writeBatch, deleteDoc, getDocs, orderBy, limit } from 'firebase/firestore';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { 
  BarChart3, TrendingUp, AlertOctagon, History, UserPlus, Users, 
  Loader2, Package, Edit3, Trash2, Search, Plus, Save, X, Check,
  ChevronDown, ChevronUp, Wallet, CircleDollarSign, Calendar, ListChecks, FileCheck2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAXEDh3wb2qZ9qO5VrbV4VhStlqMUf7vmg",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "newproject-fbb7e.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://newproject-fbb7e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "newproject-fbb7e",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "newproject-fbb7e.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "726576406795",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:726576406795:web:a083e42e09e91a4505020e"
};

export default function AdminDashboard() {
  const { user, setUser } = useStore();
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loadingReg, setLoadingReg] = useState(false);
  const [regForm, setRegForm] = useState({ name: '', email: '', password: '' });
  const [msg, setMsg] = useState({ type: '', text: '' });
  
  const [products, setProducts] = useState([]);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [isEditing, setIsEditing] = useState(null);
  const [prodForm, setProdForm] = useState({ name: '', price: '', costPrice: '', stock: '', category: 'Voucher', type: 'stok', action: '' });
  const [searchTerm, setSearchTerm] = useState('');

  const [showKaryawan, setShowKaryawan] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [showBalances, setShowBalances] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showClosings, setShowClosings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const [reportRange, setReportRange] = useState('Today');
  const [balances, setBalances] = useState({ cash: 0, apk: 0, seabank: 0, modalShift: 1000000 });
  const [balForm, setBalForm] = useState({ cash: '', apk: '', seabank: '', modalShift: '' });
  const [loadingBal, setLoadingBal] = useState(false);
  const [closings, setClosings] = useState([]);
  const [selectedClosing, setSelectedClosing] = useState(null);

  // Fetch employees
  useEffect(() => {
    if (user?.role !== 'owner') return;
    const q = query(collection(db, 'users'), where('role', '==', 'employee'));
    const unsub = onSnapshot(q, (snap) => setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [user]);

  // Fetch closings
  useEffect(() => {
    if (user?.role !== 'owner') return;
    const q = query(collection(db, 'shift_closings'));
    const unsub = onSnapshot(q, (snap) => {
       const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
       setClosings(data.sort((a,b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    });
    return () => unsub();
  }, [user]);

  // Fetch transactions, products, balances
  useEffect(() => {
    if (user?.role !== 'owner') return;
    
    // Perbaikan batas limit harian Firebase Reads
    const qTrans = query(collection(db, 'transactions'), orderBy('timestamp', 'desc'), limit(500));
    const unsubTrans = onSnapshot(qTrans, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTransactions(data.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    });
    const unsubProd = onSnapshot(collection(db, 'products'), (snap) => {
      setProducts(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubBal = onSnapshot(doc(db, 'balances', 'current'), (d) => {
      if (d.exists()) {
        const b = d.data();
        setBalances(prev => ({ ...prev, ...b }));
        setBalForm({ cash: b.cash || 0, apk: b.apk || 0, seabank: b.seabank || 0, modalShift: b.modalShift || 1000000 });
      }
    });
    return () => { unsubTrans(); unsubProd(); unsubBal(); };
  }, [user]);

  if (user?.role !== 'owner') return <div className="p-8 text-center text-red-500 font-bold">Akses Ditolak (Owner Only)</div>;

  // === CALCULATIONS ===
  const defaultCategories = ['Voucher', 'E-Money', 'Rokok', 'Minuman', 'Snack', 'Lainnya'];
  const existingCategories = products.map(p => p.category).filter(Boolean);
  const allCategories = Array.from(new Set([...defaultCategories, ...existingCategories]));

  const totalPemasukan = transactions.filter(t => !['adjustment', 'expenditure'].includes(t.type) && t.status !== 'cancelled').reduce((s, t) => s + (t.total || 0), 0);
  const totalPengeluaran = transactions.filter(t => t.type === 'expenditure' && t.status !== 'cancelled').reduce((s, t) => s + (t.total || 0), 0);
  const totalLaba = transactions.filter(t => !['adjustment', 'expenditure'].includes(t.type) && t.status !== 'cancelled').reduce((s, t) => {
    if (t.items && t.items.length > 0) {
      const itemsProfit = t.items.reduce((sum, it) => {
        const q = Number(it.qty) || 1;
        if (it.action === 'tarik') return sum + ((Number(it.fee) || 0) * q);
        const cost = Number(it.costPrice) || 0;
        return sum + (cost > 0 ? (Number(it.price || 0) - cost) * q : 0);
      }, 0);
      return s + itemsProfit;
    }
    return s + (Number(t.profit) || 0);
  }, 0);
  const totalBatal = transactions.filter(t => t.status === 'cancelled').length;
  const pendingCancellations = transactions.filter(t => t.status === 'pending_cancellation' || t.status === 'cancellation_requested');
  
  const stats = [
    { title: 'Total Pemasukan', value: `Rp ${totalPemasukan.toLocaleString()}`, icon: TrendingUp, color: 'text-blue-500', bg: 'bg-blue-50' },
    { title: 'Total Pengeluaran', value: `Rp ${totalPengeluaran.toLocaleString()}`, icon: X, color: 'text-red-600', bg: 'bg-red-50' },
    { title: 'Total Laba', value: `Rp ${totalLaba.toLocaleString()}`, icon: CircleDollarSign, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    { title: 'Void / Batal', value: totalBatal.toString(), icon: AlertOctagon, color: 'text-red-500', bg: 'bg-red-50' }
  ];

  // Report filter by time range
  const filteredReportTrans = (() => {
    const now = new Date();
    const startOfDay = new Date(new Date().setHours(0,0,0,0));
    const startOfWeek = new Date(new Date().setDate(now.getDate() - 7));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return transactions.filter(t => {
      if (t.status === 'cancelled' || t.type === 'adjustment') return false;
      const tDate = t.timestamp ? new Date(t.timestamp.seconds * 1000) : new Date();
      if (reportRange === 'Today') return tDate >= startOfDay;
      if (reportRange === 'Week') return tDate >= startOfWeek;
      if (reportRange === 'Month') return tDate >= startOfMonth;
      return true;
    });
  })();

  const reportTotal = filteredReportTrans.reduce((s, t) => s + (t.total || 0), 0);
  const reportProfit = filteredReportTrans.reduce((s, t) => {
    if (t.items && t.items.length > 0) {
      const itemsProfit = t.items.reduce((sum, it) => {
        const q = Number(it.qty) || 1;
        if (it.action === 'tarik') return sum + ((Number(it.fee) || 0) * q);
        const cost = Number(it.costPrice) || 0;
        return sum + (cost > 0 ? (Number(it.price || 0) - cost) * q : 0);
      }, 0);
      return s + itemsProfit;
    }
    return s + (Number(t.profit) || 0);
  }, 0);
  const reportAvg = filteredReportTrans.length ? Math.round(reportTotal / filteredReportTrans.length) : 0;
  const categorySummary = filteredReportTrans.filter(t => !['adjustment', 'expenditure'].includes(t.type)).reduce((acc, t) => {
    t.items?.forEach(it => {
      const cat = it.category || 'Lainnya';
      const q = Number(it.qty) || 1;
      let pft = 0;
      if (it.action === 'tarik') pft = (Number(it.fee) || 0) * q;
      else {
        const cost = Number(it.costPrice) || 0;
        pft = cost > 0 ? (Number(it.price || 0) - cost) * q : 0;
      }
      acc[cat] = (acc[cat] || 0) + pft;
    });
    return acc;
  }, {});

  // Filtered products
  const filteredProducts = products.filter(p => p.name?.toLowerCase().includes(searchTerm.toLowerCase()));

  // === HANDLERS ===
  const handleRegister = async (e) => {
    e.preventDefault();
    setLoadingReg(true);
    setMsg({ type: '', text: '' });
    try {
      const tempApp = !getApps().find(a => a.name === 'Temp') ? initializeApp(firebaseConfig, 'Temp') : getApp('Temp');
      const tempAuth = getAuth(tempApp);
      const res = await createUserWithEmailAndPassword(tempAuth, regForm.email, regForm.password);
      await setDoc(doc(db, 'users', res.user.uid), { uid: res.user.uid, name: regForm.name, email: regForm.email, role: 'employee', createdAt: serverTimestamp() });
      setMsg({ type: 'success', text: `Karyawan ${regForm.name} berhasil didaftarkan!` });
      setRegForm({ name: '', email: '', password: '' });
      await tempAuth.signOut();
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
    finally { setLoadingReg(false); }
  };

  const handleProductSubmit = async (e) => {
    e.preventDefault();
    setLoadingProduct(true);
    try {
      const data = {
        name: prodForm.name,
        price: Number(prodForm.price),
        costPrice: Number(prodForm.costPrice || 0),
        stock: prodForm.type === 'stok' ? Number(prodForm.stock) : 0,
        category: prodForm.category,
        type: prodForm.type,
        action: prodForm.action || ''
      };
      if (isEditing) {
        await setDoc(doc(db, 'products', isEditing), data, { merge: true });
        setIsEditing(null);
      } else { await addDoc(collection(db, 'products'), data); }
      setProdForm({ name: '', price: '', costPrice: '', stock: '', category: 'Voucher', type: 'stok', action: '' });
    } catch (err) { alert(err.message); }
    finally { setLoadingProduct(false); }
  };

  const startEdit = (p) => {
    setIsEditing(p.id);
    setProdForm({ name: p.name, price: p.price, costPrice: p.costPrice || '', stock: p.stock || '', category: p.category || 'Voucher', type: p.type || 'stok', action: p.action || '' });
  };

  const deleteProduct = async (id) => {
    if (!window.confirm('Hapus produk ini?')) return;
    await deleteDoc(doc(db, 'products', id));
  };

  const handleAutoPriceVouchers = async () => {
    if (!window.confirm('Auto-set harga jual voucher berdasarkan modal + 10%?')) return;
    const batch = writeBatch(db);
    products.forEach(p => {
      if (p.category === 'Voucher' && p.costPrice) {
        batch.update(doc(db, 'products', p.id), { price: Math.ceil(p.costPrice * 1.1) });
      }
    });
    await batch.commit();
    alert('Harga voucher diperbarui!');
  };

  const handleBalanceUpdate = async (e) => {
    e.preventDefault();
    setLoadingBal(true);
    try {
      const newBalances = { cash: Number(balForm.cash), apk: Number(balForm.apk), seabank: Number(balForm.seabank), modalShift: Number(balForm.modalShift) };
      await setDoc(doc(db, 'balances', 'current'), newBalances, { merge: true });
      await addDoc(collection(db, 'transactions'), { type: 'adjustment', user: user.name, role: user.role, previous: balances, current: newBalances, total: 0, timestamp: serverTimestamp(), shift: 'Manual Audit' });
      alert('Saldo berhasil diperbarui!');
    } catch (err) { alert(err.message); }
    finally { setLoadingBal(false); }
  };

  const handleApproveCancellation = async (log) => {
    if (!window.confirm("Setujui pembatalan ini? Saldo dan Stok akan dikembalikan otomatis.")) return;
    try {
      const batch = writeBatch(db);
      let newApk = balances.apk || 0; let newSeabank = balances.seabank || 0; let newCash = balances.cash || 0;
      log.items?.forEach(item => {
        const q = item.qty || 1;
        const totalFee = (item.fee || 0) * q;
        const totalNominal = (item.nominal || 0) * q;
        if (item.action === 'tarik') {
          const cashEffect = totalNominal - (item.feePaidVia === 'cash' ? totalFee : 0);
          newCash += cashEffect;
        } else {
          newCash -= (item.price * q);
        }
        if (item.type === 'jasa' || item.type === 'saldo') {
          if (item.action === 'transfer') {
            const bankToReverse = totalNominal + (item.feePaidVia === 'transfer' ? totalFee : 0);
            newSeabank += bankToReverse;
          } else if (item.action === 'tarik') {
            newSeabank -= totalNominal + (item.feePaidVia === 'transfer' ? totalFee : 0);
          } else {
            newApk += (item.costPrice * q);
          }
        }
        if (item.type === 'stok' && item.firebaseId) {
          batch.update(doc(db, 'products', item.firebaseId), { stock: increment(q) });
        }
      });
      batch.update(doc(db, 'balances', 'current'), { apk: newApk, seabank: newSeabank, cash: newCash });
      batch.update(doc(db, 'transactions', log.id), { status: 'cancelled', approvedBy: user.name, approvedAt: serverTimestamp() });
      await batch.commit();
      alert("Pembatalan Berhasil!");
    } catch (e) { alert("Gagal: " + e.message); }
  };

  const handleRejectCancellation = async (id) => {
    if (!window.confirm("Tolak pembatalan ini?")) return;
    try {
      await updateDoc(doc(db, 'transactions', id), { status: 'success', cancellationRejected: true, rejectedBy: user.name, rejectedAt: serverTimestamp() });
      alert("Ditolak.");
    } catch (e) { alert(e.message); }
  };

  const handleDeleteSelf = async () => {
    if (!window.confirm("HAPUS AKUN OWNER? Anda akan keluar dan sistem akan terkunci hingga owner baru mendaftar.")) return;
    if (!window.confirm("KONFIRMASI TERAKHIR: Anda yakin ingin menghapus akun ini?")) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid));
      setUser(null);
      navigate('/login');
    } catch (e) { alert(e.message); }
  };

  const handleResetData = async () => {
    if (!window.confirm("HAPUS SEMUA DATA TRANSAKSI, CLOSING, DAN KARYAWAN?")) return;
    if (!window.confirm("PERINGATAN TERAKHIR: Tindakan ini tidak dapat dibatalkan. Semua catatan keuangan dan data karyawan akan dihapus permanen. Lanjutkan?")) return;
    
    setLoadingBal(true);
    try {
      const clearCollection = async (colPath, queryConstraints = []) => {
        const q = queryConstraints.length > 0 ? query(collection(db, colPath), ...queryConstraints) : collection(db, colPath);
        const snap = await getDocs(q);
        let batch = writeBatch(db);
        let count = 0;
        
        for (const docSnap of snap.docs) {
          batch.delete(docSnap.ref);
          count++;
          if (count === 500) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
      };

      await clearCollection('transactions');
      await clearCollection('shift_closings');
      await clearCollection('users', [where('role', '==', 'employee')]);

      alert("Semua data (Transaksi, Closing, Karyawan) berhasil direset!");
    } catch (e) {
      alert("Gagal reset data: " + e.message);
    } finally {
      setLoadingBal(false);
    }
  };

  // === RENDER ===
  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 pb-20">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-2xl font-black text-slate-900 italic uppercase tracking-widest">Owner <span className="text-blue-600">Dashboard</span></h2>
          {user?.whatsapp && (
            <div className="bg-blue-50 px-3 py-1.5 rounded-2xl border border-blue-100 flex items-center gap-2">
              <span className="text-[10px] font-black uppercase text-blue-700">WA: {user.whatsapp}</span>
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((s, i) => (
            <div key={i} className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-3">
               <div className={`${s.bg} ${s.color} p-3 rounded-2xl`}><s.icon size={20} /></div>
               <div><p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{s.title}</p><p className="text-lg font-black">{s.value}</p></div>
            </div>
          ))}
        </div>

        {/* ===================== SECTION: PERMINTAAN PEMBATALAN ===================== */}
        {pendingCancellations.length > 0 && (
          <div className="bg-amber-50 rounded-3xl p-6 shadow-sm border border-amber-200">
             <div className="flex items-center gap-2 mb-4">
                <AlertOctagon size={24} className="text-amber-600"/>
                <h3 className="font-bold text-amber-800 text-lg">Permintaan Pembatalan ({pendingCancellations.length})</h3>
             </div>
             <div className="space-y-3">
                {pendingCancellations.map(t => (
                   <div key={t.id} className="bg-white p-4 rounded-2xl border border-amber-100 shadow-sm transition-all hover:border-amber-300">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                         <div>
                            <div className="flex items-center gap-2 flex-wrap">
                               <p className="font-black text-slate-800">{t.user}</p>
                               <span className="text-[10px] text-slate-400 font-normal">
                                 {t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleString('id-ID') : '-'}
                               </span>
                               <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">MENUNGGU RESPON</span>
                            </div>
                            <p className="text-xs text-slate-600 mt-1 italic">{t.items?.map(it=>it.name).join(', ') || t.type}</p>
                            <p className="text-sm font-black text-red-500 mt-1">Rp {t.total?.toLocaleString()}</p>
                            {t.profit !== undefined && t.profit > 0 && (
                               <p className="text-[10px] font-bold text-amber-500 italic -mt-0.5">Laba: Rp {t.profit?.toLocaleString()}</p>
                            )}
                         </div>
                         <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0 shrink-0">
                            <button onClick={() => handleApproveCancellation(t)} className="flex-1 sm:flex-none px-4 py-2 bg-emerald-50 text-emerald-600 font-bold rounded-xl text-xs hover:bg-emerald-100 flex items-center justify-center gap-2 transition-colors">
                               <Check size={16}/> Setujui
                            </button>
                            <button onClick={() => handleRejectCancellation(t.id)} className="flex-1 sm:flex-none px-4 py-2 bg-red-50 text-red-600 font-bold rounded-xl text-xs hover:bg-red-100 flex items-center justify-center gap-2 transition-colors">
                               <X size={16}/> Tolak
                            </button>
                         </div>
                      </div>
                   </div>
                ))}
             </div>
          </div>
        )}

        {/* ===================== SECTION: SDM ===================== */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowKaryawan(!showKaryawan)}>
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Users size={20} className="text-blue-600"/> Manajemen Karyawan ({employees.length})</h3>
              <button className="p-1 hover:bg-slate-50 rounded-lg">{showKaryawan ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
           </div>
           <AnimatePresence>
              {showKaryawan && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="space-y-6 mt-4 overflow-hidden">
                    {msg.text && (
                      <div className={`p-3 rounded-xl text-xs font-bold ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-600':'bg-red-50 text-red-600'}`}>{msg.text}</div>
                    )}
                    <form onSubmit={handleRegister} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                       <input type="text" required placeholder="Nama Lengkap" value={regForm.name} onChange={e=>setRegForm({...regForm, name:e.target.value})} className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                       <input type="email" required placeholder="Email" value={regForm.email} onChange={e=>setRegForm({...regForm, email:e.target.value})} className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                       <input type="password" required minLength={6} placeholder="Password (min 6)" value={regForm.password} onChange={e=>setRegForm({...regForm, password:e.target.value})} className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                       <button disabled={loadingReg} className="sm:col-span-3 bg-blue-600 text-white font-bold py-2.5 rounded-xl text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
                         {loadingReg ? <Loader2 className="animate-spin" size={16}/> : <UserPlus size={16}/>} Daftarkan Karyawan
                       </button>
                    </form>
                    <div className="divide-y border-t">
                       {employees.length === 0 && <p className="text-center text-slate-400 text-sm py-4 italic">Belum ada karyawan terdaftar</p>}
                       {employees.map((e, i) => (
                          <div key={i} className="py-3 flex justify-between items-center text-sm">
                            <div>
                              <span className="font-bold text-slate-800">{e.name}</span>
                              <span className="text-slate-400 text-xs ml-2">{e.email}</span>
                            </div>
                            <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2 py-1 rounded-full uppercase">Karyawan</span>
                          </div>
                       ))}
                    </div>
                 </motion.div>
              )}
           </AnimatePresence>
        </div>

        {/* ===================== SECTION: KATALOG PRODUK ===================== */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowInventory(!showInventory)}>
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Package size={20} className="text-blue-600"/> Katalog Produk ({products.length})</h3>
              <button className="p-1 hover:bg-slate-50 rounded-lg">{showInventory ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
           </div>
           <AnimatePresence>
              {showInventory && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="space-y-4 mt-4 overflow-hidden">
                    {/* Product Form */}
                    <form onSubmit={handleProductSubmit} className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl border border-dashed border-slate-200">
                       <input className="col-span-2 px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium" placeholder="Nama Produk" required value={prodForm.name} onChange={e=>setProdForm({...prodForm, name:e.target.value})} />
                       <select className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium bg-white" value={prodForm.category} onChange={e=>setProdForm({...prodForm, category:e.target.value})}>
                          {allCategories.map(c=><option key={c} value={c}>{c}</option>)}
                       </select>
                       <select className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium bg-white" value={prodForm.type} onChange={e=>setProdForm({...prodForm, type:e.target.value})}>
                          <option value="stok">Stok (Barang)</option>
                          <option value="jasa">Jasa (Layanan)</option>
                          <option value="saldo">Saldo (Isi Ulang)</option>
                       </select>
                       <input className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" type="number" placeholder="Modal / HPP" value={prodForm.costPrice} onChange={e=>setProdForm({...prodForm, costPrice:e.target.value})} />
                       <input className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" type="number" placeholder="Harga Jual" required value={prodForm.price} onChange={e=>setProdForm({...prodForm, price:e.target.value})} />
                       {prodForm.type === 'stok' && (
                         <input className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm" type="number" placeholder="Stok" value={prodForm.stock} onChange={e=>setProdForm({...prodForm, stock:e.target.value})} />
                       )}
                       {(prodForm.type === 'jasa' || prodForm.type === 'saldo') && (
                         <select className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium bg-white" value={prodForm.action} onChange={e=>setProdForm({...prodForm, action:e.target.value})}>
                           <option value="">-- Aksi --</option>
                           <option value="isi">Isi Saldo</option>
                           <option value="transfer">Transfer</option>
                           <option value="tarik">Tarik Tunai</option>
                         </select>
                       )}
                       <button disabled={loadingProduct} className="col-span-2 sm:col-span-4 bg-slate-900 text-white py-2.5 rounded-xl font-bold text-sm hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2">
                         {loadingProduct ? <Loader2 className="animate-spin" size={16}/> : (isEditing ? <Save size={16}/> : <Plus size={16}/>)}
                         {isEditing ? 'Update Produk' : 'Tambah Produk'}
                       </button>
                    </form>

                    {/* Auto Price & Search */}
                    <div className="flex flex-wrap gap-2 items-center">
                      <button onClick={handleAutoPriceVouchers} className="bg-amber-50 text-amber-600 border border-amber-200 px-3 py-1.5 rounded-xl text-[11px] font-bold hover:bg-amber-100">
                        ⚡ Auto Harga Voucher (+10%)
                      </button>
                      <div className="flex-1 relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                        <input className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-sm" placeholder="Cari produk..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/>
                      </div>
                    </div>

                    {/* Product Table */}
                    <div className="overflow-x-auto">
                       <table className="w-full text-xs font-bold text-slate-600">
                          <thead>
                            <tr className="border-b bg-slate-50">
                              <th className="py-3 px-2 text-left">NAMA</th>
                              <th className="py-3 px-2 text-center">KATEGORI</th>
                              <th className="py-3 px-2 text-center">TIPE</th>
                              <th className="py-3 px-2 text-center">MODAL</th>
                              <th className="py-3 px-2 text-center">JUAL</th>
                              <th className="py-3 px-2 text-center">LABA</th>
                              <th className="py-3 px-2 text-center">STOK</th>
                              <th className="py-3 px-2 text-right">AKSI</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredProducts.map(p => (
                              <tr key={p.id} className="border-b hover:bg-blue-50/30">
                                <td className="py-3 px-2 text-left font-black text-slate-800">{p.name}</td>
                                <td className="py-3 px-2 text-center"><span className="bg-slate-100 px-2 py-0.5 rounded-full text-[10px]">{p.category}</span></td>
                                <td className="py-3 px-2 text-center"><span className={`px-2 py-0.5 rounded-full text-[10px] ${p.type === 'stok' ? 'bg-blue-50 text-blue-600' : p.type === 'saldo' ? 'bg-green-50 text-green-600' : 'bg-purple-50 text-purple-600'}`}>{p.type}</span></td>
                                <td className="py-3 px-2 text-center italic text-slate-400">{p.costPrice?.toLocaleString() || '-'}</td>
                                <td className="py-3 px-2 text-center text-blue-600">{p.price?.toLocaleString()}</td>
                                <td className="py-3 px-2 text-center text-emerald-600 italic">{p.costPrice ? (p.price - p.costPrice).toLocaleString() : '-'}</td>
                                <td className="py-3 px-2 text-center">{p.type === 'stok' ? p.stock : '∞'}</td>
                                <td className="py-3 px-2 text-right space-x-1">
                                  <button onClick={()=>startEdit(p)} className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg"><Edit3 size={14}/></button>
                                  <button onClick={()=>deleteProduct(p.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14}/></button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                       </table>
                       {filteredProducts.length === 0 && <p className="text-center text-slate-400 text-sm py-6 italic">Tidak ada produk ditemukan</p>}
                    </div>
                 </motion.div>
              )}
           </AnimatePresence>
        </div>

        {/* ===================== SECTION: SALDO & MODAL ===================== */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowBalances(!showBalances)}>
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Wallet size={20} className="text-blue-600"/> Saldo & Modal</h3>
              <button className="p-1 hover:bg-slate-50 rounded-lg">{showBalances ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
           </div>
           <AnimatePresence>
              {showBalances && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="space-y-4 mt-4 overflow-hidden">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                       {Object.entries(balances).map(([k,v])=>(
                          <div key={k} className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                            <p className="text-[9px] uppercase font-black text-slate-400 tracking-wider">{k === 'modalShift' ? 'Modal Baku' : k}</p>
                            <p className="text-sm font-black italic">{typeof v === 'number' ? `Rp ${v.toLocaleString()}` : v}</p>
                          </div>
                       ))}
                    </div>
                    <form onSubmit={handleBalanceUpdate} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                       <div>
                         <label className="text-[10px] font-bold text-slate-500 uppercase">Cash</label>
                         <input className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" type="number" value={balForm.cash} onChange={e=>setBalForm({...balForm, cash:e.target.value})} />
                       </div>
                       <div>
                         <label className="text-[10px] font-bold text-slate-500 uppercase">APK</label>
                         <input className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" type="number" value={balForm.apk} onChange={e=>setBalForm({...balForm, apk:e.target.value})} />
                       </div>
                       <div>
                         <label className="text-[10px] font-bold text-slate-500 uppercase">Seabank</label>
                         <input className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" type="number" value={balForm.seabank} onChange={e=>setBalForm({...balForm, seabank:e.target.value})} />
                       </div>
                       <div>
                         <label className="text-[10px] font-bold text-slate-500 uppercase">Modal Shift</label>
                         <input className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" type="number" value={balForm.modalShift} onChange={e=>setBalForm({...balForm, modalShift:e.target.value})} />
                       </div>
                       <button disabled={loadingBal} className="col-span-2 sm:col-span-4 bg-indigo-600 text-white font-bold py-2.5 rounded-xl text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                         {loadingBal ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} Update Saldo & Modal
                       </button>
                    </form>
                 </motion.div>
              )}
           </AnimatePresence>
        </div>

        {/* ===================== SECTION: LAPORAN ANALITIK ===================== */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowReport(!showReport)}>
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><BarChart3 size={20} className="text-blue-600"/> Laporan Analitik</h3>
              <button className="p-1 hover:bg-slate-50 rounded-lg">{showReport ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
           </div>
           <AnimatePresence>
              {showReport && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="space-y-4 mt-4 overflow-hidden">
                    {/* Time Range Filter */}
                    <div className="flex gap-2">
                       {['Today','Week','Month'].map(r => (
                         <button key={r} onClick={()=>setReportRange(r)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${reportRange===r ? 'bg-blue-600 text-white shadow-md':'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                           {r === 'Today' ? 'Hari Ini' : r === 'Week' ? 'Seminggu' : 'Bulan Ini'}
                         </button>
                       ))}
                    </div>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                        <p className="text-[10px] font-black text-blue-400 uppercase">Total</p>
                        <p className="text-lg font-black text-blue-700">Rp {reportTotal.toLocaleString()}</p>
                      </div>
                      <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                        <p className="text-[10px] font-black text-emerald-400 uppercase">Laba</p>
                        <p className="text-lg font-black text-emerald-700">Rp {reportProfit.toLocaleString()}</p>
                      </div>
                      <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100">
                        <p className="text-[10px] font-black text-amber-400 uppercase">Rata-rata</p>
                        <p className="text-lg font-black text-amber-700">Rp {reportAvg.toLocaleString()}</p>
                      </div>
                    </div>
                    {/* Category Breakdown */}
                    <div className="bg-slate-50 rounded-2xl p-4 border border-dashed border-slate-200">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3">Laba Per Kategori</p>
                      {Object.entries(categorySummary).length === 0 && <p className="text-xs italic text-slate-400 text-center">Tidak ada data</p>}
                      <div className="space-y-2">
                        {Object.entries(categorySummary).sort((a,b)=>b[1]-a[1]).map(([cat, val]) => (
                          <div key={cat} className="flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-700">{cat}</span>
                            <div className="flex items-center gap-2">
                              <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 rounded-full" style={{width: `${Math.min(100, (val / reportTotal) * 100)}%`}}/>
                              </div>
                              <span className="text-xs font-black text-blue-600">Rp {val.toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium text-center italic">{filteredReportTrans.length} transaksi dalam periode ini</p>
                 </motion.div>
              )}
           </AnimatePresence>
        </div>

        {/* ===================== SECTION: RIWAYAT CLOSING ===================== */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowClosings(!showClosings)}>
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><ListChecks size={20} className="text-blue-600"/> Riwayat Closing Shift ({closings.length})</h3>
              <button className="p-1 hover:bg-slate-50 rounded-lg">{showClosings ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
           </div>
           <AnimatePresence>
              {showClosings && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="space-y-3 mt-4 overflow-hidden">
                    {closings.length === 0 && <p className="text-center text-slate-400 text-sm py-4 italic">Belum ada data closing</p>}
                    {closings.map(cl => (
                       <div key={cl.id} onClick={() => setSelectedClosing(cl)} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 cursor-pointer transition-all">
                          <div className="flex justify-between items-start">
                             <div>
                                <p className="text-xs font-black text-slate-800">{cl.user} • <span className="text-blue-600">{cl.shift}</span></p>
                                <p className="text-[10px] text-slate-400 italic">{cl.timestamp ? new Date(cl.timestamp.seconds * 1000).toLocaleString('id-ID') : '-'}</p>
                             </div>
                             <div className="text-right">
                                <p className="text-sm font-black text-blue-600">Setoran: Rp {cl.setoran?.toLocaleString()}</p>
                                {cl.totalProfit !== undefined && (
                                  <span className="bg-emerald-50 text-emerald-700 font-bold text-[10px] px-2 py-0.5 rounded-md italic">Laba: Rp {cl.totalProfit?.toLocaleString()}</span>
                                )}
                                {cl.selisih !== undefined && (
                                  <span className={`ml-1 text-[10px] font-black px-2 py-0.5 rounded-md ${cl.selisih >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                                    Selisih: Rp {cl.selisih?.toLocaleString()}
                                  </span>
                                )}
                             </div>
                          </div>
                       </div>
                    ))}
                 </motion.div>
              )}
           </AnimatePresence>
        </div>

        {/* ===================== SECTION: LOG TRANSAKSI ===================== */}
        <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowLogs(!showLogs)}>
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><History size={20} className="text-blue-600"/> Log Transaksi ({transactions.length})</h3>
              <button className="p-1 hover:bg-slate-50 rounded-lg">{showLogs ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
           </div>
           <AnimatePresence>
              {showLogs && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="divide-y mt-4 overflow-hidden">
                    {transactions.slice(0, 50).map(t => (
                       <div key={t.id} className={`py-3 ${t.status === 'cancelled' ? 'opacity-50 bg-red-50/30' : ''}`}>
                          <div className="flex justify-between items-start">
                             <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-black text-slate-800">{t.user}</span>
                                  <span className="text-[10px] text-slate-400">• {t.shift}</span>
                                  {t.type === 'adjustment' && <span className="bg-yellow-50 text-yellow-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full">AUDIT</span>}
                                  {t.type === 'expenditure' && <span className="bg-orange-50 text-orange-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full">PENGELUARAN</span>}
                                  {t.status === 'cancelled' && <span className="bg-red-100 text-red-600 text-[9px] font-bold px-1.5 py-0.5 rounded-full">BATAL</span>}
                                  {(t.status === 'pending_cancellation' || t.status === 'cancellation_requested') && <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">MINTA BATAL</span>}
                                  {t.closed && <span className="bg-slate-100 text-slate-500 text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><FileCheck2 size={10}/> Closed</span>}
                                </div>
                                <p className="text-[10px] text-slate-400 italic truncate mt-0.5">{t.items?.map(it=>it.name).join(', ') || (t.type === 'adjustment' ? 'Penyesuaian Manual' : '-')}</p>
                                {t.timestamp && <p className="text-[9px] text-slate-300 mt-0.5">{new Date(t.timestamp.seconds * 1000).toLocaleString('id-ID')}</p>}
                             </div>
                             <div className="text-right ml-2 shrink-0">
                                <p className={`text-sm font-black ${t.status === 'cancelled' ? 'text-red-400 line-through' : t.type === 'expenditure' ? 'text-orange-600' : 'text-emerald-600'}`}>
                                  Rp {t.total?.toLocaleString()}
                                </p>
                                {!['adjustment', 'cancelled'].includes(t.status) && t.profit !== undefined && t.profit > 0 && (
                                   <span className="text-[10px] font-bold text-amber-500 italic block -mt-0.5 leading-tight">Laba: Rp {t.profit?.toLocaleString()}</span>
                                )}
                                {(t.status === 'pending_cancellation' || t.status === 'cancellation_requested') && (
                                  <div className="flex gap-1 mt-1 justify-end">
                                    <button onClick={(e) => { e.stopPropagation(); handleApproveCancellation(t); }} className="p-1 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100" title="Setujui"><Check size={14}/></button>
                                    <button onClick={(e) => { e.stopPropagation(); handleRejectCancellation(t.id); }} className="p-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100" title="Tolak"><X size={14}/></button>
                                  </div>
                                )}
                             </div>
                          </div>
                       </div>
                    ))}
                    {transactions.length === 0 && <p className="text-center text-slate-400 text-sm py-6 italic">Tidak ada transaksi</p>}
                 </motion.div>
              )}
           </AnimatePresence>
        </div>

        {/* ===================== MODAL: DETAIL CLOSING ===================== */}
        <AnimatePresence>
           {selectedClosing && (
              <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setSelectedClosing(null)}>
                 <motion.div initial={{scale:0.9, opacity:0}} animate={{scale:1, opacity:1}} exit={{scale:0.9, opacity:0}} className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl" onClick={e=>e.stopPropagation()}>
                    <div className="p-5 bg-gradient-to-r from-blue-600 to-blue-700 text-white flex justify-between items-center">
                       <h3 className="font-black italic uppercase tracking-widest text-sm">Detail Closing Shift</h3>
                       <button onClick={()=>setSelectedClosing(null)} className="p-1 hover:bg-white/20 rounded-lg"><X size={20}/></button>
                    </div>
                    <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                        <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                           <div className="bg-slate-50 p-3 rounded-xl"><span className="text-slate-400 text-[10px] uppercase">User</span><p className="text-slate-800">{selectedClosing.user}</p></div>
                           <div className="bg-slate-50 p-3 rounded-xl"><span className="text-slate-400 text-[10px] uppercase">Shift</span><p className="text-slate-800">{selectedClosing.shift}</p></div>
                           <div className="bg-blue-50 p-3 rounded-xl"><span className="text-blue-400 text-[10px] uppercase">Setoran</span><p className="text-blue-700">Rp {selectedClosing.setoran?.toLocaleString()}</p></div>
                           <div className={`p-3 rounded-xl ${(selectedClosing.selisih || 0) >= 0 ? 'bg-emerald-50':'bg-red-50'}`}>
                             <span className="text-[10px] uppercase text-slate-400">Selisih</span>
                             <p className={`${(selectedClosing.selisih || 0) >= 0 ? 'text-emerald-700':'text-red-700'}`}>Rp {selectedClosing.selisih?.toLocaleString()}</p>
                           </div>
                        </div>
                        {selectedClosing.totalProfit !== undefined && (
                          <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 text-center">
                            <span className="text-[10px] font-black text-emerald-400 uppercase">Total Laba Shift</span>
                            <p className="text-lg font-black text-emerald-700">Rp {selectedClosing.totalProfit?.toLocaleString()}</p>
                          </div>
                        )}
                        {selectedClosing.cashIn !== undefined && (
                          <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                            <div className="bg-emerald-50 p-3 rounded-xl"><span className="text-[10px] uppercase text-emerald-400">Cash In</span><p className="text-emerald-700">Rp {selectedClosing.cashIn?.toLocaleString()}</p></div>
                            <div className="bg-red-50 p-3 rounded-xl"><span className="text-[10px] uppercase text-red-400">Cash Out</span><p className="text-red-700">Rp {selectedClosing.cashOut?.toLocaleString()}</p></div>
                          </div>
                        )}
                        <div className="p-4 bg-slate-100 rounded-2xl border border-dashed border-slate-300">
                           <p className="text-[10px] uppercase font-black text-slate-400 mb-2 tracking-widest text-center">Transaksi dalam shift ini</p>
                           <div className="space-y-2 max-h-40 overflow-y-auto">
                             {transactions.filter(t => t.shift === selectedClosing.shift && t.user === selectedClosing.user && t.closingId === selectedClosing.id).map(t => (
                               <div key={t.id} className="flex justify-between text-[11px] font-medium">
                                 <span className="text-slate-600 truncate flex-1">{t.items?.map(i=>i.name).join(', ') || t.type}</span>
                                 <span className="text-blue-600 font-bold ml-2">Rp {t.total?.toLocaleString()}</span>
                               </div>
                             ))}
                             {transactions.filter(t => t.shift === selectedClosing.shift && t.user === selectedClosing.user && t.closingId === selectedClosing.id).length === 0 && (
                               <p className="text-center text-slate-400 text-[11px] italic">Transaksi terkait tersimpan di database</p>
                             )}
                           </div>
                        </div>
                    </div>
                 </motion.div>
              </div>
           )}
        </AnimatePresence>

        {/* ===================== FOOTER ===================== */}
        <div className="mt-12 pt-8 border-t border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4">
           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic opacity-50">Kiosk Finance System • 2026</p>
           <div className="flex gap-2">
             <button onClick={handleResetData} className="text-xs font-black text-amber-600 hover:text-amber-700 flex items-center gap-2 uppercase tracking-tighter border border-amber-200 px-4 py-2 rounded-xl hover:bg-amber-50 transition-all">
                <History size={14}/> Reset Semua Data (Transaksi, Closing, SDM)
             </button>
             <button onClick={handleDeleteSelf} className="text-xs font-black text-red-500 hover:text-red-700 flex items-center gap-2 uppercase tracking-tighter border border-red-200 px-4 py-2 rounded-xl hover:bg-red-50 transition-all">
                <Trash2 size={14}/> Hapus Akun Owner (Resiko Tinggi)
             </button>
           </div>
        </div>

      </div>
    </div>
  );
}
