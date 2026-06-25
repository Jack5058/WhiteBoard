"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";

type MenuPosition = {
  left: number;
  top: number;
  height: number;
};

type AuthView = "login" | "register" | "reset" | "updatePassword";
type RegisterMethod = "email" | "phone";
type PaymentMethod = "wechat" | "alipay";

type PaymentOption = {
  id: PaymentMethod;
  name: string;
  hint: string;
  url?: string;
  qrUrl?: string;
  urlEnv: string;
  qrEnv: string;
};

const PAYMENT_OPTIONS: PaymentOption[] = [
  {
    id: "wechat",
    name: "微信支付",
    hint: "微信扫码或打开付款链接",
    url: process.env.NEXT_PUBLIC_WECHAT_PAY_URL,
    qrUrl: process.env.NEXT_PUBLIC_WECHAT_PAY_QR_URL,
    urlEnv: "NEXT_PUBLIC_WECHAT_PAY_URL",
    qrEnv: "NEXT_PUBLIC_WECHAT_PAY_QR_URL",
  },
  {
    id: "alipay",
    name: "支付宝支付",
    hint: "支付宝扫码或打开付款链接",
    url: process.env.NEXT_PUBLIC_ALIPAY_PAY_URL,
    qrUrl: process.env.NEXT_PUBLIC_ALIPAY_PAY_QR_URL,
    urlEnv: "NEXT_PUBLIC_ALIPAY_PAY_URL",
    qrEnv: "NEXT_PUBLIC_ALIPAY_PAY_QR_URL",
  },
];

type AccountMenuProps = {
  onEntitlementChange?: (paid: boolean) => void;
};

function getUserLabel(user: User) {
  return (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email ||
    user.phone ||
    "已登录"
  );
}

function getUserAvatar(user: User) {
  return user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
}

function UserIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20c.7-4 3-6 6.5-6s5.8 2 6.5 6" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.5L15.4 17c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.5H3.2a10 10 0 0 0 0 9.1L6.5 14Z" />
      <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.9 1.5l2.8-2.8A9.4 9.4 0 0 0 12 2a10 10 0 0 0-8.8 5.5l3.3 2.6A5.8 5.8 0 0 1 12 6Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function MoneyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.8 8.8c-.6-.6-1.5-.9-2.6-.9-1.5 0-2.5.7-2.5 1.8 0 2.8 5.3 1.2 5.3 4.3 0 1.2-1.1 2.1-2.8 2.1-1.2 0-2.3-.4-3-1.1M12.2 6.5v11" />
    </svg>
  );
}

function WechatPayIcon() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1aad19] text-white">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M9.5 4C5.4 4 2.2 6.6 2.2 9.9c0 1.9 1.1 3.6 2.8 4.7l-.7 2.1 2.5-1.2c.8.2 1.7.4 2.7.4 4.1 0 7.3-2.6 7.3-5.9C16.8 6.6 13.6 4 9.5 4Zm-2.4 5.2a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm4.7 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm7.4 2.7c0-2.4-2.2-4.5-5.1-5.1.9.9 1.4 2 1.4 3.2 0 3.1-3 5.6-6.8 5.9 1 1.2 2.8 2 4.8 2 .7 0 1.4-.1 2.1-.3l2 1-.5-1.7c1.3-.9 2.1-2.1 2.1-3.6Zm-7.6-.3a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4Zm3.7 0a.7.7 0 1 1 0-1.4.7.7 0 0 1 0 1.4Z" />
      </svg>
    </span>
  );
}

function AlipayIcon() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1677ff] text-white">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 7h12" />
        <path d="M8 11h8" />
        <path d="M12 4v7" />
        <path d="M8 19c2.5-1.3 5.7-4.3 6.8-8" />
        <path d="M6 15c4.2 3.5 8.2 4.6 12 4.7" />
      </svg>
    </span>
  );
}

export function AccountMenu({ onEntitlementChange }: AccountMenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<AuthView>("login");
  const [registerMethod, setRegisterMethod] = useState<RegisterMethod>("email");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [awaitingPhoneOtp, setAwaitingPhoneOtp] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("wechat");
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const supabase = useMemo(() => getSupabaseClient(), []);
  const accountInputRef = useRef<HTMLInputElement>(null);
  const selectedPayment = useMemo(
    () =>
      PAYMENT_OPTIONS.find((option) => option.id === paymentMethod) ??
      PAYMENT_OPTIONS[0],
    [paymentMethod],
  );

  const updatePaidState = useCallback(
    (nextPaid: boolean) => {
      setPaid(nextPaid);
      onEntitlementChange?.(nextPaid);
    },
    [onEntitlementChange],
  );

  const resetForm = useCallback((nextView: AuthView = "login") => {
    setView(nextView);
    setAccount("");
    setPassword("");
    setConfirmPassword("");
    setPhoneOtp("");
    setAwaitingPhoneOtp(false);
    setMessage(null);
    setLoading(false);
  }, []);

  const closeModal = useCallback(() => {
    setOpen(false);
    resetForm();
  }, [resetForm]);

  const updatePosition = useCallback(() => {
    const menu = document.querySelector<HTMLElement>(
      ".Stack.Stack_vertical.App-menu_top__left",
    );

    if (!menu) {
      setPosition({ left: 60, top: 16, height: 36 });
      return;
    }

    const bounds = menu.getBoundingClientRect();
    const menuButton = menu.querySelector<HTMLElement>(
      '[data-testid="main-menu-trigger"]',
    );
    const buttonBounds = menuButton?.getBoundingClientRect();

    setPosition({
      left: bounds.right + 8,
      top: buttonBounds?.top ?? bounds.top,
      height: buttonBounds?.height || 36,
    });
  }, []);

  const refreshEntitlement = useCallback(async () => {
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    const accessToken = data.session?.access_token;

    if (!accessToken) {
      updatePaidState(false);
      return false;
    }

    try {
      const response = await fetch("/api/billing/status", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const result = (await response.json()) as { paid?: boolean };
      const nextPaid = response.ok && result.paid === true;
      updatePaidState(nextPaid);
      return nextPaid;
    } catch {
      updatePaidState(false);
      return false;
    }
  }, [supabase, updatePaidState]);

  useEffect(() => {
    void supabase?.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) void refreshEntitlement();
    });

    const authSubscription = supabase?.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") {
        setOpen(true);
        setView("updatePassword");
        setAccount("");
        setPassword("");
        setConfirmPassword("");
        setMessage("请输入新密码完成重置。");
        setLoading(false);
        return;
      }
      if (session?.user) {
        setOpen(false);
        resetForm();
        void refreshEntitlement();
      } else {
        updatePaidState(false);
      }
    });

    return () => authSubscription?.data.subscription.unsubscribe();
  }, [refreshEntitlement, resetForm, supabase, updatePaidState]);

  useEffect(() => {
    let observedMenu: HTMLElement | null = null;
    const resizeObserver = new ResizeObserver(updatePosition);
    const mutationObserver = new MutationObserver(() => {
      const menu = document.querySelector<HTMLElement>(
        ".Stack.Stack_vertical.App-menu_top__left",
      );
      if (menu && menu !== observedMenu) {
        if (observedMenu) resizeObserver.unobserve(observedMenu);
        observedMenu = menu;
        resizeObserver.observe(menu);
      }
      updatePosition();
    });

    const frame = requestAnimationFrame(updatePosition);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", updatePosition);

    return () => {
      cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
    };
  }, [updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", handleKeyDown);
    const frame = requestAnimationFrame(() => accountInputRef.current?.focus());

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeModal, open, view, registerMethod]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      setMessage("请先配置 Supabase 环境变量。");
      return;
    }

    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setMessage(error.message);
      setLoading(false);
    }
  }, [supabase]);

  const signInWithPassword = useCallback(async () => {
    const normalizedAccount = account.trim();
    if (!normalizedAccount || !password) {
      setMessage("请输入邮箱或手机号和密码。");
      return;
    }
    if (!supabase) {
      setMessage("请先配置 Supabase 环境变量。");
      return;
    }

    setLoading(true);
    setMessage(null);
    const credentials = normalizedAccount.includes("@")
      ? { email: normalizedAccount, password }
      : { phone: normalizedAccount, password };
    const { error } = await supabase.auth.signInWithPassword(credentials);
    setLoading(false);
    if (error) setMessage(error.message);
  }, [account, password, supabase]);

  const sendPasswordResetEmail = useCallback(async () => {
    const normalizedEmail = account.trim();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setMessage("请输入用于注册的邮箱地址。");
      return;
    }
    if (!supabase) {
      setMessage("请先配置 Supabase 环境变量。");
      return;
    }

    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: window.location.origin,
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("密码重置邮件已发送，请前往邮箱打开链接。");
  }, [account, supabase]);

  const updatePassword = useCallback(async () => {
    if (!password) {
      setMessage("请输入新密码。");
      return;
    }
    if (password.length < 6) {
      setMessage("密码至少需要 6 个字符。");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("两次输入的密码不一致。");
      return;
    }
    if (!supabase) {
      setMessage("请先配置 Supabase 环境变量。");
      return;
    }

    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setLoading(false);
      setMessage(error.message);
      return;
    }

    await supabase.auth.signOut();
    resetForm("login");
    setOpen(true);
    setMessage("密码已重置，请使用新密码登录。");
  }, [confirmPassword, password, resetForm, supabase]);

  const register = useCallback(async () => {
    const normalizedAccount = account.trim();
    if (!normalizedAccount || !password) {
      setMessage(`请输入${registerMethod === "email" ? "邮箱" : "手机号"}和密码。`);
      return;
    }
    if (password.length < 6) {
      setMessage("密码至少需要 6 个字符。");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("两次输入的密码不一致。");
      return;
    }
    if (!supabase) {
      setMessage("请先配置 Supabase 环境变量。");
      return;
    }

    setLoading(true);
    setMessage(null);

    if (registerMethod === "email") {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedAccount,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      setLoading(false);
      if (error) {
        setMessage(error.message);
      } else if (!data.session) {
        setMessage("注册邮件已发送，请前往邮箱完成确认。");
      }
      return;
    }

    const { error } = await supabase.auth.signUp({
      phone: normalizedAccount,
      password,
      options: { channel: "sms" },
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setAwaitingPhoneOtp(true);
    setMessage("验证码已发送，请输入短信验证码完成注册。");
  }, [account, confirmPassword, password, registerMethod, supabase]);

  const verifyPhoneOtp = useCallback(async () => {
    const phone = account.trim();
    const token = phoneOtp.trim();
    if (!token) {
      setMessage("请输入短信验证码。");
      return;
    }
    if (!supabase) return;

    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
    setLoading(false);
    if (error) setMessage(error.message);
  }, [account, phoneOtp, supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signOut();
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setUser(null);
    closeModal();
  }, [closeModal, supabase]);

  const openPayment = useCallback(() => {
    if (!user) {
      resetForm("login");
      setMessage("请先登录后再购买永久订阅。");
      setOpen(true);
      return;
    }

    setPaymentMessage(paid ? "当前账号已拥有永久使用权益。" : null);
    setPaymentMethod("wechat");
    setPaymentOpen(true);
  }, [paid, resetForm, user]);

  const openSelectedPayment = useCallback(() => {
    if (paid) return;

    if (selectedPayment.url) {
      window.open(selectedPayment.url, "_blank", "noopener,noreferrer");
      setPaymentMessage(
        `已打开${selectedPayment.name}，支付完成后请点击“刷新权益状态”。`,
      );
      return;
    }

    if (selectedPayment.qrUrl) {
      setPaymentMessage(`请使用${selectedPayment.name}扫码完成 ¥19.90 支付。`);
      return;
    }

    setPaymentMessage(
      `尚未配置${selectedPayment.name}。请在 .env.local 中配置 ${selectedPayment.urlEnv} 或 ${selectedPayment.qrEnv}。`,
    );
  }, [paid, selectedPayment]);

  const refreshPaymentStatus = useCallback(async () => {
    setPaymentMessage("正在刷新权益状态...");
    const isPaid = await refreshEntitlement();
    setPaymentMessage(
      isPaid
        ? "永久订阅已开通，感谢支持！"
        : "暂未检测到永久权益。如果刚完成付款，请稍后再刷新。",
    );
  }, [refreshEntitlement]);

  const label = user ? getUserLabel(user) : "登录";
  const avatar = user ? getUserAvatar(user) : null;
  const isRegister = view === "register";
  const isResetPassword = view === "reset";
  const isUpdatingPassword = view === "updatePassword";

  return (
    <>
      <div
        className="absolute z-30 flex items-center gap-2"
        style={position ? { left: position.left, top: position.top } : { left: 60, top: 16 }}
      >
        <button
          type="button"
          title={user ? label : "登录或注册"}
          aria-label={user ? `当前账号：${label}` : "登录或注册"}
          onClick={() => {
            setOpen(true);
            setMessage(null);
          }}
          style={{
            height: position?.height ?? 36,
            width: user ? undefined : position?.height ?? 36,
          }}
          className={`flex items-center overflow-hidden rounded-lg border-0 bg-[#ececf4] text-sm font-medium text-[#1b1b1f] shadow-[0_0_0_1px_#fff] transition-all duration-300 hover:bg-[#f1f0ff] active:shadow-[0_0_0_1px_#4440bf] ${
            user ? "max-w-56 gap-2 px-2.5" : "justify-center"
          }`}
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
          ) : (
            <span className={`flex shrink-0 items-center justify-center rounded-full ${user ? "h-7 w-7 bg-white/70" : "h-full w-full"}`}>
              <UserIcon />
            </span>
          )}
          {user && <span className="truncate">{label}</span>}
        </button>

        <button
          type="button"
          title={paid ? "已开通永久订阅" : "永久订阅"}
          aria-label={paid ? "已开通永久订阅" : "购买永久订阅"}
          onClick={openPayment}
          style={{ height: position?.height ?? 36 }}
          className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium shadow-[0_0_0_1px_#fff] transition-colors active:shadow-[0_0_0_1px_#b7791f] ${
            paid
              ? "bg-[#f5b82e] text-[#4b3200] hover:bg-[#e9aa1d]"
              : "bg-[#fff3bf] text-[#6b4f00] hover:bg-[#ffe999]"
          }`}
        >
          <MoneyIcon />
          <span>{paid ? "已永久订阅" : "永久订阅"}</span>
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-dialog-title"
            className="relative w-full max-w-[420px] rounded-3xl border border-white/80 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
          >
            <button
              type="button"
              aria-label="关闭"
              onClick={closeModal}
              className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            >
              <CloseIcon />
            </button>

            {user && !isUpdatingPassword ? (
              <div className="px-2 py-4 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-[#ececf4] text-zinc-700">
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <UserIcon />
                  )}
                </div>
                <h2 id="account-dialog-title" className="text-xl font-semibold text-zinc-900">{label}</h2>
                <p className="mt-1 text-sm text-zinc-500">{user.email || user.phone}</p>
                {message && <p className="mt-4 text-sm text-red-600">{message}</p>}
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={loading}
                  className="mt-6 h-11 w-full rounded-xl border border-red-200 bg-red-50 text-sm font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                >
                  {loading ? "正在退出..." : "退出登录"}
                </button>
              </div>
            ) : (
              <>
                <div className="mb-6 pr-10">
                  <h2 id="account-dialog-title" className="text-2xl font-semibold tracking-tight text-zinc-900">
                    {isUpdatingPassword
                      ? "设置新密码"
                      : isResetPassword
                        ? "重置密码"
                        : isRegister
                          ? "创建账号"
                          : "欢迎回来"}
                  </h2>
                  <p className="mt-1.5 text-sm text-zinc-500">
                    {isUpdatingPassword
                      ? "请输入新密码完成账号恢复"
                      : isResetPassword
                        ? "输入邮箱后，我们会发送密码重置链接"
                        : isRegister
                          ? "选择邮箱或手机号完成注册"
                          : "登录后继续使用你的白板"}
                  </p>
                </div>

                {!isResetPassword && !isUpdatingPassword && (
                  <div className="mb-5 grid grid-cols-2 rounded-xl bg-zinc-100 p-1">
                    {(["login", "register"] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => resetForm(item)}
                        className={`h-9 rounded-lg text-sm font-medium transition ${
                          view === item ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                        }`}
                      >
                        {item === "login" ? "登录" : "注册"}
                      </button>
                    ))}
                  </div>
                )}

                {(isResetPassword || isUpdatingPassword) && (
                  <button
                    type="button"
                    onClick={() => resetForm("login")}
                    className="mb-5 text-sm font-medium text-[#6965db] transition hover:text-[#4a47b1]"
                  >
                    返回登录
                  </button>
                )}

                {isRegister && (
                  <div className="mb-4 flex gap-2">
                    {(["email", "phone"] as const).map((method) => {
                      const phoneDisabled = method === "phone";
                      return (
                      <button
                        key={method}
                        type="button"
                        disabled={awaitingPhoneOtp || phoneDisabled}
                        title={phoneDisabled ? "手机号注册暂未开放" : undefined}
                        onClick={() => {
                          if (phoneDisabled) return;
                          setRegisterMethod(method);
                          setAccount("");
                          setMessage(null);
                        }}
                        className={`h-9 flex-1 rounded-xl border text-sm transition ${
                          registerMethod === method
                            ? "border-[#6965db] bg-[#f1f0ff] font-medium text-[#4a47b1]"
                            : phoneDisabled
                              ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-300"
                              : "border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                        } disabled:opacity-60`}
                      >
                        {method === "email" ? "邮箱注册" : "手机号注册（暂未开放）"}
                      </button>
                    );
                    })}
                  </div>
                )}

                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (isResetPassword) void sendPasswordResetEmail();
                    else if (isUpdatingPassword) void updatePassword();
                    else if (awaitingPhoneOtp) void verifyPhoneOtp();
                    else if (isRegister) void register();
                    else void signInWithPassword();
                  }}
                >
                  {!isUpdatingPassword && (
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-zinc-700">
                        {isResetPassword ? "邮箱" : isRegister ? (registerMethod === "email" ? "邮箱" : "手机号") : "账号"}
                      </span>
                      <input
                        ref={accountInputRef}
                        type={isRegister && registerMethod === "phone" ? "tel" : isResetPassword ? "email" : "text"}
                        value={account}
                        disabled={awaitingPhoneOtp}
                        onChange={(event) => setAccount(event.target.value)}
                        autoComplete="username"
                        placeholder={
                          isRegister && registerMethod === "phone"
                            ? "+86 138 0000 0000"
                            : isRegister || isResetPassword
                              ? "name@example.com"
                              : "邮箱或国际格式手机号"
                        }
                        className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-[#6965db] focus:ring-2 focus:ring-[#6965db]/10 disabled:bg-zinc-50"
                      />
                    </label>
                  )}

                  {!awaitingPhoneOtp && !isResetPassword ? (
                    <>
                      <label className="block">
                        <span className="mb-1.5 block text-sm font-medium text-zinc-700">密码</span>
                        <input
                          type="password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          autoComplete={isRegister || isUpdatingPassword ? "new-password" : "current-password"}
                          placeholder={isRegister || isUpdatingPassword ? "至少 6 个字符" : "请输入密码"}
                          className="h-11 w-full rounded-xl border border-zinc-200 px-3.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-[#6965db] focus:ring-2 focus:ring-[#6965db]/10"
                        />
                      </label>
                      {view === "login" && (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              const currentAccount = account.trim();
                              resetForm("reset");
                              setAccount(currentAccount.includes("@") ? currentAccount : "");
                            }}
                            className="text-xs font-medium text-[#6965db] transition hover:text-[#4a47b1]"
                          >
                            忘记密码 / 重置密码
                          </button>
                        </div>
                      )}
                      {(isRegister || isUpdatingPassword) && (
                        <label className="block">
                          <span className="mb-1.5 block text-sm font-medium text-zinc-700">确认密码</span>
                          <input
                            type="password"
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            autoComplete="new-password"
                            placeholder="再次输入密码"
                            className="h-11 w-full rounded-xl border border-zinc-200 px-3.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-[#6965db] focus:ring-2 focus:ring-[#6965db]/10"
                          />
                        </label>
                      )}
                    </>
                  ) : (
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-zinc-700">短信验证码</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={phoneOtp}
                        onChange={(event) => setPhoneOtp(event.target.value.replace(/\D/g, ""))}
                        autoComplete="one-time-code"
                        placeholder="输入验证码"
                        className="h-11 w-full rounded-xl border border-zinc-200 px-3.5 text-center text-lg tracking-[0.35em] text-zinc-900 outline-none transition placeholder:text-sm placeholder:tracking-normal placeholder:text-zinc-400 focus:border-[#6965db] focus:ring-2 focus:ring-[#6965db]/10"
                      />
                    </label>
                  )}

                  {message && (
                    <p className={`text-center text-xs leading-5 ${message.includes("已发送") ? "text-emerald-600" : "text-red-600"}`}>
                      {message}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="h-11 w-full rounded-xl bg-[#6965db] text-sm font-semibold text-white transition hover:bg-[#5b57d1] disabled:cursor-wait disabled:opacity-60"
                  >
                    {loading
                      ? "请稍候..."
                      : isResetPassword
                        ? "发送重置邮件"
                        : isUpdatingPassword
                          ? "确认新密码"
                          : awaitingPhoneOtp
                        ? "验证并完成注册"
                        : isRegister
                          ? "注册"
                          : "登录"}
                  </button>
                </form>

                {view === "login" && (
                  <>
                    <div className="my-5 flex items-center gap-3 text-xs text-zinc-400">
                      <span className="h-px flex-1 bg-zinc-200" />
                      或
                      <span className="h-px flex-1 bg-zinc-200" />
                    </div>
                    <button
                      type="button"
                      onClick={() => void signInWithGoogle()}
                      disabled={loading}
                      className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
                    >
                      <GoogleIcon />
                      使用 Google 账号一键登录
                    </button>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {paymentOpen && (
        <div
          className="fixed inset-0 z-[101] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setPaymentOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-dialog-title"
            className="relative w-full max-w-[400px] rounded-3xl border border-white/80 bg-white p-7 text-center shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
          >
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setPaymentOpen(false)}
              className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            >
              <CloseIcon />
            </button>

            <div className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl ${paid ? "bg-[#f5b82e] text-[#4b3200]" : "bg-[#fff3bf] text-[#6b4f00]"}`}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 3 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.7 5.2-.8L12 3Z" />
              </svg>
            </div>
            <h2 id="payment-dialog-title" className="text-2xl font-semibold text-zinc-900">
              {paid ? "永久权益已开通" : "去除水印，永久使用"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              {paid
                ? "该权益已绑定到当前账号，后续登录会自动恢复。"
                : "一次支付，无需续费，永久解锁无水印导出。"}
            </p>

            {paymentMessage && (
              <p className={`mt-4 rounded-xl px-3 py-2.5 text-sm ${paid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {paymentMessage}
              </p>
            )}

            {!paid && (
              <div className="mt-6 space-y-4 text-left">
                <div className="grid grid-cols-2 gap-3">
                  {PAYMENT_OPTIONS.map((option) => {
                    const active = option.id === paymentMethod;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(option.id);
                          setPaymentMessage(null);
                        }}
                        className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
                          active
                            ? "border-[#f5b82e] bg-[#fff8dd] shadow-[0_8px_24px_rgba(245,184,46,0.18)]"
                            : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50"
                        }`}
                      >
                        {option.id === "wechat" ? <WechatPayIcon /> : <AlipayIcon />}
                        <span>
                          <span className="block text-sm font-semibold text-zinc-900">{option.name}</span>
                          <span className="mt-0.5 block text-xs text-zinc-500">{option.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-4 text-center">
                  {selectedPayment.qrUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selectedPayment.qrUrl}
                        alt={`${selectedPayment.name}二维码`}
                        className="mx-auto h-36 w-36 rounded-xl bg-white object-contain p-2 shadow-sm"
                      />
                      <p className="mt-3 text-sm text-zinc-600">
                        使用{selectedPayment.name}扫码支付 ¥19.90。
                      </p>
                    </>
                  ) : (
                    <p className="text-sm leading-6 text-zinc-500">
                      {selectedPayment.url
                        ? `点击下方按钮打开${selectedPayment.name}付款链接。`
                        : `请配置 ${selectedPayment.urlEnv} 或 ${selectedPayment.qrEnv} 后启用${selectedPayment.name}。`}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={openSelectedPayment}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#f5b82e] text-sm font-semibold text-[#4b3200] transition hover:bg-[#e9aa1d]"
                  >
                    <MoneyIcon />
                    {selectedPayment.url
                      ? `打开${selectedPayment.name}`
                      : selectedPayment.qrUrl
                        ? "显示付款提示"
                        : "付款方式未配置"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void refreshPaymentStatus()}
                    className="h-12 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                  >
                    刷新权益状态
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
