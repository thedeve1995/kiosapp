import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, limit, query } from 'firebase/firestore';

export default function Login() {
  const setUser = useStore(state => state.setUser);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [noUsers, setNoUsers] = useState(false);

  useEffect(() => {
    const checkUsers = async () => {
      const q = query(collection(db, 'users'), limit(1));
      const snap = await getDocs(q);
      console.log("Debug: Users found in DB?", !snap.empty);
      if (snap.empty) setNoUsers(true);
    };
    checkUsers();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErr('');
    try {
      // Real Firebase Call
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const userDocRef = doc(db, 'users', cred.user.uid);
      const docSnap = await getDoc(userDocRef);
      if (docSnap.exists()) {
        setUser({ uid: cred.user.uid, email: cred.user.email, ...docSnap.data() });
        navigate('/');
      } else {
        setErr('User role not found');
      }
    } catch (error) {
       if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
          setErr('Email atau Password salah.');
       } else {
          setErr(error.message);
       }
    } finally {
       setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute -top-16 -right-16 w-32 h-32 bg-blue-500 rounded-full blur-3xl opacity-20"></div>
        <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-emerald-500 rounded-full blur-3xl opacity-20"></div>

        <div className="relative z-10">
          <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Kios<span className="text-blue-600">App</span></h1>
          <p className="text-slate-500 mb-8 font-medium">Masuk untuk memulai shift</p>
          
          {err && <div className="bg-red-50 text-red-600 p-3 rounded-xl mb-4 text-sm font-semibold">{err}</div>}
          
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                placeholder="employee@kios.com"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                placeholder="••••••••"
              />
            </div>
            <button
              disabled={loading}
              className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-70 disabled:active:scale-100 flex justify-center shadow-lg shadow-blue-600/20"
            >
              {loading ? 'Masuk...' : 'Masuk'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100">
             {noUsers ? (
               <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 text-center">
                  <p className="text-xs text-blue-600 font-bold mb-3 italic">Sistem terdeteksi baru / kosong.</p>
                  <button 
                    onClick={() => navigate('/setup-owner')}
                    className="w-full bg-slate-900 text-white text-xs font-black py-2.5 rounded-lg hover:bg-slate-800 transition-all uppercase tracking-widest"
                  >
                    Daftar Owner Utama
                  </button>
               </div>
             ) : (
               <p className="text-[10px] text-slate-400 text-center font-bold uppercase tracking-tighter opacity-60">
                 Kiosk Management System v1.0
               </p>
             )}
          </div>
        </div>
      </div>
    </div>
  );
}
