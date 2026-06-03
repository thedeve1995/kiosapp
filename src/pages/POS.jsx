import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import {
  ShoppingCart, Plus, Minus, X, Trash2, Wallet, History, Clock,
  AlertOctagon, Loader2, ShoppingBag, Search, ClipboardList,
  Package, Zap, RefreshCw, ArrowDownToLine, CheckCircle2, ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../lib/firebase';
import { collection, onSnapshot, doc, writeBatch, addDoc, serverTimestamp, setDoc, query, where, updateDoc, increment } from 'firebase/firestore';

// === Helper Functions ===
function getItemProfit(item) {
  const q = item.qty || 1;
  if (item.action === 'tarik') return (item.fee || 0) * q;
  const cost = Number(item.costPrice) || 0;
  return cost > 0 ? (item.price - cost) * q : 0;
}

function getItemBalanceDeltas(item, paymentMethod) {
  const q = item.qty || 1;
  const fee = (item.fee || 0) * q;
  const nominal = (item.nominal || 0) * q;
  const price = item.price * q;
  const cost = (Number(item.costPrice) || 0) * q;
  let cash = 0, seabank = 0, apk = 0;

  if (paymentMethod !== 'kasbon') {
    if (item.action === 'tarik') {
      cash -= nominal;
      if (item.feePaidVia === 'cash') cash += fee;
    } else if (item.type === 'stok') {
      if (paymentMethod === 'transfer') seabank += price;
      else cash += price;
    } else {
      if (paymentMethod === 'transfer') seabank += price;
      else cash += price;
    }
  } else {
    if (item.action === 'tarik') cash -= nominal;
  }

  if (item.type === 'jasa' || item.type === 'saldo') {
    if (item.action === 'transfer') seabank -= cost;
    else if (item.action === 'tarik') {
      seabank += nominal + (paymentMethod !== 'kasbon' && item.feePaidVia === 'transfer' ? fee : 0);
    } else {
      apk -= cost;
    }
  }

  return { cash, seabank, apk };
}

// Type badge config
const TYPE_CONFIG = {
  jasa:  { label: 'Jasa',  bg: 'bg-blue-500/15',   text: 'text-blue-400',   border: 'border-blue-500/20' },
  saldo: { label: 'Saldo', bg: 'bg-violet-500/15',  text: 'text-violet-400', border: 'border-violet-500/20' },
  stok:  { label: 'Stok',  bg: 'bg-emerald-500/15', text: 'text-emerald-400',border: 'border-emerald-500/20' },
};

const CATEGORIES = [
  { id: 'semua', label: 'Semua' },
  { id: 'jasa',  label: 'Jasa' },
  { id: 'saldo', label: 'Saldo' },
  { id: 'stok',  label: 'Stok' },
];

export default function POS() {
  const { cart, addToCart, updateCartQty, removeFromCart, clearCart } = useStore();
  const [searchQuery, setSearchQuery]       = useState('');
  const [categoryFilter, setCategoryFilter] = useState('semua');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [cartOpen, setCartOpen]             = useState(false);
  const [jasaModal, setJasaModal]           = useState(null);
  const [products, setProducts]             = useState([]);
  const [balances, setBalances]             = useState({ apk: 0, seabank: 0, cash: 0 });
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [showConfirm, setShowConfirm]       = useState(false);
  const [historyOpen, setHistoryOpen]       = useState(false);
  const [shiftLogs, setShiftLogs]           = useState([]);
  const [loadingCancel, setLoadingCancel]   = useState(null);

  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('00:00');
  const [endDate, setEndDate]     = useState(new Date().toISOString().split('T')[0]);
  const [endTime, setEndTime]     = useState('23:59');

  const [belanjaModal, setBelanjaModal] = useState(false);
  const [belanjaForm, setBelanjaForm]   = useState({ name: '', total: '' });
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [kasbonName, setKasbonName]       = useState('');

  const [globalRestockModal, setGlobalRestockModal]   = useState(false);
  const [globalRestockForm, setGlobalRestockForm]     = useState({ productId: '', qty: '', totalCost: '' });

  const [kasbonModalOpen, setKasbonModalOpen] = useState(false);
  const [kasbonList, setKasbonList]           = useState([]);

  const { shift, user } = useStore();

  // Sync Global Balances
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'balances', 'current'), (d) => {
      if (d.exists()) setBalances(d.data());
      setBalanceLoading(false);
    });
    return () => unsub();
  }, [user]);

  // Sync Products
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'products'), (snapshot) => {
      if (!snapshot.empty) setProducts(snapshot.docs.map(doc => ({ firebaseId: doc.id, ...doc.data() })));
      else setProducts([]);
    }, (err) => console.error(err));
    return () => unsub();
  }, [user]);

  // Sync Kasbon List
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'transactions'), where('kasbonStatus', '==', 'belum_lunas'));
    const unsub = onSnapshot(q, (snap) => {
      setKasbonList(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    });
    return () => unsub();
  }, [user]);

  // Sync Transactions (history)
  useEffect(() => {
    if (!user) return;
    const start = new Date(`${startDate}T${startTime}`);
    const end   = new Date(`${endDate}T${endTime}`);
    const q = query(collection(db, 'transactions'), where('timestamp', '>=', start), where('timestamp', '<=', end));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      setShiftLogs(data.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    });
    return () => unsub();
  }, [user, startDate, startTime, endDate, endTime]);

  const handleRequestCancellation = async (log) => {
    const reason = window.prompt("Alasan pembatalan:");
    if (!reason) return;
    setLoadingCancel(log.id);
    try {
      await updateDoc(doc(db, 'transactions', log.id), { status: 'cancellation_requested', cancellationReason: reason, requestedAt: serverTimestamp() });
      alert("Permintaan pembatalan telah dikirim ke Owner.");
    } catch (e) { console.error(e); alert("Gagal mengirim permintaan."); }
    finally { setLoadingCancel(null); }
  };

  const handlePelunasan = async (kasbon) => {
    if (!window.confirm(`Terima pelunasan Kasbon Tunai Rp ${kasbon.total?.toLocaleString()} dari ${kasbon.kasbonName || 'Konsumen'}?`)) return;
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'balances', 'current'), { cash: increment(kasbon.total) });
      batch.set(doc(collection(db, 'transactions')), {
        type: 'pelunasan_kasbon', status: 'success', user: user.name, shift, total: kasbon.total,
        timestamp: serverTimestamp(), kasbonLunasId: kasbon.id,
        items: [{ name: `Pelunasan Piutang: ${kasbon.kasbonName}`, action: 'pelunasan_kasbon', qty: 1, price: kasbon.total, total: kasbon.total }],
        profit: 0
      });
      batch.update(doc(db, 'transactions', kasbon.id), { kasbonStatus: 'lunas', pelunasanShift: shift, pelunasanUser: user.name, dipelunasiPada: serverTimestamp() });
      await batch.commit();
      alert("Pelunasan berhasil diproses!");
      if (kasbonList.length === 1) setKasbonModalOpen(false);
    } catch (e) { alert("Error: " + e.message); }
  };

  const filteredProducts = products
    .filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter(p => categoryFilter === 'semua' || p.type === categoryFilter)
    .sort((a, b) => {
      if (a.type < b.type) return -1;
      if (a.type > b.type) return 1;
      return a.name.localeCompare(b.name);
    });

  const totalCart   = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const totalQty    = cart.reduce((s, i) => s + i.qty, 0);

  const handleProductClick = (product) => {
    if (['jasa', 'saldo'].includes(product.type)) {
      setJasaModal({ item: product, nominal: '', fee: '', costPrice: '', feePaidVia: 'transfer' });
    } else {
      addToCart(product);
    }
  };

  const submitJasa = (e) => {
    e.preventDefault();
    if (!jasaModal) return;
    const { item, nominal, fee, feePaidVia } = jasaModal;
    const nominalNum = parseFloat(nominal) || 0;
    const feeNum     = parseFloat(fee) || 0;
    if (item.action === 'transfer' && nominalNum > balances.seabank) return alert("Saldo Seabank tidak cukup!");
    const cartItem = {
      ...item,
      id: `${item.id}-${Date.now()}`,
      nominal: nominalNum, fee: feeNum,
      feePaidVia: item.action === 'tarik' ? feePaidVia : 'transfer',
      price: (nominalNum + feeNum),
      costPrice: parseFloat(jasaModal.costPrice) || parseFloat(item.costPrice) || nominalNum,
    };
    addToCart(cartItem);
    setJasaModal(null);
  };

  const handleGlobalRestock = async (e) => {
    e.preventDefault();
    const { productId, qty, totalCost } = globalRestockForm;
    if (!productId || !qty || !totalCost) return;
    const product = products.find(p => p.firebaseId === productId);
    if (!product) return;
    const qtyNum = parseInt(qty);
    const cost   = parseFloat(totalCost);
    if (cost > (balances.cash || 0)) return alert("Gagal: Kas tidak mencukupi!");
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'products', productId), { stock: increment(qtyNum) });
      batch.update(doc(db, 'balances', 'current'), { cash: increment(-cost) });
      batch.set(doc(collection(db, 'transactions')), {
        type: 'expenditure', status: 'success', user: user.name, shift, total: cost, timestamp: serverTimestamp(),
        items: [{ name: `Restock: ${product.name}`, qty: qtyNum, price: cost / qtyNum, total: cost, action: 'restock', firebaseId: productId, type: 'stok' }],
        profit: -cost
      });
      await batch.commit();
      alert(`Berhasil restock ${qtyNum} ${product.name}!`);
      setGlobalRestockModal(false);
      setGlobalRestockForm({ productId: '', qty: '', totalCost: '' });
    } catch (e) { alert("Error: " + e.message); }
  };

  const submitBelanja = async (e) => {
    e.preventDefault();
    if (!belanjaForm.total || isNaN(belanjaForm.total)) return;
    const cost = parseFloat(belanjaForm.total);
    if (cost > (balances.cash || 0)) return alert("Gagal: Kas tidak mencukupi!");
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'balances', 'current'), { cash: increment(-cost) });
      batch.set(doc(collection(db, 'transactions')), {
        type: 'expenditure', status: 'success', user: user.name, shift, total: cost, timestamp: serverTimestamp(),
        items: [{ name: belanjaForm.name, qty: 1, price: cost, total: cost, action: 'belanja' }],
        profit: -cost
      });
      await batch.commit();
      alert(`Berhasil mencatat ${belanjaForm.name} sebesar Rp ${cost.toLocaleString()}!`);
      setBelanjaModal(false);
      setBelanjaForm({ name: '', total: '' });
    } catch (e) { alert("Error: " + e.message); }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    try {
      const totalProfit = cart.reduce((sum, it) => sum + getItemProfit(it), 0);
      let deltas = cart.reduce((acc, item) => {
        const d = getItemBalanceDeltas(item, paymentMethod);
        return { cash: acc.cash + d.cash, seabank: acc.seabank + d.seabank, apk: acc.apk + d.apk };
      }, { cash: 0, seabank: 0, apk: 0 });

      const transactionData = {
        items: cart.map(it => ({ ...it, total: it.price * (it.qty || 1) })),
        total: totalCart, profit: totalProfit,
        timestamp: serverTimestamp(), shift: shift || '', user: user?.name || '',
        paymentMethod,
        kasbonName: paymentMethod === 'kasbon' ? kasbonName : null,
        kasbonStatus: paymentMethod === 'kasbon' ? 'belum_lunas' : null,
        status: 'success'
      };

      const batch = writeBatch(db);
      batch.set(doc(collection(db, 'transactions')), transactionData);
      batch.update(doc(db, 'balances', 'current'), { cash: increment(deltas.cash), seabank: increment(deltas.seabank), apk: increment(deltas.apk) });
      cart.forEach(item => {
        if (item.type === 'stok' && item.firebaseId) {
          batch.update(doc(db, 'products', item.firebaseId), { stock: increment(-(item.qty || 1)) });
        }
      });
      await batch.commit();

      const methodLabel = paymentMethod === 'transfer' ? 'Transfer Bank' : paymentMethod === 'kasbon' ? 'Kasbon/Hutang' : 'Tunai';
      alert(`Pembayaran Berhasil!\nMetode: ${methodLabel}.`);
      clearCart(); setCartOpen(false); setShowConfirm(false); setPaymentMethod('cash'); setKasbonName('');
    } catch (e) { console.error(e); alert("Gagal menyimpan transaksi."); }
  };

  // =========================== JSX ===========================
  return (
    <div className="flex flex-col bg-slate-900 min-h-full">

      {/* ── Sticky Balance + Actions Bar ── */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800/80 px-4 py-3">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {/* Balance pills */}
          {[
            { label: 'Kas', value: balances.cash, dot: 'bg-amber-400', glow: 'shadow-amber-500/20' },
            { label: 'APK', value: balances.apk,  dot: 'bg-blue-400',  glow: 'shadow-blue-500/20' },
            { label: 'Bank',value: balances.seabank,dot:'bg-emerald-400',glow:'shadow-emerald-500/20'},
          ].map(b => (
            <div key={b.label} className={`flex items-center gap-2 bg-slate-800 border border-slate-700/50 rounded-xl px-3 py-2 shrink-0 shadow-md ${b.glow}`}>
              <div className={`w-2 h-2 rounded-full ${b.dot}`} />
              <div>
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none">{b.label}</p>
                <p className="text-xs font-black text-white leading-none mt-0.5">
                  {balanceLoading ? <span className="text-slate-600">...</span> : `Rp ${(b.value || 0).toLocaleString()}`}
                </p>
              </div>
            </div>
          ))}

          <div className="w-px h-6 bg-slate-700 shrink-0 mx-1" />

          {/* Action icon buttons */}
          <button onClick={() => setKasbonModalOpen(true)} className="relative w-10 h-10 shrink-0 rounded-xl bg-slate-800 border border-slate-700/50 flex items-center justify-center text-amber-400 hover:border-amber-500/40 hover:bg-amber-500/10 transition-all active:scale-90">
            <ClipboardList size={17} />
            {kasbonList.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center border-2 border-slate-900">{kasbonList.length}</span>}
          </button>

          <button onClick={() => setHistoryOpen(true)} className="relative w-10 h-10 shrink-0 rounded-xl bg-slate-800 border border-slate-700/50 flex items-center justify-center text-slate-400 hover:border-indigo-500/40 hover:text-indigo-400 hover:bg-indigo-500/10 transition-all active:scale-90">
            <History size={17} />
            {shiftLogs.length > 0 && <span className="absolute -top-1 -right-1 bg-indigo-600 text-white w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center border-2 border-slate-900">{shiftLogs.length}</span>}
          </button>

          <button onClick={() => setGlobalRestockModal(true)} className="w-10 h-10 shrink-0 rounded-xl bg-slate-800 border border-slate-700/50 flex items-center justify-center text-slate-400 hover:border-blue-500/40 hover:text-blue-400 hover:bg-blue-500/10 transition-all active:scale-90">
            <Package size={17} />
          </button>

          <button onClick={() => setBelanjaModal(true)} className="w-10 h-10 shrink-0 rounded-xl bg-slate-800 border border-slate-700/50 flex items-center justify-center text-slate-400 hover:border-orange-500/40 hover:text-orange-400 hover:bg-orange-500/10 transition-all active:scale-90">
            <ShoppingBag size={17} />
          </button>
        </div>
      </div>

      {/* ── Search + Category Filter ── */}
      <div className="bg-slate-900 px-4 pt-3 pb-2 border-b border-slate-800/50">
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            placeholder="Cari produk..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-slate-800/80 border border-slate-700/50 rounded-xl pl-10 pr-9 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all font-medium"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-300">
              <X size={15} />
            </button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`px-4 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-all ${
                categoryFilter === cat.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/25'
                  : 'bg-slate-800 text-slate-500 border border-slate-700/50 hover:text-slate-300'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Product Grid ── */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 flex-1" style={{ paddingBottom: '80px' }}>

        {/* Special: Input Stok Masuk */}
        {searchQuery === '' && categoryFilter === 'semua' && (
          <motion.div layout onClick={() => setGlobalRestockModal(true)}
            className="group relative bg-slate-800 border border-slate-700/50 rounded-2xl p-4 flex flex-col justify-between h-44 overflow-hidden cursor-pointer hover:border-blue-500/40 hover:shadow-lg hover:shadow-blue-500/10 transition-all duration-300"
          >
            <div className="absolute -right-4 -top-4 w-16 h-16 bg-blue-500/10 rounded-full group-hover:bg-blue-500/20 transition-all" />
            <div>
              <span className="text-[9px] uppercase font-black tracking-widest px-2 py-0.5 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/20">Input Stok</span>
              <h3 className="font-black text-white text-sm mt-2 leading-tight group-hover:text-blue-400 transition-colors">Stok Masuk</h3>
              <p className="text-[10px] text-slate-600 font-bold mt-1">Galon, Rokok, dll</p>
            </div>
            <button className="w-full bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black py-2 rounded-xl transition-all uppercase tracking-wider">
              Pilih Barang
            </button>
          </motion.div>
        )}

        {/* Special: Belanja Voucher */}
        {searchQuery === '' && categoryFilter === 'semua' && (
          <motion.div layout onClick={() => setBelanjaModal(true)}
            className="group relative bg-slate-800 border border-slate-700/50 rounded-2xl p-4 flex flex-col justify-between h-44 overflow-hidden cursor-pointer hover:border-orange-500/40 hover:shadow-lg hover:shadow-orange-500/10 transition-all duration-300"
          >
            <div className="absolute -right-4 -top-4 w-16 h-16 bg-orange-500/10 rounded-full group-hover:bg-orange-500/20 transition-all" />
            <div>
              <span className="text-[9px] uppercase font-black tracking-widest px-2 py-0.5 rounded-lg bg-orange-500/15 text-orange-400 border border-orange-500/20">Pengeluaran</span>
              <h3 className="font-black text-white text-sm mt-2 leading-tight group-hover:text-orange-400 transition-colors">Belanja Voucher</h3>
              <p className="text-[10px] text-slate-600 font-bold mt-1">Potong Kas Fisik</p>
            </div>
            <button className="w-full bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-black py-2 rounded-xl transition-all uppercase tracking-wider">
              Input Biaya
            </button>
          </motion.div>
        )}

        {/* Product Cards */}
        {filteredProducts.map(product => {
          const cfg = TYPE_CONFIG[product.type] || TYPE_CONFIG.stok;
          const inCart = cart.find(c => c.firebaseId === product.firebaseId);
          return (
            <motion.div
              layout
              key={product.id || product.firebaseId}
              className="group relative bg-slate-800 border border-slate-700/50 rounded-2xl p-4 flex flex-col justify-between h-44 overflow-hidden hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-500/10 transition-all duration-300 cursor-pointer"
              onClick={() => handleProductClick(product)}
            >
              <div className="absolute -right-3 -top-3 w-12 h-12 bg-indigo-500/5 rounded-full group-hover:bg-indigo-500/15 transition-all" />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[9px] uppercase font-black tracking-widest px-2 py-0.5 rounded-lg ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                    {cfg.label}
                  </span>
                  {product.type === 'stok' && product.stock !== undefined && (
                    <span className={`text-[9px] font-black ${product.stock <= 2 ? 'text-red-400' : 'text-slate-600'}`}>
                      stok: {product.stock}
                    </span>
                  )}
                </div>
                <h3 className="font-black text-white text-xs sm:text-sm leading-tight group-hover:text-indigo-300 transition-colors line-clamp-2">
                  {product.name}
                </h3>
              </div>
              <div>
                {!['jasa', 'saldo'].includes(product.type) ? (
                  <p className="text-indigo-400 font-black text-base tracking-tight mb-2">
                    Rp {product.price.toLocaleString()}
                  </p>
                ) : (
                  <p className="text-slate-600 font-bold text-xs italic mb-2">Input Nominal</p>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleProductClick(product); }}
                  className="w-full bg-slate-700 hover:bg-indigo-600 text-slate-300 hover:text-white text-[10px] font-black py-2 rounded-xl transition-all uppercase tracking-wider active:scale-95"
                >
                  {inCart ? `✓ Pilih lagi` : 'Pilih / Jual'}
                </button>
              </div>
            </motion.div>
          );
        })}

        {filteredProducts.length === 0 && searchQuery !== '' && (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-600">
            <Search size={36} className="mb-3 text-slate-700" />
            <p className="font-bold text-sm">Produk "{searchQuery}" tidak ditemukan</p>
          </div>
        )}
      </div>

      {/* ── Fixed Bottom Cart Bar ── */}
      <div className="fixed bottom-[60px] left-0 right-0 bg-slate-900/95 backdrop-blur border-t border-slate-800/80 px-4 py-3 z-30">
        <div className="flex items-center gap-3 max-w-7xl mx-auto">
          <button
            onClick={() => setCartOpen(!cartOpen)}
            className="flex-1 flex items-center gap-3 bg-slate-800 hover:bg-slate-700 border border-slate-700/50 hover:border-indigo-500/30 rounded-2xl px-4 py-2.5 transition-all active:scale-[0.98] relative"
          >
            <div className="relative">
              <ShoppingCart size={20} className="text-indigo-400" />
              {totalQty > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[9px] w-4 h-4 rounded-full font-black flex items-center justify-center border border-slate-900">
                  {totalQty}
                </span>
              )}
            </div>
            <div className="text-left">
              <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest leading-none">Total Belanja</p>
              <p className="text-sm font-black text-white leading-none mt-0.5">Rp {totalCart.toLocaleString()}</p>
            </div>
            <ChevronRight size={16} className="text-slate-600 ml-auto" />
          </button>
          <button
            disabled={cart.length === 0}
            onClick={() => setShowConfirm(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-black px-7 py-3 rounded-2xl disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/25 transition-all active:scale-95 text-sm"
          >
            Bayar
          </button>
        </div>
      </div>

      {/* ═══════════ MODALS ═══════════ */}

      {/* Payment Confirmation Modal */}
      <AnimatePresence>
        {showConfirm && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowConfirm(false)} />
            <motion.div initial={{ y: 40, opacity: 0, scale: 0.95 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 40, opacity: 0 }} className="relative w-full max-w-sm bg-slate-800 border border-slate-700/50 rounded-3xl p-6 shadow-2xl z-10 max-h-[90vh] overflow-y-auto">
              <div className="text-center mb-5">
                <div className="w-14 h-14 bg-indigo-500/15 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Wallet size={28} className="text-indigo-400" />
                </div>
                <h3 className="text-xl font-black text-white">Konfirmasi Bayar</h3>
                <p className="text-slate-500 text-sm mt-1">Cek kembali rincian transaksi</p>
              </div>

              {/* Cart items */}
              <div className="space-y-2 max-h-40 overflow-y-auto mb-5 -mx-1 px-1">
                {cart.map((item, i) => (
                  <div key={i} className="flex justify-between items-center text-sm font-bold py-2 border-b border-slate-700/50">
                    <span className="text-slate-300 text-xs">{item.name} {item.qty > 1 ? `×${item.qty}` : ''}</span>
                    <span className="text-white">Rp {(item.price * item.qty).toLocaleString()}</span>
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="bg-slate-900 rounded-2xl p-4 mb-5 border border-slate-700/50">
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Total Tagihan</p>
                <p className="text-3xl font-black text-white">Rp {totalCart.toLocaleString()}</p>
              </div>

              {/* Payment method */}
              <div className="mb-5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest text-center mb-3">Metode Pembayaran</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'cash',     emoji: '💵', label: 'Tunai',    active: 'bg-slate-100 text-slate-900 border-slate-100' },
                    { id: 'transfer', emoji: '🏦', label: 'Transfer', active: 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-500/30' },
                    { id: 'kasbon',   emoji: '📝', label: 'Kasbon',   active: 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/30' },
                  ].map(m => (
                    <button key={m.id} onClick={() => setPaymentMethod(m.id)}
                      className={`py-2.5 rounded-xl text-xs font-black border transition-all ${paymentMethod === m.id ? m.active : 'bg-slate-900 text-slate-500 border-slate-700 hover:border-slate-600'}`}>
                      {m.emoji} {m.label}
                    </button>
                  ))}
                </div>
                {paymentMethod === 'transfer' && (
                  <p className="text-[11px] text-indigo-400 font-bold text-center mt-2">Saldo Bank akan bertambah</p>
                )}
                {paymentMethod === 'kasbon' && (
                  <div className="mt-3">
                    <input
                      type="text" required autoFocus
                      className="w-full px-4 py-3 bg-slate-900 border border-amber-500/40 rounded-xl text-white text-sm font-bold placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"
                      placeholder="Nama penghutang..."
                      value={kasbonName}
                      onChange={e => setKasbonName(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setShowConfirm(false)} className="py-3.5 rounded-2xl font-bold text-slate-400 bg-slate-700/50 hover:bg-slate-700 active:scale-95 transition-all">Batal</button>
                <button
                  onClick={handleCheckout}
                  disabled={paymentMethod === 'kasbon' && !kasbonName}
                  className={`py-3.5 rounded-2xl font-bold text-white active:scale-95 transition-all shadow-lg disabled:opacity-40 ${
                    paymentMethod === 'transfer' ? 'bg-indigo-600 shadow-indigo-500/20' : paymentMethod === 'kasbon' ? 'bg-amber-500 shadow-amber-500/20' : 'bg-slate-100 text-slate-900 shadow-slate-500/10'
                  }`}
                >
                  Proses
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Cart Panel */}
      <AnimatePresence>
        {cartOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCartOpen(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 220 }}
              className="fixed bottom-0 left-0 right-0 h-[78vh] bg-slate-800 rounded-t-3xl p-6 z-50 flex flex-col border-t border-slate-700/50 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-5">
                <div>
                  <h2 className="text-xl font-black text-white">Keranjang</h2>
                  <p className="text-slate-500 text-xs font-bold mt-0.5">{totalQty} item</p>
                </div>
                <button onClick={() => setCartOpen(false)} className="w-9 h-9 rounded-xl bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 -mx-1 px-1">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-slate-600">
                    <ShoppingCart size={40} className="mb-3 text-slate-700" />
                    <p className="font-bold text-sm">Keranjang kosong</p>
                  </div>
                ) : cart.map(item => (
                  <div key={item.id} className="flex items-center justify-between p-3.5 bg-slate-900/60 rounded-2xl border border-slate-700/50">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-white text-sm truncate">{item.name}</p>
                      {['jasa', 'saldo'].includes(item.type) && (
                        <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                          Nominal: {item.nominal?.toLocaleString()} | Fee: {item.fee?.toLocaleString()}
                        </p>
                      )}
                      <p className="text-indigo-400 font-black text-sm mt-0.5">Rp {item.price.toLocaleString()}</p>
                    </div>
                    {item.type === 'stok' ? (
                      <div className="flex items-center gap-2 bg-slate-800 border border-slate-700/50 rounded-xl p-1 ml-3 shrink-0">
                        <button onClick={() => item.qty > 1 ? updateCartQty(item.id, item.qty - 1) : removeFromCart(item.id)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-700 text-slate-300 hover:bg-red-500/20 hover:text-red-400 transition-all">
                          {item.qty === 1 ? <Trash2 size={13} /> : <Minus size={13} />}
                        </button>
                        <span className="w-5 text-center font-black text-white text-sm">{item.qty}</span>
                        <button onClick={() => updateCartQty(item.id, item.qty + 1)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-700 text-slate-300 hover:bg-indigo-500/20 hover:text-indigo-400 transition-all">
                          <Plus size={13} />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => removeFromCart(item.id)} className="ml-3 w-8 h-8 flex items-center justify-center rounded-xl bg-slate-700 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-all shrink-0">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-slate-700/50 mt-4">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-slate-400 font-bold text-sm">Total</span>
                  <span className="text-2xl font-black text-white">Rp {totalCart.toLocaleString()}</span>
                </div>
                <button
                  disabled={cart.length === 0}
                  onClick={() => { setCartOpen(false); setShowConfirm(true); }}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-500/25 disabled:opacity-40 text-sm active:scale-[0.98] transition-all"
                >
                  Lanjut ke Pembayaran →
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Global Restock Modal */}
      <AnimatePresence>
        {globalRestockModal && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setGlobalRestockModal(false)} />
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} className="relative w-full max-w-sm bg-slate-800 border border-slate-700/50 rounded-3xl p-6 shadow-2xl z-10">
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-lg font-black text-white flex items-center gap-2"><Package size={20} className="text-blue-400" /> Input Stok Masuk</h3>
                <button onClick={() => setGlobalRestockModal(false)} className="w-8 h-8 rounded-xl bg-slate-700 flex items-center justify-center text-slate-400"><X size={16} /></button>
              </div>
              <form onSubmit={handleGlobalRestock} className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Pilih Produk</label>
                  <select className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm font-medium focus:outline-none focus:border-indigo-500" value={globalRestockForm.productId} onChange={e => setGlobalRestockForm({...globalRestockForm, productId: e.target.value})}>
                    <option value="">-- Pilih Produk --</option>
                    {products.filter(p => p.type === 'stok').map(p => <option key={p.firebaseId} value={p.firebaseId}>{p.name} (Stok: {p.stock})</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Jumlah</label>
                    <input type="number" min="1" className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm font-bold focus:outline-none focus:border-indigo-500" placeholder="0" value={globalRestockForm.qty} onChange={e => setGlobalRestockForm({...globalRestockForm, qty: e.target.value})} />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Total Modal (Rp)</label>
                    <input type="number" min="0" className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm font-bold focus:outline-none focus:border-indigo-500" placeholder="0" value={globalRestockForm.totalCost} onChange={e => setGlobalRestockForm({...globalRestockForm, totalCost: e.target.value})} />
                  </div>
                </div>
                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl transition-all">Simpan Restock</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Belanja / Voucher Modal */}
      <AnimatePresence>
        {belanjaModal && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setBelanjaModal(false)} />
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} className="relative w-full max-w-sm bg-slate-800 border border-slate-700/50 rounded-3xl p-6 shadow-2xl z-10">
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-lg font-black text-white flex items-center gap-2"><ShoppingBag size={20} className="text-orange-400" /> Catat Pengeluaran</h3>
                <button onClick={() => setBelanjaModal(false)} className="w-8 h-8 rounded-xl bg-slate-700 flex items-center justify-center text-slate-400"><X size={16} /></button>
              </div>
              <form onSubmit={submitBelanja} className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Keterangan</label>
                  <input type="text" required className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm font-medium focus:outline-none focus:border-orange-500" placeholder="Beli voucher Telkomsel..." value={belanjaForm.name} onChange={e => setBelanjaForm({...belanjaForm, name: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Total (Rp)</label>
                  <input type="number" required min="1" className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-lg font-black text-center focus:outline-none focus:border-orange-500" placeholder="0" value={belanjaForm.total} onChange={e => setBelanjaForm({...belanjaForm, total: e.target.value})} />
                </div>
                <button type="submit" className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-3.5 rounded-xl transition-all">Catat Pengeluaran</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Jasa / Saldo Modal */}
      <AnimatePresence>
        {jasaModal && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setJasaModal(null)} />
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} className="relative w-full max-w-sm bg-slate-800 border border-slate-700/50 rounded-3xl p-6 shadow-2xl z-10">
              <div className="flex justify-between items-center mb-2">
                <div>
                  <h3 className="text-lg font-black text-white">{jasaModal.item.name}</h3>
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{jasaModal.item.action || jasaModal.item.type}</span>
                </div>
                <button onClick={() => setJasaModal(null)} className="w-8 h-8 rounded-xl bg-slate-700 flex items-center justify-center text-slate-400"><X size={16} /></button>
              </div>
              <form onSubmit={submitJasa} className="space-y-4 mt-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Nominal (Rp)</label>
                  <input type="number" autoFocus required min="1" className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-lg font-black text-center focus:outline-none focus:border-indigo-500" placeholder="0" value={jasaModal.nominal} onChange={e => setJasaModal({...jasaModal, nominal: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Fee / Biaya (Rp)</label>
                  <input type="number" min="0" className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-lg font-black text-center focus:outline-none focus:border-indigo-500" placeholder="0" value={jasaModal.fee} onChange={e => setJasaModal({...jasaModal, fee: e.target.value})} />
                </div>
                {jasaModal.item.action === 'tarik' && (
                  <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1.5">Fee dibayar via</label>
                    <div className="grid grid-cols-2 gap-2">
                      {['cash', 'transfer'].map(m => (
                        <button key={m} type="button" onClick={() => setJasaModal({...jasaModal, feePaidVia: m})}
                          className={`py-2.5 rounded-xl text-xs font-black border transition-all ${jasaModal.feePaidVia === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-900 text-slate-500 border-slate-700'}`}>
                          {m === 'cash' ? '💵 Cash' : '🏦 Transfer'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {jasaModal.nominal && (
                  <div className="bg-slate-900 rounded-xl p-3 border border-slate-700/50 text-center">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Total ke Pelanggan</p>
                    <p className="text-xl font-black text-indigo-400">
                      Rp {((parseFloat(jasaModal.nominal)||0) + (parseFloat(jasaModal.fee)||0)).toLocaleString()}
                    </p>
                  </div>
                )}
                <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl transition-all">Tambah ke Keranjang</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Kasbon Modal */}
      <AnimatePresence>
        {kasbonModalOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setKasbonModalOpen(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28 }}
              className="fixed bottom-0 left-0 right-0 max-h-[75vh] bg-slate-800 rounded-t-3xl p-6 z-50 flex flex-col border-t border-slate-700/50"
            >
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-xl font-black text-white flex items-center gap-2">
                  <ClipboardList size={22} className="text-amber-400" /> Daftar Kasbon
                  <span className="bg-red-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center ml-1">{kasbonList.length}</span>
                </h2>
                <button onClick={() => setKasbonModalOpen(false)} className="w-9 h-9 rounded-xl bg-slate-700 flex items-center justify-center text-slate-400"><X size={20} /></button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3">
                {kasbonList.length === 0 ? (
                  <p className="text-center text-slate-600 text-sm py-10 italic">Tidak ada kasbon aktif</p>
                ) : kasbonList.map(k => (
                  <div key={k.id} className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700/50 flex justify-between items-center gap-3">
                    <div>
                      <p className="font-black text-white text-sm">{k.kasbonName || 'Konsumen'}</p>
                      <p className="text-amber-400 font-black text-base mt-0.5">Rp {k.total?.toLocaleString()}</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">{k.timestamp ? new Date(k.timestamp.seconds * 1000).toLocaleDateString('id-ID') : '-'}</p>
                    </div>
                    <button onClick={() => handlePelunasan(k)} className="shrink-0 px-4 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-black transition-all active:scale-95">
                      <CheckCircle2 size={14} className="inline mr-1" />Lunas
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* History Drawer */}
      <AnimatePresence>
        {historyOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHistoryOpen(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28 }}
              className="fixed bottom-0 left-0 right-0 h-[85vh] bg-slate-800 rounded-t-3xl p-5 z-50 flex flex-col border-t border-slate-700/50"
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-black text-white flex items-center gap-2"><History size={22} className="text-indigo-400" /> Riwayat</h2>
                <button onClick={() => setHistoryOpen(false)} className="w-9 h-9 rounded-xl bg-slate-700 flex items-center justify-center text-slate-400"><X size={20} /></button>
              </div>
              {/* Date filter */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { label: 'Dari', date: startDate, setDate: setStartDate, time: startTime, setTime: setStartTime },
                  { label: 'Sampai', date: endDate, setDate: setEndDate, time: endTime, setTime: setEndTime },
                ].map(f => (
                  <div key={f.label} className="bg-slate-900/60 rounded-xl p-2 border border-slate-700/50">
                    <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-1">{f.label}</p>
                    <input type="date" value={f.date} onChange={e => f.setDate(e.target.value)} className="w-full bg-transparent text-white text-[11px] font-bold focus:outline-none" />
                    <input type="time" value={f.time} onChange={e => f.setTime(e.target.value)} className="w-full bg-transparent text-slate-400 text-[11px] focus:outline-none" />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-2">{shiftLogs.length} Transaksi</p>
              <div className="flex-1 overflow-y-auto space-y-2">
                {shiftLogs.length === 0 ? (
                  <p className="text-center text-slate-600 text-sm py-10 italic">Belum ada transaksi</p>
                ) : shiftLogs.map(log => (
                  <div key={log.id} className="bg-slate-900/60 rounded-xl px-4 py-3 border border-slate-700/50 flex justify-between items-center gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[9px] text-slate-500 font-bold">
                          {log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                        </span>
                        {log.status === 'cancellation_requested' && <span className="text-[8px] font-black bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full">Req. Batal</span>}
                      </div>
                      <p className="text-xs font-bold text-white truncate">{log.items?.map(it => it.name).join(', ')}</p>
                    </div>
                    <div className="text-right shrink-0 flex flex-col items-end gap-1">
                      <p className={`font-black text-sm ${log.type === 'expenditure' || log.items?.[0]?.action === 'tarik' ? 'text-red-400' : 'text-white'}`}>
                        Rp {(log.total || 0).toLocaleString()}
                      </p>
                      {log.status !== 'cancellation_requested' && log.type !== 'expenditure' && (
                        <button
                          disabled={loadingCancel === log.id}
                          onClick={() => handleRequestCancellation(log)}
                          className="text-[9px] font-black text-slate-600 hover:text-red-400 transition-colors"
                        >
                          {loadingCancel === log.id ? '...' : 'Batal?'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
