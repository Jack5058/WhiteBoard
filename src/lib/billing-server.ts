import "server-only";

import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) return null;

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function getAuthenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;
  const admin = getSupabaseAdmin();

  if (!token || !admin) return { user: null, admin };

  const { data, error } = await admin.auth.getUser(token);
  return { user: error ? null : data.user, admin };
}

export async function hasLifetimeEntitlement(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  userId: string,
) {
  const { data, error } = await admin
    .from("user_entitlements")
    .select("lifetime")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.lifetime === true;
}
