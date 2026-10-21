import { getAuthSession } from '@/lib/auth-session';

export type Person = { id: string; username: string | null; display_name: string | null };
export type Folder = { id: string; name: string };
export type Membership = { group_id: string; user_id: string };
export type Directory = { folders: Folder[]; people: Person[]; memberships: Membership[] };

// Údaje pro volání Supabase REST pod přihlášeným adminem (jeho access token).
// Přístup k datům hlídá RLS na serveru - appka jen posílá token.
export function credentials() {
  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const auth = getAuthSession();
  const token = (auth?.session as { access_token?: unknown } | undefined)?.access_token;
  const userId = (auth?.user as { id?: unknown } | undefined)?.id;
  if (!baseUrl || !anonKey || typeof token !== 'string' || typeof userId !== 'string') {
    throw new Error('not-configured');
  }
  return { baseUrl, anonKey, token, userId };
}

export async function rest(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
  const { baseUrl, anonKey, token } = credentials();
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: {
      Accept: 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`http-${response.status}`);
  return response.status === 204 ? null : response.json();
}

function asArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error('bad-response');
  return value as T[];
}

// Složky, uživatelé (bez adminů a bez sebe sama) a kdo je v jaké složce.
export async function loadDirectory(): Promise<Directory> {
  const { userId } = credentials();
  const [folders, people, memberships] = await Promise.all([
    rest('groups?select=id,name&order=created_at.asc'),
    rest(
      `profiles?select=id,username,display_name&or=(role.is.null,role.eq.user)&id=neq.${userId}&order=sort_order.asc,username.asc`,
    ),
    rest('group_members?select=group_id,user_id'),
  ]);
  return {
    folders: asArray<Folder>(folders),
    people: asArray<Person>(people),
    memberships: asArray<Membership>(memberships),
  };
}

export async function createFolder(name: string): Promise<void> {
  const { userId } = credentials();
  await rest('groups', { method: 'POST', body: JSON.stringify({ name, created_by: userId }) });
}

export function errorMessage(error: unknown, fallback: string): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'http-401') return 'Přihlášení vypršelo. Odhlaste se a přihlaste se znovu.';
  if (code === 'http-403') return 'K této akci nemáte oprávnění.';
  return fallback;
}
