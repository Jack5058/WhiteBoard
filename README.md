# Board

基于 Next.js App Router 搭建的白板网站框架，后续用于接入 Excalidraw。

## 技术栈

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- ESLint 9
- Turbopack

## 开始开发

```bash
npm install
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看页面。

## 支付配置

微信支付与支付宝支付通过环境变量配置付款链接或二维码：

```bash
NEXT_PUBLIC_WECHAT_PAY_URL=https://your-wechat-pay-link
NEXT_PUBLIC_WECHAT_PAY_QR_URL=https://your-cdn.com/wechat-pay-qr.png
NEXT_PUBLIC_ALIPAY_PAY_URL=https://your-alipay-pay-link
NEXT_PUBLIC_ALIPAY_PAY_QR_URL=https://your-cdn.com/alipay-pay-qr.png
```

付费状态仍绑定到 Supabase `user_entitlements` 表，登录后读取当前账号的 `lifetime` 状态。

## 常用命令

```bash
npm run dev
npm run lint
npm run build
```

应用代码位于 `src/`，页面路由位于 `src/app/`，静态资源位于 `public/`。
