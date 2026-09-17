'use client';

import React from 'react';
import Link from 'next/link';
import { ShieldAlert, Sparkles, Terminal, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { SignInForm } from '@/components/auth/SignInForm';

interface SessionRequiredProps {
  onConnectToken?: () => void;
  title?: string;
  description?: string;
}

export const SessionRequired: React.FC<SessionRequiredProps> = ({
  onConnectToken,
  title = 'ARGUS Workspace Access',
  description = 'Choose an access method to begin deterministic compliance evaluation and vendor qualification.',
}) => {
  const { enableDemoPreview, loginWithToken, error } = useAuth();
  const [devFormOpen, setDevFormOpen] = React.useState(false);
  const [customTokenOpen, setCustomTokenOpen] = React.useState(false);
  const [tokenInput, setTokenInput] = React.useState('');
  const [submittingCustom, setSubmittingCustom] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    try {
      setSubmittingCustom(true);
      setActionError(null);
      const success = await loginWithToken(tokenInput.trim());
      if (success) {
        setCustomTokenOpen(false);
      } else {
        setActionError('Session Required / Token Expired: Invalid Bearer token provided.');
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Verification failed.');
    } finally {
      setSubmittingCustom(false);
    }
  };

  const displayedError = actionError || error;

  return (
    <div className="flex flex-col items-center justify-center p-8 sm:p-10 max-w-2xl mx-auto my-8 text-center rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur-md shadow-2xl space-y-6">
      <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center shadow-inner">
        <ShieldAlert className="w-7 h-7 text-indigo-400" />
      </div>

      <div className="space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700 text-slate-300 text-xs font-mono">
          <span>WORKSPACE ACCESS</span>
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">{title}</h2>
        <p className="text-xs text-slate-400 leading-relaxed max-w-lg mx-auto font-sans">
          {description}
        </p>
        {displayedError && (
          <p className="text-xs text-rose-400 font-mono bg-rose-950/40 p-2.5 rounded-lg border border-rose-800/60 max-w-md mx-auto">
            {displayedError}
          </p>
        )}
      </div>

      {/* Primary & Secondary Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-lg pt-2">
        {/* Option 1: Demo */}
        <button
          onClick={() => enableDemoPreview(true)}
          className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 text-slate-200 shadow-md transition-all cursor-pointer group"
        >
          <Sparkles className="w-5 h-5 text-amber-400 mb-2 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-semibold text-white">Enter Demo Workspace</span>
          <span className="text-[10px] text-slate-400 font-mono mt-1">Synthetic data preview</span>
        </button>

        {/* Option 2: Sign In (Opens Credential Form) */}
        <button
          onClick={() => {
            setDevFormOpen(!devFormOpen);
            setCustomTokenOpen(false);
          }}
          className={`flex flex-col items-center justify-center p-4 rounded-xl transition-all cursor-pointer group ${
            devFormOpen
              ? 'bg-indigo-600/30 border-2 border-indigo-400 text-white shadow-lg shadow-indigo-600/20'
              : 'bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 hover:border-indigo-400 text-indigo-200 shadow-lg shadow-indigo-600/10'
          }`}
        >
          <Sparkles className="w-5 h-5 text-indigo-400 mb-2 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-semibold text-white">Sign In with Credentials</span>
          <span className="text-[10px] text-indigo-300/80 font-mono mt-1">Officer account</span>
        </button>

        {/* Option 3: Authorized Access */}
        <button
          onClick={() => {
            if (onConnectToken) {
              onConnectToken();
            } else {
              setCustomTokenOpen(!customTokenOpen);
              setDevFormOpen(false);
            }
          }}
          className={`flex flex-col items-center justify-center p-4 rounded-xl transition-all cursor-pointer group ${
            customTokenOpen
              ? 'bg-slate-800 border-2 border-slate-500 text-white'
              : 'bg-slate-900 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 text-slate-300 shadow-md'
          }`}
        >
          <Terminal className="w-5 h-5 text-slate-400 mb-2 group-hover:scale-110 transition-transform" />
          <span className="text-xs font-semibold text-white">Authorized Access</span>
          <span className="text-[10px] text-slate-400 font-mono mt-1">Custom Bearer JWT</span>
        </button>
      </div>

      {/* Dev Credential Form */}
      {devFormOpen && (
        <div className="w-full max-w-lg p-5 rounded-xl bg-slate-950/90 border border-indigo-500/30 text-left shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
            <span className="text-xs font-semibold text-white font-mono flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              ARGUS Officer Sign In
            </span>
          </div>
          <SignInForm
            onSuccess={() => setDevFormOpen(false)}
            onCancel={() => setDevFormOpen(false)}
            showDemoButton={false}
          />
        </div>
      )}

      {/* Inline Custom Token Form if opened */}
      {customTokenOpen && (
        <form onSubmit={handleCustomSubmit} className="w-full max-w-lg space-y-2 p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-left">
          <label className="block text-[11px] font-mono text-slate-400">Paste Bearer JWT Access Token (Authorized Access):</label>
          <input
            type="password"
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI..."
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="w-full p-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setCustomTokenOpen(false)}
              className="px-3 py-1 rounded text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingCustom}
              className="px-4 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
            >
              {submittingCustom ? 'Verifying with /auth/me...' : 'Verify & Enter'}
            </button>
          </div>
        </form>
      )}

      <div className="pt-4 border-t border-slate-800/80 w-full flex items-center justify-center gap-4 text-xs text-slate-500 font-mono">
        <Link href="/" className="inline-flex items-center gap-1 text-slate-400 hover:text-indigo-300 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Public Showcase</span>
        </Link>
        <span>•</span>
        <span>Audit-Ready Deterministic Evaluation</span>
      </div>
    </div>
  );
};
