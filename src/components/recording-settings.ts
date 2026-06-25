export type SlideRatio = "16:9" | "4:3" | "3:4" | "9:16" | "1:1" | "custom";

export type CameraShape = "circle" | "rounded" | "square";

export type RecordingSettings = {
  slideRatio: SlideRatio;
  customSlideWidth: number;
  customSlideHeight: number;
  background: string;
  backgroundPadding: number;
  recordingRadius: number;
  cameraEnabled: boolean;
  cameraDeviceId: string;
  cameraSize: number;
  cameraShape: CameraShape;
  microphoneDeviceId: string;
  showCursor: boolean;
  cursorColor: string;
};

export type CameraLayout = {
  x: number;
  y: number;
  size: number;
};

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  slideRatio: "16:9",
  customSlideWidth: 1280,
  customSlideHeight: 720,
  background: "midnight",
  backgroundPadding: 28,
  recordingRadius: 18,
  cameraEnabled: false,
  cameraDeviceId: "",
  cameraSize: 160,
  cameraShape: "circle",
  microphoneDeviceId: "",
  showCursor: true,
  cursorColor: "#ef4444",
};

export const BACKGROUND_STYLES = [
  {
    id: "none",
    name: "无背景",
    css: "#ffffff",
    canvas: { type: "solid", colors: ["#ffffff"] },
  },
  {
    id: "midnight",
    name: "深夜",
    css: "linear-gradient(135deg, #14052d 0%, #2d0b59 52%, #0f172a 100%)",
    canvas: { type: "linear", colors: ["#14052d", "#2d0b59", "#0f172a"] },
  },
  {
    id: "aurora",
    name: "极光",
    css: "linear-gradient(135deg, #22d3ee 0%, #a7f3d0 48%, #fef08a 100%)",
    canvas: { type: "linear", colors: ["#22d3ee", "#a7f3d0", "#fef08a"] },
  },
  {
    id: "sunset",
    name: "日落",
    css: "linear-gradient(135deg, #fb7185 0%, #f97316 48%, #fde68a 100%)",
    canvas: { type: "linear", colors: ["#fb7185", "#f97316", "#fde68a"] },
  },
  {
    id: "ocean",
    name: "海洋",
    css: "linear-gradient(135deg, #082f49 0%, #0284c7 55%, #67e8f9 100%)",
    canvas: { type: "linear", colors: ["#082f49", "#0284c7", "#67e8f9"] },
  },
  {
    id: "violet",
    name: "紫霞",
    css: "linear-gradient(135deg, #312e81 0%, #a855f7 50%, #f0abfc 100%)",
    canvas: { type: "linear", colors: ["#312e81", "#a855f7", "#f0abfc"] },
  },
  {
    id: "mint",
    name: "薄荷",
    css: "linear-gradient(135deg, #ecfdf5 0%, #6ee7b7 52%, #0f766e 100%)",
    canvas: { type: "linear", colors: ["#ecfdf5", "#6ee7b7", "#0f766e"] },
  },
  {
    id: "rose",
    name: "玫瑰",
    css: "linear-gradient(135deg, #fff1f2 0%, #fda4af 48%, #be123c 100%)",
    canvas: { type: "linear", colors: ["#fff1f2", "#fda4af", "#be123c"] },
  },
] as const;

export function getSlideDimensions(settings: RecordingSettings) {
  switch (settings.slideRatio) {
    case "4:3":
      return { width: 960, height: 720 };
    case "3:4":
      return { width: 720, height: 960 };
    case "9:16":
      return { width: 720, height: 1280 };
    case "1:1":
      return { width: 720, height: 720 };
    case "custom":
      return {
        width: Math.max(320, settings.customSlideWidth),
        height: Math.max(320, settings.customSlideHeight),
      };
    default:
      return { width: 1280, height: 720 };
  }
}
