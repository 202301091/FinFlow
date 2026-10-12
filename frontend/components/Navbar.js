"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { removeToken, getUser, api } from '@/lib/api';
import FinFlowLogo from '@/components/FinFlowLogo';
import ThemeToggle from '@/components/ThemeToggle';
import NotificationBell from '@/components/NotificationBell';
import SetPinModal from '@/components/SetPinModal';

export default function Navbar({ onOpenTransfer, hasPin: propHasPin }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [hasPin, setHasPin] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Close mobile menu whenever navigation occurs
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  // Synchronize with parent prop if provided, otherwise internal state
  const effectiveHasPin = propHasPin !== undefined ? propHasPin : hasPin;

  const checkPinStatus = async () => {
    try {
      const res = await api.get('/users/pin-status');
      if (res?.data) {
        setHasPin(Boolean(res.data.hasPin));
      }
    } catch {
      const u = getUser();
      if (u) setHasPin(Boolean(u.hasPin));
    }
  };

  useEffect(() => {
    const currentUser = getUser();
    setUser(currentUser);
    if (currentUser) {
      setHasPin(Boolean(currentUser.hasPin));
      checkPinStatus();
    }

    // Synchronize PIN & user updates in real-time across components & tabs
    const handlePinUpdated = (e) => {
      const val = e?.detail?.hasPin !== undefined ? Boolean(e.detail.hasPin) : true;
      setHasPin(val);
      const u = getUser();
      if (u) setUser({ ...u, hasPin: val });
    };

    const handleUserUpdated = (e) => {
      if (e?.detail) {
        setUser(e.detail);
        if (typeof e.detail.hasPin === 'boolean') {
          setHasPin(e.detail.hasPin);
        }
      }
    };

    const handleStorageChange = (e) => {
      if (e.key === 'finflow_user' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed) {
            setUser(parsed);
            if (typeof parsed.hasPin === 'boolean') {
              setHasPin(parsed.hasPin);
            }
          }
        } catch {}
      }
    };

    window.addEventListener('finflow:pin-updated', handlePinUpdated);
    window.addEventListener('finflow:user-updated', handleUserUpdated);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('finflow:pin-updated', handlePinUpdated);
      window.removeEventListener('finflow:user-updated', handleUserUpdated);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const handleLogout = () => {
    removeToken();
    router.replace('/login');
  };

  const navLinks = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Transactions', href: '/transactions' },
    { name: 'New Account', href: '/create-account' },
  ];

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 sticky top-0 z-40 transition-colors duration-300"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Left: Brand Logo & Desktop Navigation Links */}
          <div className="flex items-center gap-4 sm:gap-8">
            <Link href="/dashboard" className="group shrink-0">
              <div className="hidden sm:block">
                <FinFlowLogo size="md" subtitle="FINANCE" />
              </div>
              <div className="sm:hidden">
                <FinFlowLogo size="sm" subtitle="" />
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-1.5 sm:gap-2">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                      isActive
                        ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {link.name}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right: Actions, Theme, User Info & Hamburger Toggle */}
          <div className="flex items-center gap-2 sm:gap-3">
            {onOpenTransfer && (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onOpenTransfer}
                className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer"
              >
                <span>💸</span>
                <span>Send Money</span>
              </motion.button>
            )}

            {user && (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setIsPinModalOpen(true)}
                className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer border ${
                  effectiveHasPin
                    ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border-amber-500/40 animate-pulse'
                }`}
                title={effectiveHasPin ? '6-Digit Transaction PIN is active. Click to change.' : 'Action Required: Click to set your 6-digit Transaction PIN.'}
              >
                <span>{effectiveHasPin ? '🔒' : '⚠️'}</span>
                <span>{effectiveHasPin ? 'PIN Active' : 'Set PIN'}</span>
              </motion.button>
            )}

            <NotificationBell />

            <ThemeToggle />

            {user && (
              <div className="text-right hidden md:block border-l border-slate-200 dark:border-slate-800 pl-4">
                <p className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                  {user.name || 'FinFlow User'}
                </p>
                <p className="text-[11px] text-slate-400 font-medium truncate max-w-[140px]">
                  {user.email || ''}
                </p>
              </div>
            )}

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleLogout}
              className="hidden md:inline-flex px-3 py-1.5 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            >
              Log Out
            </motion.button>

            {/* Mobile Hamburger Menu Toggle Button */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
              className="md:hidden p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700 transition-colors focus:outline-none cursor-pointer"
            >
              {isMobileMenuOpen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Animated Mobile Drawer */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="md:hidden border-t border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl px-4 py-4 space-y-3 overflow-hidden shadow-xl"
            >
              {user && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-between">
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {user.name || 'FinFlow User'}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {user.email || ''}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      setIsPinModalOpen(true);
                    }}
                    className={`shrink-0 px-2.5 py-1 text-[11px] font-bold rounded-lg border flex items-center gap-1 ${
                      effectiveHasPin
                        ? 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                        : 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/40'
                    }`}
                  >
                    <span>{effectiveHasPin ? '🔒 PIN Active' : '⚠️ Set PIN'}</span>
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-1">
                {navLinks.map((link) => {
                  const isActive = pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-between ${
                        isActive
                          ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 font-bold'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{link.name}</span>
                      {isActive && <span className="text-sky-500 text-xs">●</span>}
                    </Link>
                  );
                })}
              </div>

              {onOpenTransfer && (
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onOpenTransfer();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-sm rounded-xl shadow-sm"
                >
                  <span>💸</span>
                  <span>Transfer Money</span>
                </button>
              )}

              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleLogout();
                }}
                className="w-full text-center px-4 py-2.5 text-xs font-semibold rounded-xl text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 hover:bg-red-100 transition-colors"
              >
                Log Out
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>

      {/* Render SetPinModal outside motion.header so fixed positioning is viewport-relative */}
      <SetPinModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        onSuccess={() => {
          setHasPin(true);
          checkPinStatus();
        }}
      />
    </>
  );
}
