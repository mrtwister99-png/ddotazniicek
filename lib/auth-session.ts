// Session držíme jen v paměti (po zavření appky zmizí).
// Trvalé ukládání (SecureStore) přijde až v dalším kroku.
export type AuthSession = { session: object; user: object };

let current: AuthSession | null = null;

export function setAuthSession(value: AuthSession) {
  current = value;
}

export function getAuthSession(): AuthSession | null {
  return current;
}

export function clearAuthSession() {
  current = null;
}

// Jen nápověda pro UI (kam navigovat) - skutečná ochrana dat je v RLS na serveru.
// Admin = owner (dotaznicek_admin_owner) nebo účet ze seed:admin (role = 'admin').
export function isAdminUser(user: object): boolean {
  const meta = (user as { app_metadata?: Record<string, unknown> }).app_metadata;
  return meta?.dotaznicek_admin_owner === true || meta?.role === 'admin';
}
