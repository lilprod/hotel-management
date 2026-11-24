import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

import { apiClient } from '../auth/session';

/**
 * Socket.io client (doc 03 §4): one shared connection per tab, authenticated with the access
 * token of the session (re-read on every (re)connection, so a refreshed token is used). The
 * server joins the property rooms itself: the client never chooses a room.
 */

export interface PlanningChange {
  propertyId: string;
  reservationId?: string;
  action?: string;
  from?: string;
  to?: string;
  reservationRoomIds?: string[];
}

export const PLANNING_CHANGED = 'planning.changed';
/** Envelope used by the outbox relay for every realtime domain event. */
const ENVELOPE = 'event';

let socket: Socket | null = null;
let users = 0;

function acquire(): Socket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      withCredentials: true,
      autoConnect: true,
      reconnectionDelayMax: 10_000,
      auth: (cb) => cb({ token: apiClient.getAccessToken() ?? '' }),
    });
  }
  users += 1;
  return socket;
}

function release() {
  users -= 1;
  if (users <= 0 && socket) {
    socket.disconnect();
    socket = null;
    users = 0;
  }
}

/**
 * Calls `onChange` for every `type` event of `propertyId` (relayed envelope `{ type, payload }`
 * on the `event` channel, or a bare event named `type`).
 */
export function useRealtimeEvent<T extends { propertyId: string }>(
  type: string,
  propertyId: string | null,
  onChange: (change: T) => void,
): void {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  useEffect(() => {
    if (!propertyId) return;
    const s = acquire();
    const handle = (payload: T | undefined) => {
      if (payload && payload.propertyId === propertyId) cb.current(payload);
    };
    const onEnvelope = (msg: { type?: string; payload?: T }) => {
      if (msg?.type === type) handle(msg.payload);
    };
    s.on(ENVELOPE, onEnvelope);
    s.on(type, handle);
    return () => {
      s.off(ENVELOPE, onEnvelope);
      s.off(type, handle);
      release();
    };
  }, [propertyId, type]);
}

export function usePlanningRealtime(
  propertyId: string | null,
  onChange: (change: PlanningChange) => void,
): void {
  useRealtimeEvent<PlanningChange>(PLANNING_CHANGED, propertyId, onChange);
}

export interface FolioChange {
  propertyId: string;
  folioId: string;
  action?: string;
}
export const FOLIO_CHANGED = 'folio.changed';

/** Live refresh of folios: `onChange` for every `folio.changed` of the property. */
export function useFolioRealtime(
  propertyId: string | null,
  onChange: (change: FolioChange) => void,
): void {
  useRealtimeEvent<FolioChange>(FOLIO_CHANGED, propertyId, onChange);
}
