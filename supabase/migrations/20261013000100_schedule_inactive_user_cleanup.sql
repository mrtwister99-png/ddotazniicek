begin;

do $$
declare
  v_supabase_url text;
  v_service_role_jwt text;
  v_jwt_payload_segment text;
  v_jwt_payload jsonb;
  v_jwt_verified text;
  v_existing_job_id bigint;
begin
  if not exists (
    select 1
    from pg_extension
    where extname = 'pg_cron'
  ) or to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception
      'Inactive-account cleanup requires pg_cron. Enable the pg_cron extension, then retry this migration.';
  end if;

  if not exists (
    select 1
    from pg_extension
    where extname = 'pg_net'
  ) or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception
      'Inactive-account cleanup requires pg_net with net.http_post. Enable pg_net, then retry this migration.';
  end if;

  if not exists (
    select 1
    from pg_extension
    where extname = 'supabase_vault'
  ) or to_regclass('vault.decrypted_secrets') is null then
    raise exception
      'Inactive-account cleanup requires Supabase Vault. Enable Vault and add the documented cleanup secrets, then retry this migration.';
  end if;

  select decrypted_secret
  into v_supabase_url
  from vault.decrypted_secrets
  where name = 'supabase_url';

  select decrypted_secret
  into v_service_role_jwt
  from vault.decrypted_secrets
  where name = 'service_role_jwt';

  select decrypted_secret
  into v_jwt_verified
  from vault.decrypted_secrets
  where name = 'cleanup_function_verify_jwt';

  if v_supabase_url is null
     or v_supabase_url !~ '^https://[^/?#]+/?$' then
    raise exception
      'Vault secret supabase_url is missing or invalid. Set it to the HTTPS Supabase project URL.';
  end if;

  if v_service_role_jwt is null or length(v_service_role_jwt) = 0 then
    raise exception
      'Vault secret service_role_jwt is missing. Add the project service-role JWT, then retry this migration.';
  end if;

  if v_jwt_verified is distinct from 'true' then
    raise exception
      'Vault secret cleanup_function_verify_jwt must be true after deploying cleanup-inactive-users with verify_jwt = true.';
  end if;

  if array_length(string_to_array(v_service_role_jwt, '.'), 1) <> 3 then
    raise exception
      'Vault secret service_role_jwt is not a signed JWT with three segments.';
  end if;

  begin
    v_jwt_payload_segment := split_part(v_service_role_jwt, '.', 2);
    v_jwt_payload := convert_from(
      decode(
        translate(v_jwt_payload_segment, '-_', '+/')
          || repeat('=', (4 - length(v_jwt_payload_segment) % 4) % 4),
        'base64'
      ),
      'UTF8'
    )::jsonb;
  exception
    when others then
      raise exception
        'Vault secret service_role_jwt has an invalid JWT payload.';
  end;

  if v_jwt_payload ->> 'role' is distinct from 'service_role' then
    raise exception
      'Vault secret service_role_jwt must have the service_role JWT claim.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.form_deliveries'::regclass
      and confrelid = 'auth.users'::regclass
      and conname = 'form_deliveries_user_id_fkey'
      and contype = 'f'
      and confdeltype = 'c'
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.responses'::regclass
      and confrelid = 'auth.users'::regclass
      and conname = 'responses_user_id_fkey'
      and contype = 'f'
      and confdeltype = 'c'
  ) then
    raise exception
      'Inactive-account cleanup requires the mobile-support cascade migration. Apply and verify that migration before scheduling cleanup.';
  end if;

  select jobid
  into v_existing_job_id
  from cron.job
  where jobname = 'cleanup-inactive-users';

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;

  perform cron.schedule(
    'cleanup-inactive-users',
    '0 3 * * 0',
    $job$
      select net.http_post(
        url := rtrim(
          (select decrypted_secret
           from vault.decrypted_secrets
           where name = 'supabase_url'),
          '/'
        ) || '/functions/v1/cleanup-inactive-users',
        body := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'service_role_jwt'
          ),
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'service_role_jwt'
          )
        )
      );
    $job$
  );
end;
$$;

commit;
