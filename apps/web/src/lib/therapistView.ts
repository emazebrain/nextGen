/**
 * Whose work the home page shows. A therapist always sees their own. A clinic manager sees everyone by default and,
 * when the clinic has several therapists, can switch to one of them — the same idea as switching between clinics.
 * The choice is kept per clinic for the browser session. The server decides what each person may see; this only
 * narrows it.
 */
import { useCallback, useState } from "react";
import { useCalendarTherapists, type CalendarTherapist } from "../api/calendar.ts";
import { useClinic } from "./clinic.tsx";

const keyOf = (clinicId: string) => `today.therapist.${clinicId}`;

function remembered(clinicId: string): string {
  try {
    return sessionStorage.getItem(keyOf(clinicId)) ?? "";
  } catch {
    return "";
  }
}

export interface TherapistView {
  /** The therapists to choose from; empty when there is nothing to switch between. */
  options: CalendarTherapist[];
  /** The chosen therapist's id, or "" for everyone. */
  chosen: string;
  choose: (id: string) => void;
  /** For the Today request: null = the signed-in user's own, "all", or a therapist id. */
  today: string | null;
  /** For lists of patients: a therapist id, or null for everyone the user can see. */
  patients: string | null;
}

export function useTherapistView(): TherapistView {
  const { clinicId, isManager } = useClinic();
  const therapists = useCalendarTherapists(isManager ? (clinicId ?? "") : "");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const list = isManager ? (therapists.data ?? []) : [];
  const options = list.length > 1 ? list : [];
  const wanted = clinicId ? (picked[clinicId] ?? remembered(clinicId)) : "";
  // A remembered therapist who has since left the clinic falls back to everyone.
  const chosen = options.some((o) => o.id === wanted) ? wanted : "";
  const choose = useCallback(
    (id: string) => {
      if (!clinicId) return;
      setPicked((p) => ({ ...p, [clinicId]: id }));
      try {
        sessionStorage.setItem(keyOf(clinicId), id);
      } catch {
        /* the choice then lasts until the page is left */
      }
    },
    [clinicId],
  );
  return { options, chosen, choose, today: isManager ? chosen || "all" : null, patients: chosen || null };
}
