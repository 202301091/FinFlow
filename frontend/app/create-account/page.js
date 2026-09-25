"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { api, getToken, getUser } from '@/lib/api';
import ThemeToggle from '@/components/ThemeToggle';
import FinFlowLogo from '@/components/FinFlowLogo';

export default function CreateAccountPage() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    account_type: 'savings',
    balance: '0',
  });

  const [loading, setLoading] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [popup, setPopup] = useState(null); // { type: 'error' | 'success', message: string }
  const [user, setUserState] = useState(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
    } else {
      setUserState(getUser());
      setAuthChecked(true);
    }
  }, [router]);

  // Automatically dismiss popup after 5 seconds
  useEffect(() => {
    if (!popup) return;
    const timer = setTimeout(() => {
      setPopup(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [popup]);

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const showPopup = (type, message) => {
    setPopup({ type, message });
  };

  const closePopup = () => {
    setPopup(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setPopup(null);

    const parsedBalance = parseFloat(formData.balance);
    if (isNaN(parsedBalance) || parsedBalance < 0) {
      showPopup('error', 'Please enter a valid, non-negative balance.');
      return;
    }

    setLoading(true);

    try {
      await api.post('/accounts', {
        account_type: formData.account_type,
        balance: parsedBalance,
      });

      showPopup('success', `Your ${formData.account_type} account has been created! Redirecting to dashboard...`);
      setTimeout(() => {
        router.push('/dashboard');
      }, 1500);
    } catch (err) {
      showPopup('error', err.message || 'Failed to create account. You may already have an account of this type.');
    } finally {
      setLoading(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#070B14]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="animate-spin rounded-full h-10 w-10 border-b-2 border-sky-500"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50/70 dark:bg-[#070B14] text-slate-900 dark:text-slate-100 p-4 sm:p-6 relative overflow-hidden transition-colors duration-300">
      {/* Background Animated Gradient Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-[500px] overflow-hidden pointer-events-none -z-10">
        <div className="absolute -top-32 left-1/3 w-[450px] h-[450px] bg-sky-500/10 dark:bg-sky-600/10 rounded-full blur-3xl animate-pulse-glow" />
        <div className="absolute -top-20 right-1/4 w-[380px] h-[380px] bg-blue-600/10 dark:bg-blue-600/10 rounded-full blur-3xl animate-pulse-glow" />
      </div>

      {/* Top Navbar */}
      <motion.header
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="max-w-6xl w-full mx-auto flex items-center justify-between z-20"
      >
        <Link href="/dashboard" className="group">
          <FinFlowLogo size="md" subtitle="NEW ACCOUNT" />
        </Link>
        <ThemeToggle />
      </motion.header>

      {/* Interactive Error / Success Popup with AnimatePresence */}
      <AnimatePresence>
        {popup && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            role="alert"
            className={`fixed top-6 right-6 z-50 max-w-md w-full shadow-2xl rounded-2xl p-4 border flex items-start justify-between gap-3 ${
              popup.type === 'error'
                ? 'bg-red-50 border-red-300 text-red-900 dark:bg-red-950/90 dark:border-red-800 dark:text-red-200'
                : 'bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-950/90 dark:border-emerald-800 dark:text-emerald-200'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">
                {popup.type === 'error' ? '⚠️' : '✅'}
              </span>
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

      {/* Account Creation Card with Framer Motion Entry */}
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg mx-auto my-auto bg-white dark:bg-slate-900/90 rounded-3xl shadow-2xl shadow-slate-950/5 border border-slate-200 dark:border-slate-800 p-8 sm:p-10 z-10"
      >
        <div className="text-center mb-8">
          <Link href="/dashboard" className="inline-block mb-3 group">
            <FinFlowLogo size="xl" iconOnly={true} className="mx-auto" />
          </Link>
          <h1 className="text-3xl font-black text-slate-950 dark:text-white tracking-tight">
            Create an Account
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
            {user?.name ? `Hello ${user.name}, set` : 'Set'} up a new account for your financial flows
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
              Select Account Type
            </label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { type: 'savings', label: 'Savings', icon: '💰' },
                { type: 'current', label: 'Current', icon: '💳' },
                { type: 'investment', label: 'Investment', icon: '📈' },
              ].map((item) => (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, account_type: item.type }))}
                  className={`flex flex-col items-center justify-center p-4 rounded-xl border text-center transition-all cursor-pointer ${
                    formData.account_type === item.type
                      ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 ring-2 ring-sky-500/20 shadow-sm'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/80 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <span className="text-2xl mb-1">{item.icon}</span>
                  <span className="text-xs font-bold capitalize">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Initial Deposit Amount (INR)
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-slate-400 font-bold text-base">
                ₹
              </span>
              <input
                type="number"
                name="balance"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={formData.balance}
                onChange={handleChange}
                disabled={loading}
                className="w-full pl-9 pr-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:outline-none transition-all text-sm font-semibold"
                required
              />
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
              You can start with ₹0.00 or deposit any initial amount.
            </p>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg shadow-sky-500/25 hover:shadow-sky-500/35 transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed text-sm"
          >
            {loading ? (
              <>
                <svg
                  className="animate-spin h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                <span>Opening account...</span>
              </>
            ) : (
              'Confirm & Create Account'
            )}
          </motion.button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/dashboard"
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-semibold"
          >
            &larr; Back to Dashboard
          </Link>
        </div>
      </motion.div>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-400 dark:text-slate-500 py-4 z-10">
        &copy; {new Date().getFullYear()} FinFlow. All rights reserved.
      </footer>
    </div>
  );
}
