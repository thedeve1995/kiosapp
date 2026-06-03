import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, limit, query } from 'firebase/firestore';
import { Eye, EyeOff, Store, Loader2, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Login() {
  const setUser = useStore(state => state.setUser);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [noUsers, setNoUsers] = useState(false);

  useEffect(() => {
    const checkUsers = async () => {
      try {
        const q = query(collection(db, 'users'), limit(1));
        const snap = await getDocs(q);
        if (snap.empty) setNoUsers(true);
      } catch (err) {
        console.warn("checkUsers failed:", err.message);
      }
    };
    checkUsers();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErr('');
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const docSnap = await getDoc(doc(db, 'users', cred.user.uid));
      if (docSnap.exists()) {
        setUser({ uid: cred.user.uid, email: cred.user.email, ...docSnap.data() });
        navigate('/');
      } else {
        setErr('Role pengguna tidak ditemukan.');
      }
    } catch (error) {
      console.error("Login Error:", error);
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setErr('Email atau Password salah.');
      } else if (error.message.includes('Missing or insufficient permissions')) {
        setErr('Akses ditolak oleh sistem keamanan. Hubungi Owner.');
      } else {
        setErr(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-48 -left-48 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-48 -right-48 w-96 h-96 bg-violet-700/15 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-64 h-64 bg-indigo-900/20 rounded-full blur-3xl" />
        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.015]" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-sm relative z-10"
      >
        {/* Logo area */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl mb-4 shadow-xl shadow-indigo-500/30"
          >
            <Store size={30} className="text-white" />
          </motion.div>
          <h1 className="text-3xl font-black text-white tracking-tight">
            Kios<span className="text-indigo-400">App</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1.5 font-medium">Sistem Manajemen Kios</p>
        </div>

        {/* Login Card */}
        <div className="bg-slate-800/60 backdrop-blur-xl border border-slate-700/50 rounded-3xl p-6 shadow-2xl shadow-black/40">
          {/* Error message */}
          {err && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-xl mb-4 text-sm font-semibold"
            >
              {err}
            </motion.div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900/80 border border-slate-700 rounded-xl text-white placeholder-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium text-sm"
                placeholder="email@kios.com"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-900/80 border border-slate-700 rounded-xl text-white placeholder-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium text-sm pr-12"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-600 hover:text-slate-300 transition-colors rounded-lg"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 rounded-xl transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 text-sm"
            >
              {loading ? (
                <><Loader2 size={18} className="animate-spin" /> Masuk...</>
              ) : (
                <>Masuk <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          {/* Setup owner */}
          {noUsers && (
            <div className="mt-5 pt-5 border-t border-slate-700/50">
              <div className="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-2xl text-center">
                <p className="text-xs text-indigo-400 font-bold mb-3 italic">Sistem terdeteksi baru / kosong.</p>
                <button
                  onClick={() => navigate('/setup-owner')}
                  className="w-full bg-slate-700 hover:bg-slate-600 text-white text-xs font-black py-2.5 rounded-xl transition-all uppercase tracking-widest"
                >
                  Daftar Owner Utama
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-slate-700 text-[10px] font-bold uppercase tracking-widest mt-6">
          Kiosk Management System v1.0
        </p>
      </motion.div>
    </div>
  );
}
