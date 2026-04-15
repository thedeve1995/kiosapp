import { Outlet, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { LogOut, Home, KeyRound, Menu } from 'lucide-react';
import { useState } from 'react';
import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';

export default function Layout() {
  const { user, shift, setUser } = useStore();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b px-4 py-3 flex justify-between items-center sticky top-0 z-50 shadow-sm">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Kios App
          </h1>
          <p className="text-xs text-slate-500 font-medium">Shift: {shift}</p>
        </div>
        
        <div className="flex items-center gap-3 relative">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold">{user?.name}</p>
            <p className="text-xs text-slate-500 uppercase">{user?.role}</p>
          </div>
          <button onClick={() => setMenuOpen(!menuOpen)} className="p-2 bg-slate-100 rounded-full active:scale-95 transition-transform">
            <Menu size={20} className="text-slate-700" />
          </button>
          
          {menuOpen && (
            <div className="absolute right-0 top-12 mt-2 w-48 bg-white rounded-xl shadow-lg border overflow-hidden animate-in fade-in slide-in-from-top-2">
              <div className="px-4 py-2 border-b sm:hidden">
                <p className="text-sm font-semibold">{user?.name}</p>
                <p className="text-xs text-slate-500">{user?.role}</p>
              </div>
              <button 
                onClick={() => { navigate('/'); setMenuOpen(false); }}
                className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 flex items-center gap-2"
              >
                <Home size={16} /> Kasir (POS)
              </button>
              <button 
                onClick={() => { navigate('/closing'); setMenuOpen(false); }}
                className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 flex items-center gap-2"
              >
                <KeyRound size={16} /> Tutup Shift
              </button>
              {user?.role === 'owner' && (
                <button 
                  onClick={() => { navigate('/admin'); setMenuOpen(false); }}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 flex items-center gap-2 border-t text-blue-600"
                >
                  <Home size={16} /> Admin Dashboard
                </button>
              )}
              <button 
                onClick={handleLogout}
                className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 border-t"
              >
                <LogOut size={16} /> Keluar
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-x-hidden relative flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
