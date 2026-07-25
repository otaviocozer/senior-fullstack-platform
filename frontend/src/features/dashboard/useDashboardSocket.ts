import { useEffect, useRef } from 'react';
import { useStore } from 'react-redux';
import { useAppDispatch } from '../../hooks';
import type { RootState } from '../../store';
import { api, API_BASE } from '../../services/api';
import { getAccessToken } from '../auth/tokenStorage';
import type { ApprovalUpdateMessage, ProjectListParams } from '../../types';

/**
 * Derive the websocket origin from the REST API base.
 * - Relative base (e.g. "/api"): use the current page origin with ws/wss.
 * - Absolute base (http(s)://host): swap the scheme to ws(s).
 */
function deriveWsBase(): string {
  if (/^https?:\/\//i.test(API_BASE)) {
    return API_BASE.replace(/^http/i, 'ws').replace(/\/?api\/?$/i, '');
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}`;
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Opens a websocket to the dashboard channel and keeps the RTK Query caches
 * in sync with server-pushed approval updates. Reconnects with exponential
 * backoff. Mount once on the dashboard.
 */
export function useDashboardSocket(): void {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const closedByUnmount = useRef(false);

  useEffect(() => {
    closedByUnmount.current = false;

    const connect = () => {
      const token = getAccessToken();
      if (!token) return; // Can't authenticate the socket without a token.

      const url = `${deriveWsBase()}/ws/dashboard/?token=${encodeURIComponent(
        token,
      )}`;

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0; // reset backoff on a healthy connection
      };

      ws.onmessage = (event: MessageEvent) => {
        let payload: unknown;
        try {
          payload = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (
          !payload ||
          typeof payload !== 'object' ||
          (payload as { type?: string }).type !== 'approval.update'
        ) {
          return;
        }
        const msg = payload as ApprovalUpdateMessage;

        // Patch the project's status in every cached list for instant feedback.
        const state = store.getState() as unknown as {
          api: {
            queries: Record<
              string,
              { endpointName?: string; originalArgs?: ProjectListParams }
            >;
          };
        };
        for (const entry of Object.values(state.api.queries)) {
          if (entry?.endpointName !== 'getProjects') continue;
          dispatch(
            api.util.updateQueryData(
              'getProjects',
              entry.originalArgs as ProjectListParams,
              (draft) => {
                const row = draft.results.find((p) => p.id === msg.project_id);
                if (row) {
                  row.status = msg.status;
                }
              },
            ),
          );
        }

        // Refetch analytics and reconcile the list from the server.
        dispatch(
          api.util.invalidateTags([
            'Analytics',
            { type: 'Projects', id: 'LIST' },
          ]),
        );
      };

      ws.onclose = () => {
        socketRef.current = null;
        if (!closedByUnmount.current) scheduleReconnect();
      };

      ws.onerror = () => {
        // Force a close so onclose drives the backoff/reconnect path.
        ws.close();
      };
    };

    const scheduleReconnect = () => {
      if (closedByUnmount.current) return;
      const attempt = attemptRef.current++;
      const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
      // Add a little jitter to avoid thundering-herd reconnects.
      const jitter = Math.random() * 500;
      reconnectTimer.current = setTimeout(connect, delay + jitter);
    };

    connect();

    return () => {
      closedByUnmount.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [dispatch, store]);
}
