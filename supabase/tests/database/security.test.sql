begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'form_deliveries', 'per-user deliveries exist');
select has_table('public', 'responses', 'original responses exist');
select has_table('public', 'response_edits', 'response corrections are versioned');
select has_function('public', 'submit_response', array['uuid', 'jsonb']);
select has_function('public', 'edit_response', array['uuid', 'jsonb']);
select has_function('public', 'bootstrap_admin_owner', array['uuid']);
select has_function(
  'public',
  'consume_login_rate_limits',
  array['text[]', 'integer', 'integer']
);
select has_function(
  'public',
  'login_email_for_username',
  array['text']
);
select has_function(
  'public',
  'find_admin_auth_user',
  array['text']
);
select has_function(
  'public',
  'adjust_user_score',
  array['uuid', 'integer', 'text']
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.bootstrap_admin_owner(uuid)',
    'EXECUTE'
  ),
  'authenticated users cannot bootstrap the owner'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.login_email_for_username(text)',
    'EXECUTE'
  ),
  'authenticated users cannot look up account e-mails'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.find_admin_auth_user(text)',
    'EXECUTE'
  ),
  'authenticated users cannot query Auth owner candidates'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.consume_login_rate_limits(text[],integer,integer)',
    'EXECUTE'
  ),
  'service role can consume shared login rate limits'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.adjust_user_score(uuid,integer,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.adjust_user_score(uuid,integer,text)',
    'EXECUTE'
  ),
  'only authenticated callers reach the owner-checked score adjustment'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.score_ledger',
    'INSERT'
  ),
  'authenticated clients cannot insert score ledger entries directly'
);

select * from finish();
rollback;
