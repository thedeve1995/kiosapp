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

// Shift detection logic
const getShiftByTime = () => {
  const date = new Date();
  const day = date.getDay(); // 0 is Sunday, 6 is Saturday
  const time = date.getHours() + date.getMinutes() / 60;
  
  if (day === 6) { // Sabtu
    if (time >= 6.5 && time < 8.5) return "Pagi (06:30 - 08:30)";
    if (time >= 8.5 && time < 15) return "Siang (08:30 - 15:00)";
    if (time >= 15 && time < 20) return "Malam (15:00 - 20:00)";
    return "Tutup";
  } else if (day === 0) { // Minggu
    if (time >= 8.5 && time < 14) return "Siang (08:30 - 14:00)";
    if (time >= 14 && time < 22) return "Malam (14:00 - 22:00)";
    return "Tutup";
  } else { // Senin - Jumat
    if (time >= 6.5 && time < 8.5) return "Pagi (06:30 - 08:30)";
    if (time >= 8.5 && time < 16.5) return "Siang (08:30 - 16:30)";
    if (time >= 16.5 && time < 21.5) return "Malam (16:30 - 21:30)";
    return "Tutup";
  }
};

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
    // Keep shift updated
    const shift = getShiftByTime();
    setShift(shift);
    const interval = setInterval(() => {
      setShift(getShiftByTime());
    }, 60000);
    return () => clearInterval(interval);
  }, [setShift]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-slate-400 font-bold animate-pulse tracking-widest uppercase text-xs">Menghubungkan...</p>
      </div>
    );
  }

  return (
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
  );
}

export default App;
