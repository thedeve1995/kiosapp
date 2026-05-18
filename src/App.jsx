import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import Login from './pages/Login';
import POS from './pages/POS';
import Closing from './pages/Closing';
import AdminDashboard from './pages/AdminDashboard';
import Layout from './components/Layout';
import RegisterOwner from './pages/RegisterOwner';
import { useEffect, useState } from 'react';
import { auth, db } from './lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';


// Simple protection wrapper
const OwnerOnly = ({ children }) => {
  const user = useStore(state => state.user);
  if (user?.role !== 'owner') return <Navigate to="/" />;
  return children;
};

function App() {
  const user = useStore(state => state.user);
  const setUser = useStore(state => state.setUser);
  const setShift = useStore(state => state.setShift);
  const [loading, setLoading] = useState(true);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const handleUpdate = () => setUpdateAvailable(true);
    window.addEventListener('swUpdateAvailable', handleUpdate);
    return () => window.removeEventListener('swUpdateAvailable', handleUpdate);
  }, []);

  const handleRefresh = () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(reg => {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          } else {
            // Fallback for safety
            window.location.reload();
          }
        });
      });
    } else {
      window.location.reload();
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        if (!user || user.uid !== firebaseUser.uid) {
          try {
            const docSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
            if (docSnap.exists()) {
              setUser({ uid: firebaseUser.uid, email: firebaseUser.email, ...docSnap.data() });
            }
          } catch (e) {
            console.error("Auth Sync Error:", e);
          }
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsub();
  }, [user, setUser]);

  useEffect(() => {
    // Set shift only when user is available, stay static during the session
    if (user) {
      setShift(`Sesi ${user.name}`);
    } else {
      setShift(null);
    }
  }, [user, setShift]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-slate-400 font-bold animate-pulse tracking-widest uppercase text-xs">Menghubungkan...</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <AnimatePresence>
        {updateAvailable && (
          <motion.div 
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-4 left-4 right-4 z-[9999] flex justify-center"
          >
            <div className="bg-slate-900/90 backdrop-blur-xl border border-white/20 px-6 py-4 rounded-[2rem] shadow-2xl flex items-center gap-4 max-w-xl text-white">
              <div className="bg-blue-600 p-2 rounded-full ring-4 ring-blue-500/20">
                <Sparkles size={20}/>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-black uppercase tracking-widest italic">Versi Baru Tersedia!</h4>
                <p className="text-[10px] opacity-70 font-bold">Fitur & perbaikan terbaru sudah siap digunakan.</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setUpdateAvailable(false)}
                  className="px-4 py-2 text-[10px] uppercase font-black tracking-widest bg-white/5 hover:bg-white/10 rounded-2xl transition-all"
                >
                  Nanti Saja
                </button>
                <button 
                  onClick={handleRefresh}
                  className="px-6 py-2 text-[10px] uppercase font-black tracking-widest bg-blue-600 hover:bg-blue-700 rounded-2xl shadow-lg shadow-blue-500/30 flex items-center gap-2 transition-all"
                >
                  <RefreshCw size={14} className="animate-spin-slow" /> Perbarui Sekarang
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <BrowserRouter>
      <Routes>
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
        <Route path="/setup-owner" element={<RegisterOwner />} />
        
        <Route element={user ? <Layout /> : <Navigate to="/login" />}>
          <Route path="/" element={<POS />} />
          <Route path="/closing" element={<Closing />} />
          <Route path="/admin" element={<OwnerOnly><AdminDashboard /></OwnerOnly>} />
        </Route>
      </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
