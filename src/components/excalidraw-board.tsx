"use client";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  LibraryItem,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import dynamic from "next/dynamic";
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CameraLayout,
  DEFAULT_RECORDING_SETTINGS,
  getSlideDimensions,
  type RecordingSettings,
} from "@/components/recording-settings";
import { RecordingSettingsPanel } from "@/components/recording-settings-panel";
import { SlideRecorder } from "@/components/slide-recorder";
import { AccountMenu } from "@/components/account-menu";
import { getSupabaseClient } from "@/lib/supabase";

const Excalidraw = dynamic(
  async () => {
    const { Excalidraw } = await import("@excalidraw/excalidraw");

    return Excalidraw;
  },
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-[#f8f9fa] text-sm text-zinc-500">
        正在加载白板...
      </div>
    ),
  },
);

const SLIDE_GAP = 160;
const SCENE_SAVE_DELAY_MS = 900;
const LIBRARY_SAVE_DELAY_MS = 900;
const WHITEBOARD_SCENE_BUCKET = "whiteboard-scenes";
const WHITEBOARD_SCENE_FILE = "scene.json";
const DATABASE_SCENE_FALLBACK_MAX_BYTES = 750_000;

type Slide = Pick<
  ExcalidrawFrameElement,
  "id" | "name" | "x" | "y" | "width" | "height"
>;

type PersistedWhiteboardScene = {
  elements: readonly ExcalidrawElement[];
  appState: Pick<AppState, "viewBackgroundColor">;
  files: BinaryFiles;
};

type PendingSceneSave = {
  userId: string;
  scene: PersistedWhiteboardScene;
  serializedScene: string;
};

type PendingLibrarySave = {
  userId: string;
  libraryItems: LibraryItems;
  serializedLibraryItems: string;
};

type SceneSaveStatus = "idle" | "saving" | "saved" | "error";

function areSlidesEqual(previous: Slide[], next: Slide[]) {
  return (
    previous.length === next.length &&
    previous.every((slide, index) => {
      const nextSlide = next[index];

      return (
        nextSlide &&
        slide.id === nextSlide.id &&
        slide.name === nextSlide.name &&
        slide.x === nextSlide.x &&
        slide.y === nextSlide.y &&
        slide.width === nextSlide.width &&
        slide.height === nextSlide.height
      );
    })
  );
}

function getPersistableAppState(
  appState: AppState,
): PersistedWhiteboardScene["appState"] {
  return {
    viewBackgroundColor: appState.viewBackgroundColor,
  };
}

function getWhiteboardScenePath(userId: string) {
  return `${userId}/${WHITEBOARD_SCENE_FILE}`;
}

function normalizePersistedWhiteboardScene(
  scene: unknown,
): PersistedWhiteboardScene {
  const candidate =
    scene && typeof scene === "object"
      ? (scene as Partial<PersistedWhiteboardScene>)
      : {};

  return {
    elements: Array.isArray(candidate.elements)
      ? (candidate.elements as ExcalidrawElement[])
      : [],
    appState:
      candidate.appState && typeof candidate.appState === "object"
        ? (candidate.appState as PersistedWhiteboardScene["appState"])
        : { viewBackgroundColor: "#f8f9fa" },
    files:
      candidate.files && typeof candidate.files === "object"
        ? (candidate.files as BinaryFiles)
        : {},
  };
}

function getStoredWhiteboardScene(data: {
  elements?: unknown;
  app_state?: unknown;
  files?: unknown;
}): PersistedWhiteboardScene {
  return {
    elements: Array.isArray(data.elements)
      ? (data.elements as ExcalidrawElement[])
      : [],
    appState:
      data.app_state && typeof data.app_state === "object"
        ? (data.app_state as PersistedWhiteboardScene["appState"])
        : { viewBackgroundColor: "#f8f9fa" },
    files:
      data.files && typeof data.files === "object"
        ? (data.files as BinaryFiles)
        : {},
  };
}

function getByteSize(value: string) {
  return new Blob([value]).size;
}

function getErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "未知错误");
  }

  return "未知错误";
}

function isMissingStorageSchemaError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("storage_path") ||
    message.includes("storage_size") ||
    message.includes("storage_updated_at") ||
    message.includes("column") ||
    message.includes("schema cache")
  );
}

function normalizeLibraryItems(libraryItems: unknown): LibraryItems {
  if (!Array.isArray(libraryItems)) {
    return [];
  }

  return libraryItems.filter(
    (item): item is LibraryItem =>
      item &&
      typeof item === "object" &&
      Array.isArray((item as Partial<LibraryItem>).elements),
  );
}

export function ExcalidrawBoard() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [sceneLoadedUserId, setSceneLoadedUserId] = useState<string | null>(null);
  const [recordingSettings, setRecordingSettings] = useState<RecordingSettings>(
    DEFAULT_RECORDING_SETTINGS,
  );
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(null);
  const [hasLifetimeAccess, setHasLifetimeAccess] = useState(false);
  const [cameraPosition, setCameraPosition] = useState({ x: 32, y: 120 });
  const [slideNavigationHeight, setSlideNavigationHeight] = useState(40);
  const [sceneSaveStatus, setSceneSaveStatus] =
    useState<SceneSaveStatus>("idle");
  const [sceneSaveMessage, setSceneSaveMessage] = useState("");
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraDragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const hasLifetimeAccessRef = useRef(hasLifetimeAccess);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneSaveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingSceneRef = useRef<PendingSceneSave | null>(null);
  const isSceneSaveInFlightRef = useRef(false);
  const isRestoringSceneRef = useRef(false);
  const lastSavedSceneRef = useRef("");
  const libraryLoadedUserIdRef = useRef<string | null>(null);
  const librarySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLibraryRef = useRef<PendingLibrarySave | null>(null);
  const isRestoringLibraryRef = useRef(false);
  const lastSavedLibraryRef = useRef("");

  const slideDimensions = useMemo(
    () => getSlideDimensions(recordingSettings),
    [recordingSettings],
  );

  const cameraLayout: CameraLayout = useMemo(
    () => ({ ...cameraPosition, size: recordingSettings.cameraSize }),
    [cameraPosition, recordingSettings.cameraSize],
  );
  const slideNavigationButtonSize = Math.max(28, slideNavigationHeight - 8);

  useEffect(() => {
    let observedZoomActions: HTMLElement | null = null;
    const resizeObserver = new ResizeObserver(() => updateSlideNavigationHeight());

    const findZoomActions = () =>
      document.querySelector<HTMLElement>(".excalidraw .zoom-actions") ??
      document.querySelector<HTMLElement>(".excalidraw [class*='zoom-actions']");

    const updateSlideNavigationHeight = () => {
      const zoomActions = findZoomActions();

      if (!zoomActions) {
        return;
      }

      if (zoomActions !== observedZoomActions) {
        if (observedZoomActions) {
          resizeObserver.unobserve(observedZoomActions);
        }
        observedZoomActions = zoomActions;
        resizeObserver.observe(zoomActions);
      }

      const nextHeight = Math.round(zoomActions.getBoundingClientRect().height);
      if (nextHeight > 0) {
        setSlideNavigationHeight((current) =>
          current === nextHeight ? current : nextHeight,
        );
      }
    };

    const frame = requestAnimationFrame(updateSlideNavigationHeight);
    const mutationObserver = new MutationObserver(updateSlideNavigationHeight);

    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", updateSlideNavigationHeight);

    return () => {
      cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateSlideNavigationHeight);
    };
  }, []);

  useEffect(() => {
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  useEffect(() => {
    return () => cameraStream?.getTracks().forEach((track) => track.stop());
  }, [cameraStream]);

  useEffect(() => {
    return () => microphoneStream?.getTracks().forEach((track) => track.stop());
  }, [microphoneStream]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    hasLifetimeAccessRef.current = hasLifetimeAccess;
  }, [hasLifetimeAccess]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let isMounted = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (isMounted) {
        setCurrentUserId(data.user?.id ?? null);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;

      if (nextUserId !== currentUserIdRef.current) {
        setSceneLoadedUserId(null);
        lastSavedSceneRef.current = "";
        pendingSceneRef.current = null;
        libraryLoadedUserIdRef.current = null;
        lastSavedLibraryRef.current = "";
        pendingLibraryRef.current = null;
      }

      setCurrentUserId(nextUserId);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      if (sceneSaveStatusTimerRef.current) {
        clearTimeout(sceneSaveStatusTimerRef.current);
      }
      if (librarySaveTimerRef.current) {
        clearTimeout(librarySaveTimerRef.current);
      }
    };
  }, []);

  const nextSlideNumber = useMemo(() => {
    const largestNumber = slides.reduce((largest, slide) => {
      const match = slide.name?.match(/(\d+)$/);
      const number = match ? Number(match[1]) : 0;

      return Math.max(largest, number);
    }, 0);

    return largestNumber + 1;
  }, [slides]);

  const syncSlides = useCallback((elements: readonly ExcalidrawElement[]) => {
    const frames = elements
      .filter(
        (element): element is ExcalidrawFrameElement => element.type === "frame",
      )
      .map(({ id, name, x, y, width, height }) => ({
        id,
        name,
        x,
        y,
        width,
        height,
      }));

    setSlides((previous) => (areSlidesEqual(previous, frames) ? previous : frames));
    setActiveSlideId((current) =>
      current && frames.some((frame) => frame.id === current) ? current : null,
    );
  }, []);

  useEffect(() => {
    if (!supabase || !excalidrawAPI || !currentUserId) {
      lastSavedSceneRef.current = "";
      pendingSceneRef.current = null;
      return;
    }

    let isCancelled = false;

    const loadSavedScene = async () => {
      let sceneResult = await supabase
        .from("whiteboard_scenes")
        .select("elements, app_state, files, storage_path")
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (sceneResult.error && isMissingStorageSchemaError(sceneResult.error)) {
        sceneResult = await supabase
          .from("whiteboard_scenes")
          .select("elements, app_state, files")
          .eq("user_id", currentUserId)
          .maybeSingle();
      }

      const { data, error } = sceneResult;

      if (isCancelled) {
        return;
      }

      if (error) {
        console.warn("Failed to load saved whiteboard scene", error);
        setSceneLoadedUserId(currentUserId);
        return;
      }

      if (!data) {
        lastSavedSceneRef.current = "";
        setSceneLoadedUserId(currentUserId);
        return;
      }

      let persistedScene: PersistedWhiteboardScene | null = null;

      if (typeof data.storage_path === "string" && data.storage_path) {
        const { data: sceneFile, error: downloadError } = await supabase.storage
          .from(WHITEBOARD_SCENE_BUCKET)
          .download(data.storage_path);

        if (isCancelled) {
          return;
        }

        if (downloadError) {
          console.warn("Failed to download saved whiteboard scene", downloadError);
        } else {
          try {
            persistedScene = normalizePersistedWhiteboardScene(
              JSON.parse(await sceneFile.text()),
            );
          } catch (parseError) {
            console.warn("Failed to parse saved whiteboard scene", parseError);
          }
        }
      }

      persistedScene ??= getStoredWhiteboardScene(data);
      const { elements, appState, files } = persistedScene;

      isRestoringSceneRef.current = true;
      excalidrawAPI.addFiles(Object.values(files));
      excalidrawAPI.updateScene({
        elements,
        appState: {
          ...appState,
          selectedElementIds: {},
        },
        captureUpdate: "NEVER",
      });
      syncSlides(elements);
      lastSavedSceneRef.current = JSON.stringify({ elements, appState, files });
      setSceneLoadedUserId(currentUserId);

      requestAnimationFrame(() => {
        isRestoringSceneRef.current = false;
      });
    };

    void loadSavedScene();

    return () => {
      isCancelled = true;
    };
  }, [currentUserId, excalidrawAPI, supabase, syncSlides]);

  const persistScene = useCallback(
    async (pendingSave: PendingSceneSave) => {
      if (!supabase || pendingSave.userId !== currentUserIdRef.current) {
        return;
      }

      if (isSceneSaveInFlightRef.current) {
        pendingSceneRef.current = pendingSave;
        return;
      }

      isSceneSaveInFlightRef.current = true;

      const markSceneSaved = (savedScene: PendingSceneSave) => {
        lastSavedSceneRef.current = savedScene.serializedScene;
        setSceneSaveStatus("saved");
        setSceneSaveMessage("白板已保存");
        sceneSaveStatusTimerRef.current = setTimeout(() => {
          setSceneSaveStatus("idle");
          setSceneSaveMessage("");
        }, 1400);
      };

      const getNextQueuedSave = () => {
        const queuedSave: PendingSceneSave | null = pendingSceneRef.current;

        return queuedSave &&
          queuedSave.serializedScene !== lastSavedSceneRef.current
          ? queuedSave
          : null;
      };

      const saveLegacyDatabaseScene = (sceneSave: PendingSceneSave) =>
        supabase.from("whiteboard_scenes").upsert(
          {
            user_id: sceneSave.userId,
            elements: sceneSave.scene.elements,
            app_state: sceneSave.scene.appState,
            files: sceneSave.scene.files,
          },
          { onConflict: "user_id" },
        );

      try {
        let saveToWrite: PendingSceneSave | null = pendingSave;

        while (saveToWrite) {
          if (saveToWrite.userId !== currentUserIdRef.current) {
            break;
          }

          if (
            pendingSceneRef.current?.serializedScene ===
            saveToWrite.serializedScene
          ) {
            pendingSceneRef.current = null;
          }

          const sceneSize = getByteSize(saveToWrite.serializedScene);
          const scenePath = getWhiteboardScenePath(saveToWrite.userId);
          const keepDatabaseFallback =
            sceneSize <= DATABASE_SCENE_FALLBACK_MAX_BYTES;

          if (sceneSaveStatusTimerRef.current) {
            clearTimeout(sceneSaveStatusTimerRef.current);
            sceneSaveStatusTimerRef.current = null;
          }

          setSceneSaveStatus("saving");
          setSceneSaveMessage("正在保存白板...");

          const { error: uploadError } = await supabase.storage
            .from(WHITEBOARD_SCENE_BUCKET)
            .upload(
              scenePath,
              new Blob([saveToWrite.serializedScene], {
                type: "application/json",
              }),
              {
              cacheControl: "0",
              contentType: "application/json",
              upsert: true,
              },
            );

          if (uploadError) {
            console.warn("Failed to upload whiteboard scene", uploadError);

            if (keepDatabaseFallback) {
              const { error: fallbackError } =
                await saveLegacyDatabaseScene(saveToWrite);

              if (!fallbackError) {
                markSceneSaved(saveToWrite);
                saveToWrite = getNextQueuedSave();
                continue;
              }

              console.warn(
                "Failed to save fallback whiteboard scene",
                fallbackError,
              );
            }

            setSceneSaveStatus("error");
            setSceneSaveMessage(
              `白板保存失败：${getErrorMessage(uploadError)}${
                keepDatabaseFallback
                  ? ""
                  : "。当前白板较大，请确认 Supabase Storage migration 已执行。"
              }`,
            );

            if (!pendingSceneRef.current) {
              pendingSceneRef.current = saveToWrite;
            }
            break;
          }

          const { error } = await supabase
            .from("whiteboard_scenes")
            .upsert(
              {
                user_id: saveToWrite.userId,
                elements: keepDatabaseFallback ? saveToWrite.scene.elements : [],
                app_state: saveToWrite.scene.appState,
                files: keepDatabaseFallback ? saveToWrite.scene.files : {},
                storage_path: scenePath,
                storage_size: sceneSize,
                storage_updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id" },
            );

          if (error) {
            console.warn("Failed to save whiteboard scene", error);

            if (keepDatabaseFallback) {
              const { error: fallbackError } =
                await saveLegacyDatabaseScene(saveToWrite);

              if (!fallbackError) {
                markSceneSaved(saveToWrite);
                saveToWrite = getNextQueuedSave();
                continue;
              }

              console.warn(
                "Failed to save fallback whiteboard scene",
                fallbackError,
              );
            }

            setSceneSaveStatus("error");
            setSceneSaveMessage(
              `白板保存失败：${getErrorMessage(error)}。请确认数据库迁移已执行。`,
            );

            if (!pendingSceneRef.current) {
              pendingSceneRef.current = saveToWrite;
            }
            break;
          }

          markSceneSaved(saveToWrite);
          saveToWrite = getNextQueuedSave();
        }
      } finally {
        isSceneSaveInFlightRef.current = false;
      }
    },
    [supabase],
  );

  useEffect(() => {
    const flushPendingScene = () => {
      const pendingSave = pendingSceneRef.current;

      if (!pendingSave) {
        return;
      }

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      void persistScene(pendingSave);
    };

    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        flushPendingScene();
      }
    };

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingSceneRef.current && !isSceneSaveInFlightRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("pagehide", flushPendingScene);
    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("visibilitychange", flushWhenHidden);

    return () => {
      window.removeEventListener("pagehide", flushPendingScene);
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [persistScene]);

  const handleSceneChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      syncSlides(elements);

      if (
        !supabase ||
        !currentUserId ||
        sceneLoadedUserId !== currentUserId ||
        isRestoringSceneRef.current
      ) {
        return;
      }

      const persistedScene: PersistedWhiteboardScene = {
        elements,
        appState: getPersistableAppState(appState),
        files,
      };
      const serializedScene = JSON.stringify(persistedScene);

      if (serializedScene === lastSavedSceneRef.current) {
        return;
      }

      pendingSceneRef.current = {
        userId: currentUserId,
        scene: persistedScene,
        serializedScene,
      };

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = setTimeout(() => {
        const pendingSave = pendingSceneRef.current;

        if (!pendingSave) {
          return;
        }

        void persistScene(pendingSave);
      }, SCENE_SAVE_DELAY_MS);
    },
    [currentUserId, persistScene, sceneLoadedUserId, supabase, syncSlides],
  );

  const persistLibrary = useCallback(
    async (pendingSave: PendingLibrarySave) => {
      if (
        !supabase ||
        !hasLifetimeAccessRef.current ||
        pendingSave.userId !== currentUserIdRef.current
      ) {
        return;
      }

      const { error } = await supabase
        .from("excalidraw_libraries")
        .upsert(
          {
            user_id: pendingSave.userId,
            library_items: pendingSave.libraryItems,
          },
          { onConflict: "user_id" },
        );

      if (error) {
        console.warn("Failed to save Excalidraw library", error);
        return;
      }

      lastSavedLibraryRef.current = pendingSave.serializedLibraryItems;

      if (
        pendingLibraryRef.current?.serializedLibraryItems ===
        pendingSave.serializedLibraryItems
      ) {
        pendingLibraryRef.current = null;
      }
    },
    [supabase],
  );

  const handleLibraryChange = useCallback(
    (libraryItems: LibraryItems) => {
      if (
        !supabase ||
        !currentUserId ||
        !hasLifetimeAccess ||
        libraryLoadedUserIdRef.current !== currentUserId ||
        isRestoringLibraryRef.current
      ) {
        return;
      }

      const normalizedLibraryItems = normalizeLibraryItems(libraryItems);
      const serializedLibraryItems = JSON.stringify(normalizedLibraryItems);

      if (serializedLibraryItems === lastSavedLibraryRef.current) {
        return;
      }

      pendingLibraryRef.current = {
        userId: currentUserId,
        libraryItems: normalizedLibraryItems,
        serializedLibraryItems,
      };

      if (librarySaveTimerRef.current) {
        clearTimeout(librarySaveTimerRef.current);
      }

      librarySaveTimerRef.current = setTimeout(() => {
        const pendingSave = pendingLibraryRef.current;

        if (!pendingSave) {
          return;
        }

        void persistLibrary(pendingSave);
      }, LIBRARY_SAVE_DELAY_MS);
    },
    [currentUserId, hasLifetimeAccess, persistLibrary, supabase],
  );

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    if (!currentUserId || !hasLifetimeAccess) {
      lastSavedLibraryRef.current = "";
      pendingLibraryRef.current = null;

      if (libraryLoadedUserIdRef.current) {
        isRestoringLibraryRef.current = true;
        void excalidrawAPI
          .updateLibrary({
            libraryItems: [],
            merge: false,
            prompt: false,
            openLibraryMenu: false,
          })
          .finally(() => {
            requestAnimationFrame(() => {
              isRestoringLibraryRef.current = false;
            });
          });
      }

      libraryLoadedUserIdRef.current = null;
      return;
    }

    if (!supabase || libraryLoadedUserIdRef.current === currentUserId) {
      return;
    }

    let isCancelled = false;

    const loadSavedLibrary = async () => {
      const { data, error } = await supabase
        .from("excalidraw_libraries")
        .select("library_items")
        .eq("user_id", currentUserId)
        .maybeSingle();

      if (isCancelled) {
        return;
      }

      if (error) {
        console.warn("Failed to load Excalidraw library", error);
        libraryLoadedUserIdRef.current = currentUserId;
        return;
      }

      const libraryItems = normalizeLibraryItems(data?.library_items);

      isRestoringLibraryRef.current = true;
      await excalidrawAPI.updateLibrary({
        libraryItems,
        merge: false,
        prompt: false,
        openLibraryMenu: false,
        defaultStatus: "published",
      });

      if (isCancelled) {
        return;
      }

      lastSavedLibraryRef.current = JSON.stringify(libraryItems);
      libraryLoadedUserIdRef.current = currentUserId;

      requestAnimationFrame(() => {
        isRestoringLibraryRef.current = false;
      });
    };

    void loadSavedLibrary();

    return () => {
      isCancelled = true;
    };
  }, [currentUserId, excalidrawAPI, hasLifetimeAccess, supabase]);

  useEffect(() => {
    const flushPendingLibrary = () => {
      const pendingSave = pendingLibraryRef.current;

      if (!pendingSave) {
        return;
      }

      if (librarySaveTimerRef.current) {
        clearTimeout(librarySaveTimerRef.current);
        librarySaveTimerRef.current = null;
      }

      void persistLibrary(pendingSave);
    };

    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        flushPendingLibrary();
      }
    };

    window.addEventListener("pagehide", flushPendingLibrary);
    document.addEventListener("visibilitychange", flushWhenHidden);

    return () => {
      window.removeEventListener("pagehide", flushPendingLibrary);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [persistLibrary]);

  const focusSlide = useCallback(
    (slide: Slide) => {
      if (!excalidrawAPI) {
        return;
      }

      const frame = excalidrawAPI
        .getSceneElements()
        .find((element) => element.id === slide.id);

      if (!frame) {
        return;
      }

      setActiveSlideId(slide.id);
      excalidrawAPI.updateScene({
        appState: {
          selectedElementIds: {},
        },
        captureUpdate: "NEVER",
      });
      excalidrawAPI.scrollToContent(frame, {
        fitToViewport: true,
        viewportZoomFactor: 0.82,
        animate: true,
        duration: 300,
      });
    },
    [excalidrawAPI],
  );

  const addSlide = useCallback(async () => {
    if (!excalidrawAPI) {
      return;
    }

    const sceneElements = excalidrawAPI.getSceneElements();
    const existingFrames = sceneElements.filter(
      (element) => element.type === "frame",
    );
    const rightEdge = existingFrames.reduce(
      (edge, frame) => Math.max(edge, frame.x + frame.width),
      0,
    );
    const x = existingFrames.length ? rightEdge + SLIDE_GAP : 0;
    const y = existingFrames[0]?.y ?? 0;
    const { convertToExcalidrawElements } = await import(
      "@excalidraw/excalidraw"
    );
    const [frame] = convertToExcalidrawElements([
      {
        type: "frame",
        x,
        y,
        width: slideDimensions.width,
        height: slideDimensions.height,
        name: `幻灯片 ${nextSlideNumber}`,
        children: [],
      },
    ]);

    excalidrawAPI.updateScene({
      elements: [...sceneElements, frame],
      appState: {
        selectedElementIds: {},
      },
      captureUpdate: "IMMEDIATELY",
    });
    setActiveSlideId(frame.id);
    excalidrawAPI.scrollToContent(frame, {
      fitToViewport: true,
      viewportZoomFactor: 0.82,
      animate: true,
      duration: 300,
    });
  }, [excalidrawAPI, nextSlideNumber, slideDimensions]);

  const startCameraDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      cameraDragRef.current = {
        offsetX: event.clientX - cameraPosition.x,
        offsetY: event.clientY - cameraPosition.y,
      };
    },
    [cameraPosition],
  );

  const moveCamera = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = cameraDragRef.current;
      if (!drag) return;
      const size = recordingSettings.cameraSize;
      setCameraPosition({
        x: Math.max(0, Math.min(window.innerWidth - size, event.clientX - drag.offsetX)),
        y: Math.max(0, Math.min(window.innerHeight - size, event.clientY - drag.offsetY)),
      });
    },
    [recordingSettings.cameraSize],
  );

  const deleteSlide = useCallback(
    (slideId: string) => {
      if (!excalidrawAPI) {
        return;
      }

      const slideIndex = slides.findIndex((slide) => slide.id === slideId);
      const nextSlide =
        slides[slideIndex + 1] ?? slides[slideIndex - 1] ?? null;
      const remainingElements = excalidrawAPI
        .getSceneElements()
        .filter(
          (element) =>
            element.id !== slideId && element.frameId !== slideId,
        );

      excalidrawAPI.updateScene({
        elements: remainingElements,
        appState: {
          selectedElementIds: {},
        },
        captureUpdate: "IMMEDIATELY",
      });

      if (nextSlide) {
        focusSlide(nextSlide);
      } else {
        setActiveSlideId(null);
      }
    },
    [excalidrawAPI, focusSlide, slides],
  );

  const scrollSlides = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const container = event.currentTarget;

    if (container.scrollWidth <= container.clientWidth) {
      return;
    }

    const distance = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX;

    if (distance === 0) {
      return;
    }

    event.preventDefault();
    container.scrollLeft += distance;
  }, []);

  const showSceneSaveStatus = currentUserId && sceneSaveStatus !== "idle";

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <Excalidraw
        langCode="zh-CN"
        name="WhiteBoard"
        autoFocus
        excalidrawAPI={setExcalidrawAPI}
        onChange={handleSceneChange}
        onLibraryChange={handleLibraryChange}
        initialData={{
          appState: {
            viewBackgroundColor: "#f8f9fa",
          },
        }}
      />

      <AccountMenu onEntitlementChange={setHasLifetimeAccess} />

      {showSceneSaveStatus && (
        <div
          className={`pointer-events-none absolute bottom-4 right-16 z-[20] rounded-xl border px-3 py-2 text-xs font-medium shadow-sm backdrop-blur ${
            sceneSaveStatus === "error"
              ? "border-red-200 bg-red-50/95 text-red-600"
              : "border-zinc-200 bg-white/95 text-zinc-500"
          }`}
        >
          {sceneSaveMessage}
        </div>
      )}

      <RecordingSettingsPanel
        settings={recordingSettings}
        onChange={setRecordingSettings}
        cameraStream={cameraStream}
        microphoneStream={microphoneStream}
        onCameraStreamChange={setCameraStream}
        onMicrophoneStreamChange={setMicrophoneStream}
        previewVideoRef={cameraVideoRef}
      />

      {recordingSettings.cameraEnabled && cameraStream && (
        <div
          className={`absolute z-[16] cursor-move touch-none overflow-hidden bg-transparent shadow-[0_12px_36px_rgba(15,23,42,0.3)] transition-[width,height,border-radius] duration-200 [backface-visibility:hidden] ${
            recordingSettings.cameraShape === "circle"
              ? "rounded-full [clip-path:circle(49.5%)]"
              : recordingSettings.cameraShape === "rounded"
                ? "rounded-3xl"
                : "rounded-md"
          }`}
          style={{
            left: cameraPosition.x,
            top: cameraPosition.y,
            width: recordingSettings.cameraSize,
            height: recordingSettings.cameraSize,
          }}
          onPointerDown={startCameraDrag}
          onPointerMove={moveCamera}
          onPointerUp={() => {
            cameraDragRef.current = null;
          }}
          onPointerCancel={() => {
            cameraDragRef.current = null;
          }}
        >
          <video
            ref={cameraVideoRef}
            autoPlay
            muted
            playsInline
            className="pointer-events-none h-full w-full scale-x-[-1.015] scale-y-[1.015] object-cover [backface-visibility:hidden]"
          />
        </div>
      )}

      <SlideRecorder
        excalidrawAPI={excalidrawAPI}
        slides={slides}
        activeSlideId={activeSlideId}
        onSelectSlide={focusSlide}
        settings={recordingSettings}
        cameraStream={cameraStream}
        microphoneStream={microphoneStream}
        cameraVideoRef={cameraVideoRef}
        cameraLayout={cameraLayout}
        showWatermark={!hasLifetimeAccess}
      />

      <aside
        className="absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center rounded-xl border border-zinc-200/80 bg-white/95 px-2 shadow-[0_3px_14px_rgba(0,0,0,0.1)] backdrop-blur"
        style={{ height: slideNavigationHeight }}
      >
        <div className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-zinc-500">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <rect x="4" y="5" width="16" height="15" rx="2" />
            <path d="M8 3v4M16 3v4M4 10h16" />
          </svg>
          幻灯片
        </div>

        <div
          className="mx-2 w-px shrink-0 bg-zinc-200"
          style={{ height: Math.max(20, slideNavigationHeight - 14) }}
        />

        <div
          onWheel={scrollSlides}
          className="hide-scrollbar flex max-w-[min(70vw,720px)] items-center gap-1.5 overflow-x-auto overflow-y-hidden px-1"
        >
          {slides.map((slide, index) => {
            const isActive = activeSlideId === slide.id;

            return (
              <div key={slide.id} className="group relative shrink-0">
                <button
                  type="button"
                  title={slide.name || `幻灯片 ${index + 1}`}
                  aria-label={`打开幻灯片 ${index + 1}`}
                  onClick={() => focusSlide(slide)}
                  style={{
                    width: slideNavigationButtonSize,
                    height: slideNavigationButtonSize,
                  }}
                  className={`flex items-center justify-center rounded-lg border text-sm font-medium shadow-sm transition ${
                    isActive
                      ? "border-zinc-900 bg-zinc-900 text-white shadow-md"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                  }`}
                >
                  {index + 1}
                </button>

                <button
                  type="button"
                  title={`删除幻灯片 ${index + 1}`}
                  aria-label={`删除幻灯片 ${index + 1}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteSlide(slide.id);
                  }}
                  className="absolute -top-1.5 -right-1.5 flex h-[18px] w-[18px] scale-75 items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-sm transition hover:bg-red-600 group-hover:scale-100 group-hover:opacity-100 focus:scale-100 focus:opacity-100"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 12 12"
                    className="h-2.5 w-2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  >
                    <path d="m3 3 6 6M9 3 3 9" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {slides.length > 0 && (
          <div
            className="mx-2 w-px shrink-0 bg-zinc-200"
            style={{ height: Math.max(20, slideNavigationHeight - 14) }}
          />
        )}

        <button
          type="button"
          title={`新建幻灯片（${slideDimensions.width} × ${slideDimensions.height}）`}
          aria-label="新建幻灯片"
          onClick={addSlide}
          disabled={!excalidrawAPI}
          style={{
            width: slideNavigationButtonSize,
            height: slideNavigationButtonSize,
          }}
          className="flex shrink-0 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white text-zinc-400 transition hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 disabled:cursor-wait disabled:opacity-50"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </aside>
    </div>
  );
}
