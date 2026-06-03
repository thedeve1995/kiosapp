import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Home, KeyRound, LayoutDashboard, LogOut } from 'lucide-react';
import { auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { motion, AnimatePresence } from 'framer-motion';

export default function Layout() {
  const { user, shift, setUser } = useStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    navigate('/login');
  };

  const tabs = [
    { path: '/', icon: Home, label: 'Kasir' },
    { path: '/closing', icon: KeyRound, label: 'Tutup Sesi' },
    ...(user?.role === 'owner' ? [{ path: '/admin', icon: LayoutDashboard, label: 'Admin' }] : []),
  ];

  const initials = user?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col font-sans">
      {/* Top Header */}
      <header className="glass-dark border-b border-slate-800/80 px-4 py-3 flex justify-between items-center sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center shadow-md shadow-indigo-500/30">
            <span className="text-white font-black text-xs">K</span>
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight text-white leading-none">
              Kios<span className="text-indigo-400">App</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-medium leading-none mt-0.5">{shift}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold text-white leading-none">{user?.name}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{user?.role}</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white font-black text-xs ring-2 ring-indigo-500/20 shadow-lg shadow-indigo-500/20">
            {initials}
          </div>
          <button
            onClick={handleLogout}
            title="Keluar"
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-red-500/15 border border-slate-700/50 hover:border-red-500/30 text-slate-400 hover:text-red-400 transition-all active:scale-90"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-x-hidden relative flex flex-col" style={{ paddingBottom: '72px' }}>
        <Outlet />
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 glass-dark border-t border-slate-800/80 z-40">
        <div className="flex items-stretch justify-around px-2 py-1.5 max-w-lg mx-auto">
          {tabs.map((tab) => {
            const isActive = location.pathname === tab.path ||
              (tab.path === '/admin' && location.pathname.startsWith('/admin'));
            return (
              <button
                key={tab.path}
                onClick={() => navigate(tab.path)}
                className="relative flex flex-col items-center justify-center gap-1 flex-1 py-2 px-3 rounded-2xl transition-all duration-200 group"
              >
                {isActive && (
                  <motion.div
                    layoutId="tabBg"
                    className="absolute inset-0 bg-indigo-500/15 rounded-2xl"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                  />
                )}
                <tab.icon
                  size={21}
                  strokeWidth={isActive ? 2.5 : 1.75}
                  className={`relative z-10 transition-colors ${isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'}`}
                />
                <span className={`relative z-10 text-[9px] font-black uppercase tracking-wider transition-colors ${isActive ? 'text-indigo-400' : 'text-slate-600 group-hover:text-slate-400'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
