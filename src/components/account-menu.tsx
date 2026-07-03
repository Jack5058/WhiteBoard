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
    hint: "跳转支付宝官方收银台",
    urlEnv: "ALIPAY_APP_ID",
    qrEnv: "ALIPAY_APP_PRIVATE_KEY",
  },
];

type AccountMenuProps = {
  onEntitlementChange?: (paid: boolean) => void;
};

type WelcomePage = {
  badge: string;
  title: string;
  description: string;
  points: string[];
  icon: "overview" | "draw" | "slides" | "record" | "teleprompter";
};

const WELCOME_PAGES: WelcomePage[] = [
  {
    badge: "WhiteBoard 是什么",
    title: "把白板、幻灯片和录制放在一起",
    description:
      "WhiteBoard 是一个面向讲解、课程、自媒体脚本和灵感整理的创作白板。你可以先在白板上自由组织内容，再把它录制成视频。",
    points: [
      "适合做知识讲解、产品演示、课程草稿和短视频脚本。",
      "无需在多个软件之间来回切换，绘制、排版、讲解和录制都在同一页完成。",
      "登录后，白板内容会保存到账号中，刷新或下次登录后继续编辑。",
    ],
    icon: "overview",
  },
  {
    badge: "功能 1",
    title: "自由绘制你的想法",
    description:
      "网站基于 Excalidraw，你可以像在纸上一样画框、写字、连线、涂鸦，把想法快速铺开。",
    points: [
      "使用顶部工具栏选择画笔、文本、箭头、形状等工具。",
      "可以把零散想法画成结构图、流程图或讲解草稿。",
      "登录后绘制内容会自动保存，刷新页面也能恢复。",
    ],
    icon: "draw",
  },
  {
    badge: "功能 2",
    title: "用幻灯片组织多页内容",
    description:
      "通过底部幻灯片导航新增页面，每个幻灯片都是一个画框，适合把复杂内容拆成多个讲解步骤。",
    points: [
      "点击底部加号新增幻灯片页面。",
      "在设置中选择画面比例、录制背景、圆角、边距和摄像头样式。",
      "录制或演示时可用左右方向键切换幻灯片。",
    ],
    icon: "slides",
  },
  {
    badge: "功能 3",
    title: "直接录制讲解视频",
    description:
      "你可以把当前白板区域录制成视频，同时录入摄像头画面、麦克风声音和讲解过程。",
    points: [
      "点击录制按钮后，可以拖动和调整录制区域。",
      "开启摄像头和麦克风后，头像、声音和白板内容会同步进入视频。",
      "未付费账号导出视频会带试用版水印，开通后可去除水印。",
    ],
    icon: "record",
  },
  {
    badge: "功能 4",
    title: "用隐形提词器辅助讲解",
    description:
      "提词器只对你可见，不会被录进最终视频，适合准备讲稿、关键词和每页讲解节奏。",
    points: [
      "点击录制导航栏左侧的提词器按钮打开脚本窗口。",
      "可以设置滚动速度、透明度、字体大小，并按脚本页管理内容。",
      "开启同步后，录制时左右方向键可以同时切换幻灯片和脚本页。",
    ],
    icon: "teleprompter",
  },
];

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
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#07c160] text-white shadow-sm">
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        className="h-6 w-6"
        fill="currentColor"
      >
        <path d="M13.7 6.5C8.4 6.5 4.2 9.8 4.2 14c0 2.3 1.3 4.4 3.4 5.8l-.8 2.6 3-1.5c1.2.4 2.5.6 3.9.6 5.3 0 9.5-3.3 9.5-7.5s-4.2-7.5-9.5-7.5Zm-3.1 6.2a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm6.2 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z" />
        <path d="M23 13.8c-.2 4.8-4.9 8.6-10.9 8.7 1.6 1.8 4.2 3 7.1 3 1.1 0 2.1-.2 3.1-.5l2.4 1.2-.7-2.1c2.3-1.4 3.7-3.5 3.7-5.8 0-2.1-1.2-4-3.2-5.4-.5.3-1 .6-1.5.9Zm-5 4.4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
      </svg>
    </span>
  );
}

function AlipayIcon() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1677ff] text-white shadow-sm">
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 9h16" />
        <path d="M10 14h12" />
        <path d="M16 6v9" />
        <path d="M10 25c4.7-2.2 8.2-6.2 9.3-11" />
        <path d="M7.5 20.5c6.3 4.1 11.7 5.2 17 5.3" />
      </svg>
    </span>
  );
}

function WelcomeSketchIcon({ type }: { type: WelcomePage["icon"] }) {
  if (type === "overview") {
    return (
      <svg aria-hidden="true" viewBox="0 0 96 96" className="h-36 w-36">
        <path
          d="M15 18h48c6 0 10 4 10 10v35c0 6-4 10-10 10H15C9 73 5 69 5 63V28c0-6 4-10 10-10Z"
          className="fill-[#fff7d6] stroke-[#2f2a25] stroke-[2.8]"
        />
        <path
          d="M18 34h24M18 44h34M18 54h20"
          className="fill-none stroke-[#2f2a25] stroke-[2.3] [stroke-linecap:round]"
        />
        <path
          d="M62 38h20c5 0 8 3 8 8v21c0 5-3 8-8 8H62c-5 0-8-3-8-8V46c0-5 3-8 8-8Z"
          className="fill-[#e9e7ff] stroke-[#2f2a25] stroke-[2.6]"
        />
        <path
          d="m78 53 8-5v18l-8-5Z"
          className="fill-[#ff6b6b] stroke-[#2f2a25] stroke-[2.3] [stroke-linejoin:round]"
        />
        <circle
          cx="67"
          cy="57"
          r="7"
          className="fill-[#ff6b6b] stroke-[#2f2a25] stroke-[2.3]"
        />
        <path
          d="M29 77c12 5 27 5 39 0"
          className="fill-none stroke-[#2f2a25] stroke-[2.2] [stroke-linecap:round] [stroke-dasharray:4_6]"
        />
      </svg>
    );
  }

  if (type === "draw") {
    return (
      <svg aria-hidden="true" viewBox="0 0 72 72" className="h-36 w-36">
        <path d="M11 53c12-17 22-23 34-17 6 3 11 3 16-5" className="fill-none stroke-[#2f2a25] stroke-[2.7] [stroke-linecap:round] [stroke-linejoin:round]" />
        <path d="M20 18h29c6 0 9 3 9 8v25c0 5-3 8-9 8H20c-6 0-9-3-9-8V26c0-5 3-8 9-8Z" className="fill-[#fff7d6] stroke-[#2f2a25] stroke-[2.2]" />
        <path d="m43 15 10 10-25 25-12 3 3-12 24-26Z" className="fill-[#ffd166] stroke-[#2f2a25] stroke-[2.4] [stroke-linejoin:round]" />
        <path d="m38 21 10 10M20 41l10 10" className="fill-none stroke-[#2f2a25] stroke-[2.1] [stroke-linecap:round]" />
      </svg>
    );
  }

  if (type === "slides") {
    return (
      <svg aria-hidden="true" viewBox="0 0 72 72" className="h-36 w-36">
        <path d="M12 17h30v19H12zM25 36v14M18 50h28" className="fill-[#e9e7ff] stroke-[#2f2a25] stroke-[2.4] [stroke-linecap:round] [stroke-linejoin:round]" />
        <path d="M45 25h13c3 0 5 2 5 5v20c0 3-2 5-5 5H35c-3 0-5-2-5-5v-7" className="fill-[#fff7d6] stroke-[#2f2a25] stroke-[2.2] [stroke-linejoin:round]" />
        <path d="M47 33v14M40 40h14" className="fill-none stroke-[#6965db] stroke-[3] [stroke-linecap:round]" />
        <path d="M17 24h17M17 30h11" className="fill-none stroke-[#2f2a25] stroke-[2] [stroke-linecap:round]" />
      </svg>
    );
  }

  if (type === "record") {
    return (
      <svg aria-hidden="true" viewBox="0 0 72 72" className="h-36 w-36">
        <path d="M13 19h34c4 0 7 3 7 7v21c0 4-3 7-7 7H13c-4 0-7-3-7-7V26c0-4 3-7 7-7Z" className="fill-[#fff0f0] stroke-[#2f2a25] stroke-[2.3]" />
        <path d="m54 31 12-7v26l-12-7Z" className="fill-[#ff6b6b] stroke-[#2f2a25] stroke-[2.2] [stroke-linejoin:round]" />
        <circle cx="27" cy="36" r="9" className="fill-[#ff6b6b] stroke-[#2f2a25] stroke-[2.3]" />
        <path d="M23 32c3-3 7-3 10 0M22 44c4-4 10-4 14 0" className="fill-none stroke-white stroke-[2.2] [stroke-linecap:round]" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 72 72" className="h-36 w-36">
      <path d="M13 15h46c4 0 7 3 7 7v28c0 4-3 7-7 7H13c-4 0-7-3-7-7V22c0-4 3-7 7-7Z" className="fill-[#e8fff2] stroke-[#2f2a25] stroke-[2.3]" />
      <path d="M18 28h31M18 36h37M18 44h24" className="fill-none stroke-[#2f2a25] stroke-[2.3] [stroke-linecap:round]" />
      <path d="m55 29 5 5-5 5M50 47l-5-5 5-5" className="fill-none stroke-[#1aad19] stroke-[2.8] [stroke-linecap:round] [stroke-linejoin:round]" />
      <path d="M10 61c17-3 35-3 52 0" className="fill-none stroke-[#2f2a25] stroke-[2] [stroke-linecap:round] [stroke-dasharray:4_6]" />
    </svg>
  );
}

function WelcomeModal({
  onClose,
  onLogin,
}: {
  onClose: () => void;
  onLogin: () => void;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const page = WELCOME_PAGES[pageIndex];
  const isFirstPage = pageIndex === 0;
  const isLastPage = pageIndex === WELCOME_PAGES.length - 1;
  const goToPrevious = () =>
    setPageIndex((current) => Math.max(0, current - 1));
  const goToNext = () =>
    setPageIndex((current) => Math.min(WELCOME_PAGES.length - 1, current + 1));

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#171717]/35 p-4 backdrop-blur-[2px]">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-dialog-title"
        className="group relative w-full max-w-[860px] overflow-hidden rounded-[28px] border-2 border-[#2f2a25]/80 bg-[#fffdf7] p-5 text-zinc-900 shadow-[8px_10px_0_rgba(47,42,37,0.18),0_28px_80px_rgba(15,23,42,0.26)] sm:p-7"
      >
        <button
          type="button"
          aria-label="关闭欢迎页"
          onClick={onClose}
          className="absolute top-4 right-4 z-30 flex h-10 w-10 items-center justify-center rounded-xl border border-[#2f2a25]/15 bg-white/90 text-zinc-500 shadow-sm transition hover:bg-zinc-100 hover:text-zinc-900"
        >
          <CloseIcon />
        </button>

        <div className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full border-2 border-dashed border-[#6965db]/35" />
        <div className="pointer-events-none absolute -bottom-14 -left-10 h-36 w-36 rounded-full border-2 border-dashed border-[#ffb703]/45" />

        {!isFirstPage && (
          <button
            type="button"
            aria-label="上一页"
            onClick={goToPrevious}
            className="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#2f2a25]/70 bg-white/80 text-zinc-800 opacity-20 shadow-[3px_4px_0_rgba(47,42,37,0.12)] backdrop-blur transition hover:-translate-x-0.5 hover:bg-white hover:opacity-100 group-hover:opacity-75"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 6-6 6 6 6" />
            </svg>
          </button>
        )}

        {!isLastPage && (
          <button
            type="button"
            aria-label="下一页"
            onClick={goToNext}
            className="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#2f2a25]/70 bg-white/80 text-zinc-800 opacity-20 shadow-[3px_4px_0_rgba(47,42,37,0.12)] backdrop-blur transition hover:translate-x-0.5 hover:bg-white hover:opacity-100 group-hover:opacity-75"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        )}

        <div className="relative">
          <div className="mb-5 flex items-center justify-between gap-4 pr-12">
            <p className="inline-flex rounded-full border border-[#2f2a25]/15 bg-[#fff7d6] px-3 py-1 text-xs font-semibold text-[#6b4f00]">
              {page.badge}
            </p>
            <p className="text-xs font-medium text-zinc-400">
              {pageIndex + 1} / {WELCOME_PAGES.length}
            </p>
          </div>

          <div className="grid h-[430px] items-center gap-8 px-7 md:grid-cols-[0.9fr_1.1fr]">
            <div className="flex justify-center">
              <div className="relative flex h-64 w-full max-w-[280px] rotate-[-1.5deg] items-center justify-center rounded-[30px] border-2 border-[#2f2a25]/75 bg-white shadow-[6px_7px_0_rgba(47,42,37,0.12)]">
                <div className="absolute left-6 top-6 h-3 w-3 rounded-full bg-[#ff6b6b]" />
                <div className="absolute left-12 top-6 h-3 w-3 rounded-full bg-[#ffd166]" />
                <div className="absolute left-[72px] top-6 h-3 w-3 rounded-full bg-[#69db7c]" />
                <WelcomeSketchIcon type={page.icon} />
              </div>
            </div>

            <div>
              <h2
                id="welcome-dialog-title"
                className="text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl"
              >
                {page.title}
              </h2>
              <p className="mt-4 text-sm leading-7 text-zinc-600 sm:text-base">
                {page.description}
              </p>

              <div className="mt-6 space-y-3">
                {page.points.map((point, index) => (
                  <div
                    key={point}
                    className="flex gap-3 rounded-2xl border-2 border-[#2f2a25]/60 bg-white/80 px-4 py-3 shadow-[3px_4px_0_rgba(47,42,37,0.08)]"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#6965db] text-xs font-bold text-white">
                      {index + 1}
                    </span>
                    <p className="text-sm leading-6 text-zinc-700">{point}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-4 border-t border-[#2f2a25]/10 pt-5">
            <div className="flex items-center justify-center">
              <div className="flex items-center justify-center gap-2">
                {WELCOME_PAGES.map((item, index) => (
                  <button
                    key={item.title}
                    type="button"
                    aria-label={`切换到第 ${index + 1} 页`}
                    onClick={() => setPageIndex(index)}
                    className={`h-2.5 rounded-full transition ${
                      index === pageIndex
                        ? "w-7 bg-[#6965db]"
                        : "w-2.5 bg-zinc-300 hover:bg-zinc-400"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-center">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-11 rounded-xl border-2 border-[#2f2a25]/75 bg-white px-5 text-sm font-bold text-zinc-900 shadow-[3px_4px_0_rgba(47,42,37,0.12)] transition hover:-translate-y-0.5"
                >
                  开始创作
                </button>
                <button
                  type="button"
                  onClick={onLogin}
                  className="h-11 rounded-xl border-2 border-[#2f2a25]/75 bg-[#6965db] px-5 text-sm font-bold text-white shadow-[3px_4px_0_rgba(47,42,37,0.18)] transition hover:-translate-y-0.5 hover:bg-[#5b57d1]"
                >
                  登录 / 注册
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
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
  const [showWelcome, setShowWelcome] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("wechat");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [wechatCodeUrl, setWechatCodeUrl] = useState<string | null>(null);
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

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
  }, []);

  const openLoginFromWelcome = useCallback(() => {
    dismissWelcome();
    resetForm("login");
    setOpen(true);
  }, [dismissWelcome, resetForm]);

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
    if (!supabase) {
      const frame = window.requestAnimationFrame(() => setShowWelcome(true));
      return () => window.cancelAnimationFrame(frame);
    }

    void supabase?.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) {
        setShowWelcome(false);
        void refreshEntitlement();
        return;
      }
      setShowWelcome(true);
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
        setShowWelcome(false);
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
    if (!user) return;

    const params = new URLSearchParams(window.location.search);
    const paymentResult = params.get("payment");
    if (!paymentResult) return;

    let attempts = 0;
    let timer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      window.history.replaceState({}, "", window.location.pathname);
      setPaymentOpen(true);
      setPaymentMethod("alipay");

      if (paymentResult !== "success") {
        setPaymentMessage("支付未完成，你可以稍后再试。");
        return;
      }

      setPaymentMessage("支付已提交，正在确认会员权益...");
      timer = window.setInterval(() => {
        attempts += 1;
        void refreshEntitlement().then((isPaid) => {
          if (isPaid) {
            setPaymentMessage("永久会员已开通，感谢支持！");
            if (timer) window.clearInterval(timer);
          } else if (attempts >= 8) {
            setPaymentMessage("支付结果仍在同步，请稍后点击“刷新权益状态”。");
            if (timer) window.clearInterval(timer);
          }
        });
      }, 1500);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (timer) window.clearInterval(timer);
    };
  }, [refreshEntitlement, user]);

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
    setWechatCodeUrl(null);
    setPaymentOpen(true);
  }, [paid, resetForm, user]);

  const openSelectedPayment = useCallback(async () => {
    if (paid) return;

    if (selectedPayment.id === "wechat") {
      if (!supabase) {
        setPaymentMessage("请先配置 Supabase 环境变量。");
        return;
      }

      setPaymentLoading(true);
      setPaymentMessage(null);
      setWechatCodeUrl(null);
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        setPaymentLoading(false);
        setPaymentOpen(false);
        resetForm("login");
        setMessage("登录状态已失效，请重新登录。");
        setOpen(true);
        return;
      }

      try {
        const response = await fetch("/api/billing/wechat/create", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = (await response.json()) as {
          codeUrl?: string;
          paid?: boolean;
          message?: string;
        };

        if (result.paid) {
          updatePaidState(true);
          setPaymentMessage("当前账号已拥有永久使用权益。");
          return;
        }
        if (!response.ok || !result.codeUrl) {
          setPaymentMessage(result.message || "创建微信支付订单失败，请稍后重试。");
          return;
        }
        setWechatCodeUrl(result.codeUrl);
        setPaymentMessage("请使用微信扫描二维码完成 ¥49.90 支付。支付成功后会员会自动开通。");
      } catch {
        setPaymentMessage("无法连接微信支付服务，请稍后重试。");
      } finally {
        setPaymentLoading(false);
      }
      return;
    }

    if (selectedPayment.id === "alipay") {
      if (!supabase) {
        setPaymentMessage("请先配置 Supabase 环境变量。");
        return;
      }

      setPaymentLoading(true);
      setPaymentMessage(null);
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        setPaymentLoading(false);
        setPaymentOpen(false);
        resetForm("login");
        setMessage("登录状态已失效，请重新登录。");
        setOpen(true);
        return;
      }

      try {
        const response = await fetch("/api/billing/alipay/create", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const result = (await response.json()) as {
          url?: string;
          paid?: boolean;
          message?: string;
        };

        if (result.paid) {
          updatePaidState(true);
          setPaymentMessage("当前账号已拥有永久使用权益。");
          return;
        }
        if (!response.ok || !result.url) {
          setPaymentMessage(result.message || "创建支付宝订单失败，请稍后重试。");
          return;
        }
        window.location.assign(result.url);
      } catch {
        setPaymentMessage("无法连接支付宝支付服务，请稍后重试。");
      } finally {
        setPaymentLoading(false);
      }
      return;
    }

    if (selectedPayment.url) {
      window.open(selectedPayment.url, "_blank", "noopener,noreferrer");
      setPaymentMessage(
        `已打开${selectedPayment.name}，支付完成后请点击“刷新权益状态”。`,
      );
      return;
    }

    if (selectedPayment.qrUrl) {
      setPaymentMessage(`请使用${selectedPayment.name}扫码完成 ¥49.90 支付。`);
      return;
    }

    setPaymentMessage(
      `尚未配置${selectedPayment.name}。请在 .env.local 中配置 ${selectedPayment.urlEnv} 或 ${selectedPayment.qrEnv}。`,
    );
  }, [paid, resetForm, selectedPayment, supabase, updatePaidState]);

  useEffect(() => {
    if (!paymentOpen || paymentMethod !== "wechat" || !wechatCodeUrl || paid) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshEntitlement().then((isPaid) => {
        if (isPaid) {
          setWechatCodeUrl(null);
          setPaymentMessage("永久会员已开通，感谢支持！");
        }
      });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [paid, paymentMethod, paymentOpen, refreshEntitlement, wechatCodeUrl]);

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
  const selectedPaymentDescription =
    selectedPayment.id === "wechat"
      ? "点击下方按钮创建微信支付订单，然后使用微信扫码完成付款。"
      : selectedPayment.id === "alipay"
      ? "点击下方按钮进入支付宝官方收银台，支付成功后会员会自动开通。"
      : selectedPayment.url
        ? `点击下方按钮打开${selectedPayment.name}付款链接。`
        : `请配置 ${selectedPayment.urlEnv} 或 ${selectedPayment.qrEnv} 后启用${selectedPayment.name}。`;
  const selectedPaymentButtonLabel = paymentLoading
    ? "正在创建订单..."
    : selectedPayment.id === "wechat"
      ? "微信支付 ¥49.90"
      : selectedPayment.id === "alipay"
      ? "支付宝支付 ¥49.90"
      : selectedPayment.url
        ? `打开${selectedPayment.name}`
        : selectedPayment.qrUrl
          ? "显示付款提示"
          : "付款方式未配置";

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

      {showWelcome && !user && (
        <WelcomeModal onClose={dismissWelcome} onLogin={openLoginFromWelcome} />
      )}

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
                <p className="mt-3 text-xs leading-5 text-zinc-400">
                  有任何问题欢迎发送邮件到 648998480@qq.com
                </p>
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
                          setWechatCodeUrl(null);
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
                  {selectedPayment.id === "wechat" && wechatCodeUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(wechatCodeUrl)}`}
                        alt="微信支付二维码"
                        className="mx-auto h-40 w-40 rounded-xl bg-white object-contain p-2 shadow-sm"
                      />
                      <p className="mt-3 text-sm text-zinc-600">
                        使用微信扫码支付 ¥49.90。
                      </p>
                    </>
                  ) : selectedPayment.qrUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selectedPayment.qrUrl}
                        alt={`${selectedPayment.name}二维码`}
                        className="mx-auto h-36 w-36 rounded-xl bg-white object-contain p-2 shadow-sm"
                      />
                      <p className="mt-3 text-sm text-zinc-600">
                        使用{selectedPayment.name}扫码支付 ¥49.90。
                      </p>
                    </>
                  ) : (
                    <p className="text-sm leading-6 text-zinc-500">
                      {selectedPaymentDescription}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void openSelectedPayment()}
                    disabled={paymentLoading}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#f5b82e] text-sm font-semibold text-[#4b3200] transition hover:bg-[#e9aa1d]"
                  >
                    <MoneyIcon />
                    {selectedPaymentButtonLabel}
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
