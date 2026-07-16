// src/components/shared/UnifiedUploader.tsx
import React, { useState, useRef, useEffect } from "react";
import { 
  Upload, Camera, Image as ImageIcon, Link as LinkIcon, X, 
  RefreshCw, Check, AlertCircle, RefreshCw as RetryIcon, ZoomIn, Move
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { uploadService } from "../../services/uploadService";
import { MediaType, UploadItem } from "../../services/upload/domain/entities";
import { devicePermissionService } from "../../services/devicePermissionService";

// Unsplash presets for Milk Shop theme
const UNSPLASH_PRESETS = [
  { id: "u-1", label: "Fresh Milk Glass", url: "https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&q=80&w=300" },
  { id: "u-2", label: "Dairy Cows Pasture", url: "https://images.unsplash.com/photo-1570042225831-d98fa7577f1e?auto=format&fit=crop&q=80&w=300" },
  { id: "u-3", label: "Vintage Milk Bottle", url: "https://images.unsplash.com/photo-1528498033373-3c6c08e93d79?auto=format&fit=crop&q=80&w=300" },
  { id: "u-4", label: "Artisanal Cheese Board", url: "https://images.unsplash.com/photo-1486299267070-83823f5448dd?auto=format&fit=crop&q=80&w=300" },
  { id: "u-5", label: "Lush Green Meadow", url: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&q=80&w=300" },
  { id: "u-6", label: "Fresh Yogurt Bowl", url: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&q=80&w=300" }
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

interface UnifiedUploaderProps {
  onUploadSuccess: (url: string) => void;
  onUploadError?: (error: string) => void;
  allowedTypes?: MediaType[];
  maxSizeMb?: number;
  cropAspect?: number; // e.g. 1 for square (avatars), 1.77 for 16:9, etc.
  buttonText?: string;
  className?: string;
  triggerElement?: React.ReactNode;
  bucketName?: string;
}

export default function UnifiedUploader({
  onUploadSuccess,
  onUploadError,
  allowedTypes = ["image", "pdf", "excel", "word", "csv"],
  maxSizeMb = 5,
  cropAspect = 1,
  buttonText = "Upload File",
  className = "",
  triggerElement,
  bucketName
}: UnifiedUploaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"device" | "camera" | "url" | "unsplash">("device");
  const [dragOver, setDragOver] = useState(false);

  // File loading states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [unsplashQuery, setUnsplashQuery] = useState("");
  const [unsplashResults, setUnsplashResults] = useState(UNSPLASH_PRESETS);
  const [unsplashLoading, setUnsplashLoading] = useState(false);
  const [unsplashError, setUnsplashError] = useState("");

  // Search caching & debounce timer
  const searchCache = useRef<Record<string, any>>({});
  const debounceTimer = useRef<any>(null);

  // Edit / Crop States
  const [isEditing, setIsEditing] = useState(false);
  const [editImageSrc, setEditImageSrc] = useState<string>("");
  const [imgNaturalSize, setImgNaturalSize] = useState({ w: 0, h: 0 });
  const [cropZoom, setCropZoom] = useState(1);
  const [cropPanX, setCropPanX] = useState(0);
  const [cropPanY, setCropPanY] = useState(0);
  const [compressToggle, setCompressToggle] = useState(true);

  // Upload progress states
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "completed" | "failed" | "queued">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [currentUploadItem, setCurrentUploadItem] = useState<UploadItem | null>(null);

  // Camera states
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
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

  if (cropAspect > 1) {
    cropBoxWidth = 210;
    cropBoxHeight = 210 / cropAspect;
  } else if (cropAspect < 1) {
    cropBoxHeight = 210;
    cropBoxWidth = 210 * cropAspect;
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
        setCropZoom(1);
        setCropPanX(0);
        setCropPanY(0);
      };
    }
  }, [editImageSrc]);

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
    if (e.touches.length === 2) {
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

  const startCamera = async () => {
    setCameraError("");
    setIsCameraActive(true);
    try {
      const permission = await devicePermissionService.request("camera");
      if (permission === "denied") {
        throw new Error("Camera permission denied. Please grant permission to continue.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 480, facingMode: "user" }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Camera access failed:", err);
      setCameraError(err.message || "Failed to access camera stream. Grant camera permissions.");
      setIsCameraActive(false);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.translate(480, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(videoRef.current, 0, 0, 480, 480);
        
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

    if (type === "image") {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setEditImageSrc(e.target.result as string);
          setIsEditing(true);
        }
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
          const targetWidth = 400;
          const targetHeight = Math.round(400 / cropAspect);
          
          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject("Canvas 2D Context empty");

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
    if (!urlInput.trim()) return;
    setErrorMessage("");
    try {
      setUploadStatus("uploading");
      setUploadProgress(20);
      const res = await fetch(urlInput);
      const blob = await res.blob();
      const type = mapMimeToCategory(blob.type);
      
      const file = new File([blob], `imported_image_${Date.now()}.jpg`, { type: blob.type });
      setSelectedFile(file);
      
      if (type === "image") {
        const objectUrl = URL.createObjectURL(blob);
        setEditImageSrc(objectUrl);
        setUploadStatus("idle");
        setIsEditing(true);
      } else {
        triggerUpload(file, type);
      }
    } catch (err) {
      const mockFile = new File([], "url_referenced_image", { type: "image/jpeg" });
      setSelectedFile(mockFile);
      triggerUpload(mockFile, "image", urlInput);
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
        { compress: compressToggle, crop: false, bucketName },
        (progress) => setUploadProgress(progress)
      );

      if (item.status === "queued_offline") {
        setUploadStatus("queued");
      } else {
        setUploadStatus("completed");
        setUploadProgress(100);
        setTimeout(() => {
          setIsOpen(false);
          onUploadSuccess(resultUrl);
          resetState();
        }, 800);
      }
    } catch (err: any) {
      console.error("Upload failed:", err);
      setUploadStatus("failed");
      setErrorMessage(err.message || "Failed to complete upload.");
      onUploadError?.(err.message || "Upload failed");
    }
  };

  const handleRetry = async () => {
    if (!currentUploadItem) return;
    triggerUpload(currentUploadItem.file || new File([], currentUploadItem.name), currentUploadItem.type, currentUploadItem.url);
  };

  const resetState = () => {
    setSelectedFile(null);
    setUrlInput("");
    setUnsplashQuery("");
    setUnsplashResults(UNSPLASH_PRESETS);
    setIsEditing(false);
    setUploadProgress(0);
    setUploadStatus("idle");
    setErrorMessage("");
    setUnsplashError("");
    setCurrentUploadItem(null);
    stopCamera();
  };

  // Official Developer API Search with Caching and Skeletal States
  const handleUnsplashSearch = async () => {
    const query = unsplashQuery.trim().toLowerCase();
    if (!query) {
      setUnsplashResults(UNSPLASH_PRESETS);
      setUnsplashError("");
      return;
    }

    // Return cached results if available
    if (searchCache.current[query]) {
      setUnsplashResults(searchCache.current[query]);
      setUnsplashError("");
      return;
    }

    setUnsplashLoading(true);
    setUnsplashError("");
    
    const accessKey = (import.meta as any).env?.VITE_UNSPLASH_ACCESS_KEY || "";
    
    // Fallback if no key is configured or offline
    if (!accessKey || accessKey === "your-unsplash-access-key" || !isOnline) {
      setTimeout(() => {
        fallbackLocalSearch(query);
        setUnsplashLoading(false);
      }, 300);
      return;
    }

    try {
      const res = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=9`,
        {
          headers: {
            Authorization: `Client-ID ${accessKey}`
          }
        }
      );

      if (!res.ok) {
        if (res.status === 403) throw new Error("API Limit Reached");
        throw new Error("API Failure");
      }

      const data = await res.json();
      if (data && data.results && data.results.length > 0) {
        const results = data.results.map((item: any) => ({
          id: item.id,
          label: item.alt_description || item.description || `${query} photo`,
          url: item.urls.small || item.urls.regular
        }));
        
        // Save in cache
        searchCache.current[query] = results;
        setUnsplashResults(results);
      } else {
        setUnsplashResults([]); // Empty state trigger
      }
    } catch (err: any) {
      console.warn("Unsplash API failed, utilizing robust local fallback library.", err);
      fallbackLocalSearch(query);
    } finally {
      setUnsplashLoading(false);
    }
  };

  // Debounced typing search handler
  const handleQueryChange = (val: string) => {
    setUnsplashQuery(val);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    
    debounceTimer.current = setTimeout(() => {
      handleUnsplashSearch();
    }, 400);
  };

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
      setUnsplashResults(scored);
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
      {triggerElement ? (
        <div onClick={() => setIsOpen(true)} className="cursor-pointer">
          {triggerElement}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={`py-2 px-3 bg-app-bg hover:bg-app-card border border-app-border text-app-text font-black rounded-xl transition cursor-pointer text-[9px] uppercase tracking-wider flex items-center gap-1.5 ${className}`}
        >
          <Upload size={11} className="text-amber-500" />
          <span>{buttonText}</span>
        </button>
      )}

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-app-card border border-app-border rounded-[28px] max-w-md w-full p-6 shadow-2xl relative space-y-4 text-app-text"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-app-border/40 pb-2.5">
                <div className="flex items-center gap-2">
                  <Upload size={16} className="text-amber-500" />
                  <h3 className="text-xs font-extrabold text-app-text uppercase tracking-wider font-display">Unified Media Uploader</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    resetState();
                    setIsOpen(false);
                  }}
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
                    <h4 className="text-[10px] font-black text-app-text uppercase tracking-wider text-center">Position and Zoom Image</h4>
                    <p className="text-[8.5px] text-app-text-muted text-center mt-0.5">Drag to move · Pinch or scroll wheel to zoom</p>
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
                    style={{ width: `${viewportSize}px`, height: `${viewportSize}px` }}
                    className="relative mx-auto rounded-3xl overflow-hidden bg-slate-900 border-2 border-app-border flex items-center justify-center cursor-move touch-none select-none"
                  >
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

                    {/* Dashed Bounding Selector */}
                    <div 
                      style={{
                        position: "absolute",
                        left: `${cropBoxX}px`,
                        top: `${cropBoxY}px`,
                        width: `${cropBoxWidth}px`,
                        height: `${cropBoxHeight}px`,
                        boxShadow: "0 0 0 2px rgb(245, 158, 11)"
                      }}
                      className="border-2 border-dashed border-white/60 pointer-events-none rounded-2xl shadow-lg"
                    />
                  </div>

                  {/* Manual Backup Controls */}
                  <div className="flex items-center justify-between text-[8px] text-app-text-muted px-6">
                    <span className="flex items-center gap-1"><ZoomIn size={10} /> Zoom: {cropZoom.toFixed(1)}x</span>
                    <span className="flex items-center gap-1"><Move size={10} /> Pan Active</span>
                  </div>

                  {/* Compression Options */}
                  <div className="flex items-center justify-between gap-4 py-2 border-t border-app-border/40 px-2">
                    <div>
                      <span className="font-extrabold text-app-text text-[10px] block">WebP Lossless Compression</span>
                      <span className="text-[8px] text-app-text-muted font-medium block mt-0.5">Optimizes loading speed & storage size</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCompressToggle(!compressToggle)}
                      className={`relative inline-flex h-4 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        compressToggle ? "bg-amber-500" : "bg-app-border"
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white dark:bg-slate-900 shadow ring-0 transition duration-200 ease-in-out ${
                        compressToggle ? "translate-x-5" : "translate-x-0"
                      }`} />
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="flex-1 py-2 bg-app-bg border border-app-border hover:bg-app-card text-[10px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleCropSave}
                      className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-[10px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
                    >
                      Crop & Save
                    </button>
                  </div>
                </div>
              ) : uploadStatus === "uploading" || uploadStatus === "completed" || uploadStatus === "failed" || uploadStatus === "queued" ? (
                /* PROGRESS & RETRY SCREEN */
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  {uploadStatus === "uploading" && (
                    <>
                      <div className="p-4 bg-amber-500/10 text-amber-500 rounded-full animate-spin">
                        <RefreshCw size={24} />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-black uppercase tracking-wider">Uploading payload...</h4>
                        <div className="w-48 bg-app-border h-1.5 rounded-full overflow-hidden mt-3 mx-auto">
                          <div 
                            className="bg-amber-500 h-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-app-text-muted font-bold block mt-1">{uploadProgress}%</span>
                      </div>
                    </>
                  )}

                  {uploadStatus === "completed" && (
                    <>
                      <div className="p-4 bg-emerald-500/15 text-emerald-500 rounded-full animate-bounce">
                        <Check size={28} />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-black uppercase tracking-wider text-emerald-500">Upload Complete!</h4>
                        <p className="text-[9px] text-app-text-muted mt-1 font-medium">Replicating public storage URLs...</p>
                      </div>
                    </>
                  )}

                  {uploadStatus === "queued" && (
                    <>
                      <div className="p-4 bg-amber-500/15 text-amber-500 rounded-full">
                        <Check size={28} />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-black uppercase tracking-wider text-amber-500">Stashed Offline</h4>
                        <p className="text-[9px] text-app-text-muted mt-1.5 font-medium px-4">
                          File cached successfully. It will automatically upload to Supabase when returning online.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsOpen(false);
                          resetState();
                        }}
                        className="py-2 px-4 bg-amber-500 text-slate-950 text-[10px] font-black uppercase tracking-wider rounded-xl cursor-pointer"
                      >
                        Got It
                      </button>
                    </>
                  )}

                  {uploadStatus === "failed" && (
                    <>
                      <div className="p-4 bg-red-500/15 text-red-500 rounded-full">
                        <AlertCircle size={28} />
                      </div>
                      <div>
                        <h4 className="text-[11px] font-black uppercase tracking-wider text-red-500">Upload Failed</h4>
                        <p className="text-[9px] text-red-400 font-mono mt-1 px-4 leading-tight">{errorMessage}</p>
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
                          className="flex-1 py-2 bg-amber-500 text-slate-950 text-[9px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
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
                        activeTab === "device" ? "bg-amber-500 text-slate-950 font-black" : "text-app-text-muted hover:text-app-text"
                      }`}
                    >
                      File Drive
                    </button>
                    <button
                      type="button"
                      onClick={() => { startCamera(); setActiveTab("camera"); }}
                      className={`flex-1 py-1.5 rounded-lg text-center transition cursor-pointer ${
                        activeTab === "camera" ? "bg-amber-500 text-slate-950 font-black" : "text-app-text-muted hover:text-app-text"
                      }`}
                    >
                      Webcam
                    </button>
                    <button
                      type="button"
                      onClick={() => { stopCamera(); setActiveTab("url"); }}
                      className={`flex-1 py-1.5 rounded-lg text-center transition cursor-pointer ${
                        activeTab === "url" ? "bg-amber-500 text-slate-950 font-black" : "text-app-text-muted hover:text-app-text"
                      }`}
                    >
                      Link
                    </button>
                    <button
                      type="button"
                      onClick={() => { stopCamera(); setActiveTab("unsplash"); }}
                      className={`flex-1 py-1.5 rounded-lg text-center transition cursor-pointer ${
                        activeTab === "unsplash" ? "bg-amber-500 text-slate-950 font-black" : "text-app-text-muted hover:text-app-text"
                      }`}
                    >
                      Unsplash
                    </button>
                  </div>

                  {errorMessage && (
                    <div className="p-2.5 bg-red-500/5 border border-red-500/10 rounded-xl text-red-500 text-[9px] font-semibold text-center leading-tight">
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
                        dragOver ? "border-amber-500 bg-amber-500/5 scale-[1.02]" : "border-app-border bg-app-bg/50 hover:bg-app-bg"
                      }`}
                    >
                      <div className="p-3 bg-amber-500/10 text-amber-500 rounded-2xl">
                        <Upload size={22} />
                      </div>
                      <div>
                        <span className="text-xs font-extrabold text-app-text block">Drag & Drop files here</span>
                        <span className="text-[8.5px] text-app-text-muted font-medium block mt-1">PNG, JPG, PDF, CSV, Excel or Word up to {maxSizeMb}MB</span>
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
                          <div className="relative w-48 h-48 rounded-2xl overflow-hidden border border-amber-500 bg-slate-950 shadow-md">
                            <video
                              ref={videoRef}
                              autoPlay
                              playsInline
                              className="w-full h-full object-cover scale-x-[-1]"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={capturePhoto}
                            className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-[10px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
                          >
                            Capture Frame
                          </button>
                        </>
                      ) : (
                        <div className="py-8 text-center text-app-text-muted space-y-3">
                          <Camera size={26} className="mx-auto text-amber-500/60" />
                          <p className="text-[10px] px-8 font-medium leading-relaxed">
                            {cameraError || "Webcam access is deactivated. Start live stream coordinates."}
                          </p>
                          <button
                            type="button"
                            onClick={startCamera}
                            className="py-1.5 px-4 bg-amber-500 text-slate-950 text-[9px] font-black uppercase tracking-wider rounded-xl cursor-pointer"
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
                            className="flex-1 bg-app-bg text-app-text px-3 py-2 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px] font-mono"
                          />
                          <button
                            type="button"
                            onClick={handleUrlLoad}
                            className="py-2 px-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-[9px] uppercase tracking-wider transition cursor-pointer shrink-0"
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
                          className="flex-1 bg-app-bg text-app-text px-3 py-1.5 rounded-xl border border-app-border focus:border-amber-500 focus:outline-none text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={handleUnsplashSearch}
                          disabled={unsplashLoading}
                          className="py-1.5 px-3 bg-app-border hover:bg-amber-500/10 disabled:opacity-50 text-app-text font-black rounded-xl text-[9px] uppercase tracking-wider transition cursor-pointer shrink-0 flex items-center gap-1"
                        >
                          {unsplashLoading && <RefreshCw size={10} className="animate-spin text-amber-500" />}
                          <span>Find</span>
                        </button>
                      </div>

                      {/* Display states (Loading, Empty, Error, Grid) */}
                      {unsplashLoading ? (
                        /* SKELETON LOADER GRID */
                        <div className="grid grid-cols-3 gap-2">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <div 
                              key={i} 
                              className="aspect-square rounded-xl bg-app-border/40  border border-app-border/10"
                            />
                          ))}
                        </div>
                      ) : unsplashError ? (
                        /* ERROR STATE */
                        <div className="py-6 text-center space-y-2">
                          <AlertCircle size={20} className="mx-auto text-red-500" />
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
                        <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-0.5 scrollbar-thin">
                          {unsplashResults.map((item) => (
                            <div 
                              key={item.id}
                              onClick={async () => {
                                try {
                                  setUploadStatus("uploading");
                                  setUploadProgress(30);
                                  const res = await fetch(item.url);
                                  const blob = await res.blob();
                                  const mockFile = new File([blob], `unsplash_${item.id}.jpg`, { type: "image/jpeg" });
                                  setSelectedFile(mockFile);
                                  const objectUrl = URL.createObjectURL(blob);
                                  setEditImageSrc(objectUrl);
                                  setUploadStatus("idle");
                                  setIsEditing(true);
                                } catch {
                                  const mockFile = new File([], `unsplash_${item.id}.jpg`, { type: "image/jpeg" });
                                  setSelectedFile(mockFile);
                                  triggerUpload(mockFile, "image", item.url);
                                }
                              }}
                              className="relative aspect-square rounded-xl overflow-hidden cursor-pointer hover:border-amber-500 border border-app-border/40 group bg-slate-900"
                            >
                              <img
                                src={item.url}
                                alt={item.label}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                loading="lazy"
                              />
                              <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[7px] text-white text-center font-bold px-1 transition-opacity">
                                Select image
                              </div>
                            </div>
                          ))}
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
