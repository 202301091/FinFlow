"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { api, getToken, getUser, removeToken } from '@/lib/api';
import Navbar from '@/components/Navbar';
import TransferModal from '@/components/TransferModal';

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [popup, setPopup] = useState(null); // { type: 'error' | 'success', message: string }
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const showPopup = (type, message) => {
    setPopup({ type, message });
  };

  const closePopup = () => {
    setPopup(null);
  };

  // Automatically dismiss popup after 5 seconds
  useEffect(() => {
    if (!popup) return;
    const timer = setTimeout(() => {
      setPopup(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [popup]);

  const fetchAccounts = async () => {
    try {
      const response = await api.get('/accounts');
      const fetchedAccounts = response.data || [];
      setAccounts(fetchedAccounts);

      // If user has zero accounts, guide them to create their first account
      if (fetchedAccounts.length === 0) {
        router.replace('/create-account');
      }
    } catch (err) {
      showPopup('error', err.message || 'Failed to fetch account information.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    const cachedUser = getUser();
    setUser(cachedUser);

    fetchAccounts();
  }, [router]);

  const handleTransferSuccess = (result) => {
    showPopup('success', `Transfer of ₹${parseFloat(result.transaction.amount).toFixed(2)} completed successfully!`);
    fetchAccounts();
  };

  const handleCopyId = (id) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleLogout = () => {
    removeToken();
    router.replace('/login');
  };

  // Compute total balance across all accounts
  const totalBalance = accounts.reduce((acc, curr) => {
    const val = parseFloat(curr.balance);
    return acc + (isNaN(val) ? 0 : val);
  }, 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#070B14]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center gap-3"
        >
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-500"></div>
          <p className="text-xs text-slate-500 font-medium tracking-wide">Loading your portfolio...</p>
        </motion.div>
      </div>
    );
  }

  // Account type specific visual badges & accents
  const getAccountStyle = (type) => {
    const t = (type || '').toLowerCase();
    if (t === 'savings') {
      return {
        badge: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/80',
        dot: 'bg-emerald-500',
        icon: '💰',
        border: 'hover:border-emerald-500/40 hover:shadow-emerald-500/5',
      };
    }
    if (t === 'current') {
      return {
        badge: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200/80 dark:border-sky-800/80',
        dot: 'bg-sky-500',
        icon: '💳',
        border: 'hover:border-sky-500/40 hover:shadow-sky-500/5',
      };
    }
    return {
      badge: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/80',
      dot: 'bg-indigo-500',
      icon: '📈',
      border: 'hover:border-indigo-500/40 hover:shadow-indigo-500/5',
    };
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.45,
        ease: 'easeOut',
      },
    },
  };

  return (
    <div className="min-h-screen bg-slate-50/80 dark:bg-[#070B14] text-slate-900 dark:text-slate-100 transition-colors duration-300">
      {/* Interactive Error / Success Popup with AnimatePresence */}
      <AnimatePresence>
        {popup && (
          <motion.div
            initial={{ opacity: 0, y: -25, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            role="alert"
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
              onClick={closePopup}
              aria-label="Close popup"
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg font-bold leading-none p-1 cursor-pointer"
            >
              &times;
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shared Navigation Bar */}
      <Navbar onOpenTransfer={() => setIsTransferOpen(true)} />

      {/* Main Dashboard Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Refined Net Balance Card - Framer Motion Entry */}
        <motion.section
          initial={{ opacity: 0, y: 25, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-3xl p-7 sm:p-9 bg-gradient-to-br from-slate-900 via-[#0B1E30] to-[#0A1622] text-white border border-slate-800 shadow-2xl shadow-slate-950/25 flex flex-col sm:flex-row sm:items-center justify-between gap-6 overflow-hidden"
        >
          {/* Subtle Ambient Glows */}
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-sky-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

          <div className="z-10">
            <span className="text-sky-300 text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
              Total Net Balance
            </span>
            <motion.h2
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="text-4xl sm:text-5xl font-black mt-2 tracking-tight text-white drop-shadow-sm"
            >
              ₹{totalBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </motion.h2>
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Aggregated across {accounts.length} active {accounts.length === 1 ? 'account' : 'accounts'}
            </div>
          </div>

          <div className="z-10 flex flex-wrap items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.04, y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setIsTransferOpen(true)}
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold px-6 py-3.5 rounded-xl shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all duration-200 cursor-pointer text-sm"
            >
              <span className="text-lg leading-none">💸</span>
              <span>Transfer Money</span>
            </motion.button>

            <Link href="/create-account">
              <motion.div
                whileHover={{ scale: 1.04, y: -2 }}
                whileTap={{ scale: 0.97 }}
                className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-bold px-5 py-3.5 rounded-xl border border-white/15 backdrop-blur-sm transition-all duration-200 cursor-pointer text-sm"
              >
                <span className="text-lg leading-none">+</span>
                <span>Create New Account</span>
              </motion.div>
            </Link>
          </div>
        </motion.section>

        {/* Accounts List Section with Staggered Framer Motion */}
        <section className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.4 }}
            className="flex items-center justify-between"
          >
            <div>
              <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                My Accounts
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Overview of your connected savings, current, and investment accounts
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              {accounts.length} {accounts.length === 1 ? 'Account' : 'Accounts'}
            </span>
          </motion.div>

          {accounts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              className="bg-white dark:bg-slate-900/60 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center space-y-4 shadow-sm"
            >
              <div className="text-4xl">💳</div>
              <h4 className="text-lg font-semibold text-slate-900 dark:text-white">
                No accounts found
              </h4>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                You haven&apos;t created any accounts yet. Choose an account type to get started.
              </p>
              <Link href="/create-account">
                <motion.div
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className="inline-block px-5 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-semibold rounded-xl text-sm shadow-md transition-all cursor-pointer"
                >
                  Create Your First Account
                </motion.div>
              </Link>
            </motion.div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              {accounts.map((acc) => {
                const bal = parseFloat(acc.balance);
                const formattedBal = isNaN(bal) ? '0.00' : bal.toLocaleString('en-IN', { minimumFractionDigits: 2 });
                const typeName = acc.account_type?.toUpperCase() || 'STANDARD';
                const style = getAccountStyle(acc.account_type);

                return (
                  <motion.div
                    key={acc.id || acc.account_type}
                    variants={cardVariants}
                    whileHover={{ y: -6, transition: { duration: 0.2 } }}
                    className={`bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-6 shadow-sm hover:shadow-xl transition-all duration-300 relative flex flex-col justify-between group cursor-default ${style.border}`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-5">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{style.icon}</span>
                          <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border ${style.badge}`}>
                            {typeName}
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          <span className={`w-2 h-2 rounded-full ${style.dot} animate-pulse`}></span>
                          {acc.status || 'Active'}
                        </span>
                      </div>

                      <p className="text-xs text-slate-400 dark:text-slate-400 font-semibold uppercase tracking-wider">
                        Available Balance
                      </p>
                      <p className="text-3xl font-black text-slate-900 dark:text-white mt-1.5 tracking-tight">
                        ₹{formattedBal}
                      </p>
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold">Currency: {acc.currency || 'INR'}</span>
                      {acc.id && (
                        <button
                          type="button"
                          onClick={() => handleCopyId(acc.id)}
                          title="Click to copy full Account UUID"
                          className="inline-flex items-center gap-1 font-mono text-[11px] px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                        >
                          <span>{copiedId === acc.id ? '✓ Copied' : `ID: ${acc.id.slice(0, 8)}...`}</span>
                          <span className="opacity-50">📋</span>
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </section>
      </main>

      {/* Transfer Money Modal */}
      <TransferModal
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        accounts={accounts}
        onSuccess={handleTransferSuccess}
      />
    </div>
  );
}
