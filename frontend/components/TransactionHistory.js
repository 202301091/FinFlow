"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';

const listVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.35, ease: 'easeOut' },
  },
};

export default function TransactionHistory({ refreshTrigger }) {
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTx, setSelectedTx] = useState(null);

  const fetchTransactions = async (page = 1, limit = 10) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/transactions?page=${page}&limit=${limit}`);
      if (response?.data) {
        setTransactions(response.data.transactions || []);
        setPagination(
          response.data.pagination || {
            page: 1,
            limit: 10,
            total: 0,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false,
          }
        );
      }
    } catch (err) {
      setError(err.message || 'Failed to load transaction history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions(pagination.page, pagination.limit);
  }, [pagination.page, pagination.limit, refreshTrigger]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.totalPages && newPage !== pagination.page) {
      fetchTransactions(newPage, pagination.limit);
    }
  };

  const handleViewDetails = async (txId) => {
    try {
      const response = await api.get(`/transactions/${txId}`);
      setSelectedTx(response.data);
    } catch (err) {
      console.error('Failed to fetch details:', err);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <section className="space-y-4">
      {/* Header with Motion */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Transaction History
            </h3>
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              key={pagination.total}
              className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
            >
              {pagination.total} {pagination.total === 1 ? 'record' : 'records'}
            </motion.span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Audit ledger of your inbound and outbound transfers
          </p>
        </div>

        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => fetchTransactions(pagination.page, pagination.limit)}
            disabled={loading}
            title="Refresh transaction history"
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
          >
            <span className={`text-sm ${loading ? 'animate-spin' : ''}`}>🔄</span>
            <span className="hidden sm:inline">Refresh</span>
          </motion.button>
        </div>
      </motion.div>

      {/* Main Content Area */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.1 }}
        className="bg-white dark:bg-slate-900/90 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xl shadow-slate-950/5 overflow-hidden"
      >
        {/* Loading Skeleton */}
        {loading && transactions.length === 0 ? (
          <div className="p-8 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0.4 }}
                animate={{ opacity: [0.4, 0.8, 0.4] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
                className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-800/60"
              />
            ))}
          </div>
        ) : error ? (
          /* Error State */
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-12 text-center space-y-3"
          >
            <div className="text-3xl">⚠️</div>
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => fetchTransactions(1, pagination.limit)}
              className="px-4 py-2 bg-sky-500 text-white rounded-xl text-xs font-semibold hover:bg-sky-400 cursor-pointer shadow-md"
            >
              Retry
            </motion.button>
          </motion.div>
        ) : transactions.length === 0 ? (
          /* Empty State */
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="p-14 text-center space-y-3"
          >
            <div className="text-4xl animate-bounce">📄</div>
            <h4 className="text-base font-bold text-slate-900 dark:text-white">
              No transactions found
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
              Once you send or receive money through FinFlow, your atomic ledger receipts will appear here in chronological order.
            </p>
          </motion.div>
        ) : (
          /* Staggered Animated Transactions List */
          <motion.div
            variants={listVariants}
            initial="hidden"
            animate="visible"
            className="divide-y divide-slate-100 dark:divide-slate-800/80"
          >
            {transactions.map((tx) => {
              const isDebit = tx.direction === 'debit';
              const amountVal = parseFloat(tx.amount);
              const formattedAmount = isNaN(amountVal)
                ? '0.00'
                : amountVal.toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  });

              const counterpartyName = isDebit
                ? tx.receiver_name || 'FinFlow User'
                : tx.sender_name || 'FinFlow User';
              const counterpartyEmail = isDebit ? tx.receiver_email : tx.sender_email;

              return (
                <motion.div
                  key={tx.id}
                  variants={itemVariants}
                  whileHover={{
                    backgroundColor: 'rgba(241, 245, 249, 0.6)',
                    x: 4,
                    transition: { duration: 0.15 },
                  }}
                  onClick={() => handleViewDetails(tx.id)}
                  className="p-4 sm:p-5 flex items-center justify-between transition-colors cursor-pointer group dark:hover:bg-slate-800/40"
                >
                  {/* Left: Direction Icon + Details */}
                  <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
                    <motion.div
                      whileHover={{ scale: 1.15, rotate: isDebit ? -10 : 10 }}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center text-lg shrink-0 font-bold shadow-sm transition-transform ${
                        isDebit
                          ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-900/50'
                          : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-900/50'
                      }`}
                    >
                      {isDebit ? '↗' : '↙'}
                    </motion.div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {isDebit ? `Sent to ${counterpartyName}` : `Received from ${counterpartyName}`}
                        </p>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                            tx.status === 'completed'
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {tx.status}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {tx.description ? (
                          <span className="italic truncate max-w-[180px] sm:max-w-xs font-medium text-slate-700 dark:text-slate-300">
                            &ldquo;{tx.description}&rdquo;
                          </span>
                        ) : (
                          <span>{counterpartyEmail || 'Transfer'}</span>
                        )}
                        <span>•</span>
                        <span>{formatDate(tx.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Amount & Receipt Preview */}
                  <div className="text-right shrink-0 ml-4">
                    <p
                      className={`text-base sm:text-lg font-black tracking-tight ${
                        isDebit
                          ? 'text-slate-900 dark:text-white'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {isDebit ? '-' : '+'}₹{formattedAmount}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
                      {tx.id.slice(0, 8)}...
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Pagination Footer with Framer Motion Buttons */}
        {pagination.totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <div>
              Showing Page <span className="font-bold text-slate-900 dark:text-white">{pagination.page}</span> of{' '}
              <span className="font-bold text-slate-900 dark:text-white">{pagination.totalPages}</span> ({pagination.total} total)
            </div>

            <div className="flex items-center gap-2">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={!pagination.hasPrevPage || loading}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm"
              >
                ← Prev
              </motion.button>

              {/* Numeric Page Chips */}
              <div className="hidden sm:flex items-center gap-1.5">
                {Array.from({ length: pagination.totalPages }, (_, idx) => idx + 1).map((p) => (
                  <motion.button
                    key={p}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handlePageChange(p)}
                    className={`w-8 h-8 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      p === pagination.page
                        ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/25'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {p}
                  </motion.button>
                ))}
              </div>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={!pagination.hasNextPage || loading}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm"
              >
                Next →
              </motion.button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Spring Animated Transaction Receipt Modal */}
      <AnimatePresence>
        {selectedTx && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl space-y-5"
            >
              {/* Receipt Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">🧾</span>
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white">Transaction Receipt</h4>
                    <p className="text-[11px] text-slate-400">Cryptographically verified record</p>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setSelectedTx(null)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-2xl font-bold cursor-pointer p-1"
                >
                  &times;
                </motion.button>
              </div>

              {/* Amount Highlight */}
              <div className="text-center py-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">
                  {selectedTx.direction === 'debit' ? 'Total Debited' : 'Total Credited'}
                </p>
                <p
                  className={`text-4xl font-black mt-1 tracking-tight ${
                    selectedTx.direction === 'debit'
                      ? 'text-slate-900 dark:text-white'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {selectedTx.direction === 'debit' ? '-' : '+'}₹
                  {parseFloat(selectedTx.amount).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                  })}
                </p>
                <span className="inline-block mt-2.5 text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  {selectedTx.status}
                </span>
              </div>

              {/* Ledger Metadata Details */}
              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400">Transaction ID</span>
                  <span className="font-mono font-medium text-slate-700 dark:text-slate-300 select-all">
                    {selectedTx.id}
                  </span>
                </div>

                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400">Sender</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {selectedTx.sender?.name} ({selectedTx.sender?.email})
                  </span>
                </div>

                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400">Receiver</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {selectedTx.receiver?.name} ({selectedTx.receiver?.email})
                  </span>
                </div>

                <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400">Description</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {selectedTx.description || 'No memo provided'}
                  </span>
                </div>

                <div className="flex justify-between py-1.5">
                  <span className="text-slate-400">Timestamp</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {formatDate(selectedTx.created_at)}
                  </span>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="button"
                onClick={() => setSelectedTx(null)}
                className="w-full py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Close Receipt
              </motion.button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </section>
  );
}
