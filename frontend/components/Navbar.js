"use client";

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { removeToken, getUser } from '@/lib/api';
import FinFlowLogo from '@/components/FinFlowLogo';
import ThemeToggle from '@/components/ThemeToggle';
import { useEffect, useState } from 'react';

export default function Navbar({ onOpenTransfer }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    setUser(getUser());
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
  );
}
