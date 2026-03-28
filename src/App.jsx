import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import Login from './pages/Login';
import POS from './pages/POS';
import Closing from './pages/Closing';
import AdminDashboard from './pages/AdminDashboard';
import Layout from './components/Layout';
import RegisterOwner from './pages/RegisterOwner';
import { useEffect } from 'react';

// Shift detection logic
const getShiftByTime = () => {
  const h = new Date().getHours();
  const m = new Date().getMinutes();
  const time = h + m / 60;
  
  if (time >= 6.5 && time < 8.5) return "Pagi (06:30 - 08:30)";
  if (time >= 8.5 && time < 16.5) return "Siang (08:30 - 16:30)";
  if (time >= 16.5 && time < 21.5) return "Malam (16:30 - 21:30)";
  return "Tutup";
};

// Simple protection wrapper
const OwnerOnly = ({ children }) => {
  const user = useStore(state => state.user);
  if (user?.role !== 'owner') return <Navigate to="/" />;
  return children;
};

function App() {
  const user = useStore(state => state.user);
  const setShift = useStore(state => state.setShift);

  useEffect(() => {
    // Keep shift updated
    const shift = getShiftByTime();
    setShift(shift);
    const interval = setInterval(() => {
      setShift(getShiftByTime());
    }, 60000);
    return () => clearInterval(interval);
  }, [setShift]);

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
