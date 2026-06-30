import {
  getAuthenticatedUser,
  hasLifetimeEntitlement,
  LIFETIME_PRICE_CENTS,
  LIFETIME_PRICE_CNY,
  LIFETIME_PRODUCT_NAME,
} from "@/lib/billing-server";
import { createAlipayPagePayUrl, getAlipayConfig } from "@/lib/alipay";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const { user, admin } = await getAuthenticatedUser(request);
    const alipayConfig = getAlipayConfig();

    if (!admin) {
      return Response.json(
        { message: "服务端 Supabase 尚未配置。" },
        { status: 503 },
      );
    }
    if (!alipayConfig) {
      return Response.json(
        { message: "支付宝服务端密钥尚未配置。" },
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
      provider: "alipay",
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

    const paymentUrl = await createAlipayPagePayUrl({
      outTradeNo,
      totalAmount: LIFETIME_PRICE_CNY,
      subject: LIFETIME_PRODUCT_NAME,
      returnUrl: `${appUrl}/?payment=success`,
      notifyUrl: `${appUrl}/api/billing/alipay/notify`,
    });

    if (!paymentUrl) {
      return Response.json({ message: "无法创建支付宝支付链接。" }, { status: 500 });
    }

    return Response.json({ url: paymentUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return Response.json(
      { message: `创建支付宝订单异常：${message}` },
      { status: 500 },
    );
  }
}
