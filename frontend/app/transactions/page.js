"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { api, getToken } from '@/lib/api';
import Navbar from '@/components/Navbar';
import TransactionHistory from '@/components/TransactionHistory';
import TransferModal from '@/components/TransferModal';

export default function TransactionsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [historyTrigger, setHistoryTrigger] = useState(0);
  const [popup, setPopup] = useState(null);

  const showPopup = (type, message) => {
    setPopup({ type, message });
  };

  useEffect(() => {
    if (!popup) return;
    const timer = setTimeout(() => setPopup(null), 5000);
    return () => clearTimeout(timer);
  }, [popup]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    const fetchAccounts = async () => {
      try {
        const response = await api.get('/accounts');
        setAccounts(response.data || []);
      } catch (err) {
        showPopup('error', err.message || 'Failed to fetch accounts');
      } finally {
        setLoading(false);
      }
    };

    fetchAccounts();
  }, [router]);

  const handleTransferSuccess = (result) => {
    showPopup(
      'success',
      `Transfer of ₹${parseFloat(result.transaction.amount).toFixed(2)} completed successfully!`
    );
    setHistoryTrigger((prev) => prev + 1);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#070B14]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/80 dark:bg-[#070B14] text-slate-900 dark:text-slate-100 transition-colors duration-300">
      {/* Navigation Bar */}
      <Navbar onOpenTransfer={() => setIsTransferOpen(true)} />

      {/* Popup Notifications */}
      <AnimatePresence>
        {popup && (
          <motion.div
            initial={{ opacity: 0, y: -25, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-6 right-6 z-50 max-w-md w-full shadow-2xl rounded-2xl p-4 border flex items-start justify-between gap-3 ${
              popup.type === 'error'
                ? 'bg-red-50 border-red-300 text-red-900 dark:bg-red-950/90 dark:border-red-800 dark:text-red-200'
                : 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-950/90 dark:border-emerald-800 dark:text-emerald-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">{popup.type === 'error' ? '⚠️' : '✅'}</span>
              <div>
                <p className="font-semibold text-sm">
                  {popup.type === 'error' ? 'Error' : 'Success'}
                </p>
                <p className="text-xs mt-0.5 leading-relaxed">{popup.message}</p>
              </div>
            </div>
            <button
              onClick={() => setPopup(null)}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg font-bold leading-none p-1 cursor-pointer"
            >
              &times;
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Page Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Banner with Transfer CTA & Framer Motion entry */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="relative rounded-3xl p-6 sm:p-8 bg-gradient-to-br from-slate-900 via-[#0B1E30] to-[#0A1622] text-white border border-slate-800 shadow-2xl shadow-slate-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-6 overflow-hidden"
        >
          {/* Subtle Ambient Glows */}
          <div className="absolute -top-24 -right-24 w-80 h-80 bg-sky-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="z-10">
            <span className="text-sky-300 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
              Ledger Overview
            </span>
            <h2 className="text-2xl sm:text-3xl font-black mt-1.5 tracking-tight text-white drop-shadow-sm">
              Transactions & Audit Trail
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">
              Inspect your verified ledger receipts, chronological transfers, and payment history across all your accounts.
            </p>
          </div>

          <div className="z-10 shrink-0">
            <motion.button
              whileHover={{ scale: 1.04, y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setIsTransferOpen(true)}
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold px-6 py-3.5 rounded-xl shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all cursor-pointer text-sm"
            >
              <span className="text-base">💸</span>
              <span>Send Money</span>
            </motion.button>
          </div>
        </motion.div>

        {/* Transaction History Component with Pagination & Details Modal */}
        <TransactionHistory refreshTrigger={historyTrigger} />
      </main>

      {/* Transfer Modal */}
      <TransferModal
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        accounts={accounts}
        onSuccess={handleTransferSuccess}
      />
    </div>
  );
}
