import "server-only";

const WECHAT_PAY_GATEWAY = "https://api.mch.weixin.qq.com";

type WechatPayConfig = {
  appId: string;
  mchId: string;
  merchantSerialNo: string;
  merchantPrivateKey: string;
  apiV3Key: string;
  platformPublicKey: string;
  gateway: string;
};

type WechatPayOrderParams = {
  outTradeNo: string;
  description: string;
  amountCents: number;
  notifyUrl: string;
};

type WechatPayEncryptedResource = {
  algorithm: string;
  ciphertext: string;
  associated_data?: string;
  nonce: string;
};

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
      "Wechat Pay key contains invalid characters. Check that the environment variable has no quotes, spaces, or extra text.",
    );
  }

  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}

function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signWithMerchantPrivateKey(message: string, privateKeyText: string) {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(normalizePemKey(privateKeyText, "PRIVATE KEY")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(message),
  );

  return arrayBufferToBase64(signature);
}

export function getWechatPayConfig(): WechatPayConfig | null {
  const appId = process.env.WECHAT_PAY_APP_ID;
  const mchId = process.env.WECHAT_PAY_MCH_ID;
  const merchantSerialNo = process.env.WECHAT_PAY_MERCHANT_SERIAL_NO;
  const merchantPrivateKey = process.env.WECHAT_PAY_MERCHANT_PRIVATE_KEY;
  const apiV3Key = process.env.WECHAT_PAY_API_V3_KEY;
  const platformPublicKey = process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY;

  if (
    !appId ||
    !mchId ||
    !merchantSerialNo ||
    !merchantPrivateKey ||
    !apiV3Key ||
    !platformPublicKey
  ) {
    return null;
  }

  return {
    appId,
    mchId,
    merchantSerialNo,
    merchantPrivateKey,
    apiV3Key,
    platformPublicKey,
    gateway: process.env.WECHAT_PAY_GATEWAY || WECHAT_PAY_GATEWAY,
  };
}

export async function createWechatNativePayOrder(params: WechatPayOrderParams) {
  const config = getWechatPayConfig();
  if (!config) return null;

  const endpoint = "/v3/pay/transactions/native";
  const url = new URL(endpoint, config.gateway);
  const body = JSON.stringify({
    appid: config.appId,
    mchid: config.mchId,
    description: params.description,
    out_trade_no: params.outTradeNo,
    notify_url: params.notifyUrl,
    amount: {
      total: params.amountCents,
      currency: "CNY",
    },
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = createNonce();
  const signature = await signWithMerchantPrivateKey(
    `POST\n${url.pathname}${url.search}\n${timestamp}\n${nonce}\n${body}\n`,
    config.merchantPrivateKey,
  );
  const authorizationParams = [
    `mchid="${config.mchId}"`,
    `nonce_str="${nonce}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${config.merchantSerialNo}"`,
    `signature="${signature}"`,
  ].join(",");
  const authorization = `WECHATPAY2-SHA256-RSA2048 ${authorizationParams}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
  });
  const result = (await response.json().catch(() => null)) as {
    code_url?: string;
    message?: string;
    code?: string;
  } | null;

  if (!response.ok || !result?.code_url) {
    throw new Error(result?.message || result?.code || "Wechat Pay order creation failed.");
  }

  return result.code_url;
}

export async function verifyWechatPayNotification(
  headers: Headers,
  body: string,
  platformPublicKey: string,
) {
  const timestamp = headers.get("wechatpay-timestamp");
  const nonce = headers.get("wechatpay-nonce");
  const signature = headers.get("wechatpay-signature");

  if (!timestamp || !nonce || !signature) return false;

  const publicKey = await crypto.subtle.importKey(
    "spki",
    pemToArrayBuffer(normalizePemKey(platformPublicKey, "PUBLIC KEY")),
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
    new TextEncoder().encode(`${timestamp}\n${nonce}\n${body}\n`),
  );
}

export async function decryptWechatPayResource(
  resource: WechatPayEncryptedResource,
  apiV3Key: string,
) {
  if (resource.algorithm !== "AEAD_AES_256_GCM") {
    throw new Error(`Unsupported Wechat Pay resource algorithm: ${resource.algorithm}`);
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(apiV3Key),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: encoder.encode(resource.nonce),
      additionalData: encoder.encode(resource.associated_data || ""),
      tagLength: 128,
    },
    key,
    Uint8Array.from(atob(resource.ciphertext), (char) => char.charCodeAt(0)),
  );

  return JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;
}
