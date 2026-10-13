begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table private.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role = 'owner')
);

create unique index user_roles_single_owner
  on private.user_roles (role);

create table private.admin_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id) on delete cascade
);

create table private.login_attempts (
  bucket_hash text primary key check (bucket_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0)
);

create table private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (
    event_type in ('response_submitted', 'response_edited')
  ),
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  audience text not null default 'owner' check (audience = 'owner'),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index notification_outbox_unprocessed
  on private.notification_outbox (created_at)
  where processed_at is null;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  username_normalized text generated always as (
    case
      when username is null then null
      else lower(regexp_replace(btrim(username), '\s+', ' ', 'g'))
    end
  ) stored,
  display_name text,
  avatar_color text,
  badge text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (
    username is null or char_length(btrim(username)) between 2 and 32
  ),
  constraint profiles_username_trimmed check (
    username is null or username = btrim(username)
  )
);

create unique index profiles_username_normalized_unique
  on public.profiles (username_normalized)
  where username_normalized is not null;

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_id on public.group_members (user_id);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text,
  points integer not null default 0 check (points >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.template_blocks (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates(id) on delete cascade,
  position integer not null check (position >= 0),
  kind text not null check (kind in ('text', 'scale', 'short_text', 'image')),
  content jsonb not null default '{}'::jsonb,
  is_required boolean not null default false,
  image_path text,
  unique (template_id, position),
  constraint template_blocks_image_path_kind check (
    image_path is null or kind = 'image'
  )
);

create table public.form_deliveries (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates(id),
  user_id uuid not null references auth.users(id),
  sent_by uuid not null references auth.users(id),
  status text not null default 'sent'
    check (status in ('sent', 'opened', 'completed', 'cancelled')),
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  completed_at timestamptz,
  unique (template_id, user_id, sent_at)
);

create index form_deliveries_user_status
  on public.form_deliveries (user_id, status, sent_at desc);

create table public.response_drafts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null unique
    references public.form_deliveries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answers) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null unique
    references public.form_deliveries(id),
  user_id uuid not null references auth.users(id),
  original_answers jsonb not null check (jsonb_typeof(original_answers) = 'object'),
  submitted_at timestamptz not null default now()
);

create index responses_user_submitted
  on public.responses (user_id, submitted_at desc);

create table public.response_edits (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.responses(id),
  version integer not null check (version > 0),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  edited_by uuid not null references auth.users(id),
  edited_at timestamptz not null default now(),
  unique (response_id, version)
);

create index response_edits_latest
  on public.response_edits (response_id, version desc);

create table public.score_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  response_id uuid references public.responses(id),
  event_type text not null check (
    event_type in ('initial_submission', 'adjustment')
  ),
  points integer not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint score_ledger_submission_nonnegative check (
    event_type <> 'initial_submission' or points >= 0
  ),
  constraint score_ledger_adjustment_reason check (
    (event_type = 'initial_submission' and reason is null)
    or (
      event_type = 'adjustment'
      and reason is not null
      and char_length(btrim(reason)) between 1 and 500
    )
  )
);

create unique index score_ledger_one_submission_award
  on public.score_ledger (response_id)
  where event_type = 'initial_submission' and response_id is not null;

create index score_ledger_user_created
  on public.score_ledger (user_id, created_at desc);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_tokens_user_id on public.push_tokens (user_id);

create or replace function private.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_username text;
begin
  v_is_admin :=
    coalesce(new.raw_app_meta_data ->> 'dotaznicek_admin_owner', 'false') = 'true'
    and coalesce(new.email, '') ~ '^admin-[0-9a-f]{64}@dotaznicek[.]invalid$';
  v_username := new.raw_user_meta_data ->> 'username';

  if not v_is_admin and (v_username is null or btrim(v_username) = '') then
    raise exception 'username is required';
  end if;

  insert into public.profiles (id, username)
  values (new.id, case when v_is_admin then null else btrim(v_username) end);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_auth_user_created();

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.admin_owner owner_record
    join private.user_roles role_record
      on role_record.user_id = owner_record.user_id
     and role_record.role = 'owner'
    where owner_record.singleton
      and owner_record.user_id = auth.uid()
  );
$$;

revoke all on function private.is_owner() from public, anon;
grant execute on function private.is_owner() to authenticated;

create or replace function public.admin_owner_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select owner_record.user_id
  from private.admin_owner owner_record
  where owner_record.singleton;
$$;

create or replace function public.bootstrap_admin_owner(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_owner uuid;
  v_is_marked boolean;
begin
  select coalesce(
    auth_user.raw_app_meta_data ->> 'dotaznicek_admin_owner' = 'true'
      and auth_user.email ~ '^admin-[0-9a-f]{64}@dotaznicek[.]invalid$',
    false
  )
  into v_is_marked
  from auth.users auth_user
  where auth_user.id = p_user_id;

  if not coalesce(v_is_marked, false) then
    raise exception 'owner account is not eligible';
  end if;

  insert into private.admin_owner (singleton, user_id)
  values (true, p_user_id)
  on conflict (singleton) do nothing;

  select owner_record.user_id
  into v_current_owner
  from private.admin_owner owner_record
  where owner_record.singleton
  for update;

  if v_current_owner <> p_user_id then
    raise exception 'an owner is already configured';
  end if;

  insert into private.user_roles (user_id, role)
  values (p_user_id, 'owner')
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.consume_login_rate_limits(
  p_bucket_keys text[],
  p_max_attempts integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_attempts integer;
  v_window_started_at timestamptz;
  v_now timestamptz := pg_catalog.now();
  v_allowed boolean := true;
begin
  if p_bucket_keys is null
     or cardinality(p_bucket_keys) < 1
     or cardinality(p_bucket_keys) > 4
     or p_max_attempts < 1
     or p_max_attempts > 100
     or p_window_seconds < 1
     or p_window_seconds > 3600 then
    raise exception 'invalid rate limit request';
  end if;

  for v_key in
    select distinct bucket_key
    from unnest(p_bucket_keys) as input_keys(bucket_key)
    order by bucket_key
  loop
    if v_key !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid rate limit key';
    end if;

    insert into private.login_attempts (bucket_hash, window_started_at, attempts)
    values (v_key, v_now, 1)
    on conflict (bucket_hash) do update
      set attempts = case
            when private.login_attempts.window_started_at
              <= v_now - pg_catalog.make_interval(secs => p_window_seconds)
              then 1
            else private.login_attempts.attempts + 1
          end,
          window_started_at = case
            when private.login_attempts.window_started_at
              <= v_now - pg_catalog.make_interval(secs => p_window_seconds)
              then v_now
            else private.login_attempts.window_started_at
          end
    returning attempts, window_started_at
    into v_attempts, v_window_started_at;

    if v_attempts > p_max_attempts then
      v_allowed := false;
    end if;
  end loop;

  delete from private.login_attempts
  where window_started_at < v_now - interval '1 day';

  return v_allowed;
end;
$$;

create or replace function public.login_email_for_username(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select auth_user.email
  from public.profiles profile
  join auth.users auth_user on auth_user.id = profile.id
  where profile.username_normalized =
    lower(regexp_replace(btrim(p_username), '\s+', ' ', 'g'))
  limit 1;
$$;

create or replace function public.find_admin_auth_user(p_email text)
returns table(user_id uuid, is_marked_owner boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth_user.id,
    coalesce(
      auth_user.raw_app_meta_data ->> 'dotaznicek_admin_owner' = 'true'
        and auth_user.email ~ '^admin-[0-9a-f]{64}@dotaznicek[.]invalid$',
      false
    )
  from auth.users auth_user
  where auth_user.email = p_email;
$$;

revoke all on function public.admin_owner_user_id() from public, anon, authenticated;
revoke all on function public.bootstrap_admin_owner(uuid) from public, anon, authenticated;
revoke all on function public.consume_login_rate_limits(text[], integer, integer)
  from public, anon, authenticated;
revoke all on function public.login_email_for_username(text)
  from public, anon, authenticated;
revoke all on function public.find_admin_auth_user(text)
  from public, anon, authenticated;
grant execute on function public.admin_owner_user_id() to service_role;
grant execute on function public.bootstrap_admin_owner(uuid) to service_role;
grant execute on function public.consume_login_rate_limits(text[], integer, integer)
  to service_role;
grant execute on function public.login_email_for_username(text) to service_role;
grant execute on function public.find_admin_auth_user(text) to service_role;

create or replace function public.adjust_user_score(
  p_user_id uuid,
  p_points integer,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_id uuid;
begin
  if not private.is_owner()
     or p_user_id is null
     or p_points = 0
     or p_reason is null
     or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'score adjustment is not allowed';
  end if;

  insert into public.score_ledger (user_id, event_type, points, reason)
  values (p_user_id, 'adjustment', p_points, btrim(p_reason))
  returning id into v_entry_id;

  return v_entry_id;
end;
$$;

revoke all on function public.adjust_user_score(uuid, integer, text)
  from public, anon;
grant execute on function public.adjust_user_score(uuid, integer, text)
  to authenticated;

create or replace function public.submit_response(
  p_delivery_id uuid,
  p_answers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_template_id uuid;
  v_points integer;
  v_response_id uuid;
  v_delivery_status text;
begin
  if v_user_id is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'response cannot be submitted';
  end if;

  select delivery.template_id, template.points, delivery.status
  into v_template_id, v_points, v_delivery_status
  from public.form_deliveries delivery
  join public.templates template on template.id = delivery.template_id
  where delivery.id = p_delivery_id
    and delivery.user_id = v_user_id
  for update of delivery;

  if not found then
    raise exception 'response cannot be submitted';
  end if;

  select response.id
  into v_response_id
  from public.responses response
  where response.delivery_id = p_delivery_id
    and response.user_id = v_user_id;

  if v_response_id is not null then
    return v_response_id;
  end if;

  if v_delivery_status not in ('sent', 'opened') then
    raise exception 'response cannot be submitted';
  end if;

  insert into public.responses (delivery_id, user_id, original_answers)
  values (p_delivery_id, v_user_id, p_answers)
  on conflict (delivery_id) do nothing
  returning id into v_response_id;

  if v_response_id is null then
    select response.id
    into v_response_id
    from public.responses response
    where response.delivery_id = p_delivery_id
      and response.user_id = v_user_id;

    if v_response_id is null then
      raise exception 'response cannot be submitted';
    end if;

    return v_response_id;
  end if;

  insert into public.score_ledger (user_id, response_id, event_type, points)
  values (v_user_id, v_response_id, 'initial_submission', v_points);

  update public.form_deliveries
  set status = 'completed', completed_at = pg_catalog.now()
  where id = p_delivery_id;

  insert into private.notification_outbox (event_type, entity_id, payload)
  values (
    'response_submitted',
    v_response_id,
    jsonb_build_object('response_id', v_response_id, 'delivery_id', p_delivery_id)
  );

  return v_response_id;
end;
$$;

create or replace function public.edit_response(
  p_response_id uuid,
  p_answers jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_delivery_id uuid;
  v_version integer;
begin
  if v_user_id is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'response cannot be edited';
  end if;

  select response.delivery_id
  into v_delivery_id
  from public.responses response
  where response.id = p_response_id
    and response.user_id = v_user_id
  for update;

  if not found then
    raise exception 'response cannot be edited';
  end if;

  select coalesce(max(edit.version), 0) + 1
  into v_version
  from public.response_edits edit
  where edit.response_id = p_response_id;

  insert into public.response_edits (response_id, version, answers, edited_by)
  values (p_response_id, v_version, p_answers, v_user_id);

  insert into private.notification_outbox (event_type, entity_id, payload)
  values (
    'response_edited',
    p_response_id,
    jsonb_build_object(
      'response_id', p_response_id,
      'delivery_id', v_delivery_id,
      'version', v_version
    )
  );

  return v_version;
end;
$$;

revoke all on function public.submit_response(uuid, jsonb) from public, anon;
revoke all on function public.edit_response(uuid, jsonb) from public, anon;
grant execute on function public.submit_response(uuid, jsonb) to authenticated;
grant execute on function public.edit_response(uuid, jsonb) to authenticated;

create view public.response_history
with (security_invoker = true)
as
select
  response.id as response_id,
  response.delivery_id,
  response.user_id,
  response.original_answers,
  latest.answers as latest_answers,
  latest.edited_at as latest_edit_at,
  response.submitted_at
from public.responses response
left join lateral (
  select edit.answers, edit.edited_at
  from public.response_edits edit
  where edit.response_id = response.id
  order by edit.version desc
  limit 1
) latest on true;

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create trigger templates_updated_at
  before update on public.templates
  for each row execute function public.handle_updated_at();

create trigger response_drafts_updated_at
  before update on public.response_drafts
  for each row execute function public.handle_updated_at();

create trigger push_tokens_updated_at
  before update on public.push_tokens
  for each row execute function public.handle_updated_at();

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.templates enable row level security;
alter table public.template_blocks enable row level security;
alter table public.form_deliveries enable row level security;
alter table public.response_drafts enable row level security;
alter table public.responses enable row level security;
alter table public.response_edits enable row level security;
alter table public.score_ledger enable row level security;
alter table public.push_tokens enable row level security;

create policy profiles_read_self_or_owner on public.profiles
  for select to authenticated
  using (id = auth.uid() or private.is_owner());

create policy profiles_update_self_or_owner on public.profiles
  for update to authenticated
  using (id = auth.uid() or private.is_owner())
  with check (id = auth.uid() or private.is_owner());

create policy groups_read_members_or_owner on public.groups
  for select to authenticated
  using (
    private.is_owner()
    or exists (
      select 1 from public.group_members membership
      where membership.group_id = groups.id and membership.user_id = auth.uid()
    )
  );

create policy groups_owner_manage on public.groups
  for all to authenticated
  using (private.is_owner())
  with check (private.is_owner());

create policy group_members_read_self_or_owner on public.group_members
  for select to authenticated
  using (user_id = auth.uid() or private.is_owner());

create policy group_members_owner_manage on public.group_members
  for all to authenticated
  using (private.is_owner())
  with check (private.is_owner());

create policy templates_read_assigned_or_owner on public.templates
  for select to authenticated
  using (
    private.is_owner()
    or exists (
      select 1 from public.form_deliveries delivery
      where delivery.template_id = templates.id
        and delivery.user_id = auth.uid()
        and delivery.status <> 'cancelled'
    )
  );

create policy templates_owner_manage on public.templates
  for all to authenticated
  using (private.is_owner())
  with check (private.is_owner());

create policy template_blocks_read_assigned_or_owner on public.template_blocks
  for select to authenticated
  using (
    private.is_owner()
    or exists (
      select 1 from public.form_deliveries delivery
      where delivery.template_id = template_blocks.template_id
        and delivery.user_id = auth.uid()
        and delivery.status <> 'cancelled'
    )
  );

create policy template_blocks_owner_manage on public.template_blocks
  for all to authenticated
  using (private.is_owner())
  with check (private.is_owner());

create policy deliveries_read_self_or_owner on public.form_deliveries
  for select to authenticated
  using (user_id = auth.uid() or private.is_owner());

create policy deliveries_owner_manage on public.form_deliveries
  for all to authenticated
  using (private.is_owner())
  with check (private.is_owner() and sent_by = auth.uid());

create policy response_drafts_read_self_or_owner on public.response_drafts
  for select to authenticated
  using (user_id = auth.uid() or private.is_owner());

create policy response_drafts_insert_own_delivery on public.response_drafts
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.form_deliveries delivery
      where delivery.id = response_drafts.delivery_id
        and delivery.user_id = auth.uid()
        and delivery.status in ('sent', 'opened')
    )
  );

create policy response_drafts_update_own_delivery on public.response_drafts
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.form_deliveries delivery
      where delivery.id = response_drafts.delivery_id
        and delivery.user_id = auth.uid()
        and delivery.status in ('sent', 'opened')
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.form_deliveries delivery
      where delivery.id = response_drafts.delivery_id
        and delivery.user_id = auth.uid()
        and delivery.status in ('sent', 'opened')
    )
  );

create policy response_drafts_delete_self_or_owner on public.response_drafts
  for delete to authenticated
  using (user_id = auth.uid() or private.is_owner());

create policy responses_read_self_or_owner on public.responses
  for select to authenticated
  using (user_id = auth.uid() or private.is_owner());

create policy response_edits_read_self_or_owner on public.response_edits
  for select to authenticated
  using (
    private.is_owner()
    or exists (
      select 1 from public.responses response
      where response.id = response_edits.response_id
        and response.user_id = auth.uid()
    )
  );

create policy score_ledger_read_self_or_owner on public.score_ledger
  for select to authenticated
  using (user_id = auth.uid() or private.is_owner());

create policy push_tokens_manage_self on public.push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy push_tokens_owner_read on public.push_tokens
  for select to authenticated
  using (private.is_owner());

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, avatar_color, badge, sort_order)
  on public.profiles to authenticated;
grant select, insert, delete on public.groups to authenticated;
grant update (name) on public.groups to authenticated;
grant select, insert, delete on public.group_members to authenticated;
grant select, insert, delete on public.templates to authenticated;
grant update (title, description, points, status) on public.templates to authenticated;
grant select, insert, delete on public.template_blocks to authenticated;
grant update (position, kind, content, is_required, image_path)
  on public.template_blocks to authenticated;
grant select, insert, update, delete on public.form_deliveries to authenticated;
grant select, insert, update, delete on public.response_drafts to authenticated;
grant select on public.responses, public.response_edits to authenticated;
grant select on public.score_ledger, public.response_history to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;

commit;
