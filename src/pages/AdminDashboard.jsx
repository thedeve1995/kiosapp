import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { db } from '../lib/firebase';
import { collection, onSnapshot, doc, setDoc, query, where, serverTimestamp, addDoc, updateDoc, increment, writeBatch, deleteDoc, getDocs, orderBy, limit } from 'firebase/firestore';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { 
  BarChart3, TrendingUp, AlertOctagon, History, UserPlus, Users, 
  Loader2, Package, Edit3, Trash2, Search, Plus, Save, X, Check,
  ChevronDown, ChevronUp, Wallet, CircleDollarSign, Calendar, ListChecks, FileCheck2, LayoutDashboard,
  ShieldCheck, ClipboardList
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
// import AiChat from '../components/AiChat';

// === Helper Functions ===

/** Hitung profit dari satu transaksi (berdasarkan items atau fallback ke t.profit) */
function calcTransactionProfit(t) {
  if (t.items && t.items.length > 0) {
    return t.items.reduce((sum, it) => {
      const q = Number(it.qty) || 1;
      if (it.action === 'tarik') return sum + ((Number(it.fee) || 0) * q);
      const cost = Number(it.costPrice) || 0;
      return sum + (cost > 0 ? (Number(it.price || 0) - cost) * q : 0);
    }, 0);
  }
  return Number(t.profit) || 0;
}

/** Hitung profit per item (untuk kategori breakdown) */
function calcItemProfit(it) {
  const q = Number(it.qty) || 1;
  if (it.action === 'tarik') return (Number(it.fee) || 0) * q;
  const cost = Number(it.costPrice) || 0;
  return cost > 0 ? (Number(it.price || 0) - cost) * q : 0;
}

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
  const [logSearchTerm, setLogSearchTerm] = useState('');

  const [activeTab, setActiveTab] = useState('ringkasan');
  const [showKaryawan, setShowKaryawan] = useState(true);
  const [showInventory, setShowInventory] = useState(true);
  const [showBalances, setShowBalances] = useState(true);
  const [showReport, setShowReport] = useState(true);
  const [showClosings, setShowClosings] = useState(true);
  const [showLogs, setShowLogs] = useState(true);

  const [reportRange, setReportRange] = useState('Today');
  const [balances, setBalances] = useState({ cash: 0, apk: 0, seabank: 0, modalShift: 0 });
  const [balForm, setBalForm] = useState({ cash: '', apk: '', seabank: '', modalShift: '' });
  const [loadingBal, setLoadingBal] = useState(false);
  const [closings, setClosings] = useState([]);
  const [selectedClosing, setSelectedClosing] = useState(null);
  
  const [penyesuaianModal, setPenyesuaianModal] = useState(false);
  const [penyesuaianForm, setPenyesuaianForm] = useState({ jenisSistem: 'seabank', jenisAksi: 'tambah', nominal: '', keterangan: 'Penyesuaian Saldo' });

  // === SUPER AUDIT STATES ===
  const [showAudit, setShowAudit] = useState(false);
  const [auditStep, setAuditStep] = useState(1);
  const [auditData, setAuditData] = useState({
    initialCash: '', initialApk: '', initialSeabank: '',
    initialStocks: {}, // { prodId: count }
    digitalTrans: [], // [ { name, nominal, fee, cost, type, action } ]
    physicalAdjustments: {}, // { prodId: { added: 0, end: 0 } }
  });
  const [auditFormTrans, setAuditFormTrans] = useState({ name: '', nominal: '', fee: '', cost: '', type: 'jasa', action: 'isi' });
  const [loadingAudit, setLoadingAudit] = useState(false);

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
        setBalForm({ cash: b.cash || 0, apk: b.apk || 0, seabank: b.seabank || 0, modalShift: b.modalShift || 0 });
      }
    });
    return () => { unsubTrans(); unsubProd(); unsubBal(); };
  }, [user]);

  if (user?.role !== 'owner') return <div className="p-8 text-center text-red-500 font-bold">Akses Ditolak (Owner Only)</div>;

  // === CALCULATIONS ===
  const defaultCategories = ['Voucher', 'E-Money', 'Rokok', 'Minuman', 'Snack', 'Lainnya'];
  const existingCategories = products.map(p => p.category).filter(Boolean);
  const allCategories = Array.from(new Set([...defaultCategories, ...existingCategories]));

  const activeTrans = useMemo(() => transactions.filter(t => !['adjustment', 'expenditure'].includes(t.type) && t.status !== 'cancelled'), [transactions]);
  const totalPemasukan = useMemo(() => activeTrans.reduce((s, t) => s + (t.total || 0), 0), [activeTrans]);
  const totalPengeluaran = useMemo(() => transactions.filter(t => t.type === 'expenditure' && t.status !== 'cancelled').reduce((s, t) => s + (t.total || 0), 0), [transactions]);
  const totalLaba = useMemo(() => activeTrans.reduce((s, t) => s + calcTransactionProfit(t), 0), [activeTrans]);
  const totalBatal = useMemo(() => transactions.filter(t => t.status === 'cancelled').length, [transactions]);
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
  const reportProfit = filteredReportTrans.reduce((s, t) => s + calcTransactionProfit(t), 0);
  const reportAvg = filteredReportTrans.length ? Math.round(reportTotal / filteredReportTrans.length) : 0;
  const categorySummary = filteredReportTrans.filter(t => !['adjustment', 'expenditure'].includes(t.type)).reduce((acc, t) => {
    t.items?.forEach(it => {
      const cat = it.category || 'Lainnya';
      acc[cat] = (acc[cat] || 0) + calcItemProfit(it);
    });
    return acc;
  }, {});

  // Filtered products
  const filteredProducts = products.filter(p => p.name?.toLowerCase().includes(searchTerm.toLowerCase()));

  // Sorted physical products for audit/stock management
  const sortedStokProducts = useMemo(() => {
    return products
      .filter(p => p.type === 'stok')
      .sort((a, b) => {
        const catA = (a.category || '').toLowerCase();
        const catB = (b.category || '').toLowerCase();
        if (catA !== catB) return catA.localeCompare(catB);
        return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
      });
  }, [products]);

  // Filtered transaction logs (deduplicated)
  const filteredLogs = useMemo(() => {
    if (!logSearchTerm) return transactions;
    const searchLower = logSearchTerm.toLowerCase();
    return transactions.filter(t => {
      const itemMatch = t.items?.some(it => it.name?.toLowerCase().includes(searchLower));
      const userMatch = t.user?.toLowerCase().includes(searchLower);
      const shiftMatch = (t.shift || '').toLowerCase().includes(searchLower);
      const typeMatch = t.type?.toLowerCase().includes(searchLower);
      return itemMatch || userMatch || shiftMatch || typeMatch;
    });
  }, [transactions, logSearchTerm]);

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

  const handlePenyesuaian = async (e) => {
    e.preventDefault();
    if (!penyesuaianForm.nominal || isNaN(penyesuaianForm.nominal)) return;
    const nominal = parseFloat(penyesuaianForm.nominal);
    if (nominal <= 0) return alert("Nominal invalid");
    setLoadingBal(true);

    try {
      const batch = writeBatch(db);
      const balanceRef = doc(db, 'balances', 'current');
      
      let change = penyesuaianForm.jenisAksi === 'tambah' ? nominal : -nominal;
      let newBalances = { ...balances };
      newBalances[penyesuaianForm.jenisSistem] = (newBalances[penyesuaianForm.jenisSistem] || 0) + change;

      if (newBalances[penyesuaianForm.jenisSistem] < 0) {
        setLoadingBal(false);
        return alert("Saldo tidak mencukupi untuk pengurangan ini!");
      }

      batch.update(balanceRef, { [penyesuaianForm.jenisSistem]: increment(change) });

      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        type: 'adjustment',
        status: 'success',
        user: user?.name || 'Owner',
        role: 'owner',
        shift: 'Manual Penyesuaian',
        total: 0,
        timestamp: serverTimestamp(),
        items: [{
          name: penyesuaianForm.keterangan || `Penyesuaian ${penyesuaianForm.jenisSistem} (${penyesuaianForm.jenisAksi})`,
          qty: 1,
          price: nominal,
          total: nominal,
          action: penyesuaianForm.jenisAksi,
          jenisSistem: penyesuaianForm.jenisSistem
        }],
        profit: 0,
        previous: balances,
        current: newBalances
      });

      await batch.commit();
      alert(`Berhasil menyesuaikan saldo ${penyesuaianForm.jenisSistem}!`);
      setPenyesuaianModal(false);
      setPenyesuaianForm({ jenisSistem: 'seabank', jenisAksi: 'tambah', nominal: '', keterangan: 'Penyesuaian Saldo' });
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      setLoadingBal(false);
    }
  };

  const handleApproveCancellation = async (log) => {
    if (!window.confirm("Setujui pembatalan ini? Saldo dan Stok akan dikembalikan otomatis.")) return;
    try {
      const batch = writeBatch(db);

      // Hitung delta reversal untuk setiap item
      let cashDelta = 0, seabankDelta = 0, apkDelta = 0;

      log.items?.forEach(item => {
        const q = item.qty || 1;
        const totalFee = (item.fee || 0) * q;
        const totalNominal = (item.nominal || 0) * q;
        const isExpenditure = log.type === 'expenditure';

        // 1. Reversal Balance Logic (kebalikan dari transaksi asli)
        if (isExpenditure) {
          cashDelta += (item.total || (item.price * q));
        } else {
          if (item.action === 'tarik') {
            const cashEffect = totalNominal - (item.feePaidVia === 'cash' ? totalFee : 0);
            cashDelta += cashEffect;
          } else {
            if (log.paymentMethod === 'transfer') {
              seabankDelta -= (item.price * q);
            } else {
              cashDelta -= (item.price * q);
            }
          }
        }

        // 2. Reversal service balance (App/Bank)
        if (item.type === 'jasa' || item.type === 'saldo') {
          if (item.action === 'transfer') {
            seabankDelta += (Number(item.costPrice || item.nominal) * q);
          } else if (item.action === 'tarik') {
            const bankReceived = totalNominal + (item.feePaidVia === 'transfer' ? totalFee : 0);
            seabankDelta -= bankReceived;
          } else {
            apkDelta += (Number(item.costPrice || item.nominal) * q);
          }
        }

        // 3. Reversal Stock
        if (item.type === 'stok' && item.firebaseId) {
          const stockChange = item.action === 'restock' ? -q : q;
          batch.update(doc(db, 'products', item.firebaseId), { stock: increment(stockChange) });
        }
      });

      // Atomic balance update — aman dari race condition
      batch.update(doc(db, 'balances', 'current'), {
        cash: increment(cashDelta),
        seabank: increment(seabankDelta),
        apk: increment(apkDelta),
      });
      batch.update(doc(db, 'transactions', log.id), { status: 'cancelled', approvedBy: user.name, approvedAt: serverTimestamp() });
      await batch.commit();
      alert("Pembatalan Berhasil!");
    } catch (e) { alert("Gagal: " + e.message); }
  };

  const handleReopenShift = async (closing) => {
    if (!window.confirm(`BUKA KEMBALI sesi closing ini? \n\nSemua transaksi dalam sesi ${closing.shift} (${closing.user}) akan dikembalikan ke status 'Aktif' dan laporan closing ini akan dihapus.`)) return;
    
    setLoadingBal(true);
    try {
      const batch = writeBatch(db);
      
      // 1. Cari transaksi yang terkait dengan closing ini
      const q = query(collection(db, 'transactions'), where('closingId', '==', closing.id));
      const snap = await getDocs(q);
      
      snap.docs.forEach(docSnap => {
        batch.update(docSnap.ref, { 
          closed: false, 
          closingId: null 
        });
      });

      // 2. Koreksi Saldo Global (Kembalikan setoran ke Kas)
      const balanceRef = doc(db, 'balances', 'current');
      batch.update(balanceRef, {
        cash: increment(closing.setoran || 0)
      });

      // 3. Hapus Laporan Closing
      batch.delete(doc(db, 'shift_closings', closing.id));

      await batch.commit();
      setSelectedClosing(null);
      alert("Sesi berhasil dibuka kembali. Karyawan bisa melanjutkan pencatatan di POS.");
    } catch (e) {
      alert("Gagal membuka kembali sesi: " + e.message);
    } finally {
      setLoadingBal(false);
    }
  };

  const handleCommitAudit = async () => {
    const confirm = window.confirm("KONFIRMASI AKHIR: Apakah Anda yakin ingin melakukan OVERWRITE data sistem dengan hasil Audit Manual ini? Seluruh transaksi yang belum ter-closing akan di-VOID.");
    if (!confirm) return;

    setLoadingAudit(true);
    try {
      const batch = writeBatch(db);
      const now = new Date();
      
      // 1. Void semua transaksi yang belum closed
      const q = query(collection(db, 'transactions'), where('closed', '!=', true));
      const snap = await getDocs(q);
      snap.docs.forEach(d => {
        batch.update(d.ref, { status: 'voided_by_audit', voidedAt: serverTimestamp(), voidedBy: user.name });
      });

      // 2. Hitung Rekapitulasi Akhir
      let netCash = Number(auditData.initialCash);
      let netApk = Number(auditData.initialApk);
      let netSeabank = Number(auditData.initialSeabank);

      // Digital Re-input processing
      auditData.digitalTrans.forEach(t => {
        const q = 1;
        const total = Number(t.nominal) + Number(t.fee);
        
        if (t.action === 'tarik') {
          // Tarik Tunai: Kas Keluar
          netCash -= Number(t.nominal);
          // Bank Bertambah (Seabank received)
          netSeabank += total; 
        } else if (t.action === 'transfer') {
          // Transfer: Kas Masuk, Bank Keluar
          netCash += total;
          netSeabank -= Number(t.cost || t.nominal);
        } else {
          // TopUp APK: Kas Masuk, APK Keluar
          netCash += total;
          netApk -= Number(t.cost || t.nominal);
        }

        // Add to Transaction Logs as Audit Reconstruction
        const tRef = doc(collection(db, 'transactions'));
        batch.set(tRef, {
          ...t,
          total,
          status: 'success',
          type: 'audit_reconstruction',
          user: user.name,
          timestamp: serverTimestamp(),
          profit: total - Number(t.cost || t.nominal)
        });
      });

      // Physical Re-input processing
      products.filter(p => p.type === 'stok').forEach(p => {
        const start = Number(auditData.initialStocks[p.id] || p.stock);
        const adjust = auditData.physicalAdjustments[p.id] || { added: 0, end: 0 };
        const sold = (start + Number(adjust.added)) - Number(adjust.end);
        
        if (sold > 0) {
          const rev = sold * p.price;
          netCash += rev; // Penjualan fisik diasumsikan cash di audit ini
          
          const tRef = doc(collection(db, 'transactions'));
          batch.set(tRef, {
            name: p.name,
            type: 'audit_reconstruction_physical',
            status: 'success',
            items: [{ name: p.name, qty: sold, price: p.price, total: rev }],
            total: rev,
            profit: (p.price - (p.costPrice || 0)) * sold,
            user: user.name,
            timestamp: serverTimestamp()
          });
        }
        
        // Update Stock
        batch.update(doc(db, 'products', p.id), { stock: Number(adjust.end) });
      });

      // 3. Update Global Balances
      const balRef = doc(db, 'balances', 'current');
      batch.update(balRef, { cash: netCash, apk: netApk, seabank: netSeabank });

      // 4. Log the Audit Header
      const auditLogRef = doc(collection(db, 'transactions'));
      batch.set(auditLogRef, {
        type: 'super_audit_header',
        status: 'success',
        user: user.name,
        timestamp: serverTimestamp(),
        previousBalances: { cash: balances.cash, apk: balances.apk, seabank: balances.seabank },
        auditBalances: { cash: netCash, apk: netApk, seabank: netSeabank }
      });

      await batch.commit();
      alert("SUPER AUDIT BERHASIL! Data sistem sekarang sinkron dengan catatan manual Anda.");
      setShowAudit(false);
      setAuditStep(1);
    } catch (e) {
      alert("Terjadi Error saat Audit: " + e.message);
    } finally {
      setLoadingAudit(false);
    }
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
  const TABS = [
    { id: 'ringkasan', label: 'Ringkasan', icon: LayoutDashboard },
    { id: 'katalog', label: 'Katalog Produk', icon: Package },
    { id: 'karyawan', label: 'SDM & Staf', icon: Users },
    { id: 'keuangan', label: 'Kas & Modal', icon: Wallet },
    { id: 'riwayat', label: 'Log Transaksi', icon: History }
  ];

  return (
    <div className="flex flex-col md:flex-row min-h-full bg-slate-900 overflow-hidden">
      
      {/* Sidebar Navigation */}
      <div className="md:w-60 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800/80 shrink-0 flex flex-row md:flex-col p-3 md:p-5 overflow-x-auto no-scrollbar gap-2 md:gap-3 z-10 w-full">
         <div className="hidden md:flex justify-between items-center mb-6">
           <div>
             <h2 className="text-xl font-black text-white tracking-tight">Owner<span className="text-indigo-400">.</span></h2>
             <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mt-0.5">Control Panel</p>
           </div>
         </div>
         {user?.whatsapp && (
           <div className="hidden md:flex mb-4 bg-indigo-500/10 border border-indigo-500/20 px-3 py-2 rounded-xl items-center gap-2">
             <span className="text-[10px] font-black uppercase text-indigo-400">WA: {user.whatsapp}</span>
           </div>
         )}
         <div className="flex md:flex-col gap-2">
           {TABS.map(t => (
              <button 
                 key={t.id} 
                 onClick={() => setActiveTab(t.id)} 
                 className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap ${
                   activeTab === t.id 
                     ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' 
                     : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
                 }`}
              >
                 <t.icon size={18} className={activeTab === t.id ? 'text-indigo-200' : ''} />
                 <span className="font-bold text-sm">{t.label}</span>
              </button>
           ))}
         </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 bg-slate-900">
        <div className="max-w-5xl mx-auto space-y-6">

        {activeTab === 'ringkasan' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {stats.map((s, i) => (
                <div key={i} className="bg-slate-800 p-5 rounded-3xl border border-slate-700/50 flex items-center gap-4 hover:border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/10 transition-all">
                   <div className={`${s.bg} ${s.color} p-4 rounded-2xl`}><s.icon size={24} /></div>
                   <div><p className="text-[10px] text-slate-500 font-extrabold uppercase tracking-wider">{s.title}</p><p className="text-xl font-black text-white">{s.value}</p></div>
                </div>
              ))}
            </div>

        {/* ===================== SECTION: PERMINTAAN PEMBATALAN ===================== */}
        {pendingCancellations.length > 0 && (
          <div className="bg-amber-500/10 rounded-3xl p-5 border border-amber-500/30">
             <div className="flex items-center gap-2 mb-4">
                <AlertOctagon size={22} className="text-amber-400"/>
                <h3 className="font-bold text-amber-400 text-base">Permintaan Pembatalan ({pendingCancellations.length})</h3>
             </div>
             <div className="space-y-3">
                {pendingCancellations.map(t => (
                   <div key={t.id} className="bg-slate-800 p-4 rounded-2xl border border-amber-500/20 hover:border-amber-500/40 transition-all">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                         <div>
                            <div className="flex items-center gap-2 flex-wrap">
                               <p className="font-black text-white">{t.user}</p>
                               <span className="text-[10px] text-slate-500 font-normal">
                                 {t.timestamp ? new Date(t.timestamp.seconds * 1000).toLocaleString('id-ID') : '-'}
                               </span>
                               <span className="bg-amber-500/20 text-amber-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">MENUNGGU RESPON</span>
                            </div>
                            <p className="text-xs text-slate-400 mt-1 italic">{t.items?.map(it=>it.name).join(', ') || t.type}</p>
                            <p className="text-sm font-black text-red-400 mt-1">Rp {t.total?.toLocaleString()}</p>
                            {t.profit !== undefined && t.profit > 0 && (
                               <p className="text-[10px] font-bold text-amber-400 italic -mt-0.5">Laba: Rp {t.profit?.toLocaleString()}</p>
                            )}
                         </div>
                         <div className="flex items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0 shrink-0">
                            <button onClick={() => handleApproveCancellation(t)} className="flex-1 sm:flex-none px-4 py-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold rounded-xl text-xs hover:bg-emerald-500/25 flex items-center justify-center gap-2 transition-all">
                               <Check size={14}/> Setujui
                            </button>
                            <button onClick={() => handleRejectCancellation(t.id)} className="flex-1 sm:flex-none px-4 py-2 bg-red-500/15 text-red-400 border border-red-500/30 font-bold rounded-xl text-xs hover:bg-red-500/25 flex items-center justify-center gap-2 transition-all">
                               <X size={14}/> Tolak
                            </button>
                         </div>
                      </div>
                   </div>
                ))}
             </div>
          </div>
        )}
          </div>
        )}

        {activeTab === 'karyawan' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* ===================== SECTION: SDM ===================== */}
        <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700/50">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowKaryawan(!showKaryawan)}>
              <h3 className="font-bold text-white flex items-center gap-2"><Users size={18} className="text-indigo-400"/> Manajemen Karyawan ({employees.length})</h3>
              <button className="p-1 hover:bg-slate-700 rounded-lg text-slate-400">{showKaryawan ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
           </div>
           <AnimatePresence>
              {showKaryawan && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="space-y-5 mt-5 overflow-hidden">
                    {msg.text && (
                      <div className={`p-3 rounded-xl text-xs font-bold ${msg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20':'bg-red-500/10 text-red-400 border border-red-500/20'}`}>{msg.text}</div>
                    )}
                    <form onSubmit={handleRegister} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                       <input type="text" required placeholder="Nama Lengkap" value={regForm.name} onChange={e=>setRegForm({...regForm, name:e.target.value})} className="px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm font-medium text-white placeholder-slate-600 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
                       <input type="email" required placeholder="Email" value={regForm.email} onChange={e=>setRegForm({...regForm, email:e.target.value})} className="px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm font-medium text-white placeholder-slate-600 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
                       <input type="password" required minLength={6} placeholder="Password (min 6)" value={regForm.password} onChange={e=>setRegForm({...regForm, password:e.target.value})} className="px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm font-medium text-white placeholder-slate-600 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
                       <button disabled={loadingReg} className="sm:col-span-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
                         {loadingReg ? <Loader2 className="animate-spin" size={16}/> : <UserPlus size={16}/>} Daftarkan Karyawan
                       </button>
                    </form>
                    <div className="divide-y divide-slate-700/50 border-t border-slate-700/50">
                       {employees.length === 0 && <p className="text-center text-slate-600 text-sm py-4 italic">Belum ada karyawan terdaftar</p>}
                       {employees.map((e, i) => (
                          <div key={i} className="py-3 flex justify-between items-center text-sm">
                            <div>
                              <span className="font-bold text-white">{e.name}</span>
                              <span className="text-slate-500 text-xs ml-2">{e.email}</span>
                            </div>
                            <span className="bg-indigo-500/15 text-indigo-400 border border-indigo-500/20 text-[10px] font-black px-2 py-1 rounded-full uppercase">Karyawan</span>
                          </div>
                       ))}
                    </div>
                 </motion.div>
              )}
           </AnimatePresence>
        </div>
          </div>
        )}

        {activeTab === 'katalog' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* ===================== SECTION: KATALOG PRODUK ===================== */}
        <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700/50">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowInventory(!showInventory)}>
              <h3 className="font-bold text-white flex items-center gap-2"><Package size={18} className="text-indigo-400"/> Katalog Produk ({products.length})</h3>
              <button className="p-1 hover:bg-slate-700 rounded-lg text-slate-400">{showInventory ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
           </div>
           <AnimatePresence>
              {showInventory && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="space-y-4 mt-5 overflow-hidden">
                    {/* Product Form */}
                    <form onSubmit={handleProductSubmit} className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-900/60 p-4 rounded-2xl border border-slate-700/50">
                       <input className="col-span-2 px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm font-medium text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none" placeholder="Nama Produk" required value={prodForm.name} onChange={e=>setProdForm({...prodForm, name:e.target.value})} />
                       <select className="px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm font-medium text-white focus:border-indigo-500 focus:outline-none" value={prodForm.category} onChange={e=>setProdForm({...prodForm, category:e.target.value})}>
                          {allCategories.map(c=><option key={c} value={c}>{c}</option>)}
                       </select>
                       <select className="px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm font-medium text-white focus:border-indigo-500 focus:outline-none" value={prodForm.type} onChange={e=>setProdForm({...prodForm, type:e.target.value})}>
                          <option value="stok">Stok (Barang)</option>
                          <option value="jasa">Jasa (Layanan)</option>
                          <option value="saldo">Saldo (Isi Ulang)</option>
                       </select>
                       <input className="px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none" type="number" placeholder="Modal / HPP" value={prodForm.costPrice} onChange={e=>setProdForm({...prodForm, costPrice:e.target.value})} />
                       <input className="px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none" type="number" placeholder="Harga Jual" required value={prodForm.price} onChange={e=>setProdForm({...prodForm, price:e.target.value})} />
                       {prodForm.type === 'stok' && (
                         <input className="px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none" type="number" placeholder="Stok" value={prodForm.stock} onChange={e=>setProdForm({...prodForm, stock:e.target.value})} />
                       )}
                       {(prodForm.type === 'jasa' || prodForm.type === 'saldo') && (
                         <select className="px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm font-medium text-white focus:border-indigo-500 focus:outline-none" value={prodForm.action} onChange={e=>setProdForm({...prodForm, action:e.target.value})}>
                           <option value="">-- Aksi --</option>
                           <option value="isi">Isi Saldo</option>
                           <option value="transfer">Transfer</option>
                           <option value="tarik">Tarik Tunai</option>
                         </select>
                       )}
                       <button disabled={loadingProduct} className="col-span-2 sm:col-span-4 bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
                         {loadingProduct ? <Loader2 className="animate-spin" size={16}/> : (isEditing ? <Save size={16}/> : <Plus size={16}/>)}
                         {isEditing ? 'Update Produk' : 'Tambah Produk'}
                       </button>
                    </form>

                    {/* Auto Price & Search */}
                    <div className="flex flex-wrap gap-2 items-center">
                      <button onClick={handleAutoPriceVouchers} className="bg-amber-500/15 text-amber-400 border border-amber-500/20 px-3 py-1.5 rounded-xl text-[11px] font-bold hover:bg-amber-500/25 transition-all">
                        ⚡ Auto Harga Voucher (+10%)
                      </button>
                      <div className="flex-1 relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"/>
                        <input className="w-full pl-8 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500" placeholder="Cari produk..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/>
                      </div>
                    </div>

                    {/* Product Table */}
                    <div className="overflow-x-auto">
                       <table className="w-full text-xs font-bold">
                          <thead>
                            <tr className="border-b border-slate-700/50">
                              <th className="py-3 px-2 text-left text-slate-500 uppercase tracking-wider">NAMA</th>
                              <th className="py-3 px-2 text-center text-slate-500 uppercase tracking-wider">KAT</th>
                              <th className="py-3 px-2 text-center text-slate-500 uppercase tracking-wider">TIPE</th>
                              <th className="py-3 px-2 text-center text-slate-500 uppercase tracking-wider">MODAL</th>
                              <th className="py-3 px-2 text-center text-slate-500 uppercase tracking-wider">JUAL</th>
                              <th className="py-3 px-2 text-center text-slate-500 uppercase tracking-wider">LABA</th>
                              <th className="py-3 px-2 text-center text-slate-500 uppercase tracking-wider">STOK</th>
                              <th className="py-3 px-2 text-right text-slate-500 uppercase tracking-wider">AKSI</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredProducts.map(p => (
                              <tr key={p.id} className="border-b border-slate-700/30 hover:bg-indigo-500/5 transition-colors">
                                <td className="py-3 px-2 text-left font-black text-white">{p.name}</td>
                                <td className="py-3 px-2 text-center"><span className="bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full text-[10px]">{p.category}</span></td>
                                <td className="py-3 px-2 text-center"><span className={`px-2 py-0.5 rounded-full text-[10px] ${p.type === 'stok' ? 'bg-blue-500/15 text-blue-400' : p.type === 'saldo' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-violet-500/15 text-violet-400'}`}>{p.type}</span></td>
                                <td className="py-3 px-2 text-center italic text-slate-500">{p.costPrice?.toLocaleString() || '-'}</td>
                                <td className="py-3 px-2 text-center text-indigo-400">{p.price?.toLocaleString()}</td>
                                <td className="py-3 px-2 text-center text-emerald-400 italic">{p.costPrice ? (p.price - p.costPrice).toLocaleString() : '-'}</td>
                                <td className="py-3 px-2 text-center text-slate-400">{p.type === 'stok' ? p.stock : '∞'}</td>
                                <td className="py-3 px-2 text-right space-x-1">
                                  <button onClick={()=>startEdit(p)} className="p-1.5 text-amber-400 hover:bg-amber-500/15 rounded-lg transition-colors"><Edit3 size={14}/></button>
                                  <button onClick={()=>deleteProduct(p.id)} className="p-1.5 text-red-400 hover:bg-red-500/15 rounded-lg transition-colors"><Trash2 size={14}/></button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                       </table>
                       {filteredProducts.length === 0 && <p className="text-center text-slate-600 text-sm py-6 italic">Tidak ada produk ditemukan</p>}
                    </div>
                 </motion.div>
              )}
           </AnimatePresence>
        </div>
          </div>
        )}

        {activeTab === 'keuangan' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* ===================== SECTION: SALDO & MODAL ===================== */}
        <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700/50">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowBalances(!showBalances)}>
              <h3 className="font-bold text-white flex items-center gap-2"><Wallet size={18} className="text-indigo-400"/> Saldo & Modal</h3>
              <button className="p-1 hover:bg-slate-700 rounded-lg text-slate-400">{showBalances ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
           </div>
           <AnimatePresence>
              {showBalances && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="space-y-4 mt-5 overflow-hidden">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                       {Object.entries(balances).map(([k,v])=>(
                          <div key={k} className="bg-slate-900/60 p-3 rounded-2xl border border-slate-700/50">
                            <p className="text-[9px] uppercase font-black text-slate-500 tracking-wider">{k === 'modalShift' ? 'Modal Baku' : k}</p>
                            <p className="text-sm font-black text-white italic">{typeof v === 'number' ? `Rp ${v.toLocaleString()}` : v}</p>
                          </div>
                       ))}
                    </div>
                    <form onSubmit={handleBalanceUpdate} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                       <div>
                         <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Cash</label>
                         <input className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:border-indigo-500 focus:outline-none" type="number" value={balForm.cash} onChange={e=>setBalForm({...balForm, cash:e.target.value})} />
                       </div>
                       <div>
                         <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">APK</label>
                         <input className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:border-indigo-500 focus:outline-none" type="number" value={balForm.apk} onChange={e=>setBalForm({...balForm, apk:e.target.value})} />
                       </div>
                       <div>
                         <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Seabank</label>
                         <input className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:border-indigo-500 focus:outline-none" type="number" value={balForm.seabank} onChange={e=>setBalForm({...balForm, seabank:e.target.value})} />
                       </div>
                       <div>
                         <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Modal Shift</label>
                         <input className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:border-indigo-500 focus:outline-none" type="number" value={balForm.modalShift} onChange={e=>setBalForm({...balForm, modalShift:e.target.value})} />
                       </div>
                       <button disabled={loadingBal} className="col-span-2 sm:col-span-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-all">
                         {loadingBal ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} Update Saldo & Modal
                       </button>
                       <button 
                         type="button" 
                         onClick={() => {
                           setShowAudit(true);
                           setAuditData({
                             ...auditData,
                             initialCash: balances.cash,
                             initialApk: balances.apk,
                             initialSeabank: balances.seabank,
                             initialStocks: products.reduce((acc, p) => ({ ...acc, [p.id]: p.stock }), {})
                           });
                         }}
                         className="col-span-2 sm:col-span-4 bg-red-500/10 text-red-400 border border-red-500/20 font-bold py-2.5 rounded-xl text-sm hover:bg-red-500/20 flex items-center justify-center gap-2 mt-2 transition-all"
                       >
                         <ShieldCheck size={18}/> Buka Fitur Super Audit (Rekonsiliasi Manual)
                       </button>
                    </form>
                 </motion.div>
              )}
           </AnimatePresence>
        </div>

        {/* ===================== SECTION: MUTASI / PENYESUAIAN MANUAL ===================== */}
        <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700/50">
             <div className="flex items-center justify-between cursor-pointer" onClick={() => setPenyesuaianModal(true)}>
                <h3 className="font-bold text-white flex items-center gap-2"><Wallet size={18} className="text-violet-400"/> Mutasi / Penyesuaian Saldo Manual</h3>
                <button className="p-2 hover:bg-slate-700 rounded-lg text-indigo-400 font-bold text-xs flex items-center gap-1 border border-indigo-500/20 bg-indigo-500/10"><Plus size={16}/> BUKA FORM</button>
             </div>
        </div>

        {/* Penyesuaian Saldo Modal */}
        <AnimatePresence>
         {penyesuaianModal && (
           <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-slate-800 border border-slate-700/50 p-6 rounded-3xl shadow-2xl w-full max-w-md">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-black text-white">Penyesuaian Saldo Manual</h3>
                    <button onClick={() => setPenyesuaianModal(false)} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-slate-400"><X size={20}/></button>
                 </div>
                 <form onSubmit={handlePenyesuaian} className="space-y-4 pb-4">
                    <div>
                       <label className="text-[10px] font-black text-slate-500 uppercase ml-1 block mb-1.5">Pilih Saldo</label>
                       <select required className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl font-bold text-white focus:border-indigo-500 focus:outline-none" value={penyesuaianForm.jenisSistem} onChange={e => setPenyesuaianForm({...penyesuaianForm, jenisSistem: e.target.value})}>
                          <option value="cash">Kas Fisik</option>
                          <option value="seabank">Seabank</option>
                          <option value="apk">Saldo APK / E-Wallet</option>
                       </select>
                    </div>
                    <div>
                       <label className="text-[10px] font-black text-slate-500 uppercase ml-1 block mb-1.5">Jenis Aksi</label>
                       <select required className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl font-bold text-white focus:border-indigo-500 focus:outline-none" value={penyesuaianForm.jenisAksi} onChange={e => setPenyesuaianForm({...penyesuaianForm, jenisAksi: e.target.value})}>
                          <option value="tambah">TAMBAH Saldo (+)</option>
                          <option value="kurang">KURANGI Saldo (-)</option>
                       </select>
                    </div>
                    <div>
                       <label className="text-[10px] font-black text-slate-500 uppercase ml-1 block mb-1.5">Nominal (Rp)</label>
                       <input type="number" required placeholder="Rp Nominal" className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl font-bold text-lg text-white focus:border-indigo-500 focus:outline-none" value={penyesuaianForm.nominal} onChange={e => setPenyesuaianForm({...penyesuaianForm, nominal: e.target.value})} />
                    </div>
                    <div>
                       <label className="text-[10px] font-black text-slate-500 uppercase ml-1 block mb-1.5">Keterangan / Alasan</label>
                       <input type="text" required placeholder="Penjelasan Mutasi" className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl font-bold text-white focus:border-indigo-500 focus:outline-none" value={penyesuaianForm.keterangan} onChange={e => setPenyesuaianForm({...penyesuaianForm, keterangan: e.target.value})} />
                    </div>
                    <div className="bg-violet-500/10 p-4 rounded-xl text-violet-400 text-xs font-bold flex items-start gap-2 border border-violet-500/20">
                       <AlertOctagon size={18} className="shrink-0" />
                       <p>Aksi ini akan menyesuaikan saldo sistem secara manual (dicatat sebagai adjustment), dan tidak mempengaruhi total laba perputaran transaksi.</p>
                    </div>
                    <button type="submit" disabled={loadingBal} className="w-full bg-violet-600 hover:bg-violet-500 text-white font-black py-4 rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 mt-2 disabled:opacity-50">
                       {loadingBal ? <Loader2 className="animate-spin" size={20}/> : <Wallet size={20} />} Simpan Penyesuaian
                    </button>
                 </form>
              </motion.div>
           </div>
         )}
        </AnimatePresence>

        {/* ===================== SECTION: LAPORAN ANALITIK ===================== */}
        <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700/50">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowReport(!showReport)}>
              <h3 className="font-bold text-white flex items-center gap-2"><BarChart3 size={18} className="text-indigo-400"/> Laporan Analitik</h3>
              <button className="p-1 hover:bg-slate-700 rounded-lg text-slate-400">{showReport ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
           </div>
           <AnimatePresence>
              {showReport && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="space-y-4 mt-5 overflow-hidden">
                    {/* Time Range Filter */}
                    <div className="flex gap-2">
                       {['Today','Week','Month'].map(r => (
                         <button key={r} onClick={()=>setReportRange(r)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${reportRange===r ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20':'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                           {r === 'Today' ? 'Hari Ini' : r === 'Week' ? 'Seminggu' : 'Bulan Ini'}
                         </button>
                       ))}
                    </div>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-indigo-500/10 p-4 rounded-2xl border border-indigo-500/20">
                        <p className="text-[10px] font-black text-indigo-400 uppercase">Total</p>
                        <p className="text-base font-black text-indigo-300">Rp {reportTotal.toLocaleString()}</p>
                      </div>
                      <div className="bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20">
                        <p className="text-[10px] font-black text-emerald-400 uppercase">Laba</p>
                        <p className="text-base font-black text-emerald-300">Rp {reportProfit.toLocaleString()}</p>
                      </div>
                      <div className="bg-amber-500/10 p-4 rounded-2xl border border-amber-500/20">
                        <p className="text-[10px] font-black text-amber-400 uppercase">Rata-rata</p>
                        <p className="text-base font-black text-amber-300">Rp {reportAvg.toLocaleString()}</p>
                      </div>
                    </div>
                    {/* Category Breakdown */}
                    <div className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50">
                      <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-3">Laba Per Kategori</p>
                      {Object.entries(categorySummary).length === 0 && <p className="text-xs italic text-slate-600 text-center">Tidak ada data</p>}
                      <div className="space-y-3">
                        {Object.entries(categorySummary).sort((a,b)=>b[1]-a[1]).map(([cat, val]) => (
                          <div key={cat} className="flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-300">{cat}</span>
                            <div className="flex items-center gap-3">
                              <div className="w-24 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 rounded-full" style={{width: `${Math.min(100, (val / reportTotal) * 100)}%`}}/>
                              </div>
                              <span className="text-xs font-black text-indigo-400 w-24 text-right">Rp {val.toLocaleString()}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-600 font-medium text-center italic">{filteredReportTrans.length} transaksi dalam periode ini</p>
                 </motion.div>
              )}
           </AnimatePresence>
        </div>
          </div>
        )}

        {activeTab === 'riwayat' && (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* ===================== SECTION: RIWAYAT CLOSING ===================== */}
        <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700/50">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowClosings(!showClosings)}>
              <h3 className="font-bold text-white flex items-center gap-2"><ListChecks size={18} className="text-indigo-400"/> Riwayat Closing Shift ({closings.length})</h3>
              <button className="p-1 hover:bg-slate-700 rounded-lg text-slate-400">{showClosings ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
           </div>
           <AnimatePresence>
              {showClosings && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="space-y-3 mt-5 overflow-hidden">
                    {closings.length === 0 && <p className="text-center text-slate-600 text-sm py-4 italic">Belum ada data closing</p>}
                    {closings.map(cl => (
                       <div key={cl.id} onClick={() => setSelectedClosing(cl)} className="p-4 bg-slate-900/60 rounded-2xl border border-slate-700/50 hover:border-indigo-500/30 hover:bg-indigo-500/5 cursor-pointer transition-all">
                          <div className="flex justify-between items-start">
                             <div>
                                <p className="text-xs font-black text-white">{cl.user} • <span className="text-indigo-400">{cl.shift}</span></p>
                                <p className="text-[10px] text-slate-500 italic">{cl.timestamp ? new Date(cl.timestamp.seconds * 1000).toLocaleString('id-ID') : '-'}</p>
                             </div>
                             <div className="text-right">
                                <p className="text-sm font-black text-indigo-400">Setoran: Rp {cl.setoran?.toLocaleString()}</p>
                                {cl.totalProfit !== undefined && (
                                  <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-bold text-[10px] px-2 py-0.5 rounded-md italic">Laba: Rp {cl.totalProfit?.toLocaleString()}</span>
                                )}
                                {cl.selisih !== undefined && (
                                  <span className={`ml-1 text-[10px] font-black px-2 py-0.5 rounded-md border ${cl.selisih >= 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
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
        <div className="bg-slate-800 rounded-3xl p-5 border border-slate-700/50">
           <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowLogs(!showLogs)}>
              <h3 className="font-bold text-white flex items-center gap-2"><History size={18} className="text-indigo-400"/> Log Transaksi ({transactions.length})</h3>
              <div className="flex gap-2 items-center">
                 {showLogs && (
                   <input 
                     type="text"
                     placeholder="Cari transaksi..."
                     value={logSearchTerm}
                     onChange={(e) => setLogSearchTerm(e.target.value)}
                     onClick={(e) => e.stopPropagation()}
                     className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-semibold text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-32 sm:w-48 transition-all"
                   />
                 )}
                 <button className="p-1 hover:bg-slate-700 rounded-lg text-slate-400">{showLogs ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button>
              </div>
           </div>
           <AnimatePresence>
              {showLogs && (
                 <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}} className="divide-y divide-slate-700/50 mt-4 overflow-hidden">
                     {filteredLogs.slice(0, 100).map(t => (
                        <div key={t.id} className={`py-3 ${t.status === 'cancelled' ? 'opacity-40' : ''}`}>
                           <div className="flex justify-between items-start">
                              <div className="flex-1 min-w-0">
                                 <div className="flex items-center gap-2 flex-wrap">
                                   <span className="text-xs font-black text-white">{t.user}</span>
                                   <span className="text-[10px] text-slate-600">• {t.shift}</span>
                                   {t.type === 'adjustment' && <span className="bg-yellow-500/15 text-yellow-400 border border-yellow-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded-full">AUDIT</span>}
                                   {t.type === 'expenditure' && <span className="bg-orange-500/15 text-orange-400 border border-orange-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded-full">PENGELUARAN</span>}
                                   {t.status === 'cancelled' && <span className="bg-red-500/15 text-red-400 border border-red-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded-full">BATAL</span>}
                                   {(t.status === 'pending_cancellation' || t.status === 'cancellation_requested') && <span className="bg-amber-500/15 text-amber-400 border border-amber-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">MINTA BATAL</span>}
                                   {t.closed && <span className="bg-slate-700 text-slate-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><FileCheck2 size={10}/> Closed</span>}
                                 </div>
                                 <p className="text-[10px] text-slate-500 italic truncate mt-0.5">{t.items?.map(it=>it.name).join(', ') || (t.type === 'adjustment' ? 'Penyesuaian Manual' : '-')}</p>
                                 {t.timestamp && <p className="text-[9px] text-slate-600 mt-0.5">{new Date(t.timestamp.seconds * 1000).toLocaleString('id-ID')}</p>}
                              </div>
                              <div className="text-right ml-2 shrink-0">
                                 <p className={`text-sm font-black ${t.status === 'cancelled' ? 'text-red-400 line-through' : t.type === 'expenditure' ? 'text-orange-400' : 'text-white'}`}>
                                   Rp {t.total?.toLocaleString()}
                                 </p>
                                 {!['adjustment', 'cancelled'].includes(t.status) && t.profit !== undefined && t.profit > 0 && (
                                    <span className="text-[10px] font-bold text-amber-400 italic block -mt-0.5 leading-tight">Laba: Rp {t.profit?.toLocaleString()}</span>
                                 )}
                                 {(t.status === 'pending_cancellation' || t.status === 'cancellation_requested') && (
                                   <div className="flex gap-1 mt-1 justify-end">
                                     <button onClick={(e) => { e.stopPropagation(); handleApproveCancellation(t); }} className="p-1 bg-emerald-500/15 text-emerald-400 rounded-lg hover:bg-emerald-500/25 transition-colors" title="Setujui"><Check size={14}/></button>
                                     <button onClick={(e) => { e.stopPropagation(); handleRejectCancellation(t.id); }} className="p-1 bg-red-500/15 text-red-400 rounded-lg hover:bg-red-500/25 transition-colors" title="Tolak"><X size={14}/></button>
                                   </div>
                                 )}
                              </div>
                           </div>
                        </div>
                     ))}
                     {filteredLogs.length === 0 && <p className="text-center text-slate-600 text-sm py-6 italic">Tidak ada transaksi ditemukan</p>}
                 </motion.div>
              )}
           </AnimatePresence>
        </div>
          </div>
        )}

        {/* ===================== MODAL: SUPER AUDIT WIZARD ===================== */}
        <AnimatePresence>
          {showAudit && (
            <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-2 sm:p-4 backdrop-blur-md overflow-y-auto">
              <motion.div initial={{scale:0.9, opacity:0}} animate={{scale:1, opacity:1}} exit={{scale:0.9, opacity:0}} className="bg-white w-full max-w-2xl rounded-[2.5rem] overflow-hidden shadow-2xl my-auto">
                <div className="p-6 bg-slate-900 text-white flex justify-between items-center">
                   <div className="flex items-center gap-3">
                      <ShieldCheck className="text-red-500" size={24}/>
                      <div>
                        <h3 className="font-black text-sm uppercase tracking-widest">Super Audit Mode</h3>
                        <p className="text-[10px] opacity-60 font-bold">Langkah {auditStep} dari 4</p>
                      </div>
                   </div>
                   <button onClick={()=>setShowAudit(false)} className="p-2 hover:bg-white/10 rounded-full"><X size={20}/></button>
                </div>

                <div className="p-6 overflow-y-auto max-h-[75vh]">
                   {auditStep === 1 && (
                     <div className="space-y-6">
                        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex gap-3 text-blue-700">
                           <AlertOctagon className="shrink-0" size={20}/>
                           <p className="text-xs font-bold">Langkah 1: Input saldo awal pagi ini (catatan manual kertas). Ini adalah titik nol audit Anda.</p>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                           <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase">Cash Awal</label>
                              <input type="number" className="w-full p-3 bg-slate-50 border rounded-xl font-bold" value={auditData.initialCash} onChange={e=>setAuditData({...auditData, initialCash: e.target.value})}/>
                           </div>
                           <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase">APK Awal</label>
                              <input type="number" className="w-full p-3 bg-slate-50 border rounded-xl font-bold" value={auditData.initialApk} onChange={e=>setAuditData({...auditData, initialApk: e.target.value})}/>
                           </div>
                           <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase">Bank Awal</label>
                              <input type="number" className="w-full p-3 bg-slate-50 border rounded-xl font-bold" value={auditData.initialSeabank} onChange={e=>setAuditData({...auditData, initialSeabank: e.target.value})}/>
                           </div>
                        </div>
                         <div className="space-y-3">
                           <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pengecekan Stok Awal Barang</p>
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {sortedStokProducts.map(p => (
                                <div key={p.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                                   <span className="text-[11px] font-black text-slate-700">{p.name}</span>
                                   <input type="number" className="w-16 p-1.5 bg-white border rounded-lg text-center font-bold text-xs" value={auditData.initialStocks[p.id] ?? p.stock} onChange={e=>setAuditData({...auditData, initialStocks: {...auditData.initialStocks, [p.id]: e.target.value}})}/>
                                </div>
                              ))}
                           </div>
                        </div>
                        <button onClick={()=>setAuditStep(2)} className="w-full py-4 bg-slate-900 text-white font-black rounded-2xl shadow-lg mt-4">Lanjut ke Transaksi Digital &gt;</button>
                     </div>
                   )}

                   {auditStep === 2 && (
                     <div className="space-y-6">
                        <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 flex gap-3 text-emerald-700">
                           <ClipboardList className="shrink-0" size={20}/>
                           <p className="text-xs font-bold">Langkah 2: Rekonstruksi Transaksi Digital. Masukkan semua TopUp/Tarik yang terjadi hari ini satu per satu.</p>
                        </div>
                        
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 grid grid-cols-2 sm:grid-cols-3 gap-3">
                           <input placeholder="Nama Transaksi" className="col-span-2 sm:col-span-1 p-2.5 border rounded-xl text-xs font-bold" value={auditFormTrans.name} onChange={e=>setAuditFormTrans({...auditFormTrans, name: e.target.value})}/>
                           <input type="number" placeholder="Nominal" className="p-2.5 border rounded-xl text-xs font-bold" value={auditFormTrans.nominal} onChange={e=>setAuditFormTrans({...auditFormTrans, nominal: e.target.value})}/>
                           <input type="number" placeholder="Fee" className="p-2.5 border rounded-xl text-xs font-bold" value={auditFormTrans.fee} onChange={e=>setAuditFormTrans({...auditFormTrans, fee: e.target.value})}/>
                           <input type="number" placeholder="Modal (Cost)" className="p-2.5 border rounded-xl text-xs font-bold" value={auditFormTrans.cost} onChange={e=>setAuditFormTrans({...auditFormTrans, cost: e.target.value})}/>
                           <select className="p-2.5 border rounded-xl text-xs font-bold" value={auditFormTrans.action} onChange={e=>setAuditFormTrans({...auditFormTrans, action: e.target.value})}>
                              <option value="isi">Isi Saldo (APK)</option>
                              <option value="transfer">Transfer (Bank)</option>
                              <option value="tarik">Tarik Tunai</option>
                           </select>
                           <button onClick={()=>{
                             if(!auditFormTrans.name || !auditFormTrans.nominal) return;
                             setAuditData({...auditData, digitalTrans: [...auditData.digitalTrans, { ...auditFormTrans, id: Date.now() }]});
                             setAuditFormTrans({ name: '', nominal: '', fee: '', cost: '', type: 'jasa', action: 'isi' });
                           }} className="bg-blue-600 text-white font-black rounded-xl text-xs">Tambah</button>
                        </div>

                        <div className="space-y-2 max-h-48 overflow-y-auto border-t pt-4">
                           {auditData.digitalTrans.map(t => (
                             <div key={t.id} className="flex justify-between items-center p-3 bg-white border rounded-xl shadow-sm">
                                <div>
                                   <p className="text-xs font-black">{t.name} <span className="text-[10px] text-blue-500 font-bold">({t.action})</span></p>
                                   <p className="text-[10px] text-slate-400">Nom: {Number(t.nominal).toLocaleString()} | Fee: {Number(t.fee).toLocaleString()}</p>
                                </div>
                                <button onClick={()=>setAuditData({...auditData, digitalTrans: auditData.digitalTrans.filter(x=>x.id!==t.id)})} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14}/></button>
                             </div>
                           ))}
                           {auditData.digitalTrans.length === 0 && <p className="text-center text-slate-400 text-xs italic">Belum ada transaksi diinput</p>}
                        </div>

                        <div className="flex gap-3 mt-6">
                           <button onClick={()=>setAuditStep(1)} className="flex-1 py-4 bg-slate-100 text-slate-600 font-black rounded-2xl">&lt; Kembali</button>
                           <button onClick={()=>setAuditStep(3)} className="flex-1 py-4 bg-slate-900 text-white font-black rounded-2xl shadow-lg text-sm">Lanjut ke Stok Fisik &gt;</button>
                        </div>
                     </div>
                   )}

                   {auditStep === 3 && (
                     <div className="space-y-6">
                        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 flex gap-3 text-amber-700">
                           <Package className="shrink-0" size={20}/>
                           <p className="text-xs font-bold">Langkah 3: Audit Stok Fisik. Masukkan stok tambahan yang masuk hari ini (Restock) dan stok nyata di rak saat ini.</p>
                        </div>
                        
                        <div className="space-y-4">
                           {sortedStokProducts.map(p => {
                             const adj = auditData.physicalAdjustments[p.id] || { added: 0, end: 0 };
                             return (
                               <div key={p.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                                  <div className="flex justify-between items-center mb-3">
                                     <p className="text-xs font-black text-slate-800">{p.name}</p>
                                     <span className="text-[10px] font-bold text-slate-400">Awal: {auditData.initialStocks[p.id] ?? p.stock}</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                     <div>
                                        <label className="text-[10px] font-black text-blue-500 uppercase">Stok Tambahan (Hari Ini)</label>
                                        <input type="number" className="w-full p-2 bg-white border border-blue-100 rounded-xl font-bold text-sm" placeholder="0" value={adj.added} onChange={e=>setAuditData({...auditData, physicalAdjustments: {...auditData.physicalAdjustments, [p.id]: { ...adj, added: e.target.value }}})}/>
                                     </div>
                                     <div>
                                        <label className="text-[10px] font-black text-red-500 uppercase">Stok Nyata Akhir</label>
                                        <input type="number" className="w-full p-2 bg-white border border-red-100 rounded-xl font-bold text-sm" placeholder="Sisa di rak" value={adj.end} onChange={e=>setAuditData({...auditData, physicalAdjustments: {...auditData.physicalAdjustments, [p.id]: { ...adj, end: e.target.value }}})}/>
                                     </div>
                                  </div>
                               </div>
                             );
                           })}
                        </div>

                        <div className="flex gap-3 mt-6">
                           <button onClick={()=>setAuditStep(2)} className="flex-1 py-4 bg-slate-100 text-slate-600 font-black rounded-2xl">&lt; Kembali</button>
                           <button onClick={()=>setAuditStep(4)} className="flex-1 py-4 bg-red-600 text-white font-black rounded-2xl shadow-lg text-sm">Review Hasil Audit &gt;</button>
                        </div>
                     </div>
                   )}

                   {auditStep === 4 && (
                     <div className="space-y-6">
                        <div className="bg-red-50 p-4 rounded-2xl border border-red-100 flex gap-3 text-red-700 text-center justify-center">
                           <AlertOctagon className="shrink-0" size={20}/>
                           <p className="text-xs font-black uppercase">Final Review: Rekapitulasi Manual</p>
                        </div>
                        
                        <div className="bg-slate-900 rounded-[2rem] p-6 text-white space-y-4">
                           <div className="flex justify-between items-center border-b border-white/10 pb-3">
                              <span className="text-[10px] font-black uppercase opacity-60">Estimasi Saldo Kas</span>
                              <span className="text-xl font-black">
                                 Rp {(
                                   Number(auditData.initialCash) + 
                                   auditData.digitalTrans.reduce((acc, t) => acc + (t.action !== 'tarik' ? (Number(t.nominal)+Number(t.fee)) : -Number(t.nominal)), 0) +
                                   products.filter(p=>p.type==='stok').reduce((acc, p) => {
                                      const s = Number(auditData.initialStocks[p.id] || p.stock);
                                      const adj = auditData.physicalAdjustments[p.id] || { added: 0, end: 0 };
                                      return acc + (Math.max(0, (s + Number(adj.added)) - Number(adj.end)) * p.price);
                                   }, 0)
                                 ).toLocaleString()}
                              </span>
                           </div>
                           <div className="flex justify-between items-center border-b border-white/10 pb-3">
                              <span className="text-[10px] font-black uppercase opacity-60">Estimasi Saldo APK</span>
                              <span className="text-xl font-black text-emerald-400">
                                 Rp {(Number(auditData.initialApk) - auditData.digitalTrans.reduce((acc, t) => acc + (t.action === 'isi' ? Number(t.cost || t.nominal) : 0), 0)).toLocaleString()}
                              </span>
                           </div>
                           <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black uppercase opacity-60">Estimasi Saldo Bank</span>
                              <span className="text-xl font-black text-blue-400">
                                 Rp {(
                                   Number(auditData.initialSeabank) + 
                                   auditData.digitalTrans.reduce((acc, t) => acc + (t.action === 'tarik' ? (Number(t.nominal)+Number(t.fee)) : t.action === 'transfer' ? -Number(t.cost||t.nominal) : 0), 0)
                                 ).toLocaleString()}
                              </span>
                           </div>
                        </div>

                        <div className="bg-amber-50 p-4 rounded-xl text-[10px] font-bold text-amber-600 text-center">
                           Catatan: Melakukan Konfirmasi akan mengubah status transaksi hari ini menjadi VOID dan memperbarui seluruh saldo & stok secara paksa ke nilai di atas.
                        </div>

                        <div className="flex gap-3 mt-6">
                           <button onClick={()=>setAuditStep(3)} className="flex-1 py-4 bg-slate-100 text-slate-600 font-black rounded-2xl">&lt; Edit Lagi</button>
                           <button disabled={loadingAudit} onClick={handleCommitAudit} className="flex-1 py-4 bg-red-600 text-white font-black rounded-2xl shadow-lg shadow-red-500/30 flex items-center justify-center gap-2">
                              {loadingAudit ? <Loader2 className="animate-spin" size={18}/> : <ShieldCheck size={18}/>} Konfirmasi & Overwrite
                           </button>
                        </div>
                     </div>
                   )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

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
                        {selectedClosing.physicalSales && selectedClosing.physicalSales.length > 0 && (
                          <div className="p-4 bg-orange-50 rounded-2xl border border-dashed border-orange-200">
                             <p className="text-[10px] uppercase font-black text-orange-400 mb-2 tracking-widest text-center">Penjualan Produk Fisik Terekam</p>
                             <div className="space-y-2 max-h-32 overflow-y-auto">
                               {selectedClosing.physicalSales.map((s, i) => (
                                 <div key={i} className="flex flex-col border-b border-orange-100 pb-1 last:border-0 last:pb-0">
                                    <div className="flex justify-between text-[11px] font-medium">
                                      <span className="text-slate-700 truncate flex-1 font-bold">{s.name} <span className="text-orange-500 bg-orange-100 px-1 rounded ml-1">x{s.sold}</span></span>
                                      <span className="text-orange-600 font-black ml-2">Rp {s.revenue?.toLocaleString()}</span>
                                    </div>
                                    <span className="text-[9px] text-orange-400 italic">Laba: Rp {s.profit?.toLocaleString()}</span>
                                 </div>
                               ))}
                             </div>
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
                        <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-3">
                           <button 
                              onClick={() => setSelectedClosing(null)}
                              className="py-3 px-4 bg-slate-100 text-slate-500 font-bold rounded-2xl hover:bg-slate-200 transition-all text-xs"
                           >
                              Tutup Detail
                           </button>
                           <button 
                              onClick={() => handleReopenShift(selectedClosing)}
                              className="py-3 px-4 bg-red-50 text-red-600 font-bold rounded-2xl hover:bg-red-100 transition-all text-xs flex items-center justify-center gap-2"
                           >
                              <History size={14}/> Buka Kembali Sesi
                           </button>
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
      
      {/* AI Chat Assistant 
      <AiChat 
        transactions={transactions} 
        products={products} 
        balances={balances} 
        closings={closings} 
      />
      */}
      </div>
    </div>
  );
}
