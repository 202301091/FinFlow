"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';

export default function TransferModal({ isOpen, onClose, accounts = [], onSuccess }) {
  const [senderAccountId, setSenderAccountId] = useState(accounts[0]?.id || '');
  const [receiverAccountId, setReceiverAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [clientErrors, setClientErrors] = useState({});

  // Reset or select default account if accounts change
  const selectedAccount = accounts.find((acc) => acc.id === senderAccountId) || accounts[0];
  const maxBalance = selectedAccount ? parseFloat(selectedAccount.balance) : 0;

  const validate = () => {
    const errors = {};
    if (!receiverAccountId.trim()) {
      errors.receiverAccountId = 'Receiver account ID is required';
    } else if (receiverAccountId.trim() === senderAccountId) {
      errors.receiverAccountId = 'Receiver cannot be the same as sender account';
    }

    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      errors.amount = 'Please enter a valid amount greater than zero';
    } else if (numAmount > maxBalance) {
      errors.amount = `Insufficient balance. Available: ₹${maxBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    }

    setClientErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!validate()) {
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/transactions/transfer', {
        senderAccountId: senderAccountId || undefined,
        receiverAccountId: receiverAccountId.trim(),
        amount: parseFloat(amount),
        description: description.trim() || undefined,
      });

      // Clear form
      setReceiverAccountId('');
      setAmount('');
      setDescription('');
      setClientErrors({});

      if (onSuccess) {
        onSuccess(response.data);
      }
      onClose();
    } catch (err) {
      setErrorMessage(err.message || 'Transfer failed. Please check your inputs and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 flex items-center justify-center text-xl">
                💸
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Transfer Funds</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Instant, atomic transfer between FinFlow accounts
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

          {/* Error Banner */}
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2"
            >
              <span>⚠️</span>
              <span>{errorMessage}</span>
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {/* Sender Account */}
            {accounts.length > 1 && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                  From Account
                </label>
                <select
                  value={senderAccountId || accounts[0]?.id}
                  onChange={(e) => setSenderAccountId(e.target.value)}
                  disabled={loading}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.account_type?.toUpperCase()} — ₹
                      {parseFloat(acc.balance).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                      })}{' '}
                      ({acc.id.slice(0, 8)}...)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Receiver Account ID */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Receiver Account ID
                </label>
                <span className="text-[11px] text-slate-400">UUID format</span>
              </div>
              <input
                type="text"
                placeholder="e.g. 3492feb7-2b08-4318-b057-5a733fa5ee27"
                value={receiverAccountId}
                onChange={(e) => {
                  setReceiverAccountId(e.target.value);
                  if (clientErrors.receiverAccountId) {
                    setClientErrors((prev) => ({ ...prev, receiverAccountId: null }));
                  }
                }}
                disabled={loading}
                className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border ${
                  clientErrors.receiverAccountId
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-slate-200 dark:border-slate-700 focus:ring-sky-500'
                } text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2`}
              />
              {clientErrors.receiverAccountId && (
                <p className="mt-1 text-xs text-red-500 font-medium">
                  {clientErrors.receiverAccountId}
                </p>
              )}
            </div>

            {/* Amount */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Amount (INR)
                </label>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Available: ₹
                  {maxBalance.toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-base">
                  ₹
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (clientErrors.amount) {
                      setClientErrors((prev) => ({ ...prev, amount: null }));
                    }
                  }}
                  disabled={loading}
                  className={`w-full pl-8 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border ${
                    clientErrors.amount
                      ? 'border-red-500 focus:ring-red-500'
                      : 'border-slate-200 dark:border-slate-700 focus:ring-sky-500'
                  } text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2`}
                />
              </div>
              {clientErrors.amount && (
                <p className="mt-1 text-xs text-red-500 font-medium">{clientErrors.amount}</p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                Description / Memo (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Dinner with team, Rent, Splitwise"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading}
                maxLength={100}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
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
                className="px-6 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-sky-500/20 hover:shadow-sky-500/35 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span>Processing Transfer...</span>
                  </>
                ) : (
                  <>
                    <span>Confirm & Send</span>
                    <span>→</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
