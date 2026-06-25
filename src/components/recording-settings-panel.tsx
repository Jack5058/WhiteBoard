"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BACKGROUND_STYLES,
  type CameraShape,
  getSlideDimensions,
  type RecordingSettings,
  type SlideRatio,
} from "@/components/recording-settings";

type RecordingSettingsPanelProps = {
  settings: RecordingSettings;
  onChange: (settings: RecordingSettings) => void;
  cameraStream: MediaStream | null;
  microphoneStream: MediaStream | null;
  onCameraStreamChange: (stream: MediaStream | null) => void;
  onMicrophoneStreamChange: (stream: MediaStream | null) => void;
  previewVideoRef: RefObject<HTMLVideoElement | null>;
};

type MediaDeviceOption = { deviceId: string; label: string };

const RATIO_OPTIONS: Array<{ id: SlideRatio; label: string; detail: string }> = [
  { id: "16:9", label: "16:9", detail: "宽屏" },
  { id: "4:3", label: "4:3", detail: "经典" },
  { id: "3:4", label: "3:4", detail: "竖屏" },
  { id: "9:16", label: "9:16", detail: "短视频" },
  { id: "1:1", label: "1:1", detail: "正方形" },
  { id: "custom", label: "自定义", detail: "尺寸" },
];

const CURSOR_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function SettingsToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 ${checked ? "border-zinc-900 bg-zinc-900" : "border-zinc-300 bg-zinc-200"}`}
    >
      <span
        className={`absolute top-1/2 left-0 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export function RecordingSettingsPanel({
  settings,
  onChange,
  cameraStream,
  microphoneStream,
  onCameraStreamChange,
  onMicrophoneStreamChange,
  previewVideoRef,
}: RecordingSettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState<{
    right: number;
    top: number;
    height: number;
  } | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceOption[]>([]);
  const [microphoneDevices, setMicrophoneDevices] = useState<MediaDeviceOption[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [loadingMicrophones, setLoadingMicrophones] = useState(false);
  const modalVideoRef = useRef<HTMLVideoElement>(null);

  const background = useMemo(
    () => BACKGROUND_STYLES.find((item) => item.id === settings.background) ?? BACKGROUND_STYLES[0],
    [settings.background],
  );
  const previewDimensions = useMemo(() => getSlideDimensions(settings), [settings]);
  const previewPadding = Math.max(0, Math.min(36, settings.backgroundPadding * 0.45));
  const previewCameraSize = Math.max(44, Math.min(110, settings.cameraSize * 0.38));
  const previewRadius = settings.recordingRadius * 0.55;
  const previewSize = useMemo(() => {
    const ratio = previewDimensions.width / previewDimensions.height;
    const maxWidth = 292;
    const maxHeight = 250;

    return ratio >= maxWidth / maxHeight
      ? { width: maxWidth, height: maxWidth / ratio }
      : { width: maxHeight * ratio, height: maxHeight };
  }, [previewDimensions]);

  const updateSettings = useCallback(
    (patch: Partial<RecordingSettings>) => onChange({ ...settings, ...patch }),
    [onChange, settings],
  );

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const uniqueDevices = (kind: MediaDeviceKind, fallback: string) =>
      Array.from(
        new Map(
          devices
            .filter((device) => device.kind === kind)
            .map((device, index) => [
              device.deviceId,
              {
                deviceId: device.deviceId,
                label: device.label || `${fallback} ${index + 1}`,
              },
            ]),
        ).values(),
      );

    setCameraDevices(uniqueDevices("videoinput", "摄像头"));
    setMicrophoneDevices(uniqueDevices("audioinput", "麦克风"));
  }, []);

  const loadMicrophoneDevices = useCallback(async () => {
    setMediaError(null);
    setLoadingMicrophones(true);

    try {
      if (!microphoneStream?.getAudioTracks().some((track) => track.readyState === "live")) {
        const permissionStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        permissionStream.getTracks().forEach((track) => track.stop());
      }
      await refreshDevices();
    } catch {
      setMediaError("无法加载麦克风设备，请允许浏览器使用麦克风。");
    } finally {
      setLoadingMicrophones(false);
    }
  }, [microphoneStream, refreshDevices]);

  const enableCamera = useCallback(
    async (deviceId = settings.cameraDeviceId) => {
      setMediaError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { ideal: deviceId } } : true,
          audio: false,
        });
        stopStream(cameraStream);
        onCameraStreamChange(stream);
        const trackDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId;
        updateSettings({ cameraEnabled: true, cameraDeviceId: trackDeviceId });
        await refreshDevices();
      } catch {
        updateSettings({ cameraEnabled: false });
        setMediaError("无法打开摄像头，请检查浏览器权限。");
      }
    }, [cameraStream, onCameraStreamChange, refreshDevices, settings.cameraDeviceId, updateSettings],
  );

  const setMicrophone = useCallback(
    async (deviceId: string) => {
      setMediaError(null);
      if (!deviceId) {
        stopStream(microphoneStream);
        onMicrophoneStreamChange(null);
        updateSettings({ microphoneDeviceId: "" });
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { ideal: deviceId } },
          video: false,
        });
        stopStream(microphoneStream);
        onMicrophoneStreamChange(stream);
        const trackDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? deviceId;
        updateSettings({ microphoneDeviceId: trackDeviceId });
        await refreshDevices();
      } catch {
        setMediaError("无法打开麦克风，请检查浏览器权限。");
      }
    }, [microphoneStream, onMicrophoneStreamChange, refreshDevices, updateSettings],
  );

  useEffect(() => {
    let observedToolbar: HTMLElement | null = null;
    const resizeObserver = new ResizeObserver(updatePosition);

    function updatePosition() {
      const toolbar = document.querySelector<HTMLElement>(".excalidraw .App-toolbar-container");
      if (!toolbar) {
        setToolbarPosition(null);
        return;
      }
      if (toolbar !== observedToolbar) {
        if (observedToolbar) resizeObserver.unobserve(observedToolbar);
        observedToolbar = toolbar;
        resizeObserver.observe(toolbar);
      }
      const bounds = toolbar.getBoundingClientRect();
      setToolbarPosition({ right: window.innerWidth - bounds.left + 8, top: bounds.top, height: bounds.height });
    }

    const frame = requestAnimationFrame(updatePosition);
    const observer = new MutationObserver(updatePosition);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", updatePosition);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
    };
  }, []);

  useEffect(() => {
    if (modalVideoRef.current) modalVideoRef.current.srcObject = cameraStream;
    if (previewVideoRef.current) previewVideoRef.current.srcObject = cameraStream;
  }, [cameraStream, open, previewVideoRef]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;

    const handleDeviceChange = () => {
      void refreshDevices();
    };
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refreshDevices]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void refreshDevices();
        }}
        style={toolbarPosition ? { right: toolbarPosition.right, top: toolbarPosition.top, height: toolbarPosition.height } : undefined}
        className={`absolute z-20 flex h-10 items-center gap-2 rounded-xl border border-zinc-200 bg-white/95 px-3 text-sm font-medium text-zinc-700 shadow-sm backdrop-blur transition hover:bg-zinc-50 ${toolbarPosition ? "" : "top-4 left-4"}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.37.36.7.66.97.3.27.68.42 1.08.43H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
        </svg>
        设置
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-5 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
          <div className="grid h-[min(850px,calc(100vh-40px))] w-[min(1060px,calc(100vw-40px))] grid-cols-[42%_58%] overflow-hidden rounded-[28px] border border-white/60 bg-[#fbfaf8] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <section className="flex flex-col items-center justify-center border-r border-zinc-200 bg-zinc-50 px-8">
              <p className="mb-4 text-xs font-medium text-zinc-400">预览</p>
              <div className="flex h-[310px] w-[330px] max-w-full items-center justify-center">
                <div
                  className="relative flex items-center justify-center overflow-hidden shadow-xl transition-[width,height,padding,border-radius] duration-300 ease-out"
                  style={{
                    background: background.css,
                    padding: previewPadding,
                    borderRadius: previewRadius,
                    width: previewSize.width + previewPadding * 2,
                    height: previewSize.height + previewPadding * 2,
                  }}
                >
                  <div
                    className="relative shrink-0 overflow-hidden bg-white shadow-lg transition-[width,height,border-radius] duration-300 ease-out"
                    style={{
                      borderRadius: previewRadius,
                      width: previewSize.width,
                      height: previewSize.height,
                    }}
                  >
                  <div className="absolute inset-x-[10%] top-[34%] space-y-2">
                    <div className="h-2 w-3/4 rounded bg-zinc-200" />
                    <div className="h-2 w-1/2 rounded bg-zinc-200" />
                    <div className="h-2 w-2/3 rounded bg-zinc-200" />
                  </div>
                   {settings.cameraEnabled && cameraStream && (
                     <video
                      ref={modalVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className={`absolute right-3 bottom-3 aspect-square scale-[1.015] object-cover shadow-[0_8px_24px_rgba(0,0,0,0.22)] [backface-visibility:hidden] ${settings.cameraShape === "circle" ? "rounded-full [clip-path:circle(49.5%)]" : settings.cameraShape === "rounded" ? "rounded-xl" : "rounded-md"}`}
                      style={{ width: previewCameraSize }}
                     />
                   )}
                   {settings.showCursor && (
                     <span
                       className="pointer-events-none absolute top-[48%] left-[62%] h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200"
                       style={{ backgroundColor: `${settings.cursorColor}3d` }}
                     >
                       <span
                         className="absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
                         style={{ backgroundColor: settings.cursorColor }}
                       >
                         <span className="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
                       </span>
                     </span>
                   )}
                   </div>
                </div>
              </div>
              <p className="mt-5 max-w-sm text-center text-xs leading-5 text-zinc-400">设置会应用到后续新增的幻灯片和导出视频。</p>
            </section>

            <section className="overflow-y-auto px-8 py-7">
              <div className="mb-6 flex items-center justify-between border-b border-zinc-200 pb-5">
                <h2 className="text-2xl font-semibold text-zinc-900">录制设置</h2>
                <button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 text-xl text-zinc-500 transition hover:bg-zinc-200">×</button>
              </div>

              <div className="space-y-7">
                <div>
                  <p className="mb-3 text-sm font-medium text-zinc-600">新增幻灯片比例</p>
                  <div className="grid grid-cols-3 gap-2">
                    {RATIO_OPTIONS.map((option) => (
                      <button key={option.id} type="button" onClick={() => updateSettings({ slideRatio: option.id })} className={`rounded-xl border px-3 py-3 text-center transition ${settings.slideRatio === option.id ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300"}`}>
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className={`mt-0.5 block text-[11px] ${settings.slideRatio === option.id ? "text-zinc-300" : "text-zinc-400"}`}>{option.detail}</span>
                      </button>
                    ))}
                  </div>
                  {settings.slideRatio === "custom" && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="text-xs text-zinc-500">宽度<input type="number" min={320} value={settings.customSlideWidth} onChange={(event) => updateSettings({ customSlideWidth: Number(event.target.value) || 320 })} className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-zinc-400" /></label>
                      <label className="text-xs text-zinc-500">高度<input type="number" min={320} value={settings.customSlideHeight} onChange={(event) => updateSettings({ customSlideHeight: Number(event.target.value) || 320 })} className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-zinc-400" /></label>
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-3 text-sm font-medium text-zinc-600">视频背景</p>
                  <div className="grid grid-cols-4 gap-3">
                    {BACKGROUND_STYLES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => updateSettings({ background: item.id })}
                        className={`group relative overflow-hidden rounded-xl border-2 bg-white p-1.5 text-left transition ${settings.background === item.id ? "border-zinc-900 ring-2 ring-zinc-900/10" : "border-zinc-200 hover:border-zinc-400"}`}
                      >
                        <span className="relative block aspect-[4/3] rounded-lg" style={{ background: item.css }}>
                          {settings.background === item.id && (
                            <span className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-xs text-white shadow">✓</span>
                          )}
                        </span>
                        <span className="mt-1.5 block truncate px-0.5 text-xs font-medium text-zinc-600">{item.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <label className="text-sm text-zinc-600">录屏圆角：{settings.recordingRadius}px<input type="range" min="0" max="64" value={settings.recordingRadius} onChange={(event) => updateSettings({ recordingRadius: Number(event.target.value) })} className="mt-3 w-full accent-zinc-900" /></label>
                  <label className="text-sm text-zinc-600">背景边距：{settings.backgroundPadding}px<input type="range" min="0" max="96" value={settings.backgroundPadding} onChange={(event) => updateSettings({ backgroundPadding: Number(event.target.value) })} className="mt-3 w-full accent-zinc-900" /></label>
                </div>

                <div className="border-t border-zinc-200 pt-6">
                  <div className="flex items-center justify-between"><div><p className="text-sm font-medium text-zinc-800">摄像头</p><p className="mt-1 text-xs text-zinc-400">开启后可在白板中拖动摄像头画面</p></div><SettingsToggle label="摄像头" checked={settings.cameraEnabled} onChange={(checked) => { if (checked) void enableCamera(); else { stopStream(cameraStream); onCameraStreamChange(null); updateSettings({ cameraEnabled: false }); } }} /></div>
                  {settings.cameraEnabled && (
                    <div className="mt-4 space-y-4 rounded-xl bg-zinc-100/70 p-4">
                      <select value={settings.cameraDeviceId} onChange={(event) => void enableCamera(event.target.value)} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 outline-none"><option value="">默认摄像头</option>{cameraDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select>
                      <label className="block text-sm text-zinc-600">大小：{settings.cameraSize}px<input type="range" min="96" max="320" value={settings.cameraSize} onChange={(event) => updateSettings({ cameraSize: Number(event.target.value) })} className="mt-2 w-full accent-zinc-900" /></label>
                      <div className="grid grid-cols-3 gap-2">{([ ["circle", "圆形"], ["rounded", "圆角"], ["square", "方形"] ] as Array<[CameraShape, string]>).map(([shape, label]) => <button key={shape} type="button" onClick={() => updateSettings({ cameraShape: shape })} className={`rounded-lg border px-3 py-2 text-sm ${settings.cameraShape === shape ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600"}`}>{label}</button>)}</div>
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-800">麦克风</p>
                      <p className="mt-1 text-xs text-zinc-400">首次加载需要允许浏览器使用麦克风</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadMicrophoneDevices()}
                      disabled={loadingMicrophones}
                      className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60"
                    >
                      {loadingMicrophones ? "加载中..." : "加载设备"}
                    </button>
                  </div>
                  <select
                    value={settings.microphoneDeviceId}
                    onChange={(event) => void setMicrophone(event.target.value)}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-700 outline-none focus:border-zinc-400"
                  >
                    <option value="">不录制麦克风</option>
                    {microphoneDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                    ))}
                  </select>
                </div>

                <div className="border-t border-zinc-200 pt-6">
                  <div className="flex items-center justify-between">
                    <div><p className="text-sm font-medium text-zinc-800">显示鼠标光标</p><p className="mt-1 text-xs text-zinc-400">开始录制后自动显示圆形光标</p></div>
                    <SettingsToggle label="显示鼠标光标" checked={settings.showCursor} onChange={(checked) => updateSettings({ showCursor: checked })} />
                  </div>
                  {settings.showCursor && (
                    <div className="mt-4 rounded-xl bg-zinc-100/70 p-4">
                      <p className="mb-3 text-xs font-medium text-zinc-500">光标圆圈颜色</p>
                      <div className="flex flex-wrap gap-3">
                        {CURSOR_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            aria-label={`选择光标颜色 ${color}`}
                            onClick={() => updateSettings({ cursorColor: color })}
                            className={`flex h-8 w-8 items-center justify-center rounded-full transition hover:scale-110 ${settings.cursorColor === color ? "ring-2 ring-zinc-900 ring-offset-2" : ""}`}
                            style={{ backgroundColor: color }}
                          >
                            {settings.cursorColor === color && <span className="text-sm font-bold text-white">✓</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {mediaError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{mediaError}</p>}
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
