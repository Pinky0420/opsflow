begin;

create extension if not exists "pgcrypto";

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  account_id text unique,
  display_name text,
  role text not null check (role in ('boss','employee','uploader','admin')),
  password_set boolean not null default false,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists account_id text;
alter table public.profiles add column if not exists password_set boolean;

create table if not exists public.access_controls (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  access_level text not null check (access_level in ('viewer','manager','admin')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists access_controls_set_updated_at on public.access_controls;
create trigger access_controls_set_updated_at
before update on public.access_controls
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, account_id, display_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', new.email), 'employee')
  on conflict (id) do update set account_id = excluded.account_id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

update public.profiles p
set account_id = u.email
from auth.users u
where p.id = u.id
  and (p.account_id is null or p.account_id = '');

update public.profiles p
set display_name = '測試者'
from auth.users u
where p.id = u.id
  and u.email = 'test_000@local.test';

create unique index if not exists profiles_account_id_idx on public.profiles (account_id);

create table if not exists public.user_departments (
  user_id uuid not null references public.profiles(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, department_id)
);

create index if not exists user_departments_department_id_user_id_idx
on public.user_departments (department_id, user_id);

create table if not exists public.training_materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  content_type text not null check (content_type in ('video','image','pdf','text','office','other')),
  visibility text not null check (visibility in ('all','department')),
  keywords text not null default '',
  file_bucket text not null default 'training-files',
  file_path text,
  file_name text,
  file_size bigint,
  mime_type text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  status text not null default 'active' check (status in ('active','disabled','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.training_materials add column if not exists updated_by uuid references public.profiles(id) on delete set null;

drop trigger if exists training_materials_set_updated_at on public.training_materials;
create trigger training_materials_set_updated_at
before update on public.training_materials
for each row execute function public.set_updated_at();

create index if not exists training_materials_created_at_idx on public.training_materials (created_at desc);
create index if not exists training_materials_content_type_idx on public.training_materials (content_type);
create index if not exists training_materials_visibility_status_idx on public.training_materials (visibility, status);
create index if not exists training_materials_uploaded_by_idx on public.training_materials (uploaded_by);
create index if not exists training_materials_updated_by_idx on public.training_materials (updated_by);

create table if not exists public.training_material_departments (
  material_id uuid not null references public.training_materials(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (material_id, department_id)
);

create index if not exists training_material_departments_department_id_material_id_idx
on public.training_material_departments (department_id, material_id);

create table if not exists public.replies (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('department_info','decisions','todos')),
  source_item_id text not null,
  reply_text text not null,
  audio_bucket text not null default 'reply-audio',
  audio_path text not null,
  replied_by uuid references public.profiles(id) on delete set null,
  replied_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists replies_replied_at_idx on public.replies (replied_at desc);
create index if not exists replies_source_idx on public.replies (source_type, source_item_id);
create index if not exists replies_replied_by_idx on public.replies (replied_by);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action_type text not null,
  target_type text,
  target_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_at_idx on public.activity_logs (created_at desc);
create index if not exists activity_logs_user_id_created_at_idx on public.activity_logs (user_id, created_at desc);

create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.is_admin_or_boss()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin','boss');
$$;

create or replace function public.is_uploader_or_admin_or_boss()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin','boss','uploader');
$$;

alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.user_departments enable row level security;
alter table public.training_materials enable row level security;
alter table public.training_material_departments enable row level security;
alter table public.replies enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin_or_boss());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.is_admin_or_boss())
with check (id = auth.uid() or public.is_admin_or_boss());

drop policy if exists departments_select_all on public.departments;
create policy departments_select_all
on public.departments
for select
to authenticated
using (true);

drop policy if exists user_departments_select_self on public.user_departments;
create policy user_departments_select_self
on public.user_departments
for select
to authenticated
using (user_id = auth.uid() or public.is_admin_or_boss());

drop policy if exists user_departments_write_admin on public.user_departments;
create policy user_departments_write_admin
on public.user_departments
for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists training_materials_select on public.training_materials;
create policy training_materials_select
on public.training_materials
for select
to authenticated
using (
  public.is_admin_or_boss()
  or (
    status = 'active'
    and visibility = 'all'
  )
  or (
    status = 'active'
    and visibility = 'department'
    and exists (
      select 1
      from public.training_material_departments tmd
      join public.user_departments ud
        on ud.department_id = tmd.department_id
      where tmd.material_id = training_materials.id
        and ud.user_id = auth.uid()
    )
  )
);

drop policy if exists training_materials_insert on public.training_materials;
create policy training_materials_insert
on public.training_materials
for insert
to authenticated
with check (public.is_uploader_or_admin_or_boss() and uploaded_by = auth.uid());

drop policy if exists training_materials_update on public.training_materials;
create policy training_materials_update
on public.training_materials
for update
to authenticated
using (
  public.current_user_role() = 'admin'
  or (public.is_uploader_or_admin_or_boss() and uploaded_by = auth.uid())
)
with check (
  public.current_user_role() = 'admin'
  or (public.is_uploader_or_admin_or_boss() and uploaded_by = auth.uid())
);

drop policy if exists training_material_departments_select on public.training_material_departments;
create policy training_material_departments_select
on public.training_material_departments
for select
to authenticated
using (true);

drop policy if exists training_material_departments_write on public.training_material_departments;
create policy training_material_departments_write
on public.training_material_departments
for all
to authenticated
using (public.is_uploader_or_admin_or_boss())
with check (public.is_uploader_or_admin_or_boss());

drop policy if exists replies_select on public.replies;
create policy replies_select
on public.replies
for select
to authenticated
using (public.is_admin_or_boss());

drop policy if exists replies_insert on public.replies;
create policy replies_insert
on public.replies
for insert
to authenticated
with check (public.current_user_role() = 'boss' and replied_by = auth.uid());

drop policy if exists replies_update on public.replies;
create policy replies_update
on public.replies
for update
to authenticated
using (public.is_admin_or_boss())
with check (public.is_admin_or_boss());

drop policy if exists activity_logs_insert on public.activity_logs;
create policy activity_logs_insert
on public.activity_logs
for insert
to authenticated
with check (user_id = auth.uid() or public.is_admin_or_boss());

drop policy if exists activity_logs_select_admin on public.activity_logs;
create policy activity_logs_select_admin
on public.activity_logs
for select
to authenticated
using (public.current_user_role() = 'admin');

drop policy if exists training_files_objects_select on storage.objects;
create policy training_files_objects_select
on storage.objects
for select
to authenticated
using (bucket_id = 'training-files');

drop policy if exists training_files_objects_insert on storage.objects;
create policy training_files_objects_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'training-files' and public.is_uploader_or_admin_or_boss());

drop policy if exists training_files_objects_update on storage.objects;
create policy training_files_objects_update
on storage.objects
for update
to authenticated
using (bucket_id = 'training-files' and public.is_uploader_or_admin_or_boss())
with check (bucket_id = 'training-files' and public.is_uploader_or_admin_or_boss());

drop policy if exists reply_audio_objects_select on storage.objects;
create policy reply_audio_objects_select
on storage.objects
for select
to authenticated
using (bucket_id = 'reply-audio' and public.is_admin_or_boss());

drop policy if exists reply_audio_objects_insert on storage.objects;
create policy reply_audio_objects_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'reply-audio' and public.is_admin_or_boss());

drop policy if exists reply_audio_objects_update on storage.objects;
create policy reply_audio_objects_update
on storage.objects
for update
to authenticated
using (bucket_id = 'reply-audio' and public.is_admin_or_boss())
with check (bucket_id = 'reply-audio' and public.is_admin_or_boss());

insert into storage.buckets (id, name, public, file_size_limit)
values ('training-files','training-files', false, 2147483648)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public, file_size_limit)
values ('reply-audio','reply-audio', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

commit;
