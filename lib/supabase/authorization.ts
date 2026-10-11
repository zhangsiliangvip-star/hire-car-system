import "server-only";

import type { AccountProfile } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedProfile() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError && authError.name !== "AuthSessionMissingError") {
    throw new Error(`Failed to verify authenticated user: ${authError.message}`);
  }
  if (!user) {
    return { supabase, user: null, profile: null };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, company, position, role, email_confirmed")
    .eq("id", user.id)
    .single();

  if (error) {
    throw new Error(`Failed to load authenticated profile: ${error.message}`);
  }

  const profile: AccountProfile = {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    company: data.company,
    position: data.position,
    role: data.role,
    emailConfirmed: data.email_confirmed,
  };

  return { supabase, user, profile };
}
