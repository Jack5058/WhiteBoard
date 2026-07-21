"use client";

import type { ExcalidrawFrameElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BACKGROUND_STYLES,
  type CameraLayout,
  type RecordingSettings,
} from "@/components/recording-settings";
import { getSupabaseClient } from "@/lib/supabase";

export type RecorderSlide = Pick<
  ExcalidrawFrameElement,
  "id" | "name" | "x" | "y" | "width" | "height"
>;

type RecorderStatus =
  | "idle"
  | "ready"
  | "recording"
  | "paused"
  | "processing";

type SlideRecorderProps = {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  slides: RecorderSlide[];
  activeSlideId: string | null;
  onSelectSlide: (slide: RecorderSlide) => void;
  settings: RecordingSettings;
  cameraStream: MediaStream | null;
  microphoneStream: MediaStream | null;
  cameraVideoRef: RefObject<HTMLVideoElement | null>;
  cameraLayout: CameraLayout;
  showWatermark: boolean;
};

type RecordingRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type RecordingContentRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PointerPosition = { x: number; y: number; visible: boolean };

type SvgTrailSnapshot = {
  pathData: string;
  fill: string;
  fillRule: CanvasFillRule;
  opacity: number;
};

type ResizeHandle = "nw" | "ne" | "sw" | "se";

type DragOperation = {
  type: "move" | "resize";
  handle?: ResizeHandle;
  startX: number;
  startY: number;
  initialRegion: RecordingRegion;
};

type TeleprompterSize = {
  width: number;
  height: number;
};

type TeleprompterPosition = {
  x: number;
  y: number;
};

type TeleprompterResizeOperation = {
  direction: "x" | "y" | "xy";
  startX: number;
  startY: number;
  initialSize: TeleprompterSize;
};

type TeleprompterDragOperation = {
  startX: number;
  startY: number;
  initialPosition: TeleprompterPosition;
};

type PersistedTeleprompterState = {
  scripts: string[];
  activeScriptIndex: number;
};

type PendingTeleprompterSave = {
  userId: string;
  state: PersistedTeleprompterState;
  serializedState: string;
};

const RENDER_INTERVAL = 1000 / 30;
const VIDEO_BIT_RATE = 8_000_000;
const MIN_REGION_WIDTH = 200;
const MIN_REGION_HEIGHT = 112;
const REGION_MARGIN = 24;
const MAX_VIDEO_WIDTH = 1920;
const MAX_VIDEO_HEIGHT = 1080;
const MIN_TELEPROMPTER_WIDTH = 360;
const MIN_TELEPROMPTER_HEIGHT = 260;
const TELEPROMPTER_VISIBLE_SCRIPT_COUNT = 10;
const MIN_TELEPROMPTER_SPEED = 1;
const MAX_TELEPROMPTER_SPEED = 120;
const MIN_TELEPROMPTER_FONT_SIZE = 16;
const MAX_TELEPROMPTER_FONT_SIZE = 36;
const TELEPROMPTER_SAVE_DELAY_MS = 900;
const DEFAULT_TELEPROMPTER_SIZE = {
  width: 540,
  height: 460,
};

const MP4_MIME_TYPES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1",
  "video/mp4",
];

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeTeleprompterScripts(scripts: unknown) {
  if (!Array.isArray(scripts)) {
    return [""];
  }

  const normalized = scripts.map((script) =>
    typeof script === "string" ? script : "",
  );

  return normalized.length > 0 ? normalized : [""];
}

function createTeleprompterState(
  scripts: string[],
  activeScriptIndex: number,
): PersistedTeleprompterState {
  const normalizedScripts = normalizeTeleprompterScripts(scripts);

  return {
    scripts: normalizedScripts,
    activeScriptIndex: clampValue(
      Math.round(Number.isFinite(activeScriptIndex) ? activeScriptIndex : 0),
      0,
      normalizedScripts.length - 1,
    ),
  };
}

function makeEven(value: number) {
  const rounded = Math.max(2, Math.round(value));

  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function getVideoSize(region: RecordingRegion, settings: RecordingSettings) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const sourceWidth = (region.width + settings.backgroundPadding * 2) * pixelRatio;
  const sourceHeight = (region.height + settings.backgroundPadding * 2) * pixelRatio;
  const scale = Math.min(
    1,
    MAX_VIDEO_WIDTH / sourceWidth,
    MAX_VIDEO_HEIGHT / sourceHeight,
  );

  return {
    width: makeEven(sourceWidth * scale),
    height: makeEven(sourceHeight * scale),
  };
}

function getContentRect(
  targetCanvas: HTMLCanvasElement,
  region: RecordingRegion,
  settings: RecordingSettings,
): RecordingContentRect {
  const totalWidth = region.width + settings.backgroundPadding * 2;
  const totalHeight = region.height + settings.backgroundPadding * 2;
  const scaleX = targetCanvas.width / totalWidth;
  const scaleY = targetCanvas.height / totalHeight;

  return {
    x: settings.backgroundPadding * scaleX,
    y: settings.backgroundPadding * scaleY,
    width: region.width * scaleX,
    height: region.height * scaleY,
  };
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  rect: RecordingContentRect,
  radius: number,
) {
  const safeRadius = Math.min(radius, rect.width / 2, rect.height / 2);
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.width, rect.height, safeRadius);
}

function fillVideoBackground(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  backgroundId: string,
) {
  const background = BACKGROUND_STYLES.find((item) => item.id === backgroundId) ?? BACKGROUND_STYLES[0];
  const colors = background.canvas.colors;

  if (background.canvas.type === "solid" || colors.length === 1) {
    context.fillStyle = colors[0];
  } else {
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    colors.forEach((color, index) => {
      gradient.addColorStop(index / (colors.length - 1), color);
    });
    context.fillStyle = gradient;
  }
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function getBoardBounds() {
  return document
    .querySelector<HTMLElement>(".excalidraw")
    ?.getBoundingClientRect() ?? null;
}

function drawInteractiveLayer(
  context: CanvasRenderingContext2D,
  region: RecordingRegion,
  boardBounds: DOMRect,
  destination: RecordingContentRect,
) {
  const interactiveCanvas = document.querySelector<HTMLCanvasElement>(
    ".excalidraw .excalidraw__canvas.interactive",
  );

  if (!interactiveCanvas) {
    return;
  }

  const canvasBounds = interactiveCanvas.getBoundingClientRect();

  if (!canvasBounds.width || !canvasBounds.height) {
    return;
  }

  const regionLeft = boardBounds.left + region.x;
  const regionTop = boardBounds.top + region.y;
  const regionRight = regionLeft + region.width;
  const regionBottom = regionTop + region.height;
  const visibleLeft = Math.max(regionLeft, canvasBounds.left);
  const visibleTop = Math.max(regionTop, canvasBounds.top);
  const visibleRight = Math.min(regionRight, canvasBounds.right);
  const visibleBottom = Math.min(regionBottom, canvasBounds.bottom);

  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
    return;
  }

  const sourceScaleX = interactiveCanvas.width / canvasBounds.width;
  const sourceScaleY = interactiveCanvas.height / canvasBounds.height;
  const destinationScaleX = destination.width / region.width;
  const destinationScaleY = destination.height / region.height;

  context.drawImage(
    interactiveCanvas,
    (visibleLeft - canvasBounds.left) * sourceScaleX,
    (visibleTop - canvasBounds.top) * sourceScaleY,
    (visibleRight - visibleLeft) * sourceScaleX,
    (visibleBottom - visibleTop) * sourceScaleY,
    destination.x + (visibleLeft - regionLeft) * destinationScaleX,
    destination.y + (visibleTop - regionTop) * destinationScaleY,
    (visibleRight - visibleLeft) * destinationScaleX,
    (visibleBottom - visibleTop) * destinationScaleY,
  );
}

function captureSvgTrails(): SvgTrailSnapshot[] {
  return Array.from(
    document.querySelectorAll<SVGPathElement>(".excalidraw .SVGLayer svg path"),
  ).flatMap((path) => {
    const pathData = path.getAttribute("d")?.trim();

    if (!pathData) {
      return [];
    }

    const computedStyle = window.getComputedStyle(path);
    const opacity =
      Number.parseFloat(computedStyle.opacity || "1") *
      Number.parseFloat(computedStyle.fillOpacity || "1");

    return [
      {
        pathData,
        fill: path.getAttribute("fill") || computedStyle.fill || "#fa5252",
        fillRule:
          path.getAttribute("fill-rule") === "evenodd" ? "evenodd" : "nonzero",
        opacity: Number.isFinite(opacity) ? opacity : 1,
      },
    ];
  });
}

function drawSvgTrails(
  context: CanvasRenderingContext2D,
  region: RecordingRegion,
  boardBounds: DOMRect,
  destination: RecordingContentRect,
  trails: SvgTrailSnapshot[],
) {
  if (trails.length === 0) {
    return;
  }

  const scaleX = destination.width / region.width;
  const scaleY = destination.height / region.height;
  const regionLeft = boardBounds.left + region.x;
  const regionTop = boardBounds.top + region.y;

  context.save();
  context.beginPath();
  context.rect(destination.x, destination.y, destination.width, destination.height);
  context.clip();
  context.setTransform(
    scaleX,
    0,
    0,
    scaleY,
    destination.x - regionLeft * scaleX,
    destination.y - regionTop * scaleY,
  );

  for (const trail of trails) {
    context.globalAlpha = trail.opacity;
    context.fillStyle = trail.fill;
    context.fill(new Path2D(trail.pathData), trail.fillRule);
  }

  context.restore();
}

function drawCamera(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  region: RecordingRegion,
  destination: RecordingContentRect,
  layout: CameraLayout,
  settings: RecordingSettings,
) {
  if (!settings.cameraEnabled || !video || video.readyState < 2) return;

  const scaleX = destination.width / region.width;
  const scaleY = destination.height / region.height;
  const x = destination.x + (layout.x - region.x) * scaleX;
  const y = destination.y + (layout.y - region.y) * scaleY;
  const width = layout.size * scaleX;
  const height = layout.size * scaleY;
  const radius =
    settings.cameraShape === "circle"
      ? Math.min(width, height) / 2
      : settings.cameraShape === "rounded"
        ? Math.min(width, height) * 0.14
        : 0;

  context.save();
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.clip();
  context.translate(x + width, y);
  context.scale(-1, 1);
  context.drawImage(video, 0, 0, width, height);
  context.restore();
}

function drawCursor(
  context: CanvasRenderingContext2D,
  pointer: PointerPosition,
  region: RecordingRegion,
  destination: RecordingContentRect,
  color: string,
) {
  if (
    !pointer.visible ||
    pointer.x < region.x ||
    pointer.y < region.y ||
    pointer.x > region.x + region.width ||
    pointer.y > region.y + region.height
  ) {
    return;
  }

  const scaleX = destination.width / region.width;
  const scaleY = destination.height / region.height;
  const x = destination.x + (pointer.x - region.x) * scaleX;
  const y = destination.y + (pointer.y - region.y) * scaleY;
  const radius = Math.max(8, Math.min(destination.width, destination.height) * 0.015);

  context.save();
  context.beginPath();
  context.arc(x, y, radius * 1.8, 0, Math.PI * 2);
  context.globalAlpha = 0.24;
  context.fillStyle = color;
  context.fill();

  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.globalAlpha = 0.95;
  context.fillStyle = color;
  context.fill();

  context.beginPath();
  context.arc(x, y, radius * 0.42, 0, Math.PI * 2);
  context.globalAlpha = 0.9;
  context.fillStyle = "#ffffff";
  context.fill();
  context.restore();
}

function drawWatermark(
  context: CanvasRenderingContext2D,
  destination: RecordingContentRect,
) {
  const text = "WhiteBoard试用版";
  const fontSize = Math.max(16, Math.min(32, destination.width * 0.025));
  const horizontalPadding = fontSize * 0.7;
  const verticalPadding = fontSize * 0.42;
  const margin = Math.max(12, fontSize * 0.75);

  context.save();
  context.font = `600 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
  context.textBaseline = "middle";
  const textWidth = context.measureText(text).width;
  const width = textWidth + horizontalPadding * 2;
  const height = fontSize + verticalPadding * 2;
  const x = destination.x + destination.width - width - margin;
  const y = destination.y + destination.height - height - margin;

  context.fillStyle = "rgba(17, 24, 39, 0.52)";
  context.beginPath();
  context.roundRect(x, y, width, height, height / 2);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  context.fillText(text, x + horizontalPadding, y + height / 2);
  context.restore();
}

function drawRecordingFrame(
  targetCanvas: HTMLCanvasElement,
  sceneCanvas: HTMLCanvasElement,
  region: RecordingRegion,
  boardBounds: DOMRect,
  backgroundColor: string,
  settings: RecordingSettings,
  cameraVideo: HTMLVideoElement | null,
  cameraLayout: CameraLayout,
  pointer: PointerPosition,
  showWatermark: boolean,
  trails = captureSvgTrails(),
) {
  const context = targetCanvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create the recording canvas.");
  }

  context.globalAlpha = 1;
  context.setTransform(1, 0, 0, 1, 0, 0);
  fillVideoBackground(context, targetCanvas, settings.background);
  const destination = getContentRect(targetCanvas, region, settings);

  context.save();
  roundedRectPath(context, destination, settings.recordingRadius * (destination.width / region.width));
  context.clip();
  context.fillStyle = backgroundColor;
  context.fillRect(destination.x, destination.y, destination.width, destination.height);
  context.drawImage(
    sceneCanvas,
    destination.x,
    destination.y,
    destination.width,
    destination.height,
  );
  drawInteractiveLayer(context, region, boardBounds, destination);
  drawSvgTrails(context, region, boardBounds, destination, trails);
  drawCamera(context, cameraVideo, region, destination, cameraLayout, settings);
  if (settings.showCursor) {
    drawCursor(context, pointer, region, destination, settings.cursorColor);
  }
  context.restore();
  if (showWatermark) {
    drawWatermark(context, destination);
  }
}

function getDefaultRegion(): RecordingRegion {
  const bounds = getBoardBounds();
  const viewportWidth = bounds?.width ?? window.innerWidth;
  const viewportHeight = bounds?.height ?? window.innerHeight;
  const width = Math.max(
    MIN_REGION_WIDTH,
    Math.min(viewportWidth - REGION_MARGIN * 2, 960),
  );
  const height = Math.max(
    MIN_REGION_HEIGHT,
    Math.min(viewportHeight - REGION_MARGIN * 2, width * (9 / 16)),
  );

  return {
    x: Math.max(REGION_MARGIN, (viewportWidth - width) / 2),
    y: Math.max(REGION_MARGIN, (viewportHeight - height) / 2),
    width,
    height,
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SlideRecorder({
  excalidrawAPI,
  slides,
  activeSlideId,
  onSelectSlide,
  settings,
  cameraStream,
  microphoneStream,
  cameraVideoRef,
  cameraLayout,
  showWatermark,
}: SlideRecorderProps) {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState<RecordingRegion | null>(null);
  const [teleprompterPersistenceUserId, setTeleprompterPersistenceUserId] =
    useState<string | null>(null);
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);
  const [teleprompterPlaying, setTeleprompterPlaying] = useState(false);
  const [teleprompterSpeed, setTeleprompterSpeed] = useState(12);
  const [teleprompterOpacity, setTeleprompterOpacity] = useState(0);
  const [teleprompterFontSize, setTeleprompterFontSize] = useState(22);
  const [teleprompterScripts, setTeleprompterScripts] = useState([""]);
  const [activeTeleprompterScriptIndex, setActiveTeleprompterScriptIndex] =
    useState(0);
  const [teleprompterScriptStartIndex, setTeleprompterScriptStartIndex] =
    useState(0);
  const [teleprompterKeyboardEnabled, setTeleprompterKeyboardEnabled] =
    useState(false);
  const [teleprompterSize, setTeleprompterSize] = useState<TeleprompterSize>(
    DEFAULT_TELEPROMPTER_SIZE,
  );
  const [teleprompterPosition, setTeleprompterPosition] =
    useState<TeleprompterPosition | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{
    left: number;
    top: number;
    height: number;
  } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const teleprompterButtonRef = useRef<HTMLButtonElement>(null);
  const teleprompterTextRef = useRef<HTMLTextAreaElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const teleprompterScrollRemainderRef = useRef(0);
  const teleprompterScriptsRef = useRef(teleprompterScripts);
  const activeTeleprompterScriptIndexRef = useRef(activeTeleprompterScriptIndex);
  const teleprompterPersistenceUserIdRef = useRef<string | null>(null);
  const teleprompterLoadedUserIdRef = useRef<string | null>(null);
  const teleprompterSaveTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTeleprompterSaveRef = useRef<PendingTeleprompterSave | null>(
    null,
  );
  const isRestoringTeleprompterRef = useRef(false);
  const lastSavedTeleprompterStateRef = useRef("");
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderInProgressRef = useRef(false);
  const statusRef = useRef<RecorderStatus>(status);
  const activeSlideIdRef = useRef(activeSlideId);
  const regionRef = useRef<RecordingRegion | null>(region);
  const settingsRef = useRef(settings);
  const cameraLayoutRef = useRef(cameraLayout);
  const showWatermarkRef = useRef(showWatermark);
  const pointerRef = useRef<PointerPosition>({ x: 0, y: 0, visible: false });
  const dragOperationRef = useRef<DragOperation | null>(null);
  const teleprompterResizeRef =
    useRef<TeleprompterResizeOperation | null>(null);
  const teleprompterDragRef =
    useRef<TeleprompterDragOperation | null>(null);
  const effectiveTeleprompterSpeed = teleprompterSpeed;
  const teleprompterVisualOpacity = Math.max(0.15, 1 - teleprompterOpacity / 100);
  const activeTeleprompterScript =
    teleprompterScripts[activeTeleprompterScriptIndex] ?? "";
  const maxTeleprompterScriptStartIndex = Math.max(
    0,
    teleprompterScripts.length - TELEPROMPTER_VISIBLE_SCRIPT_COUNT,
  );
  const visibleTeleprompterScriptStartIndex = Math.min(
    teleprompterScriptStartIndex,
    maxTeleprompterScriptStartIndex,
  );
  const visibleTeleprompterScripts = teleprompterScripts.slice(
    visibleTeleprompterScriptStartIndex,
    visibleTeleprompterScriptStartIndex + TELEPROMPTER_VISIBLE_SCRIPT_COUNT,
  );

  useEffect(() => {
    teleprompterScriptsRef.current = teleprompterScripts;
  }, [teleprompterScripts]);

  useEffect(() => {
    activeTeleprompterScriptIndexRef.current = activeTeleprompterScriptIndex;
  }, [activeTeleprompterScriptIndex]);

  useEffect(() => {
    teleprompterPersistenceUserIdRef.current = teleprompterPersistenceUserId;
  }, [teleprompterPersistenceUserId]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let isMounted = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (isMounted) {
        setTeleprompterPersistenceUserId(data.user?.id ?? null);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;

      if (nextUserId !== teleprompterPersistenceUserIdRef.current) {
        teleprompterLoadedUserIdRef.current = null;
        lastSavedTeleprompterStateRef.current = "";
        pendingTeleprompterSaveRef.current = null;
      }

      setTeleprompterPersistenceUserId(nextUserId);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || showWatermark || !teleprompterPersistenceUserId) {
      teleprompterLoadedUserIdRef.current = null;
      lastSavedTeleprompterStateRef.current = "";
      pendingTeleprompterSaveRef.current = null;
      return;
    }

    let isCancelled = false;

    const loadTeleprompterState = async () => {
      const { data, error } = await supabase
        .from("teleprompter_states")
        .select("scripts, active_script_index")
        .eq("user_id", teleprompterPersistenceUserId)
        .maybeSingle();

      if (isCancelled) {
        return;
      }

      if (error) {
        console.warn("Failed to load teleprompter state", error);
        teleprompterLoadedUserIdRef.current = teleprompterPersistenceUserId;
        return;
      }

      if (!data) {
        teleprompterLoadedUserIdRef.current = teleprompterPersistenceUserId;
        return;
      }

      const restoredState = createTeleprompterState(
        normalizeTeleprompterScripts(data.scripts),
        typeof data.active_script_index === "number"
          ? data.active_script_index
          : 0,
      );

      isRestoringTeleprompterRef.current = true;
      setTeleprompterScripts(restoredState.scripts);
      setActiveTeleprompterScriptIndex(restoredState.activeScriptIndex);
      setTeleprompterScriptStartIndex(() => {
        if (restoredState.activeScriptIndex >= TELEPROMPTER_VISIBLE_SCRIPT_COUNT) {
          return (
            restoredState.activeScriptIndex -
            TELEPROMPTER_VISIBLE_SCRIPT_COUNT +
            1
          );
        }

        return 0;
      });

      lastSavedTeleprompterStateRef.current = JSON.stringify(restoredState);
      teleprompterLoadedUserIdRef.current = teleprompterPersistenceUserId;

      requestAnimationFrame(() => {
        isRestoringTeleprompterRef.current = false;
      });
    };

    void loadTeleprompterState();

    return () => {
      isCancelled = true;
    };
  }, [showWatermark, supabase, teleprompterPersistenceUserId]);

  const persistTeleprompterState = useCallback(
    async (pendingSave: PendingTeleprompterSave) => {
      if (
        !supabase ||
        showWatermarkRef.current ||
        pendingSave.userId !== teleprompterPersistenceUserIdRef.current
      ) {
        return;
      }

      const { error } = await supabase
        .from("teleprompter_states")
        .upsert(
          {
            user_id: pendingSave.userId,
            scripts: pendingSave.state.scripts,
            active_script_index: pendingSave.state.activeScriptIndex,
          },
          { onConflict: "user_id" },
        );

      if (error) {
        console.warn("Failed to save teleprompter state", error);
        return;
      }

      lastSavedTeleprompterStateRef.current = pendingSave.serializedState;

      if (
        pendingTeleprompterSaveRef.current?.serializedState ===
        pendingSave.serializedState
      ) {
        pendingTeleprompterSaveRef.current = null;
      }
    },
    [supabase],
  );

  useEffect(() => {
    if (
      !supabase ||
      showWatermark ||
      !teleprompterPersistenceUserId ||
      teleprompterLoadedUserIdRef.current !== teleprompterPersistenceUserId ||
      isRestoringTeleprompterRef.current
    ) {
      return;
    }

    const nextState = createTeleprompterState(
      teleprompterScripts,
      activeTeleprompterScriptIndex,
    );
    const serializedState = JSON.stringify(nextState);

    if (serializedState === lastSavedTeleprompterStateRef.current) {
      return;
    }

    pendingTeleprompterSaveRef.current = {
      userId: teleprompterPersistenceUserId,
      state: nextState,
      serializedState,
    };

    if (teleprompterSaveTimerRef.current) {
      clearTimeout(teleprompterSaveTimerRef.current);
    }

    teleprompterSaveTimerRef.current = setTimeout(() => {
      const pendingSave = pendingTeleprompterSaveRef.current;

      if (!pendingSave) {
        return;
      }

      void persistTeleprompterState(pendingSave);
    }, TELEPROMPTER_SAVE_DELAY_MS);
  }, [
    activeTeleprompterScriptIndex,
    persistTeleprompterState,
    showWatermark,
    supabase,
    teleprompterPersistenceUserId,
    teleprompterScripts,
  ]);

  useEffect(() => {
    const flushPendingTeleprompterState = () => {
      const pendingSave = pendingTeleprompterSaveRef.current;

      if (!pendingSave) {
        return;
      }

      if (teleprompterSaveTimerRef.current) {
        clearTimeout(teleprompterSaveTimerRef.current);
        teleprompterSaveTimerRef.current = null;
      }

      void persistTeleprompterState(pendingSave);
    };

    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        flushPendingTeleprompterState();
      }
    };

    window.addEventListener("pagehide", flushPendingTeleprompterState);
    document.addEventListener("visibilitychange", flushWhenHidden);

    return () => {
      window.removeEventListener("pagehide", flushPendingTeleprompterState);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [persistTeleprompterState]);

  useEffect(() => {
    return () => {
      if (teleprompterSaveTimerRef.current) {
        clearTimeout(teleprompterSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    showWatermarkRef.current = showWatermark;
  }, [showWatermark]);

  useEffect(() => {
    activeSlideIdRef.current = activeSlideId;
  }, [activeSlideId]);

  useEffect(() => {
    if (teleprompterTextRef.current) {
      teleprompterTextRef.current.scrollTop = 0;
    }
    teleprompterScrollRemainderRef.current = 0;
  }, [activeTeleprompterScriptIndex]);

  useEffect(() => {
    if (
      !teleprompterOpen ||
      !teleprompterPlaying ||
      effectiveTeleprompterSpeed <= 0
    ) {
      return;
    }

    let animationFrame = 0;
    let previousTime = performance.now();
    const scrollText = (time: number) => {
      const textArea = teleprompterTextRef.current;
      const deltaSeconds = (time - previousTime) / 1000;
      previousTime = time;

      if (textArea) {
        teleprompterScrollRemainderRef.current +=
          effectiveTeleprompterSpeed * deltaSeconds;
        const wholePixels = Math.trunc(teleprompterScrollRemainderRef.current);
        if (wholePixels !== 0) {
          textArea.scrollTop += wholePixels;
          teleprompterScrollRemainderRef.current -= wholePixels;
        }
      }

      animationFrame = requestAnimationFrame(scrollText);
    };

    animationFrame = requestAnimationFrame(scrollText);

    return () => cancelAnimationFrame(animationFrame);
  }, [effectiveTeleprompterSpeed, teleprompterOpen, teleprompterPlaying]);

  const updateActiveTeleprompterScript = useCallback(
    (value: string) => {
      setTeleprompterScripts((current) =>
        current.map((script, index) =>
          index === activeTeleprompterScriptIndex ? value : script,
        ),
      );
    },
    [activeTeleprompterScriptIndex],
  );

  const selectTeleprompterScript = useCallback((index: number) => {
    setActiveTeleprompterScriptIndex(index);
    setTeleprompterScriptStartIndex((current) => {
      if (index < current) {
        return index;
      }
      if (index >= current + TELEPROMPTER_VISIBLE_SCRIPT_COUNT) {
        return index - TELEPROMPTER_VISIBLE_SCRIPT_COUNT + 1;
      }
      return current;
    });
  }, []);

  const selectRelativeTeleprompterScript = useCallback(
    (direction: -1 | 1) => {
      setActiveTeleprompterScriptIndex((current) => {
        const next = Math.min(
          teleprompterScripts.length - 1,
          Math.max(0, current + direction),
        );

        setTeleprompterScriptStartIndex((start) => {
          if (next < start) {
            return next;
          }
          if (next >= start + TELEPROMPTER_VISIBLE_SCRIPT_COUNT) {
            return next - TELEPROMPTER_VISIBLE_SCRIPT_COUNT + 1;
          }
          return start;
        });
        return next;
      });
    },
    [teleprompterScripts.length],
  );

  const handleTeleprompterScriptWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (teleprompterScripts.length <= 1) {
        return;
      }

      event.preventDefault();
      const distance =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;

      if (distance === 0) {
        return;
      }

      selectRelativeTeleprompterScript(distance > 0 ? 1 : -1);
    },
    [selectRelativeTeleprompterScript, teleprompterScripts.length],
  );

  const updateTeleprompterSpeed = useCallback((value: number) => {
    setTeleprompterSpeed(
      clampValue(
        Math.round(Number.isFinite(value) ? value : 0),
        MIN_TELEPROMPTER_SPEED,
        MAX_TELEPROMPTER_SPEED,
      ),
    );
  }, []);

  const updateTeleprompterFontSize = useCallback((value: number) => {
    setTeleprompterFontSize(
      clampValue(
        Math.round(Number.isFinite(value) ? value : MIN_TELEPROMPTER_FONT_SIZE),
        MIN_TELEPROMPTER_FONT_SIZE,
        MAX_TELEPROMPTER_FONT_SIZE,
      ),
    );
  }, []);

  const addTeleprompterScript = useCallback(() => {
    setTeleprompterScripts((current) => {
      setActiveTeleprompterScriptIndex(current.length);
      setTeleprompterScriptStartIndex(
        Math.max(
          0,
          current.length + 1 - TELEPROMPTER_VISIBLE_SCRIPT_COUNT,
        ),
      );
      return [...current, ""];
    });
  }, []);

  const deleteTeleprompterScript = useCallback((targetIndex: number) => {
    setTeleprompterScripts((current) => {
      if (current.length <= 1) {
        setActiveTeleprompterScriptIndex(0);
        return current;
      }

      const next = current.filter((_, index) => index !== targetIndex);
      setActiveTeleprompterScriptIndex((activeIndex) => {
        const nextActiveIndex =
          activeIndex === targetIndex
            ? Math.min(targetIndex, next.length - 1)
            : activeIndex > targetIndex
              ? activeIndex - 1
              : activeIndex;

        setTeleprompterScriptStartIndex((start) => {
          const maxStart = Math.max(
            0,
            next.length - TELEPROMPTER_VISIBLE_SCRIPT_COUNT,
          );
          const clampedStart = Math.min(start, maxStart);

          if (nextActiveIndex < clampedStart) {
            return nextActiveIndex;
          }
          if (
            nextActiveIndex >=
            clampedStart + TELEPROMPTER_VISIBLE_SCRIPT_COUNT
          ) {
            return nextActiveIndex - TELEPROMPTER_VISIBLE_SCRIPT_COUNT + 1;
          }
          return clampedStart;
        });
        return nextActiveIndex;
      });
      return next;
    });
  }, []);

  useEffect(() => {
    regionRef.current = region;
  }, [region]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    cameraLayoutRef.current = cameraLayout;
  }, [cameraLayout]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-teleprompter]")
      ) {
        pointerRef.current.visible = false;
        return;
      }

      const board = document.querySelector<HTMLElement>(".excalidraw");
      if (!board) return;
      const bounds = board.getBoundingClientRect();
      const visible =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;
      pointerRef.current = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        visible,
      };
    };
    const hidePointer = () => {
      pointerRef.current.visible = false;
    };

    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("blur", hidePointer);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("blur", hidePointer);
    };
  }, []);

  useEffect(() => {
    let observedToolbar: HTMLElement | null = null;
    const resizeObserver = new ResizeObserver(() => updatePosition());

    const updatePosition = () => {
      const toolbar = document.querySelector<HTMLElement>(
        ".excalidraw .App-toolbar-container",
      );

      if (!toolbar) {
        setToolbarPosition(null);
        return;
      }

      if (toolbar !== observedToolbar) {
        if (observedToolbar) {
          resizeObserver.unobserve(observedToolbar);
        }
        observedToolbar = toolbar;
        resizeObserver.observe(toolbar);
      }

      const bounds = toolbar.getBoundingClientRect();
      const left = bounds.right + 8;
      const availableWidth = window.innerWidth - left - 16;

      setToolbarPosition(
        availableWidth >= 88
          ? { left, top: bounds.top, height: bounds.height }
          : null,
      );
    };

    const frame = requestAnimationFrame(updatePosition);
    const mutationObserver = new MutationObserver(updatePosition);

    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", updatePosition);

    return () => {
      cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
    };
  }, []);

  useEffect(() => {
    if (status !== "recording") {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [status]);

  const stopRenderLoop = useCallback(() => {
    if (renderTimerRef.current) {
      clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
    }
  }, []);

  const renderRecordingRegion = useCallback(async () => {
    const targetCanvas = canvasRef.current;
    const currentRegion = regionRef.current;
    const boardBounds = getBoardBounds();

    if (!excalidrawAPI || !targetCanvas || !currentRegion || !boardBounds) {
      return;
    }

    // Laser trails live in a short-lived SVG animation layer. Capture them
    // before the asynchronous scene export has a chance to outlive the trail.
    const svgTrails = captureSvgTrails();

    const { convertToExcalidrawElements, exportToCanvas, viewportCoordsToSceneCoords } =
      await import("@excalidraw/excalidraw");
    const appState = excalidrawAPI.getAppState();
    const currentSettings = settingsRef.current;
    const contentRect = getContentRect(targetCanvas, currentRegion, currentSettings);
    const topLeft = viewportCoordsToSceneCoords(
      {
        clientX: boardBounds.left + currentRegion.x,
        clientY: boardBounds.top + currentRegion.y,
      },
      appState,
    );
    const bottomRight = viewportCoordsToSceneCoords(
      {
        clientX: boardBounds.left + currentRegion.x + currentRegion.width,
        clientY: boardBounds.top + currentRegion.y + currentRegion.height,
      },
      appState,
    );
    const [recordingFrame] = convertToExcalidrawElements([
      {
        type: "frame",
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
        name: "Recording area",
        children: [],
      },
    ]);
    const elements = excalidrawAPI.getSceneElements();
    const recordingElements = elements
      .filter(
        (element) => element.type !== "frame" && element.type !== "magicframe",
      )
      .map((element) => ({
        ...element,
        frameId: recordingFrame.id,
      }));
    const exportedCanvas = await exportToCanvas({
      elements: [...recordingElements, recordingFrame],
      appState: {
        ...appState,
        exportBackground: true,
        exportWithDarkMode: false,
      },
      files: excalidrawAPI.getFiles(),
      exportingFrame: recordingFrame,
      exportPadding: 0,
      getDimensions: () => ({
        width: Math.max(2, Math.round(contentRect.width)),
        height: Math.max(2, Math.round(contentRect.height)),
      }),
    });
    const context = targetCanvas.getContext("2d");
    sceneCanvasRef.current = exportedCanvas;

    if (!context) {
      throw new Error("无法创建录制画布，请刷新页面后重试。");
    }

    drawRecordingFrame(
      targetCanvas,
      exportedCanvas,
      currentRegion,
      boardBounds,
      appState.viewBackgroundColor || "#ffffff",
      currentSettings,
      cameraStream ? cameraVideoRef.current : null,
      cameraLayoutRef.current,
      pointerRef.current,
      showWatermarkRef.current,
      svgTrails,
    );
  }, [cameraStream, cameraVideoRef, excalidrawAPI]);

  const startRenderLoop = useCallback(() => {
    stopRenderLoop();

    const render = () => {
      if (statusRef.current !== "recording") {
        return;
      }

      try {
        const targetCanvas = canvasRef.current;
        const sceneCanvas = sceneCanvasRef.current;
        const currentRegion = regionRef.current;
        const boardBounds = getBoardBounds();

        if (
          targetCanvas &&
          sceneCanvas &&
          currentRegion &&
          boardBounds &&
          excalidrawAPI
        ) {
          drawRecordingFrame(
            targetCanvas,
            sceneCanvas,
            currentRegion,
            boardBounds,
            excalidrawAPI.getAppState().viewBackgroundColor || "#ffffff",
            settingsRef.current,
            cameraStream ? cameraVideoRef.current : null,
            cameraLayoutRef.current,
            pointerRef.current,
            showWatermarkRef.current,
          );
        }
      } catch (renderError) {
        setError(
          renderError instanceof Error
            ? renderError.message
            : "录制画面渲染失败。",
        );
      }

      if (!renderInProgressRef.current) {
        renderInProgressRef.current = true;
        void renderRecordingRegion()
          .catch((renderError) => {
            setError(
              renderError instanceof Error
                ? renderError.message
                : "Failed to render the recording frame.",
            );
          })
          .finally(() => {
            renderInProgressRef.current = false;
          });
      }

      renderTimerRef.current = setTimeout(render, RENDER_INTERVAL);
    };

    void render();
  }, [cameraStream, cameraVideoRef, excalidrawAPI, renderRecordingRegion, stopRenderLoop]);

  const selectRelativeSlide = useCallback(
    (direction: -1 | 1) => {
      if (slides.length === 0) {
        return;
      }

      const currentIndex = slides.findIndex(
        (slide) => slide.id === activeSlideIdRef.current,
      );
      const safeIndex = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex = Math.min(
        slides.length - 1,
        Math.max(0, safeIndex + direction),
      );

      if (nextIndex !== safeIndex) {
        onSelectSlide(slides[nextIndex]);
      }
    },
    [onSelectSlide, slides],
  );

  useEffect(() => {
    if (status !== "recording" && status !== "paused") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;

        if (
          teleprompterOpen &&
          teleprompterKeyboardEnabled &&
          teleprompterScripts.length > 1
        ) {
          selectRelativeTeleprompterScript(direction);
        }

        selectRelativeSlide(direction);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    selectRelativeSlide,
    selectRelativeTeleprompterScript,
    status,
    teleprompterKeyboardEnabled,
    teleprompterOpen,
    teleprompterScripts.length,
  ]);

  useEffect(() => {
    return () => {
      stopRenderLoop();
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [stopRenderLoop]);

  const prepareRecording = useCallback(async () => {
    setError(null);
    let nextRegion = getDefaultRegion();
    const boardBounds = getBoardBounds();
    const slideId = activeSlideIdRef.current;

    if (excalidrawAPI && boardBounds && slideId) {
      const frame = excalidrawAPI
        .getSceneElements()
        .find((element) => element.type === "frame" && element.id === slideId);

      if (frame) {
        const { sceneCoordsToViewportCoords } = await import(
          "@excalidraw/excalidraw"
        );
        const appState = excalidrawAPI.getAppState();
        const topLeft = sceneCoordsToViewportCoords(
          { sceneX: frame.x, sceneY: frame.y },
          appState,
        );
        const bottomRight = sceneCoordsToViewportCoords(
          {
            sceneX: frame.x + frame.width,
            sceneY: frame.y + frame.height,
          },
          appState,
        );
        const left = Math.max(0, topLeft.x - boardBounds.left);
        const top = Math.max(0, topLeft.y - boardBounds.top);
        const right = Math.min(
          boardBounds.width,
          bottomRight.x - boardBounds.left,
        );
        const bottom = Math.min(
          boardBounds.height,
          bottomRight.y - boardBounds.top,
        );

        if (
          right - left >= MIN_REGION_WIDTH &&
          bottom - top >= MIN_REGION_HEIGHT
        ) {
          nextRegion = {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
          };
        }
      }
    }

    setRegion(nextRegion);
    regionRef.current = nextRegion;
    setStatus("ready");
  }, [excalidrawAPI]);

  const cancelPreparation = useCallback(() => {
    setError(null);
    setRegion(null);
    regionRef.current = null;
    setStatus("idle");
  }, []);

  const startRegionInteraction = useCallback(
    (
      event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
      type: DragOperation["type"],
      handle?: ResizeHandle,
    ) => {
      if (!region) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragOperationRef.current = {
        type,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        initialRegion: region,
      };
    },
    [region],
  );

  const updateRegionInteraction = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const operation = dragOperationRef.current;
      const bounds = getBoardBounds();

      if (!operation || !bounds) {
        return;
      }

      event.preventDefault();
      const deltaX = event.clientX - operation.startX;
      const deltaY = event.clientY - operation.startY;
      const initial = operation.initialRegion;
      const next = { ...initial };

      if (operation.type === "move") {
        next.x = Math.min(
          bounds.width - initial.width,
          Math.max(0, initial.x + deltaX),
        );
        next.y = Math.min(
          bounds.height - initial.height,
          Math.max(0, initial.y + deltaY),
        );
      } else if (operation.handle) {
        const movesLeft = operation.handle.includes("w");
        const movesTop = operation.handle.includes("n");
        const right = initial.x + initial.width;
        const bottom = initial.y + initial.height;

        if (movesLeft) {
          next.x = Math.min(
            right - MIN_REGION_WIDTH,
            Math.max(0, initial.x + deltaX),
          );
          next.width = right - next.x;
        } else {
          next.width = Math.max(
            MIN_REGION_WIDTH,
            Math.min(bounds.width - initial.x, initial.width + deltaX),
          );
        }

        if (movesTop) {
          next.y = Math.min(
            bottom - MIN_REGION_HEIGHT,
            Math.max(0, initial.y + deltaY),
          );
          next.height = bottom - next.y;
        } else {
          next.height = Math.max(
            MIN_REGION_HEIGHT,
            Math.min(bounds.height - initial.y, initial.height + deltaY),
          );
        }
      }

      setRegion(next);
      regionRef.current = next;
    },
    [],
  );

  const finishRegionInteraction = useCallback(
    () => {
      dragOperationRef.current = null;
    },
    [],
  );

  const toggleTeleprompter = useCallback(() => {
    setTeleprompterOpen((current) => {
      if (current) {
        return false;
      }

      const buttonBounds = teleprompterButtonRef.current?.getBoundingClientRect();
      const fallbackLeft = toolbarPosition?.left ?? window.innerWidth - 560;
      const fallbackTop = toolbarPosition
        ? toolbarPosition.top + toolbarPosition.height + 10
        : 72;
      const nextX = buttonBounds?.left ?? fallbackLeft;
      const nextY = (buttonBounds?.bottom ?? fallbackTop) + 10;

      setTeleprompterPosition({
        x: Math.min(
          Math.max(12, window.innerWidth - teleprompterSize.width - 12),
          Math.max(12, nextX),
        ),
        y: Math.min(
          Math.max(12, window.innerHeight - teleprompterSize.height - 12),
          Math.max(12, nextY),
        ),
      });
      return true;
    });
  }, [teleprompterSize.height, teleprompterSize.width, toolbarPosition]);

  const startTeleprompterDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      teleprompterDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        initialPosition: teleprompterPosition ?? { x: 24, y: 72 },
      };
    },
    [teleprompterPosition],
  );

  const updateTeleprompterDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const operation = teleprompterDragRef.current;

      if (!operation) {
        return;
      }

      event.preventDefault();
      setTeleprompterPosition({
        x: Math.min(
          Math.max(12, window.innerWidth - teleprompterSize.width - 12),
          Math.max(
            12,
            operation.initialPosition.x + event.clientX - operation.startX,
          ),
        ),
        y: Math.min(
          Math.max(12, window.innerHeight - teleprompterSize.height - 12),
          Math.max(
            12,
            operation.initialPosition.y + event.clientY - operation.startY,
          ),
        ),
      });
    },
    [teleprompterSize.height, teleprompterSize.width],
  );

  const finishTeleprompterDrag = useCallback(() => {
    teleprompterDragRef.current = null;
  }, []);

  const startTeleprompterResize = useCallback(
    (
      event: ReactPointerEvent<HTMLButtonElement>,
      direction: TeleprompterResizeOperation["direction"],
    ) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      teleprompterResizeRef.current = {
        direction,
        startX: event.clientX,
        startY: event.clientY,
        initialSize: teleprompterSize,
      };
    },
    [teleprompterSize],
  );

  const updateTeleprompterResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const operation = teleprompterResizeRef.current;

      if (!operation) {
        return;
      }

      event.preventDefault();
      const nextWidth =
        operation.direction === "y"
          ? operation.initialSize.width
          : Math.min(
              Math.max(MIN_TELEPROMPTER_WIDTH, window.innerWidth - 48),
              Math.max(
                MIN_TELEPROMPTER_WIDTH,
                operation.initialSize.width + event.clientX - operation.startX,
              ),
            );
      const nextHeight =
        operation.direction === "x"
          ? operation.initialSize.height
          : Math.min(
              Math.max(MIN_TELEPROMPTER_HEIGHT, window.innerHeight - 96),
              Math.max(
                MIN_TELEPROMPTER_HEIGHT,
                operation.initialSize.height + event.clientY - operation.startY,
              ),
            );
      const nextSize = {
        width: nextWidth,
        height: nextHeight,
      };

      setTeleprompterSize(nextSize);
      setTeleprompterPosition((current) =>
        current
          ? {
              x: Math.min(
                Math.max(12, window.innerWidth - nextSize.width - 12),
                Math.max(12, current.x),
              ),
              y: Math.min(
                Math.max(12, window.innerHeight - nextSize.height - 12),
                Math.max(12, current.y),
              ),
            }
          : current,
      );
    },
    [],
  );

  const finishTeleprompterResize = useCallback(() => {
    teleprompterResizeRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    const canvas = canvasRef.current;
    const currentRegion = regionRef.current;

    setError(null);

    if (!canvas || !excalidrawAPI || !currentRegion) {
      setError("录制区域尚未准备完成。");
      return;
    }

    if (settingsRef.current.showCursor) {
      const pointer = pointerRef.current;
      const pointerInsideRegion =
        pointer.visible &&
        pointer.x >= currentRegion.x &&
        pointer.x <= currentRegion.x + currentRegion.width &&
        pointer.y >= currentRegion.y &&
        pointer.y <= currentRegion.y + currentRegion.height;

      if (!pointerInsideRegion) {
        pointerRef.current = {
          x: currentRegion.x + currentRegion.width / 2,
          y: currentRegion.y + currentRegion.height / 2,
          visible: true,
        };
      }
    }

    if (typeof MediaRecorder === "undefined") {
      setError("当前浏览器不支持录屏功能。");
      return;
    }

    const mimeType = MP4_MIME_TYPES.find((type) =>
      MediaRecorder.isTypeSupported(type),
    );

    if (!mimeType) {
      setError("当前浏览器无法原生录制 MP4，请使用最新版 Chrome 或 Edge。");
      return;
    }

    try {
      const videoSize = getVideoSize(currentRegion, settingsRef.current);

      canvas.width = videoSize.width;
      canvas.height = videoSize.height;
      sceneCanvasRef.current = null;
      await renderRecordingRegion();

      const stream = canvas.captureStream(30);
      microphoneStream?.getAudioTracks().forEach((track) => {
        stream.addTrack(track.clone());
      });
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BIT_RATE,
      });

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorderRef.current = recorder;
      streamRef.current = stream;
      setElapsedSeconds(0);
      setStatus("recording");
      statusRef.current = "recording";
      recorder.start(1000);
      startRenderLoop();
    } catch (recordingError) {
      setError(
        recordingError instanceof Error
          ? recordingError.message
          : "无法开始录制。",
      );
    }
  }, [excalidrawAPI, microphoneStream, renderRecordingRegion, startRenderLoop]);

  const pauseRecording = useCallback(() => {
    const recorder = recorderRef.current;

    if (!recorder || recorder.state !== "recording") {
      return;
    }

    recorder.pause();
    stopRenderLoop();
    setStatus("paused");
    statusRef.current = "paused";
  }, [stopRenderLoop]);

  const resumeRecording = useCallback(() => {
    const recorder = recorderRef.current;

    if (!recorder || recorder.state !== "paused") {
      return;
    }

    recorder.resume();
    setStatus("recording");
    statusRef.current = "recording";
    startRenderLoop();
  }, [startRenderLoop]);

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      return;
    }

    setError(null);
    setStatus("processing");
    statusRef.current = "processing";
    stopRenderLoop();

    if (recorder.state === "recording") {
      recorder.pause();
    }

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType }));
      };
      recorder.requestData();
      recorder.stop();
    });

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;

    const fileName = `whiteboard-recording-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.mp4`;

    downloadBlob(blob, fileName);
    chunksRef.current = [];
    sceneCanvasRef.current = null;
    setElapsedSeconds(0);
    setRegion(null);
    regionRef.current = null;
    setStatus("idle");
    statusRef.current = "idle";
  }, [stopRenderLoop]);

  return (
    <>
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        className="pointer-events-none fixed -left-[10000px] top-0"
        aria-hidden="true"
      />

      {status === "ready" && region && (
        <div
          className="absolute inset-0 z-[15] touch-none"
          onPointerMove={updateRegionInteraction}
          onPointerUp={finishRegionInteraction}
          onPointerCancel={finishRegionInteraction}
        >
          <div
            className="absolute cursor-move border-2 border-red-500 bg-red-500/5 shadow-[0_0_0_9999px_rgba(15,23,42,0.28)]"
            style={{
              left: region.x,
              top: region.y,
              width: region.width,
              height: region.height,
            }}
            onPointerDown={(event) =>
              startRegionInteraction(event, "move")
            }
          >
            <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-red-500 px-3 py-1 text-xs font-medium whitespace-nowrap text-white shadow-sm">
              拖动调整位置 · 拖动四角调整大小
            </div>
            {(["nw", "ne", "sw", "se"] as ResizeHandle[]).map(
              (handle) => (
                <button
                  key={handle}
                  type="button"
                  aria-label={`调整录制区域 ${handle}`}
                  className={`absolute h-4 w-4 rounded-sm border-2 border-white bg-red-500 shadow ${
                    handle === "nw"
                      ? "-top-2 -left-2 cursor-nwse-resize"
                      : handle === "ne"
                        ? "-top-2 -right-2 cursor-nesw-resize"
                        : handle === "sw"
                          ? "-bottom-2 -left-2 cursor-nesw-resize"
                          : "-right-2 -bottom-2 cursor-nwse-resize"
                  }`}
                  onPointerDown={(event) =>
                    startRegionInteraction(event, "resize", handle)
                  }
                />
              ),
            )}
          </div>
        </div>
      )}

      {(status === "recording" || status === "paused") && region && (
        <div
          className="pointer-events-none absolute z-[15] border-2 border-red-500 shadow-[0_0_0_9999px_rgba(15,23,42,0.28)]"
          style={{
            left: region.x,
            top: region.y,
            width: region.width,
            height: region.height,
          }}
          aria-hidden="true"
        />
      )}

      {teleprompterOpen && (
        <section
          data-teleprompter
          aria-label="提词器"
          className="fixed z-30 cursor-default overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.18)]"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onPointerCancel={(event) => event.stopPropagation()}
          style={{
            left: teleprompterPosition?.x ?? 24,
            top: teleprompterPosition?.y ?? 72,
            width: teleprompterSize.width,
            height: teleprompterSize.height,
            opacity: teleprompterVisualOpacity,
          }}
        >
          <header
            className="flex h-8 cursor-move touch-none items-center justify-between border-b border-zinc-100 px-3"
            onPointerDown={startTeleprompterDrag}
            onPointerMove={updateTeleprompterDrag}
            onPointerUp={finishTeleprompterDrag}
            onPointerCancel={finishTeleprompterDrag}
          >
            <span className="h-px flex-1" aria-hidden="true" />
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setTeleprompterOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="关闭提词器"
            >
              ×
            </button>
          </header>

          <div className="mx-4 mt-2 flex items-center gap-2 rounded-xl bg-zinc-50 px-2.5 py-2">
            <button
              type="button"
              onClick={() => setTeleprompterPlaying((current) => !current)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-zinc-600 shadow-sm transition hover:bg-zinc-900 hover:text-white active:scale-[0.98]"
              aria-label={teleprompterPlaying ? "暂停提词器" : "播放提词器"}
            >
              {teleprompterPlaying ? (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="currentColor"
                >
                  <path d="M7 5h3.5v14H7V5Zm6.5 0H17v14h-3.5V5Z" />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4 translate-x-px"
                  fill="currentColor"
                >
                  <path d="M8 5.5v13l10-6.5-10-6.5Z" />
                </svg>
              )}
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="shrink-0 text-xs font-medium text-zinc-500">速度</span>
                <input
                  type="number"
                  min={MIN_TELEPROMPTER_SPEED}
                  max={MAX_TELEPROMPTER_SPEED}
                  step="1"
                  value={teleprompterSpeed}
                  onChange={(event) =>
                    updateTeleprompterSpeed(Number(event.target.value))
                  }
                  className="h-6 w-12 rounded-md border border-zinc-200 bg-zinc-50 text-center text-xs font-semibold tabular-nums text-zinc-700 outline-none focus:border-zinc-400"
                  aria-label="提词器滚动速度"
                />
                <span className="shrink-0 text-[10px] font-medium text-zinc-400">px/s</span>
              </div>
              <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium whitespace-nowrap text-zinc-500">
                <span className="shrink-0">透明度</span>
                <input
                  type="range"
                  min="0"
                  max="85"
                  step="5"
                  value={teleprompterOpacity}
                  onChange={(event) =>
                    setTeleprompterOpacity(Number(event.target.value))
                  }
                  className="h-1 min-w-0 flex-1 accent-zinc-700"
                />
              </label>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="shrink-0 text-xs font-medium text-zinc-500">字号</span>
                <input
                  type="number"
                  min={MIN_TELEPROMPTER_FONT_SIZE}
                  max={MAX_TELEPROMPTER_FONT_SIZE}
                  step="1"
                  value={teleprompterFontSize}
                  onChange={(event) =>
                    updateTeleprompterFontSize(Number(event.target.value))
                  }
                  className="h-6 w-12 rounded-md border border-zinc-200 bg-zinc-50 text-center text-xs font-semibold tabular-nums text-zinc-700 outline-none focus:border-zinc-400"
                  aria-label="提词器脚本字号"
                />
              </div>
              <button
                type="button"
                title={
                  teleprompterKeyboardEnabled
                    ? "录制时左右键同步切换脚本页已开启"
                    : "录制时左右键同步切换脚本页已关闭"
                }
                aria-label="幻灯片同步切换"
                aria-pressed={teleprompterKeyboardEnabled}
                onClick={() =>
                  setTeleprompterKeyboardEnabled((current) => !current)
                }
                className={`flex h-8 shrink-0 items-center gap-1.5 text-[11px] font-medium transition ${
                  teleprompterKeyboardEnabled
                    ? "text-zinc-900"
                    : "text-zinc-500 hover:text-zinc-800"
                }`}
              >
                <span
                  className={`relative h-4 w-7 rounded-full transition ${
                    teleprompterKeyboardEnabled ? "bg-white/30" : "bg-zinc-200"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                      teleprompterKeyboardEnabled
                        ? "translate-x-3"
                        : "translate-x-0"
                    }`}
                  />
                </span>
                同步
              </button>
            </div>
          </div>
          <textarea
            ref={teleprompterTextRef}
            value={activeTeleprompterScript}
            onChange={(event) =>
              updateActiveTeleprompterScript(event.target.value)
            }
            placeholder={
              "在此粘贴你的脚本...\n\n此文本仅对你可见，不会出现在录制中。"
            }
            className="mt-3 h-[calc(100%-7.5rem)] w-full cursor-text resize-none bg-transparent px-5 pb-16 text-zinc-800 outline-none placeholder:text-zinc-400"
            style={{
              fontSize: teleprompterFontSize,
              lineHeight: `${Math.round(teleprompterFontSize * 1.55)}px`,
            }}
          />

          <div
            onWheel={handleTeleprompterScriptWheel}
            className="absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-3rem)] -translate-x-1/2 items-center gap-1 px-1 py-1"
          >
            {teleprompterScripts.length > TELEPROMPTER_VISIBLE_SCRIPT_COUNT && (
              <button
                type="button"
                title="上一页脚本"
                aria-label="上一页脚本"
                disabled={activeTeleprompterScriptIndex === 0}
                onClick={() => selectRelativeTeleprompterScript(-1)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-35"
              >
                ‹
              </button>
            )}

            {visibleTeleprompterScripts.map((_, visibleIndex) => {
              const index =
                visibleTeleprompterScriptStartIndex + visibleIndex;
              const isActive = activeTeleprompterScriptIndex === index;

              return (
                <div key={index} className="group relative shrink-0">
                  <button
                    type="button"
                    title={`脚本页 ${index + 1}`}
                    aria-label={`切换到脚本页 ${index + 1}`}
                    onClick={() => selectTeleprompterScript(index)}
                    className={`flex h-6 min-w-6 items-center justify-center rounded-md px-2 text-[11px] font-medium transition ${
                      isActive
                        ? "bg-zinc-100 text-zinc-800 ring-1 ring-zinc-300"
                        : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700"
                    }`}
                  >
                    {index + 1}
                  </button>
                  {teleprompterScripts.length > 1 && (
                    <button
                      type="button"
                      title={`删除脚本页 ${index + 1}`}
                      aria-label={`删除脚本页 ${index + 1}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteTeleprompterScript(index);
                      }}
                      className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 scale-75 items-center justify-center rounded-full bg-zinc-500 text-[10px] leading-none text-white opacity-0 shadow-sm transition hover:bg-red-500 group-hover:scale-100 group-hover:opacity-100 focus:scale-100 focus:opacity-100"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {teleprompterScripts.length > TELEPROMPTER_VISIBLE_SCRIPT_COUNT && (
              <button
                type="button"
                title="下一页脚本"
                aria-label="下一页脚本"
                disabled={
                  activeTeleprompterScriptIndex ===
                  teleprompterScripts.length - 1
                }
                onClick={() => selectRelativeTeleprompterScript(1)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-35"
              >
                ›
              </button>
            )}
            <button
              type="button"
              title="新增脚本页"
              aria-label="新增脚本页"
              onClick={addTeleprompterScript}
              className="flex h-6 min-w-6 items-center justify-center rounded-md border border-dashed border-zinc-300 px-2 text-sm leading-none text-zinc-400 transition hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"
            >
              +
            </button>
          </div>

          <button
            type="button"
            aria-label="调整提词器宽度"
            onPointerDown={(event) => startTeleprompterResize(event, "x")}
            onPointerMove={updateTeleprompterResize}
            onPointerUp={finishTeleprompterResize}
            onPointerCancel={finishTeleprompterResize}
            className="absolute top-3 right-0 bottom-3 w-2 cursor-ew-resize rounded-full transition hover:bg-zinc-300/40"
          />
          <button
            type="button"
            aria-label="调整提词器高度"
            onPointerDown={(event) => startTeleprompterResize(event, "y")}
            onPointerMove={updateTeleprompterResize}
            onPointerUp={finishTeleprompterResize}
            onPointerCancel={finishTeleprompterResize}
            className="absolute right-3 bottom-0 left-3 h-2 cursor-ns-resize rounded-full transition hover:bg-zinc-300/40"
          />
          <button
            type="button"
            aria-label="调整提词器宽高"
            onPointerDown={(event) => startTeleprompterResize(event, "xy")}
            onPointerMove={updateTeleprompterResize}
            onPointerUp={finishTeleprompterResize}
            onPointerCancel={finishTeleprompterResize}
            className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize rounded-br-2xl transition hover:bg-zinc-300/40"
          />
        </section>
      )}

      <div
        className={`absolute z-20 flex flex-col gap-2 ${
          toolbarPosition ? "items-start" : "top-4 right-4 items-end"
        }`}
        style={
          toolbarPosition
            ? { left: toolbarPosition.left, top: toolbarPosition.top }
            : undefined
        }
      >
        <div className="flex items-start gap-2">
          <button
            ref={teleprompterButtonRef}
            type="button"
            onClick={toggleTeleprompter}
            style={{ height: toolbarPosition ? toolbarPosition.height : 40 }}
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-sm font-medium shadow-sm backdrop-blur transition ${
              teleprompterOpen
                ? "border-zinc-300 bg-white text-zinc-900"
                : "border-zinc-200 bg-white/95 text-zinc-700 hover:bg-zinc-50"
            }`}
          >
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
              <path d="M8 3.5h6l3 3V20a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 20V5a1.5 1.5 0 0 1 1.5-1.5Z" />
              <path d="M14 3.5V7h3M10 11h4M10 15h4" />
            </svg>
            提词器
          </button>

        {status === "idle" || status === "ready" ? (
          <div
            style={{
              width: status === "ready" ? 328 : 76,
              height: toolbarPosition ? toolbarPosition.height : 40,
            }}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white/95 shadow-sm backdrop-blur transition-[width] duration-300 ease-out"
          >
            {status === "idle" ? (
              <button
                type="button"
                onClick={prepareRecording}
                className="flex h-full w-full items-center justify-center gap-2 whitespace-nowrap text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                录制
              </button>
            ) : (
              <div className="grid h-full w-[328px] grid-cols-[1fr_auto_auto] items-center gap-2 px-2.5">
                <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
                  <span className="text-sm font-semibold text-zinc-800">
                    调整录制区域
                  </span>
                  {region && (
                    <span className="text-sm font-medium tabular-nums text-zinc-400">
                      {Math.round(region.width)} × {Math.round(region.height)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={startRecording}
                  className="h-8 whitespace-nowrap rounded-lg bg-red-500 px-3 text-sm font-medium text-white transition hover:bg-red-600 active:scale-[0.98]"
                >
                  开始录制
                </button>
                <button
                  type="button"
                  onClick={cancelPreparation}
                  className="justify-self-end whitespace-nowrap rounded-lg px-1.5 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        ) : status === "recording" || status === "paused" ? (
          <div
            style={{ height: toolbarPosition ? toolbarPosition.height : 40 }}
            className="grid w-max grid-cols-[auto_auto_auto_auto] items-center gap-1.5 overflow-hidden rounded-xl border border-zinc-200 bg-white/95 px-2.5 shadow-sm backdrop-blur"
          >
            <div className="min-w-0 leading-none">
              <p className="flex items-center gap-2 whitespace-nowrap text-sm font-semibold text-zinc-900">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    status === "recording"
                      ? "animate-pulse bg-red-500"
                      : "bg-amber-400"
                  }`}
                />
                {status === "recording" ? "正在录制" : "录制已暂停"}
              </p>
              <p className="mt-1 whitespace-nowrap pl-[18px] text-[10px] font-semibold leading-none text-red-500">
                使用 ← → 切换幻灯片
              </p>
            </div>
            <button
              type="button"
              onClick={status === "recording" ? pauseRecording : resumeRecording}
              className="h-8 min-w-14 whitespace-nowrap rounded-lg bg-zinc-100 px-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:scale-[0.98]"
            >
              {status === "recording" ? "暂停" : "继续"}
            </button>
            <button
              type="button"
              onClick={finishRecording}
              className="h-8 whitespace-nowrap rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white transition hover:bg-black active:scale-[0.98]"
            >
              结束录制
            </button>
            <span className="min-w-[48px] text-right font-mono text-sm font-semibold tabular-nums text-zinc-700">
              {formatDuration(elapsedSeconds)}
            </span>
          </div>
        ) : (
          <div
            style={{ height: toolbarPosition ? toolbarPosition.height : 40 }}
            className="flex min-w-52 items-center gap-3 rounded-xl border border-zinc-200 bg-white/95 px-4 shadow-sm backdrop-blur"
          >
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
            <span className="text-sm font-semibold text-zinc-800">
              正在生成 MP4
            </span>
          </div>
        )}
        </div>

        {error && (
          <div className="max-w-80 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 shadow-sm">
            {error}
          </div>
        )}
      </div>
    </>
  );
}
