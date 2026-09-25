"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { isAuthenticated, getUser } from '@/lib/api';
import ThemeToggle from '@/components/ThemeToggle';
import FinFlowLogo from '@/components/FinFlowLogo';

export default function Home() {
  const [auth, setAuth] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (isAuthenticated()) {
      setAuth(true);
      setUser(getUser());
    }
  }, []);

  const featureContainerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.35,
      },
    },
  };

  const featureItemVariants = {
    hidden: { opacity: 0, y: 25 },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        ease: 'easeOut',
      },
    },
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50/70 dark:bg-[#070B14] text-slate-900 dark:text-slate-100 relative overflow-hidden transition-colors duration-300">
      {/* Background Animated Gradient Mesh Glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] overflow-hidden pointer-events-none -z-10">
        <div className="absolute -top-32 left-1/4 w-[520px] h-[520px] bg-sky-500/10 dark:bg-sky-600/10 rounded-full blur-3xl animate-pulse-glow" />
        <div className="absolute -top-24 right-1/4 w-[480px] h-[480px] bg-blue-600/10 dark:bg-blue-600/10 rounded-full blur-3xl animate-pulse-glow" />
      </div>

      {/* Navigation Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="max-w-7xl w-full mx-auto px-6 py-6 flex items-center justify-between z-20"
      >
        <Link href="/" className="group">
          <FinFlowLogo size="md" subtitle="FINANCIAL PLATFORM" />
        </Link>

        <nav className="flex items-center gap-3 sm:gap-4">
          <ThemeToggle />

          {auth ? (
            <Link href="/dashboard">
              <motion.div
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-semibold text-sm shadow-md shadow-sky-500/20 transition-all duration-200 cursor-pointer"
              >
                Dashboard &rarr;
              </motion.div>
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
              >
                Log In
              </Link>
              <Link href="/signup">
                <motion.div
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-semibold text-sm shadow-md shadow-sky-500/20 hover:shadow-sky-500/30 transition-all duration-200 cursor-pointer"
                >
                  Get Started
                </motion.div>
              </Link>
            </>
          )}
        </nav>
      </motion.header>

      {/* Hero Section */}
      <main className="max-w-5xl mx-auto px-6 pt-8 pb-20 text-center flex flex-col items-center justify-center z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-sky-50 dark:bg-sky-950/60 border border-sky-200/80 dark:border-sky-800/80 text-sky-700 dark:text-sky-300 text-xs font-semibold mb-6 animate-float shadow-sm"
        >
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
          </span>
          <span>Official Financial Transaction Platform</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight leading-[1.1] text-slate-950 dark:text-white max-w-4xl"
        >
          Smarter Financial Flows for{' '}
          <span className="bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Modern Wealth
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
          className="mt-5 text-lg sm:text-xl text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed"
        >
          Open and manage multiple distinct accounts with real-time balance tracking in INR, bank-grade encryption, and seamless authentication designed for effortless money management.
        </motion.p>

        {/* Official Logo Banner Showcase with Motion */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 mb-8 relative w-full max-w-2xl group"
        >
          <div className="absolute -inset-1.5 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 rounded-3xl blur-xl opacity-25 group-hover:opacity-40 transition duration-700 animate-pulse-glow" />
          <div className="relative rounded-2xl overflow-hidden border border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl shadow-2xl p-2 sm:p-4 hover:scale-[1.01] transition-transform duration-300">
            <Image
              src="/finflow-banner.png"
              alt="FinFlow - Financial Transaction Platform"
              width={1024}
              height={558}
              className="w-full h-auto rounded-xl object-contain shadow-md"
              priority
            />
          </div>
        </motion.div>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
          className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto justify-center"
        >
          {auth ? (
            <Link href="/dashboard">
              <motion.div
                whileHover={{ scale: 1.04, y: -2 }}
                whileTap={{ scale: 0.97 }}
                className="px-8 py-4 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-base shadow-lg shadow-sky-500/25 hover:shadow-xl hover:shadow-sky-500/35 transition-all duration-200 cursor-pointer text-center"
              >
                Open Dashboard ({user?.name || 'My Account'}) &rarr;
              </motion.div>
            </Link>
          ) : (
            <>
              <Link href="/signup">
                <motion.div
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  className="px-8 py-4 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-base shadow-lg shadow-sky-500/25 hover:shadow-xl hover:shadow-sky-500/35 transition-all duration-200 cursor-pointer text-center"
                >
                  Create Free Account &rarr;
                </motion.div>
              </Link>
              <Link href="/login">
                <motion.div
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  className="px-8 py-4 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-bold text-base transition-all duration-200 shadow-sm cursor-pointer text-center"
                >
                  Sign In
                </motion.div>
              </Link>
            </>
          )}
        </motion.div>

        {/* Interactive Feature Cards with Framer Motion Stagger */}
        <motion.div
          variants={featureContainerVariants}
          initial="hidden"
          animate="show"
          className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 w-full text-left"
        >
          <motion.div
            variants={featureItemVariants}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="p-6 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-800 shadow-sm hover:shadow-xl hover:shadow-sky-500/5 transition-all duration-300 group cursor-default"
          >
            <div className="w-12 h-12 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform border border-sky-100 dark:border-sky-900/50">
              💳
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Multi-Account Architecture
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Create and manage multiple account types including Savings, Current, and Investment accounts under one profile.
            </p>
          </motion.div>

          <motion.div
            variants={featureItemVariants}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="p-6 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-800 shadow-sm hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300 group cursor-default"
          >
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform border border-blue-100 dark:border-blue-900/50">
              🛡️
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Bank-Grade Security
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Cryptographic bcrypt salt hashing, signed JWT Bearer authorization, and strict PostgreSQL transactional safety.
            </p>
          </motion.div>

          <motion.div
            variants={featureItemVariants}
            whileHover={{ y: -6, transition: { duration: 0.2 } }}
            className="p-6 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-800 shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-300 group cursor-default"
          >
            <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform border border-indigo-100 dark:border-indigo-900/50">
              ⚡
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Dynamic Experience
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Real-time balance aggregation in INR (₹), custom password security, dark/light theme, and automated routing.
            </p>
          </motion.div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl w-full mx-auto px-6 py-8 border-t border-slate-200 dark:border-slate-800/80 text-center text-xs text-slate-500 dark:text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <FinFlowLogo size="sm" showText={false} />
          <span>&copy; {new Date().getFullYear()} FinFlow - Financial Transaction Platform. All rights reserved.</span>
        </div>
        <span className="flex items-center gap-1.5 text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          System Operational
        </span>
      </footer>
    </div>
  );
}
