'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ArrowLeft } from 'lucide-react';
import { SignInForm } from '@/components/auth/SignInForm';
import { AuthProvider, useAuth } from '@/hooks/useAuth';

function LoginContent() {
  const router = useRouter();
  const { isAuthenticated, isDemoPreview } = useAuth();

  useEffect(() => {
    if (isAuthenticated || isDemoPreview) {
      router.replace('/workspace');
    }
  }, [isAuthenticated, isDemoPreview, router]);

  return (
    <main className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 text-slate-100">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 mb-2 shadow-inner">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white font-sans">
            ARGUS Workspace Sign In
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Deterministic Compliance &amp; Bid Evaluation Platform
          </p>
        </div>

        {/* Card */}
        <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-md">
          <SignInForm
            redirectTo="/workspace"
            onSuccess={() => router.push('/workspace')}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-4 text-xs text-slate-500 font-mono">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-slate-400 hover:text-indigo-300 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Public Showcase</span>
          </Link>
          <span>•</span>
          <span>GeM Procurement Security</span>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <AuthProvider>
      <LoginContent />
    </AuthProvider>
  );
}
