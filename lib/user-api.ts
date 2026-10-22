import { credentials, rest } from "@/lib/admin-api";

export type Task = {
  id: string;
  kind: "D" | "R";
  title: string;
  isNew: boolean;
  points: number;
  position: number;
};
export type UserHome = {
  name: string | null;
  tasks: Task[]; // nesplněné úkoly (D = dotazník, R = reklama)
  points: number; // B
  doneQuestionnaires: number; // D
};

type DeliveryRow = {
  id: string;
  status: string;
  position: number | null;
  templates:
    | { title?: string; category?: string; points?: number }
    | { title?: string; category?: string; points?: number }[]
    | null;
};

function asArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error("bad-response");
  return value as T[];
}

// Vše, co potřebuje domovská obrazovka uživatele. Data hlídá RLS (uživatel vidí jen své).
export async function loadUserHome(): Promise<UserHome> {
  const { userId } = credentials();
  const [profiles, ledger] = await Promise.all([
    rest(`profiles?select=username,display_name&id=eq.${userId}`),
    rest(`score_ledger?select=points&user_id=eq.${userId}`),
  ]);
  let deliveries: unknown;
  try {
    deliveries = await rest(
      `form_deliveries?select=id,status,position,templates(title,category,points)&user_id=eq.${userId}&status=neq.cancelled&order=position.asc.nullsLast,sent_at.desc`,
    );
  } catch {
    deliveries = await rest(
      `form_deliveries?select=id,status,templates(title,category,points)&user_id=eq.${userId}&status=neq.cancelled&order=sent_at.desc`,
    );
  }

  const profile = asArray<{
    username: string | null;
    display_name: string | null;
  }>(profiles)[0];
  const tasks: Task[] = [];
  let doneQuestionnaires = 0;

  for (const row of asArray<DeliveryRow>(deliveries)) {
    const template = Array.isArray(row.templates)
      ? row.templates[0]
      : row.templates;
    const kind = template?.category === "advertisement" ? "R" : "D";
    if (row.status === "completed") {
      if (kind === "D") doneQuestionnaires += 1;
    } else {
      tasks.push({
        id: row.id,
        kind,
        title: template?.title ?? "",
        isNew: row.status === "sent",
        points: template?.points ?? 0,
        position: row.position ?? 0,
      });
    }
  }

  const points = asArray<{ points: number }>(ledger).reduce(
    (sum, r) => sum + (r.points ?? 0),
    0,
  );
  return {
    name: profile?.display_name ?? profile?.username ?? null,
    tasks,
    points,
    doneQuestionnaires,
  };
}
