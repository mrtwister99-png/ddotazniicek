begin;

alter table private.user_roles
  drop constraint user_roles_role_check,
  add constraint user_roles_role_check
    check (role in ('owner', 'admin'));

drop index private.user_roles_single_owner;
create unique index user_roles_single_owner
  on private.user_roles (role)
  where role = 'owner';

-- Existing policies and definer functions share this admin-capability check.
create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.user_roles role_record
    where role_record.user_id = auth.uid()
      and (
        role_record.role = 'admin'
        or (
          role_record.role = 'owner'
          and exists (
            select 1
            from private.admin_owner owner_record
            where owner_record.singleton
              and owner_record.user_id = role_record.user_id
          )
        )
      )
  );
$$;

create or replace function public.grant_admin_role(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app_role text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'only the service role can assign admin roles';
  end if;

  if p_user_id is null then
    raise exception 'a valid Auth user is required';
  end if;

  select auth_user.raw_app_meta_data ->> 'role'
  into v_app_role
  from auth.users auth_user
  where auth_user.id = p_user_id;

  if v_app_role is distinct from 'admin' then
    raise exception 'Auth user must have the server-managed admin role';
  end if;

  if exists (
    select 1
    from private.admin_owner owner_record
    where owner_record.singleton
      and owner_record.user_id = p_user_id
  ) then
    raise exception 'the singleton owner cannot be converted to an admin';
  end if;

  insert into private.user_roles (user_id, role)
  values (p_user_id, 'admin')
  on conflict (user_id) do update
    set role = 'admin'
    where private.user_roles.role = 'admin';

  if not exists (
    select 1
    from private.user_roles role_record
    where role_record.user_id = p_user_id
      and role_record.role = 'admin'
  ) then
    raise exception 'the singleton owner role cannot be replaced';
  end if;
end;
$$;

revoke all on function public.grant_admin_role(uuid)
  from public, anon, authenticated;
grant execute on function public.grant_admin_role(uuid)
  to service_role;

commit;
