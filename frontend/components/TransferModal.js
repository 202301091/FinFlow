"use client";

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import SetPinModal from '@/components/SetPinModal';
import {
  getOrSetTransferIdempotencyKey,
  clearTransferIdempotencyKey,
} from '@/lib/idempotency';

export default function TransferModal({ isOpen, onClose, accounts = [], onSuccess, hasPin: propHasPin }) {
  const [senderAccountId, setSenderAccountId] = useState(accounts[0]?.id || '');
  const [receiverAccountId, setReceiverAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [transactionPin, setTransactionPin] = useState('');
  const [showSetPinModal, setShowSetPinModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [clientErrors, setClientErrors] = useState({});
  const [hasPin, setHasPin] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Synchronize with parent prop if provided, otherwise internal state
  const effectiveHasPin = propHasPin !== undefined ? propHasPin : hasPin;

  useEffect(() => {
    setMounted(true);

    const handlePinUpdated = (e) => {
      const val = e?.detail?.hasPin !== undefined ? Boolean(e.detail.hasPin) : true;
      setHasPin(val);
    };

    window.addEventListener('finflow:pin-updated', handlePinUpdated);
    return () => {
      window.removeEventListener('finflow:pin-updated', handlePinUpdated);
    };
  }, []);

  const currentSenderId = senderAccountId || accounts[0]?.id || '';

  // Maintain a persistent idempotency key for this transfer attempt session backed by sessionStorage
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    getOrSetTransferIdempotencyKey(accounts[0]?.id, '', '')
  );

  // Reset or select default account if accounts change
  const selectedAccount = accounts.find((acc) => acc.id === currentSenderId) || accounts[0];
  const maxBalance = selectedAccount ? parseFloat(selectedAccount.balance) : 0;

  const checkPinStatus = async () => {
    try {
      const res = await api.get('/users/pin-status');
      if (res?.data) {
        setHasPin(Boolean(res.data.hasPin));
      }
    } catch {
      // fallback
    }
  };

  // Synchronize stable idempotency key with sessionStorage draft whenever transfer intent updates
  useEffect(() => {
    if (isOpen) {
      const activeKey = getOrSetTransferIdempotencyKey(
        currentSenderId,
        receiverAccountId,
        amount
      );
      setIdempotencyKey(activeKey);
      checkPinStatus();
    }
  }, [isOpen, currentSenderId, receiverAccountId, amount]);

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

    if (!effectiveHasPin) {
      errors.transactionPin = 'You must configure your 6-digit Transaction PIN before making transfers';
    } else if (!transactionPin || !/^\d{6}$/.test(transactionPin.trim())) {
      errors.transactionPin = 'Your 6-digit Transaction PIN is required to authorize this transfer';
    }

    setClientErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Guard against multiple rapid clicks while a transfer is in-flight
    if (loading) return;

    setErrorMessage('');

    if (!validate()) {
      return;
    }

    setLoading(true);
    try {
      // Send the stable idempotencyKey. Multiple clicks or network retries for
      // this payment attempt reuse the SAME key so the backend rejects duplicates or returns cached response.
      const response = await api.post(
        '/transactions/transfer',
        {
          senderAccountId: senderAccountId || undefined,
          receiverAccountId: receiverAccountId.trim(),
          amount: parseFloat(amount),
          description: description.trim() || undefined,
          transactionPin: transactionPin.trim() || undefined,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        }
      );

      // Successful transfer: clear persistent draft key from sessionStorage & reset form
      clearTransferIdempotencyKey(currentSenderId, receiverAccountId, amount);
      setReceiverAccountId('');
      setAmount('');
      setDescription('');
      setTransactionPin('');
      setClientErrors({});
      setIdempotencyKey(getOrSetTransferIdempotencyKey(currentSenderId, '', ''));

      if (onSuccess) {
        onSuccess(response.data);
      }
      onClose();
    } catch (err) {
      // Retain the same idempotencyKey here so if user retries due to network glitch,
      // the server recognizes the retry and prevents double debit.
      setErrorMessage(err.message || 'Transfer failed. Please check your inputs and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <>
      <AnimatePresence>
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative my-auto max-h-[90vh] overflow-y-auto"
          >
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

            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex flex-col gap-1.5"
              >
                <div className="flex items-center gap-2">
                  <span>⚠️</span>
                  <span>{errorMessage}</span>
                </div>
                {errorMessage.toLowerCase().includes('pin') && (
                  <button
                    type="button"
                    onClick={() => setShowSetPinModal(true)}
                    className="self-start text-xs font-bold underline text-red-800 dark:text-red-200 hover:text-red-950 cursor-pointer"
                  >
                    Set up or update your 6-digit Transaction PIN now →
                  </button>
                )}
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
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

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Receiver Account ID
                  </label>
                  <span className="text-[11px] text-slate-400">UUID format</span>
                </div>
                <input
                  type="text"
                  placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
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

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Amount (INR)
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Available: ₹
                    {maxBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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

              <div className="pt-1">
                {!effectiveHasPin ? (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-950 dark:text-amber-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold flex items-center gap-1.5 text-amber-900 dark:text-amber-200">
                        <span>⚠️</span> Security PIN Not Set
                      </p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                        You must configure your 6-digit PIN before you can authorize transfers.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSetPinModal(true)}
                      className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer whitespace-nowrap"
                    >
                      Set PIN Now →
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                        6-Digit Security PIN <span className="text-red-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowSetPinModal(true)}
                        className="text-xs text-sky-500 hover:text-sky-600 font-semibold cursor-pointer underline"
                      >
                        Change PIN
                      </button>
                    </div>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                        🔒
                      </span>
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        placeholder="•••••• (Enter 6-digit PIN)"
                        value={transactionPin}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setTransactionPin(val);
                          if (clientErrors.transactionPin) {
                            setClientErrors((prev) => ({ ...prev, transactionPin: null }));
                          }
                        }}
                        disabled={loading}
                        className={`w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border ${
                          clientErrors.transactionPin
                            ? 'border-red-500 focus:ring-red-500'
                            : 'border-slate-200 dark:border-slate-700 focus:ring-sky-500'
                        } text-sm font-bold tracking-widest text-slate-900 dark:text-white focus:outline-none focus:ring-2`}
                      />
                    </div>
                    {clientErrors.transactionPin && (
                      <p className="mt-1 text-xs text-red-500 font-medium">
                        {clientErrors.transactionPin}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-slate-400">
                       Protects your funds if your account is left open on this device.
                    </p>
                  </>
                )}
              </div>

              <div className="pt-3 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                {!effectiveHasPin ? (
                  <button
                    type="button"
                    onClick={() => setShowSetPinModal(true)}
                    className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-sm font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <span>Set PIN to Send Money</span>
                    <span>→</span>
                  </button>
                ) : (
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
                )}
              </div>
            </form>
          </motion.div>
        </div>
      </AnimatePresence>

      <SetPinModal
        isOpen={showSetPinModal}
        onClose={() => setShowSetPinModal(false)}
        onSuccess={() => {
          setErrorMessage('');
          setHasPin(true);
          checkPinStatus();
        }}
      />
    </>,
    document.body
  );
}
