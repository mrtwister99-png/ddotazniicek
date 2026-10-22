import type { Template } from "@/lib/admin-api";
import { useEffect, useState } from "react";
// Globální store pro výběr uživatelů a vzoru
export type SelectedTemplate = {
  id: string;
  title: string;
  description?: string | null;
  points?: number;
  category?: Template["category"];
  status?: string;
  position?: number;
};
type Listener = () => void;
let selectedUserIds = new Set<string>();
let selectedTemplate: SelectedTemplate | null = null;
let listeners = new Set<Listener>();
function emit() {
  for (const l of listeners) l();
}
export function getSelectedUserIds(): Set<string> {
  return new Set(selectedUserIds);
}
export function getSelectedTemplate(): SelectedTemplate | null {
  return selectedTemplate;
}
export function setSelectedUserIds(ids: Set<string>) {
  selectedUserIds = new Set(ids);
  emit();
}
export function setSelectedTemplate(t: SelectedTemplate | null) {
  selectedTemplate = t;
  emit();
}
export function clearAll() {
  selectedUserIds = new Set();
  selectedTemplate = null;
  emit();
}
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function useSelectionStore() {
  const [users, setUsers] = useState<Set<string>>(() => getSelectedUserIds());
  const [template, setTemplate] = useState<SelectedTemplate | null>(() =>
    getSelectedTemplate(),
  );
  useEffect(() => {
    const unsub = subscribe(() => {
      setUsers(getSelectedUserIds());
      setTemplate(getSelectedTemplate());
    });
    return unsub;
  }, []);
  return { selectedUserIds: users, selectedTemplate: template };
}
