'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, LogOut, AlertCircle, Home, Sparkles, Terminal, RotateCcw } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/services/api';

import { SignInForm } from '@/components/auth/SignInForm';

export const TopNav: React.FC = () => {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { principal, isAuthenticated, isDemoPreview, enableDemoPreview, setToken, logout, error } =
    useAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleResetDemoData = async () => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        'Reset all synthetic demo data back to canonical default 3 scenarios? Custom tenders, bidders, and audit logs will be cleared.'
      );
      if (confirmed) {
        try {
          await apiClient.resetDemo();
          window.location.reload();
        } catch (err: unknown) {
          alert(err instanceof Error ? err.message : 'Failed to reset demo data on backend.');
        }
      }
    }
  };

  const [tokenInputOpen, setTokenInputOpen] = useState(false);
  const [tokenInputValue, setTokenInputValue] = useState('');
  const [tokenSubmitting, setTokenSubmitting] = useState(false);

  const handleConnectToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInputValue.trim()) return;
    try {
      setTokenSubmitting(true);
      await setToken(tokenInputValue.trim());
      setTokenInputOpen(false);
      setTokenInputValue('');
    } catch {
      // Error handled by AuthContext
    } finally {
      setTokenSubmitting(false);
    }
  };

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-6 flex items-center justify-between select-none shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        {!mounted ? null : isDemoPreview ? (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-amber-950/60 border border-amber-800/80 text-amber-300 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="font-semibold tracking-wide">SYNTHETIC DEMO DATA</span>
            <span className="text-amber-400/70 hidden lg:inline">• Non-authoritative preview</span>
            <button
              onClick={handleResetDemoData}
              className="ml-2 px-2 py-0.5 rounded bg-amber-900/60 hover:bg-amber-800 text-amber-200 hover:text-white text-[11px] inline-flex items-center gap-1 border border-amber-700/60 cursor-pointer"
              title="Reset all synthetic demo data back to canonical default 3 scenarios"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Demo Data</span>
            </button>
            <button
              onClick={() => enableDemoPreview(false)}
              className="ml-1 underline text-amber-200 hover:text-white text-[11px] cursor-pointer"
            >
              Exit Demo
            </button>
          </div>
        ) : isAuthenticated ? (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-emerald-950/60 border border-emerald-800/80 text-emerald-300 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="font-semibold tracking-wide">AUTHENTICATED SESSION</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-400 text-xs font-mono">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
            <span>Session Required / Token Expired</span>
            <button
              onClick={() => enableDemoPreview(true)}
              className="ml-2 px-2.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-sans font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3 h-3" />
              <span>Open Demo Workspace</span>
            </button>
          </div>
        )}
      </div>

      {/* User Session & Status Controls */}
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 hover:text-white text-xs font-mono transition-colors"
          title="Return to Public Landing Page"
        >
          <Home className="w-3.5 h-3.5 text-slate-400" />
          <span>Landing Page</span>
        </Link>

        <Link
          href="/workspace/status"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 hover:text-white text-xs font-mono transition-colors"
        >
          <Activity className="w-3.5 h-3.5 text-indigo-400" />
          <span>Status</span>
        </Link>

        {isAuthenticated && principal ? (
          <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold text-slate-200 leading-tight">
                {principal.full_name || principal.name || 'ARGUS Evaluation Officer'}
              </p>
              <p className="text-[11px] font-mono text-slate-400 leading-tight">
                {principal.email || 'demo.procurement@argus.local'}
              </p>
            </div>
            <button
              onClick={() => {
                logout();
                router.push('/');
              }}
              title="Logout"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-rose-400 hover:border-rose-800/60 transition-colors text-xs font-mono cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTokenInputOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
            <button
              onClick={() => setTokenInputOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-mono transition-colors cursor-pointer"
              title="Advanced: Enter Authorized Bearer Token"
            >
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span>Authorized Access</span>
            </button>
          </div>
        )}
      </div>

      {/* Connect Development Token Modal */}
      {tokenInputOpen && (
        <div className="absolute top-16 right-6 z-50 w-96 p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              <h4 className="text-xs font-bold text-white font-mono">Workspace Authentication</h4>
            </div>
            <button
              onClick={() => {
                setTokenInputOpen(false);
              }}
              className="text-slate-500 hover:text-slate-300 text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-800/60 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-indigo-200 font-semibold font-mono">ARGUS Officer Sign In</span>
            </div>
            <SignInForm
              onSuccess={() => setTokenInputOpen(false)}
              onCancel={() => setTokenInputOpen(false)}
              showDemoButton={false}
            />
          </div>

          <div className="border-t border-slate-800 pt-2 space-y-2">
            <p className="text-[11px] text-slate-400 font-medium">
              Or Connect Custom Bearer Token:
            </p>
            <form onSubmit={handleConnectToken} className="space-y-2">
              <input
                type="password"
                placeholder="Paste Bearer Token..."
                value={tokenInputValue}
                onChange={(e) => setTokenInputValue(e.target.value)}
                className="w-full p-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
              />
              {error && <p className="text-[11px] text-rose-400 font-mono leading-tight">{error}</p>}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    enableDemoPreview(true);
                    setTokenInputOpen(false);
                  }}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                >
                  Open Demo Workspace
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTokenInputOpen(false)}
                    className="px-2.5 py-1 text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={tokenSubmitting}
                    className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg font-medium cursor-pointer"
                  >
                    {tokenSubmitting ? 'Verifying...' : 'Verify Token'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
