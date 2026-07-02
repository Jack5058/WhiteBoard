import {
  getAuthenticatedUser,
  hasLifetimeEntitlement,
  LIFETIME_PRICE_CENTS,
  LIFETIME_PRODUCT_NAME,
} from "@/lib/billing-server";
import { createWechatNativePayOrder, getWechatPayConfig } from "@/lib/wechat-pay";

export const runtime = "edge";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const message = typeof record.message === "string" ? record.message : "";
    const code =
      typeof record.code === "string" || typeof record.code === "number"
        ? `code=${record.code}`
        : "";
    const details = [name, message, code].filter(Boolean).join(": ");
    if (details) return details;
  }
  return String(error);
}

export async function POST(request: Request) {
  try {
    const { user, admin } = await getAuthenticatedUser(request);
    const wechatPayConfig = getWechatPayConfig();

    if (!admin) {
      return Response.json(
        { message: "服务端 Supabase 尚未配置。" },
        { status: 503 },
      );
    }
    if (!wechatPayConfig) {
      return Response.json(
        { message: "微信支付服务端密钥尚未配置。" },
        { status: 503 },
      );
    }
    if (!user) {
      return Response.json({ message: "请先登录。" }, { status: 401 });
    }

    if (await hasLifetimeEntitlement(admin, user.id)) {
      return Response.json({ paid: true });
    }

    const requestOrigin = new URL(request.url).origin;
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || requestOrigin).replace(
      /\/$/,
      "",
    );
    const outTradeNo = `WB${Date.now()}${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const now = new Date().toISOString();

    const { error } = await admin.from("payment_orders").insert({
      out_trade_no: outTradeNo,
      user_id: user.id,
      provider: "wechat",
      amount_cents: LIFETIME_PRICE_CENTS,
      currency: "CNY",
      status: "created",
      created_at: now,
      updated_at: now,
    });

    if (error) {
      return Response.json(
        { message: "创建支付订单失败，请确认 payment_orders 数据表已创建。" },
        { status: 500 },
      );
    }

    const codeUrl = await createWechatNativePayOrder({
      outTradeNo,
      amountCents: LIFETIME_PRICE_CENTS,
      description: LIFETIME_PRODUCT_NAME,
      notifyUrl: `${appUrl}/api/billing/wechat/notify`,
    });

    if (!codeUrl) {
      return Response.json({ message: "无法创建微信支付订单。" }, { status: 500 });
    }

    return Response.json({ codeUrl, outTradeNo });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("Wechat Pay order creation failed", error);
    return Response.json(
      { message: `创建微信支付订单异常：${message}` },
      { status: 500 },
    );
  }
}
