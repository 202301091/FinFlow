"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import ThemeToggle from '@/components/ThemeToggle';
import FinFlowLogo from '@/components/FinFlowLogo';

export default function SignupPage() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
  });

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [popup, setPopup] = useState(null); // { type: 'error' | 'success', message: string }

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

    // Client-side validation
    if (!formData.name.trim() || !formData.email.trim() || !formData.password) {
      showPopup('error', 'All fields (Name, Email, and Password) are required.');
      return;
    }

    if (formData.password.length < 6) {
      showPopup('error', 'Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);

    try {
      await api.post('/users/register', {
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password,
      });

      showPopup('success', 'User registered successfully! Redirecting to login...');
      setTimeout(() => {
        router.push('/login');
      }, 1500);
    } catch (err) {
      showPopup('error', err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
        <Link href="/" className="group">
          <FinFlowLogo size="md" />
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

      {/* Signup Form Card with Framer Motion Entry */}
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md mx-auto my-auto bg-white dark:bg-slate-900/90 rounded-3xl shadow-2xl shadow-slate-950/5 border border-slate-200 dark:border-slate-800 p-8 sm:p-10 z-10"
      >
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-3 group">
            <FinFlowLogo size="xl" iconOnly={true} className="mx-auto" />
          </Link>
          <h1 className="text-3xl font-black text-slate-950 dark:text-white tracking-tight">
            Create an Account
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
            Start managing your financial flows with FinFlow
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Full Name
            </label>
            <input
              type="text"
              name="name"
              placeholder="e.g. John Doe"
              value={formData.name}
              onChange={handleChange}
              disabled={loading}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:outline-none transition-all text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              name="email"
              placeholder="name@example.com"
              value={formData.email}
              onChange={handleChange}
              disabled={loading}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:outline-none transition-all text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                placeholder="Choose a strong password (min. 6 chars)"
                value={formData.password}
                onChange={handleChange}
                disabled={loading}
                className="w-full px-4 py-3 pr-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/80 text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:outline-none transition-all text-sm"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors focus:outline-none"
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
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
                <span>Creating account...</span>
              </>
            ) : (
              'Create Account'
            )}
          </motion.button>
        </form>

        <div className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
          Already have an account?{' '}
          <Link href="/login" className="font-bold text-sky-600 dark:text-sky-400 hover:underline">
            Sign in &rarr;
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
