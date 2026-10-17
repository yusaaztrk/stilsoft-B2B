import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';

/**
 * useRefreshOnFocus
 *
 * Automatically invalidates (and refetches) the given query keys whenever
 * the screen receives navigation focus.  This keeps the screen in sync with
 * changes made on other devices (web / mobile) without requiring a re-login.
 *
 * Usage:
 *   useRefreshOnFocus(['ariza', 'saha']);
 *   useRefreshOnFocus(['servicerecords', 'paged', 'installation']);
 */
export function useRefreshOnFocus(queryKey: readonly unknown[]) {
  const qc = useQueryClient();

  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey });
    }, [qc, queryKey]) // eslint-disable-line react-hooks/exhaustive-deps
  );
}

/**
 * useAutoRefetch
 *
 * Combined hook:
 * - Invalidates queries on navigation focus (screen becomes visible)
 * - Refetches every `intervalMs` milliseconds (default 30 seconds) as long as
 *   the screen is focused.
 *
 * Usage:
 *   useAutoRefetch(['ariza', 'saha']);
 *   useAutoRefetch(['servicerecords', 'paged', 'installation'], 60_000);
 */
export function useAutoRefetch(queryKey: readonly unknown[], intervalMs = 30_000) {
  const qc = useQueryClient();

  useFocusEffect(
    useCallback(() => {
      // Immediate refetch on focus
      qc.invalidateQueries({ queryKey });

      // Periodic polling while focused
      const timer = setInterval(() => {
        qc.invalidateQueries({ queryKey });
      }, intervalMs);

      return () => clearInterval(timer);
    }, [qc, queryKey, intervalMs]) // eslint-disable-line react-hooks/exhaustive-deps
  );
}
