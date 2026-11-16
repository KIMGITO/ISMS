// src/components/shared/UnifiedUploader.tsx
import { toUserMessage } from "../../utils/userError";
import { SwitchCamera } from "lucide-react";
import React, { useState, useRef, useEffect } from "react";
import { 
  Upload, Camera, Image as ImageIcon, Link as LinkIcon, X, 
  Check, AlertCircle, RefreshCw as RetryIcon, ZoomIn, Move, Eraser, Undo2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { uploadService } from "../../services/uploadService";
import { MediaType, UploadItem } from "../../services/upload/domain/entities";
import { devicePermissionService } from "../../services/devicePermissionService";
import { Switch } from './Switch';
import { nativePlatformService } from "../../core/native/NativePlatformService";
import { isBackgroundRemovalReady, isRemovalCancelled, removeBackground, RemovalProgress } from "../../services/backgroundRemoval";
import ProgressBar from "./ProgressBar";
import { useOverlay } from "../../hooks/useOverlay";

/** Downloads an image and reports 0 to 100 when the server says how big it is. */
async function fetchBlobWithProgress(url: string, onProgress: (percent: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not get that image (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) {
    const blob = await res.blob();
    onProgress(100);
    return blob;
  }
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(99, Math.round((received / total) * 100)));
  }
  onProgress(100);
  return new Blob(chunks, { type: res.headers.get("content-type") || "image/jpeg" });
}

const formatSeconds = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${s} s`);

/** Phones and tablets have a camera; computers have a webcam. */
function cameraWord(): "Camera" | "Webcam" {
  if (nativePlatformService.isNative()) return "Camera";
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent || "";
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return "Camera";
    // iPadOS reports itself as a Mac but has touch.
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "Camera";
  }
  return "Webcam";
}

// Unsplash presets for Milk Shop theme
const UNSPLASH_PRESETS = [
  { id: "u-1", label: "Fresh Milk Glass", url: "https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&q=80&w=300" },
  { id: "u-2", label: "Dairy Cows Pasture", url: "https://images.unsplash.com/photo-1570042225831-d98fa7577f1e?auto=format&fit=crop&q=80&w=300" },
  { id: "u-3", label: "Vintage Milk Bottle", url: "https://images.unsplash.com/photo-1528498033373-3c6c08e93d79?auto=format&fit=crop&q=80&w=300" },
  { id: "u-4", label: "Artisanal Cheese Board", url: "https://images.unsplash.com/photo-1486299267070-83823f5448dd?auto=format&fit=crop&q=80&w=300" },
  { id: "u-5", label: "Lush Green Meadow", url: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&q=80&w=300" },
  { id: "u-6", label: "Fresh Yogurt Bowl", url: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&q=80&w=300" },
  { id: "u-7", label: "Creamy Yogurt Dessert", url: "https://images.unsplash.com/photo-1571244856341-4f3005953043?auto=format&fit=crop&q=80&w=300" },
  { id: "u-8", label: "Operator Jane", url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150" },
  { id: "u-9", label: "Fresh Dairy Butter Block", url: "https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&q=80&w=300" },
  { id: "u-10", label: "Cow Milking Process", url: "https://images.unsplash.com/photo-1596731046162-9745e69e4ce1?auto=format&fit=crop&q=80&w=300" },
  { id: "u-11", label: "Gourmet Cheese Platter", url: "https://images.unsplash.com/photo-1561043433-aaf687c4ce04?auto=format&fit=crop&q=80&w=300" },
  { id: "u-12", label: "Milk Splash Abstract", url: "https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&q=80&w=300" }
];

// High-quality local index fallback for offline mode or empty API keys
const LOCAL_FALLBACK_CATALOG = [
  { keywords: ["milk", "glass", "bottle"], label: "Fresh Milk Glass", url: "https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&q=80&w=300" },
  { keywords: ["milk", "bottle", "jug"], label: "Vintage Milk Bottle", url: "https://images.unsplash.com/photo-1528498033373-3c6c08e93d79?auto=format&fit=crop&q=80&w=300" },
  { keywords: ["milk", "pour", "splash"], label: "Splash of Fresh Milk", url: "https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&q=80&w=300" },
  { keywords: ["cow", "farm", "pasture", "meadow"], label: "Dairy Cows Pasture", url: "https://images.unsplash.com/photo-1570042225831-d98fa7577f1e?auto=format&fit=crop&q=80&w=300" },
  { keywords: ["meadow", "grass", "green"], label: "Lush Green Meadow", url: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&q=80&w=300" },
  { keywords: ["cheese", "board", "food"], label: "Artisanal Cheese Board", url: "https://images.unsplash.com/photo-1486299267070-83823f5448dd?auto=format&fit=crop&q=80&w=300" },
  { keywords: ["yogurt", "bowl", "berry"], label: "Fresh Yogurt Bowl", url: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&q=80&w=300" },
  { keywords: ["yogurt", "strawberry", "spoon"], label: "Creamy Yogurt Dessert", url: "https://images.unsplash.com/photo-1571244856341-4f3005953043?auto=format&fit=crop&q=80&w=300" },
  { keywords: ["worker", "staff", "person", "operator", "profile", "man", "woman"], label: "Operator Jane", url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150" },
  { keywords: ["worker", "staff", "person", "operator", "profile", "man"], label: "Operator David", url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150" },
  { keywords: ["worker", "staff", "person", "operator", "profile", "woman"], label: "Operator Sarah", url: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=150" },
  { keywords: ["butter", "cream", "bakery"], label: "Fresh Dairy Butter Block", url: "https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&q=80&w=300" },
];

export interface UploaderPreset {
  id: string;
  label: string;
  /** The image that is used when picked. */
  url: string;
  /** A smaller copy for the grid; `url` when missing. */
  thumb?: string;
}

interface UnifiedUploaderProps {
  /** `info.name` is the original file name, useful as a starting alt text. */
  onUploadSuccess: (url: string, info?: { name: string }) => void;
  onUploadError?: (error: string) => void;
  allowedTypes?: MediaType[];
  maxSizeMb?: number;
  /** Suggested crop shape (width / height), e.g. 1 for square. "original" keeps the photo's own shape. */
  cropAspect?: number | "original";
  /**
   * Cropping is optional unless this is set: by default the whole picture is kept and staff can
   * switch "Crop picture" on. Profile pictures set it, because they are always shown as a square.
   */
  cropRequired?: boolean;
  /** Width in pixels of the saved image (never enlarged past the photo's own size). Defaults to 400. */
  outputWidth?: number;
  /** Controlled mode: the parent opens and closes the uploader, and no trigger button is drawn. */
  open?: boolean;
  onClose?: () => void;
  /** Heading of the dialog. */
  title?: string;
  /** Pictures shown in the gallery tab before anything is searched. */
  presetImages?: UploaderPreset[];
  buttonText?: string;
  className?: string;
  triggerElement?: React.ReactNode;
  bucketName?: string;
  /** Offer "Remove background" on the crop screen. On by default for images. */
  allowBackgroundRemoval?: boolean;
}

export default function UnifiedUploader({
  onUploadSuccess,
  onUploadError,
  allowedTypes = ["image", "pdf", "excel", "word", "csv"],
  maxSizeMb = 5,
  cropAspect = 1,
  cropRequired = false,
  buttonText = "Upload File",
  className = "",
  triggerElement,
  bucketName,
  allowBackgroundRemoval = true,
  outputWidth = 400,
  open,
  onClose,
  title = "Unified Media Uploader",
  presetImages,
}: UnifiedUploaderProps) {
  const presets: UploaderPreset[] = presetImages ?? UNSPLASH_PRESETS;
  const controlled = open !== undefined;
  const [isOpenState, setIsOpen] = useState(false);
  const isOpen = controlled ? Boolean(open) : isOpenState;
  const [activeTab, setActiveTab] = useState<"device" | "camera" | "url" | "unsplash">("device");
  const [dragOver, setDragOver] = useState(false);

  // File loading states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [unsplashQuery, setUnsplashQuery] = useState("");
  const [unsplashResults, setUnsplashResults] = useState<UploaderPreset[]>(presets);
  const [unsplashLoading, setUnsplashLoading] = useState(false);
  const [unsplashError, setUnsplashError] = useState("");

  // Search: cached pages, typing pause, and paging until the term has no more images
  const searchCache = useRef<Record<string, { results: any[]; totalPages: number }>>({});
  const debounceTimer = useRef<any>(null);
  const searchSeq = useRef(0);
  const [unsplashPage, setUnsplashPage] = useState(1);
  const [unsplashHasMore, setUnsplashHasMore] = useState(false);
  const [unsplashLoadingMore, setUnsplashLoadingMore] = useState(false);
  const [unsplashMoreError, setUnsplashMoreError] = useState("");
  const unsplashGridRef = useRef<HTMLDivElement>(null);

  // Edit / Crop States
  const [isEditing, setIsEditing] = useState(false);
  const [editImageSrc, setEditImageSrc] = useState<string>("");
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [cropPanX, setCropPanX] = useState(0);
  const [cropPanY, setCropPanY] = useState(0);
  const [compressToggle, setCompressToggle] = useState(true);
  // Off: the whole picture is kept. On: the frame below is cut out, in the shape chosen.
  const [cropOn, setCropOn] = useState(cropRequired);
  const [chosenAspect, setChosenAspect] = useState<number | "original">(cropAspect);

  // Background removal: runs on this device; the original is kept so it can be undone.
  const [bgOriginalSrc, setBgOriginalSrc] = useState<string | null>(null);
  const [bgProgress, setBgProgress] = useState<RemovalProgress | null>(null);
  const [bgError, setBgError] = useState("");
  const [bgModelReady, setBgModelReady] = useState(false);
  const bgAbortRef = useRef<AbortController | null>(null);
  const originalNameRef = useRef("");

  // Upload progress states
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "fetching" | "uploading" | "completed" | "failed" | "queued">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [currentUploadItem, setCurrentUploadItem] = useState<UploadItem | null>(null);

  // Camera states
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("environment");
  const [cameraCount, setCameraCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop gestures states
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const touchStartRef = useRef<{ dist: number; zoom: number } | null>(null);

  // Pre-load network check
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  // Viewport mapping dimensions
  const viewportSize = 240;
  let cropBoxWidth = 180;
  let cropBoxHeight = 180;
  // "original" follows the picture itself, so the whole photo fits the frame at the start.
  // With cropping off the frame is always the whole picture.
  const naturalAspect = imgNaturalSize.w && imgNaturalSize.h ? imgNaturalSize.w / imgNaturalSize.h : 1;
  const shape = cropOn ? (cropRequired ? cropAspect : chosenAspect) : "original";
  const aspect = shape === "original" ? naturalAspect : shape;
  /** Shapes staff can pick when cropping is optional; the suggested one first. */
  const shapeChoices: { value: number | "original"; label: string }[] = [
    { value: "original", label: "Photo's own" },
    { value: 1, label: "Square" },
    { value: 4 / 3, label: "4:3" },
    { value: 16 / 9, label: "Wide 16:9" },
    { value: 3 / 4, label: "Tall 3:4" },
  ];
  if (typeof cropAspect === "number" && !shapeChoices.some((c) => typeof c.value === "number" && Math.abs(c.value - cropAspect) < 0.01)) {
    shapeChoices.splice(1, 0, { value: cropAspect, label: "Suggested" });
  }
  const sameShape = (a: number | "original", b: number | "original") =>
    a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 0.01);

  if (aspect > 1) {
    cropBoxWidth = 210;
    cropBoxHeight = 210 / aspect;
  } else if (aspect < 1) {
    cropBoxHeight = 210;
    cropBoxWidth = 210 * aspect;
  }

  const cropBoxX = (viewportSize - cropBoxWidth) / 2;
  const cropBoxY = (viewportSize - cropBoxHeight) / 2;

  // Image base fit multiplier calculation
  const getBaseScale = () => {
    if (!imgNaturalSize.w || !imgNaturalSize.h) return 1;
    return Math.max(cropBoxWidth / imgNaturalSize.w, cropBoxHeight / imgNaturalSize.h);
  };

  const baseScale = getBaseScale();

  // Load natural dimensions on edit start
  useEffect(() => {
    if (editImageSrc) {
      const img = new Image();
      img.src = editImageSrc;
      img.onload = () => {
        setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        resetFrame();
      };
    }
  }, [editImageSrc]);

  /** Back to the whole picture in the frame (zoom 1, centred). */
  const resetFrame = () => {
    setCropZoom(1);
    setCropPanX(0);
    setCropPanY(0);
  };

  /** Each new picture starts uncropped unless cropping is a must. */
  const startEditing = (src: string) => {
    setCropOn(cropRequired);
    setChosenAspect(cropAspect);
    setEditImageSrc(src);
    setIsEditing(true);
  };

  // Clamping helper to prevent revealing blank crop areas
  const getClampedPan = (px: number, py: number, zoom: number) => {
    if (!imgNaturalSize.w || !imgNaturalSize.h) return { x: 0, y: 0 };
    
    const W = imgNaturalSize.w * baseScale * zoom;
    const H = imgNaturalSize.h * baseScale * zoom;
    const X_center = (viewportSize - W) / 2;
    const Y_center = (viewportSize - H) / 2;

    const X_crop_min = cropBoxX;
    const X_crop_max = cropBoxX + cropBoxWidth;
    const Y_crop_min = cropBoxY;
    const Y_crop_max = cropBoxY + cropBoxHeight;

    const minPanX = X_crop_max - X_center - W;
    const maxPanX = X_crop_min - X_center;
    const minPanY = Y_crop_max - Y_center - H;
    const maxPanY = Y_crop_min - Y_center;

    // In case zoom makes rendering smaller than the crop box, center it
    const clampedX = minPanX > maxPanX ? (minPanX + maxPanX) / 2 : Math.min(maxPanX, Math.max(minPanX, px));
    const clampedY = minPanY > maxPanY ? (minPanY + maxPanY) / 2 : Math.min(maxPanY, Math.max(minPanY, py));

    return { x: clampedX, y: clampedY };
  };

  // Pointer drag events for mouse & single-touch positioning
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!cropOn) return;
    if (e.pointerType === "touch" && touchStartRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: cropPanX,
      panY: cropPanY
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const nextPan = getClampedPan(dragStartRef.current.panX + dx, dragStartRef.current.panY + dy, cropZoom);
      setCropPanX(nextPan.x);
      setCropPanY(nextPan.y);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragStartRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      dragStartRef.current = null;
    }
  };

  // Wheel zoom (Desktop)
  const handleWheel = (e: React.WheelEvent) => {
    if (!cropOn) return;
    e.preventDefault();
    const zoomDelta = -e.deltaY * 0.003;
    const nextZoom = Math.min(5, Math.max(1, cropZoom + zoomDelta));
    
    // Adjust pan offsets to keep centered scaling neat
    const nextPan = getClampedPan(cropPanX, cropPanY, nextZoom);
    setCropZoom(nextZoom);
    setCropPanX(nextPan.x);
    setCropPanY(nextPan.y);
  };

  // Pinch-to-zoom touch events (Mobile)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (cropOn && e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      touchStartRef.current = { dist, zoom: cropZoom };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartRef.current) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const factor = dist / touchStartRef.current.dist;
      const nextZoom = Math.min(5, Math.max(1, touchStartRef.current.zoom * factor));
      
      const nextPan = getClampedPan(cropPanX, cropPanY, nextZoom);
      setCropZoom(nextZoom);
      setCropPanX(nextPan.x);
      setCropPanY(nextPan.y);
    }
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
  };

  // Cleanup camera streams
  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  // Back camera first (products, receipts); the switch button flips to the selfie camera.
  const startCamera = async (facing: "user" | "environment" = cameraFacing) => {
    setCameraError("");
    setCameraFacing(facing);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(true);
    try {
      const permission = await devicePermissionService.request("camera");
      if (permission === "denied") {
        throw new Error("Camera permission denied. Please grant permission to continue.");
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 1280 }, facingMode: { ideal: facing } }
        });
      } catch {
        // Laptops with one camera may refuse the size or the facing; take whatever camera there is.
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      navigator.mediaDevices.enumerateDevices?.()
        .then(devices => setCameraCount(devices.filter(d => d.kind === "videoinput").length))
        .catch(() => {});
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Camera access failed:", err);
      setCameraError(toUserMessage(err, "Failed to access camera stream. Grant camera permissions."));
      setIsCameraActive(false);
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    try {
      // Square centre of the frame, as the preview shows it, without stretching.
      const side = Math.min(video.videoWidth, video.videoHeight);
      const out = Math.min(side, 1080);
      const canvas = document.createElement("canvas");
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        if (cameraFacing === "user") {
          // The selfie preview is mirrored; keep the photo the way the person saw it.
          ctx.translate(out, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, out, out);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const capturedFile = new File([blob], `avatar_capture_${Date.now()}.jpg`, {
              type: "image/jpeg"
            });
            stopCamera();
            handleLoadedFile(capturedFile);
          }
        }, "image/jpeg", 0.95);
      }
    } catch (err) {
      console.error("Camera capture failed:", err);
    }
  };

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleLoadedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleLoadedFile(e.target.files[0]);
    }
  };

  // Determine media category
  const mapMimeToCategory = (mime: string): MediaType => {
    if (mime.startsWith("image/")) return "image";
    if (mime.includes("pdf")) return "pdf";
    if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) return "excel";
    if (mime.includes("word") || mime.includes("officedocument")) return "word";
    if (mime.startsWith("video/")) return "video";
    return "pdf";
  };

  // Load selected file
  const handleLoadedFile = (file: File) => {
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > maxSizeMb) {
      setErrorMessage(`File is too large (${sizeMb.toFixed(1)}MB). Max size is ${maxSizeMb}MB.`);
      return;
    }

    const type = mapMimeToCategory(file.type);
    if (!allowedTypes.includes(type)) {
      setErrorMessage(`Unsupported file format. Allowed: ${allowedTypes.join(", ")}`);
      return;
    }

    setErrorMessage("");
    setSelectedFile(file);
    originalNameRef.current = file.name;

    if (type === "image") {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) startEditing(e.target.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      triggerUpload(file, type);
    }
  };

  // Trigger high-quality Canvas crop with correct pixel matching preview
  const handleCropSave = async () => {
    setIsEditing(false);
    if (!selectedFile) return;

    try {
      const croppedBlob = await cropImageCanvas(editImageSrc, cropZoom, cropPanX, cropPanY);
      const processedFile = new File(
        [croppedBlob], 
        selectedFile.name.replace(/\.[^/.]+$/, ".webp"), 
        { type: "image/webp" }
      );
      
      triggerUpload(processedFile, "image");
    } catch (err) {
      console.warn("Crop failed, performing raw file upload fallback", err);
      triggerUpload(selectedFile, "image");
    }
  };

  // Core high-fidelity image cropping math
  const cropImageCanvas = (src: string, zoom: number, panX: number, panY: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      img.onload = () => {
        try {
          // Natural image width/height at viewport scale
          const W = img.naturalWidth * baseScale * zoom;
          const H = img.naturalHeight * baseScale * zoom;
          const X_center = (viewportSize - W) / 2;
          const Y_center = (viewportSize - H) / 2;

          const X_img_min = X_center + panX;
          const Y_img_min = Y_center + panY;

          const dx = cropBoxX - X_img_min;
          const dy = cropBoxY - Y_img_min;

          const S = baseScale * zoom;
          const x_nat = dx / S;
          const y_nat = dy / S;
          const w_nat = cropBoxWidth / S;
          const h_nat = cropBoxHeight / S;

          // Never enlarge past the photo's own pixels.
          const targetWidth = Math.max(1, Math.min(outputWidth, Math.round(w_nat)));
          const targetHeight = Math.max(1, Math.round(targetWidth / aspect));

          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject("Canvas 2D Context empty");

          // Draw slice from natural image onto canvas
          ctx.drawImage(img, x_nat, y_nat, w_nat, h_nat, 0, 0, targetWidth, targetHeight);

          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject("Blob generation failed");
          }, "image/webp", 0.90);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = (e) => reject(e);
    });
  };

  // Standard url loader
  const handleUrlLoad = async () => {
    const link = urlInput.trim().replace(/^http:\/\//i, "https://");
    if (!link) return;
    if (!/^https:\/\/\S+$/i.test(link)) {
      setErrorMessage("Paste a full link starting with https://");
      return;
    }
    await loadRemoteImage(link, link.split("/").pop()?.split("?")[0] || "linked image");
  };

  /**
   * Downloads a picture from a link (or the gallery) so it can be cropped, cut out and stored
   * here. Some sites refuse to hand their pictures to apps; then the link itself is used.
   */
  const loadRemoteImage = async (url: string, name: string) => {
    setErrorMessage("");
    setUploadStatus("fetching");
    setUploadProgress(0);
    try {
      const blob = await fetchBlobWithProgress(url, setUploadProgress);
      const type = mapMimeToCategory(blob.type);
      const file = new File([blob], name.includes(".") ? name : `${name}.jpg`, { type: blob.type || "image/jpeg" });
      setSelectedFile(file);
      originalNameRef.current = name;
      if (type === "image") {
        setUploadStatus("idle");
        startEditing(URL.createObjectURL(blob));
      } else {
        triggerUpload(file, type);
      }
    } catch (err) {
      console.warn("Could not download the picture; using its link instead.", err);
      originalNameRef.current = name;
      finishWith(url);
    }
  };

  // Upload executing routine
  const triggerUpload = async (file: File, type: MediaType, fallbackUrl?: string) => {
    setUploadStatus("uploading");
    setUploadProgress(10);
    setErrorMessage("");

    const item: UploadItem = {
      id: `up-${Date.now()}`,
      name: file.name,
      size: file.size,
      type,
      status: "pending",
      progress: 0,
      file: file.size > 0 ? file : undefined,
      url: fallbackUrl,
      retryCount: 0,
      timestamp: Date.now()
    };

    setCurrentUploadItem(item);

    try {
      const resultUrl = await uploadService.execute(
        item,
        { compress: compressToggle, crop: false, bucketName, maxDimension: Math.max(1024, outputWidth) },
        (progress) => setUploadProgress((p) => Math.max(p, progress))
      );

      if (item.status === "queued_offline") {
        setUploadStatus("queued");
      } else {
        setUploadStatus("completed");
        setUploadProgress(100);
        setTimeout(() => finishWith(resultUrl), 600);
      }
    } catch (err: any) {
      console.error("Upload failed:", err);
      setUploadStatus("failed");
      setErrorMessage(toUserMessage(err, "Upload did not finish."));
      onUploadError?.(toUserMessage(err, "Upload failed"));
    }
  };

  /** Hands the finished picture to the caller and closes. */
  const finishWith = (url: string) => {
    onUploadSuccess(url, { name: originalNameRef.current });
    closeUploader();
  };

  const closeUploader = () => {
    resetState();
    if (controlled) onClose?.();
    else setIsOpen(false);
  };

  // The phone's back button closes the uploader (and stops any work) instead of leaving the screen.
  useOverlay(isOpen, closeUploader, "dialog");

  const handleRetry = async () => {
    if (!currentUploadItem) return;
    triggerUpload(currentUploadItem.file || new File([], currentUploadItem.name), currentUploadItem.type, currentUploadItem.url);
  };

  const resetState = () => {
    setSelectedFile(null);
    setUrlInput("");
    setUnsplashQuery("");
    setUnsplashResults(presets);
    setUnsplashHasMore(false);
    setUnsplashPage(1);
    setUnsplashMoreError("");
    searchSeq.current++;
    setIsEditing(false);
    setUploadProgress(0);
    setUploadStatus("idle");
    setErrorMessage("");
    setUnsplashError("");
    setCurrentUploadItem(null);
    cancelBackground();
    setBgOriginalSrc(null);
    setBgError("");
    originalNameRef.current = "";
    stopCamera();
  };

  useEffect(() => {
    if (isEditing && allowBackgroundRemoval) isBackgroundRemovalReady().then(setBgModelReady);
  }, [isEditing, allowBackgroundRemoval]);

  /** Stops a running removal at once; the model's memory is given back. */
  const cancelBackground = () => {
    bgAbortRef.current?.abort();
    bgAbortRef.current = null;
    setBgProgress(null);
  };

  // Closing the app screen mid-removal must stop the work too.
  useEffect(() => () => bgAbortRef.current?.abort(), []);

  const handleRemoveBackground = async () => {
    if (!editImageSrc || bgAbortRef.current) return;
    const controller = new AbortController();
    bgAbortRef.current = controller;
    const source = editImageSrc;
    setBgError("");
    setBgProgress({ stage: bgModelReady ? "preparing" : "downloading", percent: 0 });
    try {
      const cutout = await removeBackground(
        source,
        (p) => { if (!controller.signal.aborted) setBgProgress(p); },
        { aspect: shape === "original" ? undefined : shape, signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setBgOriginalSrc(source);
      setEditImageSrc(cutout);
      setBgModelReady(true);
    } catch (err) {
      if (controller.signal.aborted || isRemovalCancelled(err)) return;
      console.error("Background removal failed:", err);
      setBgError(toUserMessage(err, "Could not remove the background on this device. Try again, or use a smaller photo."));
    } finally {
      if (bgAbortRef.current === controller) {
        bgAbortRef.current = null;
        setBgProgress(null);
      }
    }
  };

  const handleUndoBackground = () => {
    if (!bgOriginalSrc) return;
    setEditImageSrc(bgOriginalSrc);
    setBgOriginalSrc(null);
  };

  const bgLabel = !bgProgress
    ? ""
    : bgProgress.stage === "downloading"
      ? bgModelReady ? "Loading the remover" : "Downloading the remover"
      : bgProgress.stage === "preparing"
        ? "Starting the remover"
        : "Removing background";
  const bgDetail = !bgProgress
    ? ""
    : bgProgress.stage === "working"
      ? `Step 2 of 2 · ${bgProgress.secondsLeft ? `about ${formatSeconds(bgProgress.secondsLeft)} left` : "finishing up"}`
      : `Step 1 of 2${bgProgress.stage === "downloading" && !bgModelReady ? " · first time only" : ""}`;

  const UNSPLASH_PER_PAGE = 24;

  /**
   * Searches Unsplash for `rawQuery`. Page 1 replaces the results; later pages are added below.
   * Only the newest search may change the results, so a slow earlier reply cannot overwrite them.
   */
  const searchUnsplash = async (rawQuery: string, page = 1) => {
    const query = rawQuery.trim().toLowerCase();
    const seq = page === 1 ? ++searchSeq.current : searchSeq.current;
    if (!query) {
      setUnsplashResults(presets);
      setUnsplashError("");
      setUnsplashHasMore(false);
      setUnsplashPage(1);
      setUnsplashLoading(false);
      return;
    }

    const accessKey = import.meta.env?.VITE_UNSPLASH_ACCESS_KEY || "";
    if (!accessKey || accessKey === "your-unsplash-access-key" || !isOnline) {
      if (page === 1) fallbackLocalSearch(query);
      setUnsplashHasMore(false);
      setUnsplashLoading(false);
      return;
    }

    const show = (results: any[], totalPages: number) => {
      if (seq !== searchSeq.current) return;
      setUnsplashResults((prev) => {
        if (page === 1) return results;
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...results.filter((r) => !seen.has(r.id))];
      });
      setUnsplashPage(page);
      setUnsplashHasMore(page < totalPages && results.length > 0);
    };

    const key = `${query}|${page}`;
    if (searchCache.current[key]) {
      const hit = searchCache.current[key];
      show(hit.results, hit.totalPages);
      setUnsplashError("");
      setUnsplashLoading(false);
      return;
    }

    if (page === 1) {
      setUnsplashLoading(true);
      setUnsplashError("");
    } else {
      setUnsplashLoadingMore(true);
      setUnsplashMoreError("");
    }

    try {
      const res = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${UNSPLASH_PER_PAGE}&page=${page}`,
        { headers: { Authorization: `Client-ID ${accessKey}` } }
      );
      if (!res.ok) throw new Error(res.status === 403 ? "Unsplash's hourly limit was reached. Try again later." : "Unsplash did not answer.");
      const data = await res.json();
      const results = (data?.results || []).map((item: any) => ({
        id: item.id,
        label: item.alt_description || item.description || `${query} photo`,
        url: outputWidth > 400 ? item.urls.regular || item.urls.small : item.urls.small || item.urls.regular,
        thumb: item.urls.small || item.urls.thumb,
      }));
      const totalPages = Number(data?.total_pages) || 0;
      searchCache.current[key] = { results, totalPages };
      show(results, totalPages);
    } catch (err: any) {
      if (seq !== searchSeq.current) return;
      if (page === 1) {
        console.warn("Unsplash search failed; showing the built-in images.", err);
        fallbackLocalSearch(query);
        setUnsplashHasMore(false);
      } else {
        setUnsplashMoreError(err?.message || "Could not load more images.");
      }
    } finally {
      if (seq === searchSeq.current) {
        setUnsplashLoading(false);
        setUnsplashLoadingMore(false);
      }
    }
  };

  const handleUnsplashSearch = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    void searchUnsplash(unsplashQuery, 1);
  };

  // Searches by itself once typing pauses.
  const handleQueryChange = (val: string) => {
    setUnsplashQuery(val);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => void searchUnsplash(val, 1), 400);
  };

  const loadMoreUnsplash = () => {
    if (!unsplashHasMore || unsplashLoading || unsplashLoadingMore || unsplashMoreError) return;
    void searchUnsplash(unsplashQuery, unsplashPage + 1);
  };

  // Near the bottom of the grid, fetch the next page.
  const onUnsplashScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) loadMoreUnsplash();
  };

  // A page that does not fill the grid cannot be scrolled, so keep loading until it does.
  useEffect(() => {
    const el = unsplashGridRef.current;
    if (el && unsplashHasMore && !unsplashLoadingMore && el.scrollHeight <= el.clientHeight + 4) loadMoreUnsplash();
  }, [unsplashResults, unsplashHasMore, unsplashLoadingMore]);

  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  }, []);

  const fallbackLocalSearch = (query: string) => {
    const q = query.toLowerCase();
    const scored = LOCAL_FALLBACK_CATALOG.map(item => {
      let score = 0;
      item.keywords.forEach(kw => {
        if (q.includes(kw)) score += 2;
      });
      return { item, score };
    }).filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => ({
        id: `local-${x.item.label.replace(/\s+/g, '-').toLowerCase()}-${Math.random().toString(36).substring(2, 5)}`,
        label: x.item.label,
        url: x.item.url
      }));

    if (scored.length > 0) {
      setUnsplashResults(scored.slice(0, 12));
    } else {
      setUnsplashResults([]);
    }
  };

  // Absolute viewport dimensions of rendering image
  const imgW = imgNaturalSize.w * baseScale * cropZoom;
  const imgH = imgNaturalSize.h * baseScale * cropZoom;
  const initLeft = (viewportSize - imgW) / 2;
  const initTop = (viewportSize - imgH) / 2;
  const renderLeft = initLeft + cropPanX;
  const renderTop = initTop + cropPanY;

  return (
    <>
      {controlled ? null : triggerElement ? (
        <div onClick={() => setIsOpen(true)} className="cursor-pointer">
          {triggerElement}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={`py-2 px-3 bg-app-bg hover:bg-app-card border border-app-border text-app-text font-black rounded-xl transition cursor-pointer text-[9px] uppercase tracking-wider flex items-center gap-1.5 ${className}`}
        >
          <Upload size={11} className="text-brand-500" />
          <span>{buttonText}</span>
        </button>
      )}

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 bg-app-text/80 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-app-card border border-app-border rounded-[28px] max-w-md w-full p-6 shadow-2xl relative space-y-4 text-app-text"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-app-border/40 pb-2.5">
                <div className="flex items-center gap-2">
                  <Upload size={16} className="text-brand-500" />
                  <h3 className="text-xs font-extrabold text-app-text uppercase tracking-wider font-display">{title}</h3>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={closeUploader}
                  className="p-1.5 hover:bg-app-bg text-app-text-muted hover:text-app-text rounded-xl transition cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Main Content Area */}
              {isEditing ? (
                /* GESTURE CROP SCREEN */
                <div className="flex flex-col gap-4">
                  <div>
                    <h4 className="text-[10px] font-black text-app-text uppercase tracking-wider text-center">
                      {cropOn ? "Position and zoom" : "Check your picture"}
                    </h4>
                    <p className="text-[8.5px] text-app-text-muted text-center mt-0.5">
                      {cropOn ? "Drag to move · Pinch or scroll wheel to zoom" : "The whole picture is kept. Switch on cropping below to cut part of it."}
                    </p>
                  </div>
                  
                  {/* Interactive Viewport Box */}
                  <div 
                    ref={containerRef}
                    onWheel={handleWheel}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    style={{
                      width: `${viewportSize}px`,
                      height: `${viewportSize}px`,
                      // A checkerboard shows where the picture is now see-through.
                      ...(bgOriginalSrc ? { background: "repeating-conic-gradient(#d4d4d8 0 25%, #ffffff 0 50%) 0 0 / 16px 16px" } : {}),
                    }}
                    className={`relative mx-auto rounded-3xl overflow-hidden bg-app-text/5 border-2 border-app-border flex items-center justify-center touch-none select-none ${cropOn ? "cursor-move" : ""}`}
                  >
                    {bgProgress && (
                      <div className="absolute inset-0 z-10 flex items-end bg-app-bg/60 p-3" aria-live="polite">
                        <div className="w-full rounded-xl bg-app-card/95 p-2.5 shadow-lg">
                          <ProgressBar size="compact" percent={bgProgress.percent ?? 0} label={bgLabel} detail={bgDetail} />
                        </div>
                      </div>
                    )}
                    {/* Rendered Absolute Image */}
                    {editImageSrc && (
                      <img
                        src={editImageSrc}
                        alt="Crop target"
                        style={{
                          width: `${imgW}px`,
                          height: `${imgH}px`,
                          left: `${renderLeft}px`,
                          top: `${renderTop}px`,
                          position: "absolute"
                        }}
                        className="max-w-none max-h-none pointer-events-none select-none"
                      />
                    )}

                    {/* Dark Mask Overlay for Outside Bounding Box */}
                    <div 
                      style={{
                        position: "absolute",
                        inset: 0,
                        boxShadow: `0 0 0 9999px rgba(15, 23, 42, 0.75)`
                      }}
                      className="pointer-events-none"
                    />

                    {/* Dashed Bounding Selector: only when cutting part of the picture */}
                    {cropOn && <div 
                      style={{
                        position: "absolute",
                        left: `${cropBoxX}px`,
                        top: `${cropBoxY}px`,
                        width: `${cropBoxWidth}px`,
                        height: `${cropBoxHeight}px`,
                        boxShadow: "0 0 0 2px var(--color-brand-500)"
                      }}
                      className="border-2 border-dashed border-app-bg/60 pointer-events-none rounded-2xl shadow-lg"
                    />}
                  </div>

                  {cropOn && (
                    <div className="flex items-center justify-between text-[8px] text-app-text-muted px-6">
                      <span className="flex items-center gap-1"><ZoomIn size={10} /> Zoom: {cropZoom.toFixed(1)}x</span>
                      <span className="flex items-center gap-1"><Move size={10} /> Drag to move</span>
                    </div>
                  )}

                  {/* Cropping: a must only for profile pictures, otherwise staff choose */}
                  {cropRequired ? (
                    <p className="text-[8.5px] text-app-text-muted text-center px-2">
                      Profile pictures are always shown as a {cropAspect === 1 ? "square" : "fixed shape"}, so this one is cropped.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2 py-2 border-t border-app-border/40 px-2">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <span className="font-extrabold text-app-text text-[10px] block">Crop picture</span>
                          <span className="text-[8px] text-app-text-muted font-medium block mt-0.5">
                            {cropOn ? "Only the part inside the frame is saved." : "Off: the whole picture is saved as it is."}
                          </span>
                        </div>
                        <Switch
                          checked={cropOn}
                          onChange={(on) => { setCropOn(on); resetFrame(); }}
                          ariaLabel="Crop picture"
                        />
                      </div>
                      {cropOn && (
                        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Crop shape">
                          {shapeChoices.map((choice) => {
                            const picked = sameShape(chosenAspect, choice.value);
                            return (
                              <button
                                key={choice.label}
                                type="button"
                                role="radio"
                                aria-checked={picked}
                                onClick={() => { setChosenAspect(choice.value); resetFrame(); }}
                                className={`px-2.5 py-1 rounded-lg border text-[9px] font-black uppercase tracking-wider transition cursor-pointer ${picked ? "bg-brand-500 text-app-bg border-brand-500" : "bg-app-bg border-app-border hover:bg-app-card"}`}
                              >
                                {choice.label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Background removal: free, on this device */}
                  {allowBackgroundRemoval && (
                    <div className="flex flex-col gap-2 py-2 border-t border-app-border/40 px-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-extrabold text-app-text text-[10px] block">Remove background</span>
                          <span className="text-[8px] text-app-text-muted font-medium block mt-0.5">
                            {bgOriginalSrc
                              ? "Done. The product now sits on a clear background."
                              : bgModelReady
                                ? "Cuts the product out of its photo. Free, on this device."
                                : "Free, on this device. First use downloads it once (about 45 MB on a computer)."}
                          </span>
                        </div>
                        {bgOriginalSrc ? (
                          <button
                            type="button"
                            onClick={handleUndoBackground}
                            className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-app-bg border border-app-border hover:bg-app-card text-[9px] font-black uppercase tracking-wider rounded-lg transition cursor-pointer"
                          >
                            <Undo2 size={11} /> Undo
                          </button>
                        ) : bgProgress ? (
                          <button
                            type="button"
                            onClick={cancelBackground}
                            className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-app-bg border border-app-border hover:bg-app-card text-[9px] font-black uppercase tracking-wider rounded-lg transition cursor-pointer"
                          >
                            <X size={11} /> Cancel
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleRemoveBackground}
                            className="shrink-0 flex items-center gap-1 px-3 py-1.5 bg-brand-500/10 text-brand-500 hover:bg-brand-500/20 text-[9px] font-black uppercase tracking-wider rounded-lg transition cursor-pointer"
                          >
                            <Eraser size={11} /> Remove
                          </button>
                        )}
                      </div>
                      {bgError && (
                        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600">
                          <AlertCircle size={14} className="mt-0.5 shrink-0" />
                          <span className="min-w-0 flex-1">{bgError}</span>
                          <button type="button" onClick={handleRemoveBackground} className="shrink-0 font-bold underline cursor-pointer">
                            Try again
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Compression Options */}
                  <div className="flex items-center justify-between gap-4 py-2 border-t border-app-border/40 px-2">
                    <div>
                      <span className="font-extrabold text-app-text text-[10px] block">WebP Lossless Compression</span>
                      <span className="text-[8px] text-app-text-muted font-medium block mt-0.5">Optimizes loading speed & storage size</span>
                    </div>
                    <Switch checked={compressToggle} onChange={setCompressToggle} ariaLabel="WebP lossless compression" />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        cancelBackground();
                        setBgError("");
                        setBgOriginalSrc(null);
                        setIsEditing(false);
                      }}
                      className="flex-1 py-2 bg-app-bg border border-app-border hover:bg-app-card text-[10px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleCropSave}
                      disabled={Boolean(bgProgress)}
                      className="flex-1 py-2 disabled:opacity-50 bg-brand-500 hover:bg-brand-600 text-app-bg text-[10px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
                    >
                      {cropOn ? "Crop & Save" : "Save"}
                    </button>
                  </div>
                </div>
              ) : uploadStatus !== "idle" ? (
                /* PROGRESS & RETRY SCREEN */
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  {(uploadStatus === "uploading" || uploadStatus === "fetching") && (
                    <div className="w-full max-w-xs py-4" aria-live="polite">
                      <ProgressBar
                        percent={uploadProgress}
                        label={uploadStatus === "fetching" ? "Getting the picture" : "Uploading"}
                        detail={
                          uploadStatus === "fetching"
                            ? "Downloading it so you can crop it"
                            : uploadProgress < 60
                              ? "Making it web-sized"
                              : "Sending it to your shop's storage"
                        }
                      />
                    </div>
                  )}

                  {uploadStatus === "completed" && (
                    <>
                      <div className="w-full max-w-xs py-2">
                        <ProgressBar percent={100} label="Uploaded" />
                      </div>
                      <div className="flex items-center gap-1.5 text-success">
                        <Check size={18} />
                        <h4 className="text-[11px] font-black uppercase tracking-wider">Upload complete</h4>
                      </div>
                    </>
                  )}

                  {uploadStatus === "queued" && (
                    <>
                      <div className="p-4 bg-brand-500/15 text-brand-500 rounded-full">
                        <Check size={28} />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-black uppercase tracking-wider text-brand-500">Stashed Offline</h4>
                        <p className="text-[9px] text-app-text-muted mt-1.5 font-medium px-4">
                          File cached successfully. It will automatically upload to Supabase when returning online.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={closeUploader}
                        className="py-2 px-4 bg-brand-500 text-app-bg text-[10px] font-black uppercase tracking-wider rounded-xl cursor-pointer"
                      >
                        Got It
                      </button>
                    </>
                  )}

                  {uploadStatus === "failed" && (
                    <>
                      <div className="p-4 bg-error/15 text-error rounded-full">
                        <AlertCircle size={28} />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-black uppercase tracking-wider text-error">Upload Failed</h4>
                        <p className="text-[9px] text-error font-mono mt-1 px-4 leading-tight">{errorMessage}</p>
                      </div>
                      <div className="flex gap-2 w-full px-8 mt-2">
                        <button
                          type="button"
                          onClick={resetState}
                          className="flex-1 py-2 bg-app-bg border border-app-border text-[9px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleRetry}
                          className="flex-1 py-2 bg-brand-500 text-app-bg text-[9px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <RetryIcon size={10} />
                          <span>Retry</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                /* MAIN INPUT SOURCE TABS */
                <div className="space-y-4">
                  {/* Tab list header */}
                  <div className="flex bg-app-bg p-1 rounded-xl border border-app-border/40 gap-1 text-[9.5px] font-black uppercase tracking-wider">
                    <button
                      type="button"
                      onClick={() => { stopCamera(); setActiveTab("device"); }}
                      className={`flex-1 py-1.5 rounded-lg text-center transition cursor-pointer ${
                        activeTab === "device" ? "bg-brand-500 text-app-bg font-black" : "text-app-text-muted hover:text-app-text"
                      }`}
                    >
                      File Drive
                    </button>
                    <button
                      type="button"
                      onClick={() => { startCamera(); setActiveTab("camera"); }}
                      className={`flex-1 py-1.5 rounded-lg text-center transition cursor-pointer ${
                        activeTab === "camera" ? "bg-brand-500 text-app-bg font-black" : "text-app-text-muted hover:text-app-text"
                      }`}
                    >
                      {cameraWord()}
                    </button>
                    <button
                      type="button"
                      onClick={() => { stopCamera(); setActiveTab("url"); }}
                      className={`flex-1 py-1.5 rounded-lg text-center transition cursor-pointer ${
                        activeTab === "url" ? "bg-brand-500 text-app-bg font-black" : "text-app-text-muted hover:text-app-text"
                      }`}
                    >
                      Link
                    </button>
                    <button
                      type="button"
                      onClick={() => { stopCamera(); setActiveTab("unsplash"); }}
                      className={`flex-1 py-1.5 rounded-lg text-center transition cursor-pointer ${
                        activeTab === "unsplash" ? "bg-brand-500 text-app-bg font-black" : "text-app-text-muted hover:text-app-text"
                      }`}
                    >
                      Unsplash
                    </button>
                  </div>

                  {errorMessage && (
                    <div className="p-2.5 bg-error/5 border border-error/10 rounded-xl text-error text-[9px] font-semibold text-center leading-tight">
                      {errorMessage}
                    </div>
                  )}

                  {/* Device Browse Tab */}
                  {activeTab === "device" && (
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`border-2 border-dashed rounded-3xl p-6 flex flex-col items-center justify-center text-center gap-3 transition ${
                        dragOver ? "border-brand-500 bg-brand-500/5 scale-[1.02]" : "border-app-border bg-app-bg/50 hover:bg-app-bg"
                      }`}
                    >
                      <div className="p-3 bg-brand-500/10 text-brand-500 rounded-2xl">
                        <Upload size={22} />
                      </div>
                      <div>
                        <span className="text-xs font-extrabold text-app-text block">Drag & Drop files here</span>
                        <span className="text-[8.5px] text-app-text-muted font-medium block mt-1">
                          {allowedTypes.length === 1 && allowedTypes[0] === "image" ? "PNG, JPG or WebP photos" : "PNG, JPG, PDF, CSV, Excel or Word"} up to {maxSizeMb}MB
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="py-1.5 px-3.5 bg-app-border hover:bg-app-border/80 text-app-text text-[9px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
                      >
                        Browse Files
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileChange}
                        className="hidden"
                        accept={allowedTypes.map(t => {
                          if (t === "image") return "image/*";
                          if (t === "pdf") return ".pdf";
                          if (t === "excel") return ".xls,.xlsx,.csv";
                          if (t === "word") return ".doc,.docx";
                          return "*";
                        }).join(",")}
                      />
                    </div>
                  )}

                  {/* Webcam capture Tab */}
                  {activeTab === "camera" && (
                    <div className="flex flex-col items-center gap-3">
                      {isCameraActive ? (
                        <>
                          <div className="relative w-48 h-48 rounded-2xl overflow-hidden border border-brand-500 bg-app-text shadow-md">
                            <video
                              ref={videoRef}
                              autoPlay
                              playsInline
                              className={`w-full h-full object-cover ${cameraFacing === "user" ? "scale-x-[-1]" : ""}`}
                            />
                            {cameraCount !== 1 && (
                              <button
                                type="button"
                                onClick={() => startCamera(cameraFacing === "user" ? "environment" : "user")}
                                aria-label={cameraFacing === "user" ? "Use the back camera" : "Use the front camera"}
                                title={cameraFacing === "user" ? "Use the back camera" : "Use the front camera"}
                                className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-black/55 text-white flex items-center justify-center cursor-pointer"
                              >
                                <SwitchCamera size={18} />
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={capturePhoto}
                            className="w-full py-2 bg-brand-500 hover:bg-brand-600 text-app-bg text-[10px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
                          >
                            Capture Frame
                          </button>
                        </>
                      ) : (
                        <div className="py-8 text-center text-app-text-muted space-y-3">
                          <Camera size={26} className="mx-auto text-brand-500/60" />
                          <p className="text-[10px] px-8 font-medium leading-relaxed">
                            {cameraError || `The ${cameraWord().toLowerCase()} is off. Allow access to take a photo.`}
                          </p>
                          <button
                            type="button"
                            onClick={() => startCamera()}
                            className="py-1.5 px-4 bg-brand-500 text-app-bg text-[9px] font-black uppercase tracking-wider rounded-xl cursor-pointer"
                          >
                            Activate Camera Feed
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* URL Paste Tab */}
                  {activeTab === "url" && (
                    <div className="space-y-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[8.5px] font-black text-app-text-muted uppercase tracking-wider block">Paste Media / Document URL</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            placeholder="https://example.com/assets/avatar.jpg"
                            className="flex-1 bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-brand-500 focus:outline-none text-[11px] font-mono"
                          />
                          <button
                            type="button"
                            onClick={handleUrlLoad}
                            className="py-2 px-3 bg-brand-500 hover:bg-brand-600 text-app-bg font-black rounded-xl text-[9px] uppercase tracking-wider transition cursor-pointer shrink-0"
                          >
                            Load URL
                          </button>
                        </div>
                      </div>
                      <p className="text-[8px] text-app-text-muted leading-normal">
                        Import documents directly by feeding remote HTTPS locations. Note: CORS restrictions might redirect uploads as external links.
                      </p>
                    </div>
                  )}

                  {/* Unsplash Search & Gallery Tab */}
                  {activeTab === "unsplash" && (
                    <div className="space-y-3">
                      {/* Search Input */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={unsplashQuery}
                          onChange={(e) => handleQueryChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleUnsplashSearch();
                            }
                          }}
                          placeholder="Search milk shop assets..."
                          className="flex-1 bg-app-bg text-app-text px-3 py-1.5 rounded-xl border border-app-border focus:border-brand-500 focus:outline-none text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={handleUnsplashSearch}
                          disabled={unsplashLoading}
                          className="py-1.5 px-3 bg-app-border hover:bg-brand-500/10 disabled:opacity-50 text-app-text font-black rounded-xl text-[9px] uppercase tracking-wider transition cursor-pointer shrink-0 flex items-center gap-1"
                        >
                          <span>{unsplashLoading ? "Finding…" : "Find"}</span>
                        </button>
                      </div>

                      {/* Display states (Loading, Empty, Error, Grid) */}
                      {unsplashLoading ? (
                        /* SKELETON LOADER GRID */
                        <div className="grid grid-cols-3 gap-2">
                          {Array.from({ length: 12 }).map((_, i) => (
                            <div 
                              key={i} 
                              className="relative w-full h-0 pb-[100%] rounded-xl bg-app-border/40 border border-app-border/10"
                            />
                          ))}
                        </div>
                      ) : unsplashError ? (
                        /* ERROR STATE */
                        <div className="py-6 text-center space-y-2">
                          <AlertCircle size={20} className="mx-auto text-error" />
                          <p className="text-[10px] text-app-text-muted">{unsplashError}</p>
                          <button
                            type="button"
                            onClick={handleUnsplashSearch}
                            className="py-1 px-3 bg-app-border text-app-text rounded-lg text-[9px] uppercase font-bold transition hover:bg-app-border/80"
                          >
                            Retry
                          </button>
                        </div>
                      ) : unsplashResults.length === 0 ? (
                        /* EMPTY STATE */
                        <div className="py-8 text-center space-y-1">
                          <ImageIcon size={22} className="mx-auto text-app-text-muted/45" />
                          <p className="text-[10px] text-app-text-muted font-semibold">No results found</p>
                          <p className="text-[8.5px] text-app-text-muted/80">Try another keyword like &quot;milk&quot; or &quot;cheese&quot;</p>
                        </div>
                      ) : (
                        /* RESULTS GRID */
                        <div ref={unsplashGridRef} onScroll={onUnsplashScroll} className="max-h-64 overflow-y-auto overscroll-contain pr-1 scrollbar-thin">
                        <div className="grid grid-cols-3 gap-2 content-start">
                          {unsplashResults.map((item) => (
                            <div 
                              key={item.id}
                              onClick={() => void loadRemoteImage(item.url, item.label || `photo_${item.id}`)}
                              // Square by padding, not aspect-ratio: the Linux app's WebKit stacks
                              // aspect-ratio tiles on top of each other inside a scrolling grid.
                              className="relative block w-full h-0 pb-[100%] rounded-xl overflow-hidden cursor-pointer hover:border-brand-500 border border-app-border/40 group bg-app-text/5"
                            >
                              <img
                                src={item.thumb || item.url}
                                alt={item.label}
                                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform"
                                loading="lazy"
                              />
                              <div className="absolute inset-0 bg-app-text/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[7px] text-app-bg text-center font-bold px-1 transition-opacity">
                                Select image
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="py-2 text-center text-[10px] text-app-text-muted">
                          {unsplashLoadingMore ? (
                            <span>Loading more…</span>
                          ) : unsplashMoreError ? (
                            <button type="button" onClick={() => { setUnsplashMoreError(""); void searchUnsplash(unsplashQuery, unsplashPage + 1); }} className="underline cursor-pointer">
                              {unsplashMoreError} Try again
                            </button>
                          ) : unsplashHasMore ? (
                            <span>Scroll for more</span>
                          ) : unsplashQuery.trim() ? (
                            <span>No more images for “{unsplashQuery.trim()}”</span>
                          ) : null}
                        </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
