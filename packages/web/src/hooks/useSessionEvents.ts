"use client";

import { useEffect, useReducer, useRef } from "react";
import type { DashboardSession, SSESnapshotEvent } from "@/lib/types";

type Action =
  | { type: "reset"; sessions: DashboardSession[] }
  | { type: "snapshot"; patches: SSESnapshotEvent["sessions"] };

function reducer(state: DashboardSession[], action: Action): DashboardSession[] {
  switch (action.type) {
    case "reset":
      return action.sessions;
    case "snapshot": {
      const patchMap = new Map(action.patches.map((p) => [p.id, p]));
      let changed = false;
      const next = state.map((s) => {
        const patch = patchMap.get(s.id);
        if (!patch) return s;
        if (
          s.status === patch.status &&
          s.activity === patch.activity &&
          s.lastActivityAt === patch.lastActivityAt
        ) {
          return s;
        }
        changed = true;
        return {
          ...s,
          status: patch.status,
          activity: patch.activity,
          lastActivityAt: patch.lastActivityAt,
        };
      });
      return changed ? next : state;
    }
  }
}

export function useSessionEvents(initialSessions: DashboardSession[]): DashboardSession[] {
  const [sessions, dispatch] = useReducer(reducer, initialSessions);
  const sessionsRef = useRef(sessions);
  const refreshingRef = useRef(false);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Reset state when server-rendered props change (e.g. full page refresh)
  useEffect(() => {
    dispatch({ type: "reset", sessions: initialSessions });
  }, [initialSessions]);

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as { type: string };
        if (data.type === "snapshot") {
          const snapshot = data as SSESnapshotEvent;
          const workerPatches = snapshot.sessions.filter((s) => !s.id.endsWith("-orchestrator"));
          dispatch({ type: "snapshot", patches: workerPatches });

          const currentIds = new Set(sessionsRef.current.map((s) => s.id));
          const snapshotIds = new Set(workerPatches.map((s) => s.id));
          const sameMembership =
            currentIds.size === snapshotIds.size &&
            [...snapshotIds].every((id) => currentIds.has(id));

          if (!sameMembership && !refreshingRef.current) {
            refreshingRef.current = true;
            void fetch("/api/sessions")
              .then((res) => (res.ok ? res.json() : null))
              .then((payload: { sessions?: DashboardSession[] } | null) => {
                if (payload?.sessions) {
                  dispatch({ type: "reset", sessions: payload.sessions });
                }
              })
              .finally(() => {
                refreshingRef.current = false;
              });
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here
    };

    return () => {
      es.close();
    };
  }, []);

  return sessions;
}
