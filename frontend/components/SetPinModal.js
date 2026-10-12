"use client";

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api, getUser, setUser } from '@/lib/api';

export default function SetPinModal({ isOpen, onClose, onSuccess }) {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [errors, setErrors] = useState({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const validate = () => {
    const errs = {};
    if (!password) {
      errs.password = 'Account password is required';
    }

    if (!pin || pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      errs.pin = 'PIN must be exactly 6 numeric digits';
    }

    if (pin !== confirmPin) {
      errs.confirmPin = 'PIN confirmation does not match';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!validate()) return;

    setLoading(true);
    try {
      const response = await api.post('/users/set-pin', {
        password,
        pin: pin.trim(),
      });

      // Update local user state
      const currentUser = getUser();
      if (currentUser) {
        setUser({ ...currentUser, hasPin: true });
      }

      // Immediately broadcast to all components across the app
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('finflow:pin-updated', { detail: { hasPin: true } })
        );
      }

      setSuccessMessage('6-digit Transaction PIN configured successfully!');
      setTimeout(() => {
        // Reset form
        setPassword('');
        setPin('');
        setConfirmPin('');
        setSuccessMessage('');
        if (onSuccess) onSuccess(response.data);
        onClose();
      }, 1000);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to set transaction PIN. Please verify your password.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl relative my-auto max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-xl">
                🔒
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Security Transaction PIN</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Protect against unauthorized transfers
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={loading}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold p-1 rounded-lg cursor-pointer"
            >
              &times;
            </button>
          </div>

          {/* Success / Error Messages */}
          {errorMessage && (
            <div className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
              <span>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
              <span>✓</span>
              <span>{successMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {/* Account Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                Current Account Password
              </label>
              <input
                type="password"
                placeholder="Enter your login password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors((prev) => ({ ...prev, password: null }));
                }}
                disabled={loading}
                className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border ${
                  errors.password
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-slate-200 dark:border-slate-700 focus:ring-amber-500'
                } text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2`}
              />
              {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
            </div>

            {/* New 6-Digit PIN */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                New 6-Digit PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="•••••• (6 numbers)"
                value={pin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setPin(val);
                  if (errors.pin) setErrors((prev) => ({ ...prev, pin: null }));
                }}
                disabled={loading}
                className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border ${
                  errors.pin
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-slate-200 dark:border-slate-700 focus:ring-amber-500'
                } text-sm font-bold tracking-widest text-slate-900 dark:text-white focus:outline-none focus:ring-2`}
              />
              {errors.pin && <p className="mt-1 text-xs text-red-500">{errors.pin}</p>}
            </div>

            {/* Confirm PIN */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                Confirm 6-Digit PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="•••••• (Re-enter 6 numbers)"
                value={confirmPin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setConfirmPin(val);
                  if (errors.confirmPin) setErrors((prev) => ({ ...prev, confirmPin: null }));
                }}
                disabled={loading}
                className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border ${
                  errors.confirmPin
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-slate-200 dark:border-slate-700 focus:ring-amber-500'
                } text-sm font-bold tracking-widest text-slate-900 dark:text-white focus:outline-none focus:ring-2`}
              />
              {errors.confirmPin && <p className="mt-1 text-xs text-red-500">{errors.confirmPin}</p>}
            </div>

            {/* Actions */}
            <div className="pt-3 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-amber-500/20 hover:shadow-amber-500/35 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span>Saving PIN...</span>
                  </>
                ) : (
                  <span>Set 6-Digit PIN</span>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
