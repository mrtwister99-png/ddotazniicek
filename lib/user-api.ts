import { asArray, credentials, rest } from "@/lib/supabase-rest";

function asArrayOld<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error("bad-response");
  return value as T[];
}

export type Task = {
  id: string;
  kind: "D" | "R";
  title: string;
  isNew: boolean;
  points: number;
  position: number;
  templateId: string;
  category: "questionnaire" | "advertisement" | "special_questionnaire";
  description?: string | null;
  is_ephemeral?: boolean;
  is_global?: boolean;
};

export type DeliveryBlock = {
  id: string;
  position: number;
  kind: "text" | "scale" | "short_text" | "image";
  content: Record<string, any>;
  is_required: boolean;
};

export type DeliveryDetail = {
  deliveryId: string;
  template: {
    id: string;
    title: string;
    description: string | null;
    points: number;
    category: Task["category"];
  };
  blocks: DeliveryBlock[];
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
  template_id: string;
  is_ephemeral: boolean;
  templates:
    | {
        id?: string;
        title?: string;
        category?: string;
        points?: number;
        description?: string | null;
      }
    | {
        id?: string;
        title?: string;
        category?: string;
        points?: number;
        description?: string | null;
      }[]
    | null;
};

// Vše, co potřebuje domovská obrazovka uživatele. Data hlídá RLS (uživatel vidí jen své).
export async function loadUserHome(): Promise<UserHome> {
  const { userId } = credentials();
  const [profiles, ledger] = await Promise.all([
    rest(`profiles?select=username,display_name&id=eq.${userId}`),
    rest(`score_ledger?select=points&user_id=eq.${userId}`),
  ]);
  let deliveries: unknown;
  let globals: unknown = [];
  try {
    const [d, g] = await Promise.all([
      rest(
        `form_deliveries?select=id,status,position,template_id,is_ephemeral,templates(id,title,category,points,description)&user_id=eq.${userId}&status=neq.cancelled&order=position.asc.nullsLast,sent_at.desc`,
      ),
      rest(
        `templates?select=id,title,description,points,category,global_position&is_global=eq.true&status=eq.published&order=global_position.asc`,
      ),
    ]);
    deliveries = d;
    globals = g;
  } catch {
    deliveries = await rest(
      `form_deliveries?select=id,status,template_id,is_ephemeral,templates(id,title,category,points,description)&user_id=eq.${userId}&status=neq.cancelled&order=sent_at.desc`,
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
    const cat = (template?.category as Task["category"]) ?? "questionnaire";
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
        templateId: row.template_id,
        category: cat,
        description: (template as any)?.description ?? null,
        is_ephemeral: row.is_ephemeral ?? false,
      } as any);
    }
  }

  // pridat globalni sablony jako virtualni tasky
  for (const g of asArray<any>(globals)) {
    tasks.push({
      id: `global-${g.id}`,
      kind: g.category === "advertisement" ? "R" : "D",
      title: g.title ?? "",
      isNew: false,
      points: g.points ?? 0,
      position: g.global_position ?? 0,
      templateId: g.id,
      category: g.category,
      description: g.description ?? null,
      is_ephemeral: false,
      is_global: true,
    } as any);
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

export async function loadDeliveryDetail(
  deliveryId: string,
): Promise<DeliveryDetail> {
  const { userId } = credentials();
  const rows = await rest(
    `form_deliveries?select=id,template_id,templates(id,title,description,points,category)&id=eq.${deliveryId}&user_id=eq.${userId}`,
  );
  const row = asArray<{
    id: string;
    template_id: string;
    templates:
      | {
          id: string;
          title: string;
          description: string | null;
          points: number;
          category: string;
        }
      | {
          id: string;
          title: string;
          description: string | null;
          points: number;
          category: string;
        }[]
      | null;
  }>(rows)[0];
  if (!row) throw new Error("not-found");
  const tpl = Array.isArray(row.templates) ? row.templates[0] : row.templates;
  if (!tpl) throw new Error("not-found");
  const bRows = await rest(
    `template_blocks?select=id,position,kind,content,is_required&template_id=eq.${row.template_id}&order=position.asc`,
  );
  const blocks = asArray<DeliveryBlock>(bRows);
  return {
    deliveryId: row.id,
    template: {
      id: tpl.id,
      title: tpl.title,
      description: tpl.description,
      points: tpl.points,
      category: tpl.category as DeliveryDetail["template"]["category"],
    },
    blocks,
  };
}

export async function ensureDeliveryForGlobal(
  templateId: string,
): Promise<string> {
  const { userId, baseUrl, anonKey, token } = credentials();
  // zkontroluj jestli uz nemam delivery pro tuhle global sablonu
  const existing = await rest(
    `form_deliveries?select=id&template_id=eq.${templateId}&user_id=eq.${userId}&status=neq.cancelled&limit=1`,
  );
  const arr = existing as any[];
  if (arr.length > 0) return arr[0].id;
  // vytvor novou
  const res = await fetch(`${baseUrl}/rest/v1/form_deliveries`, {
    method: "POST",
    body: JSON.stringify({
      template_id: templateId,
      user_id: userId,
      sent_by: userId,
      status: "sent",
      position: null,
      is_ephemeral: false,
    }),
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  const rows = await res.json();
  return rows[0].id;
}

export async function submitResponse(
  deliveryId: string,
  answers: Record<string, any>,
): Promise<string> {
  const { baseUrl, anonKey, token } = credentials();
  const res = await fetch(`${baseUrl}/rest/v1/rpc/submit_response`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_delivery_id: deliveryId,
      p_answers: answers,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`http-${res.status}:${txt.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => null);
  return typeof data === "string" ? data : deliveryId;
}
