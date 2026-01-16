-- Enable RLS (Row Level Security) - Optional but recommended for security
-- For this MVP, we will start with open access but basic structure
-- You can run this entire script in the Supabase SQL Editor

-- 1. Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create room_users table
CREATE TABLE IF NOT EXISTS room_users (
  room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT,
  data JSONB, -- Stores the full user object (name, languages, avatar, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

-- 3. Create room_messages table
CREATE TABLE IF NOT EXISTS room_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  data JSONB, -- Stores the full message object
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create app_settings table
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings (key, value)
VALUES ('rooms_auto_delete_after_24h', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 5. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_room_users_room_id ON room_users(room_id);
CREATE INDEX IF NOT EXISTS idx_room_messages_room_id ON room_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_room_messages_created_at ON room_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_rooms_last_activity_at ON rooms(last_activity_at);

CREATE OR REPLACE FUNCTION public.touch_room_last_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.rooms
  SET last_activity_at = NEW.created_at
  WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_room_message_insert_touch_room ON public.room_messages;
CREATE TRIGGER on_room_message_insert_touch_room
AFTER INSERT ON public.room_messages
FOR EACH ROW EXECUTE PROCEDURE public.touch_room_last_activity();

-- 6. Create profiles table (auth.users + profiles)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_select_own'
  ) THEN
    EXECUTE 'CREATE POLICY profiles_select_own ON public.profiles FOR SELECT USING (auth.uid() = id)';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_own'
  ) THEN
    EXECUTE 'CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  full_name TEXT;
  avatar TEXT;
BEGIN
  full_name := COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  avatar := COALESCE(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture');

  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (new.id, new.email, full_name, avatar)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
    updated_at = NOW();

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 6. (Optional) Set up Realtime
-- To enable realtime for these tables, you need to add them to the publication
-- This is usually done via the Dashboard: Database -> Replication -> supabase_realtime
-- Or via SQL:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel pr
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
      AND n.nspname = 'public'
      AND c.relname = 'rooms'
  ) THEN
    EXECUTE 'alter publication supabase_realtime add table public.rooms';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel pr
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
      AND n.nspname = 'public'
      AND c.relname = 'room_users'
  ) THEN
    EXECUTE 'alter publication supabase_realtime add table public.room_users';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel pr
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
      AND n.nspname = 'public'
      AND c.relname = 'room_messages'
  ) THEN
    EXECUTE 'alter publication supabase_realtime add table public.room_messages';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel pr
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pr.prpubid = (SELECT oid FROM pg_publication WHERE pubname = 'supabase_realtime')
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE 'alter publication supabase_realtime add table public.profiles';
  END IF;
END $$;
