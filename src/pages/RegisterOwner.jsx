import { useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, collection, getDocs, limit, query, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Loader2 } from 'lucide-react';

export default function RegisterOwner() {
  const [form, setForm] = useState({ name: '', email: '', password: '', whatsapp: '' });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [exists, setExists] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkUsers = async () => {
      const q = query(collection(db, 'users'), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) setExists(true);
      setChecking(false);
    };
    checkUsers();
  }, []);

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: form.name,
        email: form.email,
        whatsapp: form.whatsapp,
        role: 'owner',
        createdAt: serverTimestamp()
      });
      alert("Owner Berhasil Didaftarkan! Silakan Login.");
      navigate('/login');
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  if (checking) return <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white font-bold tracking-widest animate-pulse">MEMERIKSA SISTEM...</div>;

  if (exists) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 text-center">
       <div className="max-w-md bg-white p-8 rounded-3xl shadow-2xl">
          <ShieldCheck size={64} className="mx-auto text-red-500 mb-4" />
          <h2 className="text-2xl font-black text-slate-800 mb-2">Akses Dilarang</h2>
          <p className="text-slate-500 font-medium leading-relaxed">Sistem sudah memiliki Owner utama. Untuk menambah user, silakan minta Owner saat ini mendaftarkan Anda via Dashboard Admin.</p>
          <button onClick={() => navigate('/login')} className="mt-8 bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800">Kembali ke Login</button>
       </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl">
        <h1 className="text-3xl font-black text-slate-900 mb-2 italic">SETUP <span className="text-blue-600">OWNER</span></h1>
        <p className="text-slate-500 mb-8 font-medium">Langkah pertama: Daftarkan akun Owner Anda.</p>
        
        <form onSubmit={handleRegister} className="space-y-4">
          <input
            type="text" required placeholder="Nama Lengkap Owner"
            value={form.name} onChange={e => setForm({...form, name: e.target.value})}
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="email" required placeholder="Email Login"
            value={form.email} onChange={e => setForm({...form, email: e.target.value})}
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500"
          />
          <div>
            <input
              type="text" required placeholder="No. WhatsApp Owner (Contoh: 628123...)"
              value={form.whatsapp} onChange={e => setForm({...form, whatsapp: e.target.value})}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[10px] text-slate-400 mt-1 ml-1">* Nomor ini akan menjadi tujuan pengiriman laporan closing shift.</p>
          </div>
          <input
            type="password" required placeholder="Kata Sandi (Min. 6 Karakter)"
            value={form.password} onChange={e => setForm({...form, password: e.target.value})}
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500"
          />
          <button
            disabled={loading}
            className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/30 hover:bg-blue-700 transition-all flex justify-center items-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" /> : 'Selesaikan Registrasi Owner'}
          </button>
        </form>
      </div>
    </div>
  );
}
