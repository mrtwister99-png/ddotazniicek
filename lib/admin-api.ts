import { getAuthSession } from "@/lib/auth-session";

export type Person = {
  id: string;
  username: string | null;
  display_name: string | null;
};
export type Folder = { id: string; name: string };
export type Membership = { group_id: string; user_id: string };
export type Directory = {
  folders: Folder[];
  people: Person[];
  memberships: Membership[];
};

export type Template = {
  id: string;
  title: string;
  description: string | null;
  points: number;
  status: "draft" | "published" | "archived";
  category: "questionnaire" | "advertisement" | "special_questionnaire";
  created_at: string;
  created_by: string;
};

export type TemplateBlock = {
  id: string;
  template_id: string;
  position: number;
  kind: "text" | "scale" | "short_text" | "image";
  content: Record<string, any>;
  is_required: boolean;
  image_path: string | null;
};

export type DeliveryCreateResult = { created: number; failedPush?: number };

export function credentials() {
  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const auth = getAuthSession();
  const token = (auth?.session as { access_token?: unknown } | undefined)
    ?.access_token;
  const userId = (auth?.user as { id?: unknown } | undefined)?.id;
  if (
    !baseUrl ||
    !anonKey ||
    typeof token !== "string" ||
    typeof userId !== "string"
  ) {
    throw new Error("not-configured");
  }
  return { baseUrl, anonKey, token, userId };
}

export async function rest(
  path: string,
  init: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<unknown> {
  const { baseUrl, anonKey, token } = credentials();
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    body: init.body,
    headers: {
      Accept: "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: init.method === "POST" ? "return=representation" : "",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(`http-${response.status}:${txt.slice(0, 200)}`);
  }
  return response.status === 204 ? null : response.json();
}

async function restWithPreferReturn(
  path: string,
  body: string,
): Promise<unknown> {
  return rest(path, {
    method: "POST",
    body,
    headers: { Prefer: "return=representation" },
  });
}

function asArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error("bad-response");
  return value as T[];
}

export async function loadDirectory(): Promise<Directory> {
  const { userId } = credentials();
  const [folders, people, memberships] = await Promise.all([
    rest("groups?select=id,name&order=created_at.asc"),
    rest(
      `profiles?select=id,username,display_name&or=(role.is.null,role.eq.user)&id=neq.${userId}&order=sort_order.asc,username.asc`,
    ),
    rest("group_members?select=group_id,user_id"),
  ]);
  return {
    folders: asArray<Folder>(folders),
    people: asArray<Person>(people),
    memberships: asArray<Membership>(memberships),
  };
}

export async function createFolder(name: string): Promise<void> {
  const { userId } = credentials();
  await rest("groups", {
    method: "POST",
    body: JSON.stringify({ name, created_by: userId }),
  });
}

export async function loadTemplates(): Promise<Template[]> {
  const rows = await rest(
    "templates?select=id,title,description,points,status,category,created_at,created_by&order=created_at.desc",
  );
  return asArray<Template>(rows);
}

export async function loadTemplateDetail(
  id: string,
): Promise<{ template: Template; blocks: TemplateBlock[] }> {
  const [tRows, bRows] = await Promise.all([
    rest(
      `templates?select=id,title,description,points,status,category,created_at,created_by&id=eq.${id}`,
    ),
    rest(
      `template_blocks?select=id,template_id,position,kind,content,is_required,image_path&template_id=eq.${id}&order=position.asc`,
    ),
  ]);
  const t = asArray<Template>(tRows)[0];
  if (!t) throw new Error("not-found");
  return { template: t, blocks: asArray<TemplateBlock>(bRows) };
}

export async function createTemplate(data: {
  title: string;
  description?: string;
  points: number;
  category: Template["category"];
  status?: Template["status"];
}): Promise<Template> {
  const { userId } = credentials();
  const payload = {
    title: data.title.trim(),
    description: data.description?.trim() || null,
    points: data.points,
    category: data.category,
    status: data.status ?? "draft",
    created_by: userId,
  };
  const rows = await restWithPreferReturn("templates", JSON.stringify(payload));
  const created = asArray<Template>(rows)[0];
  if (!created) throw new Error("bad-response");
  return created;
}

export async function updateTemplate(
  id: string,
  data: Partial<{
    title: string;
    description: string | null;
    points: number;
    category: Template["category"];
    status: Template["status"];
  }>,
): Promise<Template> {
  const patch: any = {};
  if (data.title !== undefined) patch.title = data.title.trim();
  if (data.description !== undefined)
    patch.description = data.description?.trim() || null;
  if (data.points !== undefined) patch.points = data.points;
  if (data.category !== undefined) patch.category = data.category;
  if (data.status !== undefined) patch.status = data.status;
  const rows = await rest(`templates?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    headers: { Prefer: "return=representation" },
  });
  const updated = asArray<Template>(rows)[0];
  if (!updated) throw new Error("bad-response");
  return updated;
}

export async function deleteTemplate(id: string): Promise<void> {
  await rest(`templates?id=eq.${id}`, { method: "DELETE" });
}

export async function duplicateTemplate(id: string): Promise<Template> {
  const { template, blocks } = await loadTemplateDetail(id);
  const newTpl = await createTemplate({
    title: `${template.title} (kopie)`,
    description: template.description ?? undefined,
    points: template.points,
    category: template.category,
    status: "draft",
  });
  if (blocks.length > 0) {
    const newBlocks = blocks.map((b: any) => ({
      template_id: newTpl.id,
      position: b.position,
      kind: b.kind,
      content: b.content,
      is_required: b.is_required,
      image_path: b.image_path,
    }));
    await rest("template_blocks", {
      method: "POST",
      body: JSON.stringify(newBlocks),
    });
  }
  return newTpl;
}

export async function saveTemplateBlocks(
  templateId: string,
  blocks: Array<{
    kind: TemplateBlock["kind"];
    content: Record<string, any>;
    is_required: boolean;
    image_path?: string | null;
  }>,
): Promise<TemplateBlock[]> {
  await rest(`template_blocks?template_id=eq.${templateId}`, {
    method: "DELETE",
  });
  if (blocks.length === 0) return [];
  const payload = blocks.map((b, idx) => ({
    template_id: templateId,
    position: idx,
    kind: b.kind,
    content: b.content,
    is_required: b.is_required,
    image_path: b.image_path ?? null,
  }));
  const rows = await restWithPreferReturn(
    "template_blocks",
    JSON.stringify(payload),
  );
  return asArray<TemplateBlock>(rows).sort((a, b) => a.position - b.position);
}

export async function createDeliveries(
  templateId: string,
  userIds: string[],
  position?: number,
): Promise<DeliveryCreateResult> {
  const { userId, baseUrl, anonKey, token } = credentials();
  if (userIds.length === 0) throw new Error("no-recipients");
  if (position !== undefined && (position < 1 || position > 16))
    throw new Error("bad-position");
  const unique = Array.from(new Set(userIds));
  const rows = unique.map((uid) => ({
    template_id: templateId,
    user_id: uid,
    sent_by: userId,
    status: "sent",
    position: position ?? null,
  }));
  const response = await fetch(`${baseUrl}/rest/v1/form_deliveries`, {
    method: "POST",
    body: JSON.stringify(rows),
    headers: {
      Accept: "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(`http-${response.status}:${txt.slice(0, 300)}`);
  }
  const createdRows = (await response.json()) as any[];
  let failedPush = 0;
  try {
    const pushBase = `${baseUrl}/functions/v1/send-ephemeral-notification`;
    for (const row of createdRows) {
      try {
        await fetch(pushBase, {
          method: "POST",
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            kind: "delivery",
            user_id: row.user_id,
            delivery_id: row.id,
            template_id: templateId,
          }),
        });
      } catch {
        failedPush++;
      }
    }
  } catch {}
  return { created: createdRows.length, failedPush };
}

export function errorMessage(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : "";
  if (msg.startsWith("http-401")) return "Prihlaseni vyprselo.";
  if (msg.startsWith("http-403")) return "Nemate opravneni.";
  if (msg.includes("not-found")) return "Sablona nebyla nalezena.";
  if (msg.includes("no-recipients")) return "Nevybral jsi zadne uzivatele.";
  return fallback;
}
