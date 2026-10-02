"use client";

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getToken,
  getNotificationStreamUrl,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/api';

/**
 * Format timestamp into relative human-readable time
 */
function formatTimeAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);

  if (diffInSeconds < 30) return 'Just now';
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;

  return date.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
  });
}

export default function NotificationBell({ className = '' }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const dropdownRef = useRef(null);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // Fetch initial notifications
  const fetchInitialNotifications = async () => {
    try {
      setLoading(true);
      const res = await getNotifications({ page: 1, limit: 15 });
      if (res?.data) {
        setNotifications(res.data.notifications || []);
        setUnreadCount(res.data.unreadCount || 0);
      }
    } catch (err) {
      console.warn('[Notifications] Failed to load notifications:', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Setup Server-Sent Events (SSE) stream
  const connectSSE = () => {
    const token = getToken();
    if (!token) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const streamUrl = getNotificationStreamUrl();
    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    es.onopen = () => {
      // Connected to real-time notification stream
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Ignore keepalive or initial connection handshakes
        if (data.type === 'CONNECTED') return;

        // Process incoming transfer alert
        const newNotif = {
          id: data.id || `live-${Date.now()}`,
          type: data.type,
          title: data.title,
          message: data.message,
          data: data.data || {},
          is_read: false,
          created_at: data.created_at || new Date().toISOString(),
        };

        setNotifications((prev) => [newNotif, ...prev.slice(0, 19)]);
        setUnreadCount((prev) => prev + 1);

        // Trigger live toast alert
        setToast({
          id: newNotif.id,
          type: data.type,
          title: data.title,
          message: data.message,
        });
      } catch (e) {
        console.warn('[Notifications] SSE payload parse error:', e);
      }
    };

    es.onerror = () => {
      es.close();
      // Retry connection after 5 seconds
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        connectSSE();
      }, 5000);
    };
  };

  useEffect(() => {
    fetchInitialNotifications();
    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  // Dismiss toast after 5 seconds
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Mark single notification as read
  const handleMarkAsRead = async (id, isRead) => {
    if (isRead) return;
    try {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      await markNotificationRead(id);
    } catch (err) {
      console.warn('[Notifications] Failed to mark read:', err.message);
    }
  };

  // Mark all notifications as read
  const handleMarkAllAsRead = async () => {
    if (unreadCount === 0) return;
    try {
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      await markAllNotificationsRead();
    } catch (err) {
      console.warn('[Notifications] Failed to mark all read:', err.message);
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        type="button"
        aria-label="View notifications"
        className="relative p-2.5 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-all duration-300 shadow-sm hover:shadow-md cursor-pointer flex items-center justify-center group"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.75}
          stroke="currentColor"
          className="w-5 h-5 text-slate-600 dark:text-slate-300 group-hover:rotate-12 transition-transform duration-300"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>

        {/* Unread Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white dark:ring-slate-900">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute right-0 mt-2.5 w-80 sm:w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-slate-800 dark:text-slate-100">
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400 rounded-full">
                    {unreadCount} new
                  </span>
                )}
              </div>

              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 transition-colors cursor-pointer"
                >
                  Mark all as read
                </button>
              )}
            </div>

            {/* List */}
            <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
              {loading ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  Loading notifications...
                </div>
              ) : notifications.length === 0 ? (
                <div className="py-10 text-center px-4">
                  <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800/80 mx-auto flex items-center justify-center text-slate-400 mb-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-6 h-6"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                      />
                    </svg>
                  </div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    No notifications yet
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Live money transfer alerts will appear here.
                  </p>
                </div>
              ) : (
                notifications.map((notif) => {
                  const isReceived = notif.type === 'TRANSFER_RECEIVED';
                  const isSecurity = notif.type === 'SECURITY_NOTICE' || notif.type === 'SECURITY_ALERT';

                  let badgeBg = 'bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400';
                  let badgeIcon = '↑';

                  if (isSecurity) {
                    badgeBg = 'bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400';
                    badgeIcon = '🛡️';
                  } else if (isReceived) {
                    badgeBg = 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400';
                    badgeIcon = '↓';
                  }

                  return (
                    <div
                      key={notif.id}
                      onClick={() => handleMarkAsRead(notif.id, notif.is_read)}
                      className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer ${
                        notif.is_read
                          ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40 opacity-75'
                          : isSecurity
                          ? 'bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50/80 dark:hover:bg-amber-950/40'
                          : 'bg-sky-50/40 dark:bg-sky-950/20 hover:bg-sky-50/80 dark:hover:bg-sky-950/40'
                      }`}
                    >
                      {/* Icon */}
                      <div
                        className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-sm font-bold ${badgeBg}`}
                      >
                        {badgeIcon}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p
                            className={`text-xs font-bold truncate ${
                              notif.is_read
                                ? 'text-slate-700 dark:text-slate-300'
                                : isSecurity
                                ? 'text-amber-900 dark:text-amber-200'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {notif.title}
                          </p>
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {formatTimeAgo(notif.created_at)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug line-clamp-2">
                          {notif.message}
                        </p>
                      </div>

                      {/* Unread indicator */}
                      {!notif.is_read && (
                        <div
                          className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
                            isSecurity ? 'bg-amber-500' : 'bg-sky-500'
                          }`}
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Real-time Toast Pop-up Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed top-20 right-4 sm:right-8 z-50 max-w-sm w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-4 flex items-start gap-3 backdrop-blur-md"
          >
            <div
              className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-base font-bold ${
                toast.type === 'SECURITY_NOTICE' || toast.type === 'SECURITY_ALERT'
                  ? 'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400'
                  : toast.type === 'TRANSFER_RECEIVED'
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400'
                  : 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400'
              }`}
            >
              {toast.type === 'SECURITY_NOTICE' || toast.type === 'SECURITY_ALERT'
                ? '🛡️'
                : toast.type === 'TRANSFER_RECEIVED'
                ? '💰'
                : '📤'}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-white">
                {toast.title}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                {toast.message}
              </p>
            </div>

            <button
              onClick={() => setToast(null)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold p-1 cursor-pointer"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
