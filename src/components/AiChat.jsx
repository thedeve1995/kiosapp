import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Send, Loader2, Bot, User, Trash2 } from 'lucide-react';
import { generateChatResponse } from '../lib/ai';

export default function AiChat({ transactions, products, balances, closings }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'ai', text: 'Halo! Saya asisten AI untuk Kios Finance Anda. 📊\n\nTanyakan apa saja seputar penjualan, laba, stok, atau data bisnis Anda!' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg = { role: 'user', text: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const contextData = { transactions, products, balances, closings };
      const response = await generateChatResponse(trimmed, contextData);
      setMessages(prev => [...prev, { role: 'ai', text: response }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', text: `⚠️ ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([
      { role: 'ai', text: 'Chat direset! Silakan tanyakan hal baru. 📊' }
    ]);
  };

  return (
    <>
      {/* Floating Toggle Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-20 right-4 z-[90] bg-gradient-to-br from-violet-600 to-indigo-700 text-white p-4 rounded-2xl shadow-2xl shadow-violet-500/30 hover:shadow-violet-500/50 hover:scale-105 active:scale-95 transition-all"
            title="Asisten AI"
          >
            <Sparkles size={24} />
            {/* Pulse indicator */}
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-pulse border-2 border-white" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
            className="fixed bottom-20 right-4 z-[95] w-[360px] max-w-[calc(100vw-2rem)] bg-white rounded-3xl shadow-2xl shadow-slate-900/20 border border-slate-200 overflow-hidden flex flex-col"
            style={{ maxHeight: 'calc(100vh - 8rem)' }}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-violet-600 to-indigo-700 px-5 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 p-2 rounded-xl">
                  <Bot size={18} className="text-white" />
                </div>
                <div>
                  <h3 className="font-black text-white text-sm tracking-wide">Asisten AI</h3>
                  <p className="text-violet-200 text-[10px] font-medium">GPT • Kios Finance</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleClear}
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                  title="Hapus Chat"
                >
                  <Trash2 size={16} className="text-white/70" />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                >
                  <X size={18} className="text-white" />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[250px] max-h-[400px] bg-slate-50/50">
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {/* Avatar */}
                  <div className={`shrink-0 w-7 h-7 rounded-xl flex items-center justify-center ${
                    msg.role === 'ai' 
                      ? 'bg-gradient-to-br from-violet-100 to-indigo-100 text-violet-600' 
                      : 'bg-gradient-to-br from-blue-100 to-blue-50 text-blue-600'
                  }`}>
                    {msg.role === 'ai' ? <Bot size={14} /> : <User size={14} />}
                  </div>
                  {/* Bubble */}
                  <div className={`max-w-[75%] px-4 py-3 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'ai'
                      ? 'bg-white border border-slate-100 text-slate-700 rounded-tl-md shadow-sm'
                      : 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-tr-md shadow-md shadow-blue-500/20'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              
              {/* Loading Indicator */}
              {loading && (
                <div className="flex gap-2.5">
                  <div className="shrink-0 w-7 h-7 rounded-xl bg-gradient-to-br from-violet-100 to-indigo-100 text-violet-600 flex items-center justify-center">
                    <Bot size={14} />
                  </div>
                  <div className="bg-white border border-slate-100 px-4 py-3 rounded-2xl rounded-tl-md shadow-sm">
                    <div className="flex items-center gap-2 text-violet-500">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-[12px] font-medium italic">Menganalisis...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-3 border-t border-slate-100 bg-white shrink-0">
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Tanya soal bisnis Anda..."
                  rows={1}
                  className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium resize-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none transition-all max-h-20"
                  disabled={loading}
                />
                <button
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  className="bg-gradient-to-br from-violet-600 to-indigo-700 text-white p-3 rounded-2xl hover:shadow-lg hover:shadow-violet-500/30 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  <Send size={18} />
                </button>
              </div>
              <p className="text-[9px] text-slate-400 text-center mt-2 font-medium">
                AI menggunakan data real-time dari dashboard Anda
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
