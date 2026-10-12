"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
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
          {/* Left: Brand Logo & Navigation Links */}
          <div className="flex items-center gap-6 sm:gap-8">
            <Link href="/dashboard" className="group">
              <FinFlowLogo size="md" subtitle="FINANCE" />
            </Link>

            <nav className="flex items-center gap-1.5 sm:gap-2">
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

          {/* Right: Actions, Theme, User Info & Logout */}
          <div className="flex items-center gap-2.5 sm:gap-4">
            {onOpenTransfer && (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onOpenTransfer}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer"
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
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer border ${
                  effectiveHasPin
                    ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border-amber-500/40 animate-pulse'
                }`}
                title={effectiveHasPin ? '6-Digit Transaction PIN is active. Click to change.' : 'Action Required: Click to set your 6-digit Transaction PIN.'}
              >
                <span>{effectiveHasPin ? '🔒' : '⚠️'}</span>
                <span className="hidden sm:inline">{effectiveHasPin ? 'PIN Active' : 'Set PIN'}</span>
              </motion.button>
            )}

            <NotificationBell />

            <ThemeToggle />

            {user && (
              <div className="text-right hidden md:block border-l border-slate-200 dark:border-slate-800 pl-4">
                <p className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                  {user.name || 'FinFlow User'}
                </p>
                <p className="text-[11px] text-slate-400 font-medium">
                  {user.email || ''}
                </p>
              </div>
            )}

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleLogout}
              className="px-3 py-1.5 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            >
              Log Out
            </motion.button>
          </div>
        </div>
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
