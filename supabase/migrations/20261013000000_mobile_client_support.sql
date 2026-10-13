begin;

do $$
declare
  v_conflicting_user_id uuid;
begin
  select membership.user_id
  into v_conflicting_user_id
  from public.group_members membership
  group by membership.user_id
  having count(*) > 1
  limit 1;

  if v_conflicting_user_id is not null then
    raise exception
      'Cannot enforce one folder per user: user % has multiple group memberships. Resolve the memberships explicitly before applying this migration.',
      v_conflicting_user_id;
  end if;
end;
$$;

alter table public.templates
  add column category text not null default 'questionnaire',
  add constraint templates_category_check
    check (category in ('questionnaire', 'advertisement', 'special_questionnaire'));

alter table public.profiles
  add column is_favorite boolean not null default false;

alter table public.groups
  add column is_favorite boolean not null default false;

create unique index group_members_one_group_per_user
  on public.group_members (user_id);

create or replace function public.move_users_to_group(
  p_user_ids uuid[],
  p_group_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_user_ids uuid[];
begin
  if not private.is_owner() then
    raise exception 'only the owner can move users between folders';
  end if;

  if p_user_ids is null
     or cardinality(p_user_ids) = 0
     or array_position(p_user_ids, null) is not null then
    raise exception 'select at least one valid user to move';
  end if;

  select array_agg(distinct selected.user_id order by selected.user_id)
  into v_user_ids
  from unnest(p_user_ids) as selected(user_id);

  select owner_record.user_id
  into v_owner_id
  from private.admin_owner owner_record
  where owner_record.singleton;

  if v_owner_id = any(v_user_ids) then
    raise exception 'the owner account cannot be moved between folders';
  end if;

  if exists (
    select 1
    from unnest(v_user_ids) as selected(user_id)
    left join auth.users auth_user on auth_user.id = selected.user_id
    where auth_user.id is null
  ) then
    raise exception 'one or more selected users no longer exist';
  end if;

  if p_group_id is not null and not exists (
    select 1
    from public.groups destination
    where destination.id = p_group_id
  ) then
    raise exception 'the destination folder does not exist';
  end if;

  delete from public.group_members membership
  where membership.user_id = any(v_user_ids);

  if p_group_id is not null then
    insert into public.group_members (group_id, user_id)
    select p_group_id, selected.user_id
    from unnest(v_user_ids) as selected(user_id);
  end if;

  return cardinality(v_user_ids);
end;
$$;

revoke all on function public.move_users_to_group(uuid[], uuid)
  from public, anon;
grant execute on function public.move_users_to_group(uuid[], uuid)
  to authenticated;

create or replace function private.prevent_non_owner_favorite_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_favorite is distinct from old.is_favorite
     and not private.is_owner() then
    raise exception 'only the owner can change profile favorite state';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_non_owner_favorite_changes()
  from public, anon, authenticated;

create trigger profiles_favorite_owner_only
  before update of is_favorite on public.profiles
  for each row
  execute function private.prevent_non_owner_favorite_changes();

grant update (category) on public.templates to authenticated;
grant update (is_favorite) on public.profiles to authenticated;
grant update (is_favorite) on public.groups to authenticated;

alter table public.form_deliveries
  drop constraint if exists form_deliveries_user_id_fkey,
  add constraint form_deliveries_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.responses
  drop constraint if exists responses_delivery_id_fkey,
  drop constraint if exists responses_user_id_fkey,
  add constraint responses_delivery_id_fkey
    foreign key (delivery_id) references public.form_deliveries(id)
    on delete cascade,
  add constraint responses_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.response_edits
  drop constraint if exists response_edits_response_id_fkey,
  drop constraint if exists response_edits_edited_by_fkey,
  add constraint response_edits_response_id_fkey
    foreign key (response_id) references public.responses(id) on delete cascade,
  add constraint response_edits_edited_by_fkey
    foreign key (edited_by) references auth.users(id) on delete cascade;

alter table public.score_ledger
  drop constraint if exists score_ledger_user_id_fkey,
  drop constraint if exists score_ledger_response_id_fkey,
  add constraint score_ledger_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  add constraint score_ledger_response_id_fkey
    foreign key (response_id) references public.responses(id) on delete cascade;

commit;
