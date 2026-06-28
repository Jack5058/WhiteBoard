import {
  grantLifetimeEntitlement,
  getSupabaseAdmin,
  LIFETIME_PRICE_CENTS,
} from "@/lib/billing-server";
import { getAlipayConfig, verifyAlipayParams } from "@/lib/alipay";

export const runtime = "edge";

function textResponse(message: string, status = 200) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function yuanToCents(amount: string) {
  const [yuan = "0", cents = ""] = amount.split(".");
  return Number(yuan) * 100 + Number(cents.padEnd(2, "0").slice(0, 2));
}

export async function POST(request: Request) {
  const admin = getSupabaseAdmin();
  const alipayConfig = getAlipayConfig();

  if (!admin || !alipayConfig) {
    return textResponse("fail", 503);
  }

  const formData = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    params[key] = String(value);
  }

  const verified = await verifyAlipayParams(params, alipayConfig.alipayPublicKey);
  if (!verified) {
    return textResponse("fail", 400);
  }

  if (params.app_id !== alipayConfig.appId) {
    return textResponse("fail", 400);
  }
  if (alipayConfig.sellerId && params.seller_id !== alipayConfig.sellerId) {
    return textResponse("fail", 400);
  }
  if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(params.trade_status)) {
    return textResponse("success");
  }
  if (yuanToCents(params.total_amount || "0") !== LIFETIME_PRICE_CENTS) {
    return textResponse("fail", 400);
  }

  const { data: order, error: orderError } = await admin
    .from("payment_orders")
    .select("user_id,status")
    .eq("out_trade_no", params.out_trade_no)
    .eq("provider", "alipay")
    .maybeSingle();

  if (orderError || !order) {
    return textResponse("fail", 404);
  }

  await grantLifetimeEntitlement(
    admin,
    order.user_id,
    "alipay",
    params.trade_no || params.out_trade_no,
  );

  const { error: updateError } = await admin
    .from("payment_orders")
    .update({
      status: "paid",
      trade_no: params.trade_no || null,
      buyer_id: params.buyer_id || null,
      paid_at: new Date().toISOString(),
      raw_notify: params,
      updated_at: new Date().toISOString(),
    })
    .eq("out_trade_no", params.out_trade_no);

  if (updateError) {
    return textResponse("fail", 500);
  }

  return textResponse("success");
}
