import "server-only";

const ALIPAY_GATEWAY = "https://openapi.alipay.com/gateway.do";

type AlipayConfig = {
  appId: string;
  appPrivateKey: string;
  alipayPublicKey: string;
  sellerId?: string;
  gateway: string;
};

type AlipaySignParams = Record<string, string>;

function normalizePemKey(key: string, label: "PRIVATE KEY" | "PUBLIC KEY") {
  const trimmed = key.trim().replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n");
  if (trimmed.includes("-----BEGIN")) {
    return trimmed;
  }

  const body = trimmed.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new Error(
      "Alipay key contains invalid characters. Check that the environment variable has no quotes, spaces, or extra text.",
    );
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

function getSignContent(params: AlipaySignParams) {
  return Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export function getAlipayConfig(): AlipayConfig | null {
  const appId = process.env.ALIPAY_APP_ID;
  const appPrivateKey = process.env.ALIPAY_APP_PRIVATE_KEY;
  const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

  if (!appId || !appPrivateKey || !alipayPublicKey) return null;

  return {
    appId,
    appPrivateKey,
    alipayPublicKey,
    sellerId: process.env.ALIPAY_SELLER_ID,
    gateway: process.env.ALIPAY_GATEWAY || ALIPAY_GATEWAY,
  };
}

export async function signAlipayParams(
  params: AlipaySignParams,
  appPrivateKey: string,
) {
  const pem = normalizePemKey(appPrivateKey, "PRIVATE KEY");
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(getSignContent(params)),
  );

  return arrayBufferToBase64(signature);
}

export async function verifyAlipayParams(
  params: AlipaySignParams,
  alipayPublicKey: string,
) {
  const signature = params.sign;
  if (!signature) return false;

  const signParams = { ...params };
  delete signParams.sign;
  delete signParams.sign_type;

  const pem = normalizePemKey(alipayPublicKey, "PUBLIC KEY");
  const publicKey = await crypto.subtle.importKey(
    "spki",
    pemToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = Uint8Array.from(atob(signature), (char) =>
    char.charCodeAt(0),
  );

  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signatureBytes,
    new TextEncoder().encode(getSignContent(signParams)),
  );
}

export async function createAlipayPagePayUrl(params: {
  outTradeNo: string;
  totalAmount: string;
  subject: string;
  returnUrl: string;
  notifyUrl: string;
}) {
  const config = getAlipayConfig();
  if (!config) return null;

  const requestParams: AlipaySignParams = {
    app_id: config.appId,
    method: "alipay.trade.page.pay",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    version: "1.0",
    return_url: params.returnUrl,
    notify_url: params.notifyUrl,
    biz_content: JSON.stringify({
      out_trade_no: params.outTradeNo,
      product_code: "FAST_INSTANT_TRADE_PAY",
      total_amount: params.totalAmount,
      subject: params.subject,
      ...(config.sellerId ? { seller_id: config.sellerId } : {}),
    }),
  };
  const sign = await signAlipayParams(requestParams, config.appPrivateKey);
  const query = new URLSearchParams({ ...requestParams, sign });

  return `${config.gateway}?${query.toString()}`;
}
