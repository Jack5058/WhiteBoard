import { getAuthenticatedUser, hasLifetimeEntitlement } from "@/lib/billing-server";

export const runtime = "edge";

export async function GET(request: Request) {
  const { user, admin } = await getAuthenticatedUser(request);

  if (!admin) {
    return Response.json(
      { paid: false, configured: false, message: "服务端 Supabase 尚未配置。" },
      { status: 503 },
    );
  }
  if (!user) {
    return Response.json({ paid: false, message: "请先登录。" }, { status: 401 });
  }

  try {
    const paid = await hasLifetimeEntitlement(admin, user.id);
    return Response.json({ paid, configured: true });
  } catch {
    return Response.json(
      { paid: false, configured: false, message: "永久权益数据表尚未创建。" },
      { status: 503 },
    );
  }
}
