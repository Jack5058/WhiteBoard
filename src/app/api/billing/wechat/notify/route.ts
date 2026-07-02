import {
  grantLifetimeEntitlement,
  getSupabaseAdmin,
  LIFETIME_PRICE_CENTS,
} from "@/lib/billing-server";
import {
  decryptWechatPayResource,
  getWechatPayConfig,
  verifyWechatPayNotification,
} from "@/lib/wechat-pay";

export const runtime = "edge";

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : 0;
}

export async function POST(request: Request) {
  const admin = getSupabaseAdmin();
  const wechatPayConfig = getWechatPayConfig();

  if (!admin || !wechatPayConfig) {
    return jsonResponse({ code: "FAIL", message: "service not configured" }, 503);
  }

  const body = await request.text();
  const verified = await verifyWechatPayNotification(
    request.headers,
    body,
    wechatPayConfig.platformPublicKey,
  );

  if (!verified) {
    return jsonResponse({ code: "FAIL", message: "invalid signature" }, 400);
  }

  const payload = JSON.parse(body) as {
    event_type?: string;
    resource?: {
      algorithm: string;
      ciphertext: string;
      associated_data?: string;
      nonce: string;
    };
  };

  if (payload.event_type !== "TRANSACTION.SUCCESS") {
    return jsonResponse({ code: "SUCCESS", message: "成功" });
  }
  if (!payload.resource) {
    return jsonResponse({ code: "FAIL", message: "missing resource" }, 400);
  }

  const transaction = await decryptWechatPayResource(
    payload.resource,
    wechatPayConfig.apiV3Key,
  );
  const outTradeNo = stringValue(transaction.out_trade_no);
  const transactionId = stringValue(transaction.transaction_id);
  const tradeState = stringValue(transaction.trade_state);
  const appId = stringValue(transaction.appid);
  const mchId = stringValue(transaction.mchid);
  const amount = transaction.amount as Record<string, unknown> | undefined;
  const payer = transaction.payer as Record<string, unknown> | undefined;
  const total = numberValue(amount?.total);

  if (
    !outTradeNo ||
    tradeState !== "SUCCESS" ||
    appId !== wechatPayConfig.appId ||
    mchId !== wechatPayConfig.mchId ||
    total !== LIFETIME_PRICE_CENTS
  ) {
    return jsonResponse({ code: "FAIL", message: "invalid transaction" }, 400);
  }

  const { data: order, error: orderError } = await admin
    .from("payment_orders")
    .select("user_id,status")
    .eq("out_trade_no", outTradeNo)
    .eq("provider", "wechat")
    .maybeSingle();

  if (orderError || !order) {
    return jsonResponse({ code: "FAIL", message: "order not found" }, 404);
  }

  await grantLifetimeEntitlement(
    admin,
    order.user_id,
    "wechat",
    transactionId || outTradeNo,
  );

  const { error: updateError } = await admin
    .from("payment_orders")
    .update({
      status: "paid",
      trade_no: transactionId || null,
      buyer_id: stringValue(payer?.openid) || null,
      paid_at: new Date().toISOString(),
      raw_notify: transaction,
      updated_at: new Date().toISOString(),
    })
    .eq("out_trade_no", outTradeNo);

  if (updateError) {
    return jsonResponse({ code: "FAIL", message: "order update failed" }, 500);
  }

  return jsonResponse({ code: "SUCCESS", message: "成功" });
}
