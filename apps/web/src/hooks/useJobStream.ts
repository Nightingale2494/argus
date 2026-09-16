'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, getApiBaseUrl, getAuthToken } from '@/services/api';
import type { JobEventRead, JobRead, JobStage, JobStatus } from '@/types/api';

/**
 * Canonical ProcessingJob terminal lifecycle statuses.
 * Expected: QUEUED -> RUNNING -> COMPLETED | FAILED.
 * REVIEW_REQUIRED is a compliance outcome / workflow stage, NOT a ProcessingJob status.
 */
const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['COMPLETED', 'FAILED'];

function isTerminalStatus(status: string | null | undefined): boolean {
  return !!status && (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

interface UseJobStreamOptions {
  jobId: string | null;
  onCompleted?: (job: JobRead) => void;
  onFailed?: (error: string) => void;
  pollingFallbackIntervalMs?: number;
}

export function useJobStream({
  jobId,
  onCompleted,
  onFailed,
  pollingFallbackIntervalMs = 2500,
}: UseJobStreamOptions) {
  const [job, setJob] = useState<JobRead | null>(null);
  const [events, setEvents] = useState<JobEventRead[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastSeqRef = useRef<number>(0);
  const isTerminalRef = useRef(false);
  const terminalFiredRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const onCompletedRef = useRef(onCompleted);
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
    onFailedRef.current = onFailed;
  });

  const checkJobStatus = useCallback(
    async (id: string) => {
      try {
        const currentJob = await apiClient.getJob(id);
        setJob(currentJob);

        if (isTerminalStatus(currentJob.status)) {
          isTerminalRef.current = true;
          setIsStreaming(false);
          if (terminalFiredRef.current !== id) {
            terminalFiredRef.current = id;
            if (currentJob.status === 'FAILED') {
              onFailedRef.current?.(currentJob.error_message || 'Job execution failed');
            } else {
              onCompletedRef.current?.(currentJob);
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unable to read job status.';
        setError(msg);
      }
    },
    []
  );

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setEvents([]);
      setIsStreaming(false);
      isTerminalRef.current = false;
      terminalFiredRef.current = null;
      lastSeqRef.current = 0;
      return;
    }

    isTerminalRef.current = false;
    terminalFiredRef.current = null;
    setIsStreaming(true);
    setError(null);

    // Initial check for real backend job
    checkJobStatus(jobId);

    // Abort previous stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let intervalId: NodeJS.Timeout | null = null;

    // Start fetch-based authenticated SSE streaming
    async function startStream() {
      const token = getAuthToken();
      const baseUrl = getApiBaseUrl();
      const url = `${baseUrl}/api/v1/jobs/${encodeURIComponent(jobId!)}/events`;

      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      if (lastSeqRef.current > 0) {
        headers['Last-Event-ID'] = String(lastSeqRef.current);
      }

      try {
        const response = await fetch(url, {
          headers,
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE stream connection failed: HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!isTerminalRef.current && !abortController.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              try {
                const jsonStr = trimmed.slice(5).trim();
                if (jsonStr) {
                  const eventData: JobEventRead = JSON.parse(jsonStr);
                  if (eventData.progress !== undefined) {
                    lastSeqRef.current = Math.max(lastSeqRef.current, eventData.progress);
                  }
                  setEvents((prev) => {
                    if (prev.some((existing) => existing.id === eventData.id)) {
                      return prev;
                    }
                    return [...prev, eventData];
                  });

                  if (isTerminalStatus(eventData.status)) {
                    isTerminalRef.current = true;
                    setIsStreaming(false);
                    abortController.abort();
                    if (intervalId) clearInterval(intervalId);
                    checkJobStatus(jobId!);
                    break;
                  }
                }
              } catch {
                // Ignore SSE line parse errors
              }
            }
          }
        }
      } catch {
        if (!abortController.signal.aborted) {
          // Fallback gracefully to polling
        }
      }
    }

    startStream();

    // Polling fallback ticker
    intervalId = setInterval(() => {
      if (!isTerminalRef.current) {
        checkJobStatus(jobId);
      } else if (intervalId) {
        clearInterval(intervalId);
      }
    }, pollingFallbackIntervalMs);

    return () => {
      abortController.abort();
      if (intervalId) clearInterval(intervalId);
    };
  }, [jobId, checkJobStatus, pollingFallbackIntervalMs]);

  const currentStage: JobStage =
    job?.current_stage ?? (events.length > 0 ? events[events.length - 1].stage : 'UPLOAD');

  return {
    job,
    events,
    isStreaming,
    error,
    progress: job?.progress ?? (events.length > 0 ? events[events.length - 1].progress : 0),
    currentStage,
    isCompleted: job?.status === 'COMPLETED',
    isFailed: job?.status === 'FAILED',
    isReviewRequired: currentStage === 'HUMAN_REVIEW_REQUIRED',
    isTerminal: isTerminalStatus(job?.status),
  };
}
