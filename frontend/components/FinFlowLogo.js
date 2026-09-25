"use client";

import React from 'react';
import Image from 'next/image';

/**
 * FinFlowLogo - Renders the user's authentic FinFlow rising-arrows emblem
 * and brand typography with crisp scaling and seamless Dark/Light mode support.
 */
export default function FinFlowLogo({
  size = 'md',
  showText = true,
  subtitle = '',
  iconOnly = false,
  className = '',
}) {
  const sizeMap = {
    sm: { height: 32, width: 44, text: 'text-xl', sub: 'text-[8px]', gap: 'gap-2.5' },
    md: { height: 40, width: 55, text: 'text-2xl', sub: 'text-[9px]', gap: 'gap-3' },
    lg: { height: 50, width: 68, text: 'text-3xl', sub: 'text-[10px]', gap: 'gap-3.5' },
    xl: { height: 68, width: 92, text: 'text-4xl', sub: 'text-xs', gap: 'gap-4' },
  };

  const current = sizeMap[size] || sizeMap.md;

  return (
    <div className={`inline-flex items-center ${current.gap} select-none ${className}`}>
      {/* Official Authentic Emblem Image */}
      <div
        className="relative shrink-0 flex items-center justify-center p-1 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 shadow-sm transition-transform duration-300 group-hover:scale-105"
        style={{ width: current.width, height: current.height }}
      >
        <Image
          src="/finflow-emblem.png"
          alt="FinFlow Official Emblem"
          fill
          sizes={`${current.width}px`}
          className="object-contain p-0.5"
          priority
        />
      </div>

      {/* Brand Typography */}
      {showText && !iconOnly && (
        <div className="flex flex-col text-left leading-none">
          <div className={`font-black tracking-tight ${current.text}`}>
            <span className="text-slate-950 dark:text-white transition-colors duration-200">Fin</span>
            <span className="bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Flow
            </span>
          </div>
          {subtitle ? (
            <span className={`uppercase font-bold tracking-widest text-slate-500 dark:text-slate-400 mt-1 ${current.sub}`}>
              {subtitle}
            </span>
          ) : (
            <span className={`uppercase font-bold tracking-widest text-slate-500 dark:text-slate-400 mt-0.5 ${current.sub}`}>
              Financial Platform
            </span>
          )}
        </div>
      )}
    </div>
  );
}
