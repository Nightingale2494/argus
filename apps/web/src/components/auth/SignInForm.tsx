'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Lock, Mail, AlertCircle, Loader2, Terminal, KeyRound } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface SignInFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  showDemoButton?: boolean;
  className?: string;
  redirectTo?: string;
}

export const SignInForm: React.FC<SignInFormProps> = ({
  onSuccess,
  onCancel,
  showDemoButton = true,
  className = '',
  redirectTo = '/workspace',
}) => {
  const router = useRouter();
  const { loginDevOfficer, enableDemoPreview } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMessage('Please enter both email address and password.');
      return;
    }

    try {
      setSigningIn(true);
      setErrorMessage(null);
      const success = await loginDevOfficer({
        email: cleanEmail,
        password,
      });

      if (success) {
        if (onSuccess) {
          onSuccess();
        } else if (redirectTo) {
          router.push(redirectTo);
        }
      } else {
        setErrorMessage('Invalid credentials. Please verify your email and password.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      setErrorMessage(msg);
    } finally {
      setSigningIn(false);
    }
  };

  const handleUseDemoCredentials = () => {
    setEmail('demo.procurement@argus.local');
    setPassword('ArgusDemo2026!');
    setErrorMessage(null);
  };

  const handleOpenDemoWorkspace = () => {
    enableDemoPreview(true);
    router.push('/workspace?mode=demo');
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {errorMessage && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-2 p-3 rounded-lg bg-rose-950/50 border border-rose-800/80 text-rose-300 text-xs font-mono"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3.5 text-left" noValidate>
        {/* Email Address */}
        <div>
          <label
            htmlFor="argus-signin-email"
            className="block text-xs font-mono text-slate-300 font-medium mb-1.5"
          >
            Email Address
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
              <Mail className="w-4 h-4" />
            </div>
            <input
              id="argus-signin-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="officer@argus.gov.in"
              disabled={signingIn}
              className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Password */}
        <div>
          <label
            htmlFor="argus-signin-password"
            className="block text-xs font-mono text-slate-300 font-medium mb-1.5"
          >
            Password
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
              <Lock className="w-4 h-4" />
            </div>
            <input
              id="argus-signin-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              disabled={signingIn}
              className="w-full pl-9 pr-10 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 font-mono placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-1">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={signingIn}
              className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={signingIn}
            className={`${onCancel ? 'flex-1 sm:flex-initial' : 'w-full'} inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {signingIn ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Validating credentials...</span>
              </>
            ) : (
              <span>Sign In to Workspace</span>
            )}
          </button>
        </div>
      </form>

      {/* Convenience shortcuts: Use Demo Credentials & Open Demo Workspace */}
      {showDemoButton && (
        <div className="space-y-3 pt-2">
          {/* OR Divider */}
          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-800" />
            <span className="flex-shrink mx-3 text-[10px] font-mono uppercase tracking-wider text-slate-500">OR</span>
            <div className="flex-grow border-t border-slate-800" />
          </div>

          {/* Button 1: Use Demo Credentials */}
          <div>
            <button
              type="button"
              onClick={handleUseDemoCredentials}
              disabled={signingIn}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 text-slate-200 hover:text-white text-xs font-mono transition-all cursor-pointer disabled:opacity-50"
            >
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>Use Demo Credentials</span>
            </button>
            <p className="mt-1 text-[11px] text-slate-400 font-mono text-center">
              Fill the evaluation account for the authenticated workspace.
            </p>
          </div>

          {/* Button 2: Open Demo Workspace */}
          <div>
            <button
              type="button"
              onClick={handleOpenDemoWorkspace}
              disabled={signingIn}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800/60 border border-indigo-900/60 hover:border-indigo-700/60 text-indigo-300 hover:text-indigo-200 text-xs font-mono transition-all cursor-pointer disabled:opacity-50"
            >
              <Terminal className="w-3.5 h-3.5 text-indigo-400" />
              <span>Open Demo Workspace</span>
            </button>
            <p className="mt-1 text-[11px] text-slate-400 font-mono text-center">
              Explore the synthetic fallback/demo environment.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
