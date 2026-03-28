import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { ShoppingCart, Plus, Minus, X, Trash2, Wallet, History, Clock, AlertOctagon, Loader2, ShoppingBag, FileCheck2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../lib/firebase';
import { collection, onSnapshot, doc, writeBatch, addDoc, serverTimestamp, setDoc, query, where, updateDoc } from 'firebase/firestore';

export default function POS() {
  const { cart, addToCart, updateCartQty, removeFromCart, clearCart } = useStore();
  const [activeCategory, setActiveCategory] = useState('Semua');
  const [cartOpen, setCartOpen] = useState(false);
  const [jasaModal, setJasaModal] = useState(null); // { item, nominal, fee }
  const [products, setProducts] = useState([]);
  
  // Ambil kategori unik secara dinamis dari database produk
  const categories = ['Semua', ...new Set(products.map(p => p.category))].filter(Boolean);
  const [balances, setBalances] = useState({ apk: 0, seabank: 0, cash: 0 });
  const [showConfirm, setShowConfirm] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shiftLogs, setShiftLogs] = useState([]);
  const [loadingCancel, setLoadingCancel] = useState(null);
  const [restockModal, setRestockModal] = useState(null); 
  const [restockForm, setRestockForm] = useState({ qty: '', totalCost: '' });
  const { shift, user } = useStore();

  // Sync Global Balances
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'balances', 'current'), (d) => {
      if (d.exists()) setBalances(d.data());
      else setDoc(doc(db, 'balances', 'current'), { apk: 5000000, seabank: 5000000, cash: 1000000 }); // Default initial
    });
    return () => unsub();
  }, []);

  // Sync to Firestore Products
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'products'), (snapshot) => {
      if (!snapshot.empty) {
        setProducts(snapshot.docs.map(doc => ({ firebaseId: doc.id, ...doc.data() })));
      } else {
        setProducts([]);
      }
    }, (err) => console.error(err));
    return () => unsub();
  }, []);

  // Sync Shift Logs for Employee History
  useEffect(() => {
    if (!user) return;
    const today = new Date();
    today.setHours(0,0,0,0);
    const q = query(collection(db, 'transactions'), where('shift', '==', shift));
    
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      const filtered = data.filter(t => {
        const tDate = t.timestamp ? new Date(t.timestamp.seconds * 1000) : new Date();
        return tDate >= today;
      });
      setShiftLogs(filtered.sort((a,b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
    });
    return () => unsub();
  }, [user, shift]);

  const handleRequestCancellation = async (log) => {
    const reason = window.prompt("Alasan pembatalan:");
    if (!reason) return;

    setLoadingCancel(log.id);
    try {
      await updateDoc(doc(db, 'transactions', log.id), {
        status: 'cancellation_requested',
        cancellationReason: reason,
        requestedAt: serverTimestamp()
      });
      alert("Permintaan pembatalan telah dikirim ke Owner.");
    } catch (e) {
      console.error(e);
      alert("Gagal mengirim permintaan.");
    } finally {
      setLoadingCancel(null);
    }
  };

  const filteredProducts = activeCategory === 'Semua' 
    ? products 
    : products.filter(p => p.category === activeCategory);

  const totalCart = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

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
    const feeNum = parseFloat(fee) || 0;
    
    if (item.action === 'transfer' && nominalNum > balances.seabank) {
       return alert("Saldo Seabank tidak cukup!");
    }

    const cartItem = {
      ...item,
      id: `${item.id}-${Date.now()}`,
      nominal: nominalNum,
      fee: feeNum,
      feePaidVia: item.action === 'tarik' ? feePaidVia : 'transfer',
      price: (nominalNum + feeNum),
      costPrice: parseFloat(jasaModal.costPrice) || nominalNum,
    };
    addToCart(cartItem);
    setJasaModal(null);
  };

  const handleRestock = async (e) => {
    e.preventDefault();
    if (!restockModal || !restockForm.qty || !restockForm.totalCost) return;

    const qty = parseInt(restockForm.qty);
    const cost = parseFloat(restockForm.totalCost);

    if (cost > (balances.cash || 0)) {
       return alert("Gagal: Kas tidak mencukupi untuk belanja stok ini!");
    }

    try {
      const batch = writeBatch(db);
      const productRef = doc(db, 'products', restockModal.firebaseId);
      batch.update(productRef, {
        stock: (restockModal.stock || 0) + qty
      });

      const balanceRef = doc(db, 'balances', 'current');
      batch.update(balanceRef, {
        cash: (balances.cash || 0) - cost
      });

      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        type: 'expenditure',
        status: 'success',
        user: user.name,
        shift,
        total: cost,
        timestamp: serverTimestamp(),
        items: [{
          name: `Belanja: ${restockModal.name}`,
          qty,
          price: cost / qty,
          total: cost,
          action: 'restock'
        }],
        profit: -cost 
      });

      await batch.commit();
      alert(`Berhasil restock ${qty} ${restockModal.name}!`);
      setRestockModal(null);
      setRestockForm({ qty: '', totalCost: '' });
    } catch (e) {
      alert("Error: " + e.message);
    }
  };

  const handleCheckout = async () => {
    if(cart.length === 0) return;
    try {
      const transactionData = {
        items: cart.map(it => ({ ...it, total: (it.price * (it.qty || 1)) })),
        total: totalCart,
        profit: cart.reduce((sum, it) => sum + ((it.price - (it.costPrice || it.price)) * (it.qty || 1)), 0),
        timestamp: serverTimestamp(),
        shift: shift || 'Unknown',
        user: user?.name || 'Unknown User',
        status: 'success'
      };
      
      const batch = writeBatch(db);
      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, transactionData);
      
      const balanceRef = doc(db, 'balances', 'current');
      
      let newApk = balances.apk || 0;
      let newSeabank = balances.seabank || 0;
      let newCash = balances.cash || 0;

      cart.forEach(item => {
        const q = item.qty || 1;
        const totalFee = (item.fee || 0) * q;
        const totalNominal = (item.nominal || 0) * q;

        if (item.action === 'tarik') {
           // Jika Arik Tunai: 
           // 1. Kas Keluar (Nominal yang ditarik)
           // 2. TAPI Jika Fee dibayar Cash, maka Kas masuk (Fee)
           const cashEffect = totalNominal - (item.feePaidVia === 'cash' ? totalFee : 0);
           newCash -= cashEffect;
        } else {
           // Selain Tarik (Top Up dll): Pelanggan kasih CASH seluas 'price' (nominal + fee)
           newCash += (item.price * q);
        }

        if (item.type === 'jasa' || item.type === 'saldo') {
          if (item.action === 'transfer') {
            newSeabank -= (item.costPrice * q); 
          } else if (item.action === 'tarik') {
            // Jika Tarik Tunai: Uang masuk ke Bank sesuai nominal + fee (jika via transfer)
            const bankReceived = totalNominal + (item.feePaidVia === 'transfer' ? totalFee : 0);
            newSeabank += bankReceived;
          } else {
            newApk -= (item.costPrice * q); 
          }
        }

        if (item.type === 'stok' && item.firebaseId) {
          const productRef = doc(db, 'products', item.firebaseId);
          batch.update(productRef, { stock: (item.stock || 0) - q });
        }
      });

      batch.update(balanceRef, { apk: newApk, seabank: newSeabank, cash: newCash });
      await batch.commit();

      alert(`Pembayaran Berhasil! \nSaldo Terpotong Otomatis.`);
      clearCart();
      setCartOpen(false);
      setShowConfirm(false);
    } catch (e) {
      console.error(e);
      alert("Gagal menyimpan transaksi.");
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 relative pb-24">
      
      {/* Header Section */}
      <div className="bg-white px-6 py-4 flex flex-col gap-1 border-b">
         <h1 className="text-2xl font-black text-slate-900 tracking-tight">Kios POS</h1>
         <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 rounded-md">
               <Clock size={12} className="text-blue-500" />
               <span>Shift {shift}</span>
            </div>
            <span>•</span>
            <span className="text-slate-300 italic">User: {user?.name}</span>
         </div>
      </div>

      {/* Real-time Balances Widget */}
      <div className="px-6 py-4 bg-slate-50 flex items-center justify-between gap-4">
        <div className="flex gap-3 overflow-x-auto no-scrollbar scroll-smooth">
          <div className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-2xl shadow-sm border border-slate-100 shrink-0">
             <div className="w-2.5 h-2.5 rounded-full bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.4)]"></div>
             <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5 leading-none">Kas</p>
                <p className="text-sm font-black text-slate-900 leading-none">Rp {(balances.cash || 0).toLocaleString()}</p>
             </div>
          </div>
          <div className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-2xl shadow-sm border border-slate-100 shrink-0">
             <div className="w-2.5 h-2.5 rounded-full bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.4)]"></div>
             <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5 leading-none">APK</p>
                <p className="text-sm font-black text-slate-900 leading-none">Rp {balances.apk.toLocaleString()}</p>
             </div>
          </div>
          <div className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-2xl shadow-sm border border-slate-100 shrink-0">
             <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.4)]"></div>
             <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-0.5 leading-none">Bank</p>
                <p className="text-sm font-black text-slate-900 leading-none">Rp {balances.seabank.toLocaleString()}</p>
             </div>
          </div>
        </div>
        <button 
           onClick={() => setHistoryOpen(true)}
           className="w-12 h-12 flex items-center justify-center bg-white rounded-2xl text-slate-600 shadow-sm border border-slate-100 hover:text-blue-600 active:scale-90 transition-all relative shrink-0"
        >
          <History size={20} />
          {shiftLogs.length > 0 && (
             <span className="absolute -top-1 -right-1 bg-blue-600 text-white w-5 h-5 rounded-full border-2 border-slate-50 text-[9px] font-black flex items-center justify-center">
               {shiftLogs.length}
             </span>
          )}
        </button>
      </div>

      {/* Categories Horizontal Scroll */}
      <div className="bg-white border-b px-6 py-4 overflow-x-auto whitespace-nowrap sticky top-0 z-40 shadow-sm flex gap-3 no-scrollbar">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-6 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
              activeCategory === cat ? 'bg-slate-900 text-white shadow-lg' : 'bg-white text-slate-500 hover:bg-slate-50 border border-slate-100'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 flex-1 overflow-y-auto w-full max-w-7xl mx-auto">
        {filteredProducts.map(product => {
          const outOfStock = product.type === 'stok' && product.stock <= 0;
          return (
            <motion.div
              layout
              key={product.id || product.firebaseId}
              className={`group relative p-5 rounded-[2rem] flex flex-col justify-between bg-white border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 hover:border-blue-100 transition-all duration-300 h-52 overflow-hidden ${
                outOfStock ? 'opacity-60 grayscale' : ''
              }`}
            >
              {['jasa', 'saldo'].includes(product.type) && (
                <div className="absolute -right-6 -top-6 w-20 h-20 bg-blue-500 rounded-full opacity-10 group-hover:opacity-20 transition-opacity flex items-center justify-center pt-6 pl-6">
                  <Wallet size={32} className="text-blue-600"/>
                </div>
              )}
              
              <div className="z-10 w-full">
                <div className="flex justify-between items-start mb-3">
                   <span className={`text-[9px] uppercase font-black tracking-[0.15em] px-2.5 py-1 rounded-lg ${
                     product.type === 'stok' ? 'bg-emerald-50 text-emerald-600' :
                     product.type === 'jasa' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
                   }`}>
                     {product.type}
                   </span>
                   {product.type === 'stok' && (
                      <span className={`text-[10px] font-black ${product.stock <= 3 ? 'text-red-500' : 'text-slate-400'}`}>
                         Stok: {product.stock}
                      </span>
                   )}
                </div>
                <h3 className="font-black text-slate-800 text-sm sm:text-base leading-tight group-hover:text-blue-600 transition-colors">
                  {product.name}
                </h3>
              </div>

              <div className="z-10 mt-4 flex flex-col gap-3">
                <div className="flex flex-col">
                  {!['jasa', 'saldo'].includes(product.type) ? (
                    <p className="text-xl font-black text-slate-900 tracking-tight">Rp {product.price.toLocaleString()}</p>
                  ) : (
                    <p className="text-slate-400 font-bold text-xs italic">Input Nominal</p>
                  )}
                </div>
                
                <div className="flex gap-2">
                   <button 
                     disabled={outOfStock}
                     onClick={() => !outOfStock && handleProductClick(product)}
                     className="flex-1 bg-slate-900 text-white text-xs font-black py-3 rounded-xl hover:bg-blue-600 active:scale-95 transition-all shadow-md active:shadow-none uppercase tracking-wider"
                   >
                     {outOfStock ? 'Habis' : 'Pilih'}
                   </button>
                   {product.type === 'stok' && (
                     <button 
                       onClick={(e) => { e.stopPropagation(); setRestockModal(product); }}
                       className="w-10 bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center rounded-xl hover:bg-amber-500 hover:text-white transition-all shadow-sm active:shadow-none"
                       title="Restock Barang"
                     >
                       <Plus size={18} strokeWidth={3} />
                     </button>
                   )}
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Bottom Cart Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 z-40 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <button 
            onClick={() => setCartOpen(!cartOpen)}
            className="flex items-center gap-3 active:scale-95 transition-transform relative"
          >
            <div className="bg-blue-100 p-3 rounded-full relative">
              <ShoppingCart size={24} className="text-blue-600" />
              {cart.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold border-2 border-white">
                  {cart.reduce((s,i) => s + i.qty, 0)}
                </span>
              )}
            </div>
            <div className="text-left hidden xs:block">
              <p className="text-xs text-slate-500 font-semibold mb-0.5">Total Belanja</p>
              <p className="text-lg font-black text-slate-900 leading-none">Rp {totalCart.toLocaleString()}</p>
            </div>
          </button>
          <button 
            disabled={cart.length === 0}
            onClick={() => setShowConfirm(true)}
            className="bg-blue-600 text-white rounded-2xl px-8 py-4 font-bold disabled:bg-slate-300 disabled:text-slate-500 hover:bg-blue-700 active:scale-95 transition-all shadow-lg shadow-blue-600/30 text-lg"
          >
            Bayar
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowConfirm(false)} />
            <motion.div 
               initial={{ scale: 0.9, opacity: 0 }} 
               animate={{ scale: 1, opacity: 1 }} 
               exit={{ scale: 0.9, opacity: 0 }}
               className="bg-white rounded-[2.5rem] w-full max-w-sm p-8 z-10 shadow-2xl relative overflow-hidden"
            >
               <div className="text-center mb-6">
                 <div className="bg-blue-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600">
                    <Wallet size={32} />
                 </div>
                 <h3 className="text-2xl font-black text-slate-900">Konfirmasi Bayar</h3>
                 <p className="text-slate-500 font-medium">Cek kembali rincian belanja</p>
               </div>
               <div className="space-y-3 max-h-48 overflow-y-auto mb-6 px-2">
                  {cart.map((item, i) => (
                    <div key={i} className="flex justify-between items-center text-sm font-bold border-b border-slate-50 pb-2">
                       <span className="text-slate-600">{item.name} {item.qty > 1 ? `x${item.qty}` : ''}</span>
                       <span className="text-slate-900">Rp {item.price.toLocaleString()}</span>
                    </div>
                  ))}
               </div>
               <div className="bg-slate-900 rounded-3xl p-5 text-white mb-6">
                 <div className="flex justify-between items-center opacity-70 text-xs font-bold mb-1 uppercase tracking-widest">Total Tagihan</div>
                 <div className="text-3xl font-black italic tracking-tight">Rp {totalCart.toLocaleString()}</div>
               </div>
               <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setShowConfirm(false)} className="py-4 rounded-2xl font-bold text-slate-500 bg-slate-100 active:scale-95 transition-all">Batal</button>
                  <button onClick={handleCheckout} className="py-4 rounded-2xl font-bold text-white bg-blue-600 active:scale-95 transition-all shadow-lg shadow-blue-500/20">Proses</button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Cart Sliding Panel */}
      <AnimatePresence>
        {cartOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCartOpen(false)} className="fixed inset-0 bg-slate-900/40 z-50 backdrop-blur-sm" />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="fixed bottom-0 left-0 right-0 h-[80vh] bg-white rounded-t-[2.5rem] p-6 z-50 flex flex-col shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-black text-slate-900">Keranjang</h2>
                  <p className="text-slate-500 font-medium text-sm mt-1">{cart.reduce((s,i) => s + i.qty, 0)} items</p>
                </div>
                <button onClick={() => setCartOpen(false)} className="p-2 bg-slate-100 rounded-full"><X size={24} /></button>
              </div>
              <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-4">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                    <ShoppingCart size={48} className="mb-4 text-slate-200" />
                    <p className="font-semibold">Keranjang kosong</p>
                  </div>
                ) : (
                  cart.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="flex-1">
                        <p className="font-bold text-slate-800 text-[15px]">{item.name}</p>
                        {['jasa', 'saldo'].includes(item.type) && (
                          <p className="text-xs text-slate-500 font-semibold mt-1">
                            Nominal: {item.nominal.toLocaleString()} | Fee: {item.fee.toLocaleString()}
                          </p>
                        )}
                        <p className="text-blue-600 font-bold mt-1 text-sm text-[15px]">Rp {item.price.toLocaleString()}</p>
                      </div>
                      {item.type === 'stok' ? (
                        <div className="flex items-center gap-3 bg-white border rounded-full p-1 shadow-sm">
                          <button onClick={() => item.qty > 1 ? updateCartQty(item.id, item.qty - 1) : removeFromCart(item.id)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50 text-slate-600 hover:bg-red-50 hover:text-red-500">
                            {item.qty === 1 ? <Trash2 size={16} /> : <Minus size={16} />}
                          </button>
                          <span className="w-4 text-center font-bold text-sm">{item.qty}</span>
                          <button onClick={() => updateCartQty(item.id, item.qty + 1)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50 text-slate-600 hover:bg-blue-50 hover:text-blue-500">
                            <Plus size={16} />
                          </button>
                        </div>
                      ) : (
                         <div className="flex bg-white border rounded-full p-1 shadow-sm">
                            <button onClick={() => removeFromCart(item.id)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50 text-slate-600 hover:bg-red-50 hover:text-red-500">
                              <Trash2 size={16} />
                            </button>
                         </div>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="pt-6 border-t mt-4 mb-safe">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-slate-500 font-bold">Total</span>
                  <span className="text-2xl font-black text-slate-900">Rp {totalCart.toLocaleString()}</span>
                </div>
                <button disabled={cart.length === 0} onClick={handleCheckout} className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/30 disabled:opacity-50 text-lg hover:bg-blue-700 active:scale-[0.98] transition-all">
                  Konfirmasi Pembayaran
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Restock Modal */}
      <AnimatePresence>
        {restockModal && (
          <div className="fixed inset-0 bg-slate-900/60 z-[70] flex flex-col justify-end">
             <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="bg-white p-6 rounded-t-3xl shadow-2xl safe-area-bottom">
                <div className="flex justify-between items-center mb-6">
                   <h3 className="text-xl font-black text-slate-900">Belanja Stok: {restockModal.name}</h3>
                   <button onClick={() => setRestockModal(null)} className="p-2 bg-slate-100 rounded-full"><X size={20}/></button>
                </div>
                <form onSubmit={handleRestock} className="space-y-4 pb-4">
                   <div className="grid grid-cols-2 gap-4">
                      <div>
                         <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Jumlah Masuk</label>
                         <input type="number" required placeholder="Qty" className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-bold" value={restockForm.qty} onChange={e => setRestockForm({...restockForm, qty: e.target.value})} />
                      </div>
                      <div>
                         <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Total Biaya (Keluar Kas)</label>
                         <input type="number" required placeholder="Rp Total" className="w-full px-4 py-3 bg-slate-50 border rounded-xl font-bold" value={restockForm.totalCost} onChange={e => setRestockForm({...restockForm, totalCost: e.target.value})} />
                      </div>
                   </div>
                   <div className="bg-red-50 p-4 rounded-xl text-red-600 text-xs font-bold flex items-start gap-2">
                      <AlertOctagon size={18} className="shrink-0" />
                      <p>Perhatian: Aksi ini akan memotong saldo Kas Global sebesar Rp {(parseFloat(restockForm.totalCost) || 0).toLocaleString()} dan menambah stok barang.</p>
                   </div>
                   <button type="submit" className="w-full bg-slate-900 text-white font-black py-4 rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2">
                     <ShoppingBag size={20} /> Konfirmasi Belanja
                   </button>
                </form>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Jasa Input Modal */}
      <AnimatePresence>
        {jasaModal && (
          <div className="fixed inset-0 bg-slate-900/60 z-[60] flex flex-col justify-end">
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} className="bg-white p-6 rounded-t-3xl">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-black text-xl text-slate-900">{jasaModal.item.name}</h3>
                <button onClick={() => setJasaModal(null)} className="p-2 bg-slate-100 rounded-full"><X size={20} /></button>
              </div>
              <form onSubmit={submitJasa} className="space-y-4 pb-8">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Nominal (Rp)</label>
                  <input type="number" required autoFocus className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-lg" value={jasaModal.nominal} onChange={e => setJasaModal({...jasaModal, nominal: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Fee / Biaya (Rp)</label>
                  <input type="number" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-lg" value={jasaModal.fee} onChange={e => setJasaModal({...jasaModal, fee: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2 opacity-60">Harga Modal (OPSIONAL - Rp)</label>
                  <input type="number" placeholder={`Default: Rp ${jasaModal.nominal || 0}`} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-lg italic text-slate-500" value={jasaModal.costPrice} onChange={e => setJasaModal({...jasaModal, costPrice: e.target.value})} />
                </div>
                {jasaModal.item.action === 'tarik' && (
                  <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 space-y-3">
                     <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest text-center">Metode Pembayaran FEE / JASA</p>
                     <div className="flex gap-2">
                        {['transfer', 'cash'].map(met => (
                           <button 
                              key={met} type="button"
                              onClick={() => setJasaModal({...jasaModal, feePaidVia: met})}
                              className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest border transition-all ${
                                 jasaModal.feePaidVia === met ? 'bg-blue-600 text-white border-blue-600 shadow-lg' : 'bg-white text-slate-500 border-slate-200'
                              }`}
                           >
                              {met === 'transfer' ? 'Via Transfer' : 'Via Cash'}
                           </button>
                        ))}
                     </div>
                  </div>
                )}
                <button type="submit" className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl mt-4 text-lg">
                  Tambahkan ke Keranjang
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Shift Logs Side Drawer */}
      <AnimatePresence>
        {historyOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setHistoryOpen(false)} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[70]" />
            <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} className="fixed top-0 right-0 h-full w-full max-w-sm bg-slate-50 z-[80] shadow-2xl flex flex-col">
               <div className="p-6 bg-white border-b flex justify-between items-center shrink-0">
                  <div className="flex items-center gap-2">
                     <History size={20} className="text-blue-600" />
                     <h3 className="font-extrabold text-slate-800 tracking-tight">Riwayat Shift Anda</h3>
                  </div>
                  <button onClick={() => setHistoryOpen(false)} className="p-2 hover:bg-slate-100 rounded-full"><X size={24} /></button>
               </div>
               <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {shiftLogs.length === 0 ? (
                    <div className="text-center py-20 text-slate-400 text-xs italic">Belum ada transaksi di shift ini.</div>
                   ) : (
                    shiftLogs.map(log => (
                      <div key={log.id} className={`bg-white p-4 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden ${log.status === 'cancelled' ? 'opacity-50 grayscale' : ''}`}>
                         <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold">
                               <Clock size={12} />
                               {log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleTimeString('id-id', { hour: '2-digit', minute: '2-digit'}) : '...'}
                            </div>
                            <div className="flex gap-2">
                               {log.status === 'cancellation_requested' && (
                                 <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">Menunggu Batal</span>
                               )}
                               {log.status === 'cancelled' && (
                                 <span className="text-[9px] font-black text-red-600 bg-red-50 px-2 py-0.5 rounded uppercase tracking-widest">Dibatalkan</span>
                               )}
                               {(!log.status || log.status === 'success') && (
                                 <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded uppercase tracking-widest">Berhasil</span>
                               )}
                               {log.type === 'expenditure' && (
                                 <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded uppercase tracking-widest">Belanja</span>
                               )}
                               {log.closed && (
                                 <span className="text-[9px] font-black text-white bg-slate-900 px-2 py-0.5 rounded uppercase tracking-widest flex items-center gap-1 shadow-sm">
                                   <FileCheck2 size={10} /> Closed
                                 </span>
                               )}
                            </div>
                         </div>
                         <div className="space-y-1">
                            {log.items?.map((it, idx) => (
                                <div key={idx} className="flex justify-between text-xs font-bold text-slate-700">
                                   <span>{it.name} {it.qty > 1 ? `x${it.qty}` : ''} {it.action === 'tarik' ? '(Tarik)' : ''}</span>
                                   <span>{it.action === 'tarik' ? '-' : '+'}Rp {(it.total || (it.price * (it.qty || 1)) || 0).toLocaleString()}</span>
                                </div>
                            ))}
                         </div>
                         <div className="mt-3 pt-3 border-t flex justify-between items-center">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Sesi</span>
                            <span className={`font-black tracking-tight ${log.type === 'expenditure' ? 'text-red-500' : 'text-slate-900'}`}>
                               {log.type === 'expenditure' ? '-' : ''}Rp {(log.total || 0).toLocaleString()}
                            </span>
                         </div>
                         {(!log.status || log.status === 'success') && log.type !== 'expenditure' && (
                            <button 
                               onClick={() => handleRequestCancellation(log)}
                               className="w-full mt-3 py-2 bg-red-50 text-red-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-100 transition-colors"
                            >
                               Minta Pembatalan
                            </button>
                         )}
                      </div>
                    ))
                  )}
               </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
