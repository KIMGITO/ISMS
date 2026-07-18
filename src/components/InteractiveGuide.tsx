import React, { useState, useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight, HelpCircle } from "lucide-react";

export interface TourStep {
  targetSelector?: string;
  title: string;
  content: string;
  placement?: "top" | "bottom" | "left" | "right";
  tab?: string;
}

interface InteractiveGuideProps {
  isOpen: boolean;
  steps: TourStep[];
  onClose: () => void;
  onStepChange?: (tab: string) => void;
}

export const InteractiveGuide: React.FC<InteractiveGuideProps> = ({
  isOpen,
  steps,
  onClose,
  onStepChange,
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const lastTabRef = useRef<string | undefined>(undefined);

  const currentStep = steps[currentStepIndex];

  // Helper to resolve dynamic selector and placement based on screen width
  const getResolvedTarget = () => {
    if (!currentStep) return { selector: undefined, placement: "bottom" };
    let selector = currentStep.targetSelector;
    let placement = currentStep.placement || "bottom";

    if (selector && window.innerWidth < 768) {
      if (selector.startsWith("#sidebar-tab-")) {
        selector = selector.replace("#sidebar-tab-", "#mobile-tab-");
        placement = "top";
      } else if (selector === "#sidebar-brand-header") {
        selector = "#mobile-brand-header";
        placement = "bottom";
      } else if (selector === "#restart-tour-button") {
        selector = undefined; // Fallback to center screen
      }
    }
    return { selector, placement };
  };

  const { selector: resolvedSelector, placement: resolvedPlacement } = getResolvedTarget();

  // Reset step index when opened
  useEffect(() => {
    if (isOpen) {
      setCurrentStepIndex(0);
      lastTabRef.current = undefined;
    }
  }, [isOpen]);

  // Navigate to target and measure bounding box
  useEffect(() => {
    if (!isOpen || !currentStep) return;

    // 1. Trigger tab change if specified for this step and it's different from the last triggered tab
    if (currentStep.tab && onStepChange && lastTabRef.current !== currentStep.tab) {
      lastTabRef.current = currentStep.tab;
      onStepChange(currentStep.tab);
    }

    setTargetRect(null);

    // 2. Poll for DOM element availability to handle mounting delays
    let attempts = 0;
    const maxAttempts = 15;

    const measureElement = () => {
      const { selector } = getResolvedTarget();
      if (!selector) {
        setTargetRect(null);
        return;
      }

      const el = document.querySelector(selector);
      if (el) {
        // Scroll the element into viewport center smoothly
        el.scrollIntoView({ behavior: "smooth", block: "center" });

        // Let the scroll finish, then capture the final rect bounds
        setTimeout(() => {
          setTargetRect(el.getBoundingClientRect());
        }, 150);
      } else if (attempts < maxAttempts) {
        attempts++;
        setTimeout(measureElement, 100);
      } else {
        setTargetRect(null);
      }
    };

    const timer = setTimeout(measureElement, 150);
    return () => clearTimeout(timer);
  }, [currentStepIndex, isOpen, currentStep, onStepChange]);

  // Recalculate target position on window scroll or resize
  useEffect(() => {
    const { selector } = getResolvedTarget();
    if (!isOpen || !currentStep || !selector) return;

    const handleUpdate = () => {
      const el = document.querySelector(selector);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      }
    };

    window.addEventListener("resize", handleUpdate);
    window.addEventListener("scroll", handleUpdate, { capture: true });

    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate, { capture: true });
    };
  }, [currentStep, isOpen]);

  if (!isOpen || !currentStep) return null;

  const totalSteps = steps.length;
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === totalSteps - 1;
  const maskId = `tour-spotlight-mask-${currentStepIndex}`;

  const handleNext = () => {
    if (isLastStep) {
      onClose();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };
  const margin = 16;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 768;
  const tooltipWidth = Math.min(320, viewportWidth - 32);
  const tooltipHeight = 200; // Safe estimate for viewport checks

  let tooltipStyle: React.CSSProperties = {
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    position: "fixed" as const,
  };
  let finalPlacement = resolvedPlacement;
  let top = 0;
  let left = 0;

  if (targetRect) {
    const getCoords = (p: typeof resolvedPlacement) => {
      let t = 0;
      let l = 0;
      if (p === "bottom") {
        t = targetRect.top + targetRect.height + 12;
        l = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
      } else if (p === "top") {
        t = targetRect.top - tooltipHeight - 12;
        l = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
      } else if (p === "right") {
        t = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        l = targetRect.left + targetRect.width + 12;
      } else if (p === "left") {
        t = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        l = targetRect.left - tooltipWidth - 12;
      }
      return { t, l };
    };

    const idealCoords = getCoords(resolvedPlacement);
    top = idealCoords.t;
    left = idealCoords.l;

    // Auto-flip if it overflows the boundaries
    if (resolvedPlacement === "top" && top < margin) {
      const bottomCoords = getCoords("bottom");
      if (bottomCoords.t + tooltipHeight < viewportHeight - margin) {
        finalPlacement = "bottom";
        top = bottomCoords.t;
        left = bottomCoords.l;
      }
    } else if (resolvedPlacement === "bottom" && top + tooltipHeight > viewportHeight - margin) {
      const topCoords = getCoords("top");
      if (topCoords.t > margin) {
        finalPlacement = "top";
        top = topCoords.t;
        left = topCoords.l;
      }
    } else if (resolvedPlacement === "left" && left < margin) {
      const rightCoords = getCoords("right");
      if (rightCoords.l + tooltipWidth < viewportWidth - margin) {
        finalPlacement = "right";
        top = rightCoords.t;
        left = rightCoords.l;
      }
    } else if (resolvedPlacement === "right" && left + tooltipWidth > viewportWidth - margin) {
      const leftCoords = getCoords("left");
      if (leftCoords.l > margin) {
        finalPlacement = "left";
        top = leftCoords.t;
        left = leftCoords.l;
      }
    }

    // Keep tooltip inside screen boundaries
    left = Math.max(margin, Math.min(viewportWidth - tooltipWidth - margin, left));
    top = Math.max(margin, Math.min(viewportHeight - tooltipHeight - margin, top));

    tooltipStyle = {
      top: `${top}px`,
      left: `${left}px`,
      width: `${tooltipWidth}px`,
      position: "fixed" as const,
    };
  }

  // Render CSS arrow element depending on finalPlacement and center alignment
  const renderArrow = () => {
    if (!targetRect) return null;

    const baseArrowClass = "absolute w-3 h-3 bg-app-card border-app-border rotate-45 z-0";

    if (finalPlacement === "bottom") {
      const arrowOffset = Math.max(16, Math.min(tooltipWidth - 16, targetRect.left + targetRect.width / 2 - left));
      return <div style={{ left: `${arrowOffset}px` }} className={`${baseArrowClass} -top-1.5 -translate-x-1/2 border-t border-l`} />;
    }
    if (finalPlacement === "top") {
      const arrowOffset = Math.max(16, Math.min(tooltipWidth - 16, targetRect.left + targetRect.width / 2 - left));
      return <div style={{ left: `${arrowOffset}px` }} className={`${baseArrowClass} -bottom-1.5 -translate-x-1/2 border-b border-r`} />;
    }
    if (finalPlacement === "right") {
      const arrowOffset = Math.max(16, Math.min(tooltipHeight - 16, targetRect.top + targetRect.height / 2 - top));
      return <div style={{ top: `${arrowOffset}px` }} className={`${baseArrowClass} -left-1.5 -translate-y-1/2 border-b border-l`} />;
    }
    if (finalPlacement === "left") {
      const arrowOffset = Math.max(16, Math.min(tooltipHeight - 16, targetRect.top + targetRect.height / 2 - top));
      return <div style={{ top: `${arrowOffset}px` }} className={`${baseArrowClass} -right-1.5 -translate-y-1/2 border-t border-r`} />;
    }
    return null;
  };

  return (
    <div className="fixed inset-0 z-[99999] pointer-events-none">
      {/* SVG Spotlight Mask Overlay */}
      <svg className="absolute inset-0 w-full h-full pointer-events-auto">
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - 8}
                y={targetRect.top - 8}
                width={targetRect.width + 16}
                height={targetRect.height + 16}
                rx={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(15, 23, 42, 0.75)"
          mask={`url(#${maskId})`}
        />
      </svg>

      {/* Popover Tooltip Box */}
      <div
        style={tooltipStyle}
        className="max-w-[calc(100vw-32px)] bg-app-card border border-app-border rounded-3xl p-5 shadow-2xl pointer-events-auto transition-all duration-200 animate-scale-up"
      >
        {renderArrow()}

        <div className="relative z-10 flex flex-col gap-3">
          {/* Header & Step Indicator */}
          <div className="flex justify-between items-center pb-2 border-b border-app-border/40">
            <div className="flex items-center gap-1.5 text-amber-500 font-extrabold text-[10px] uppercase tracking-wider">
              <HelpCircle size={12} />
              <span>Guided Tour ({currentStepIndex + 1} of {totalSteps})</span>
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-app-bg text-app-text-muted hover:text-app-text rounded-lg transition cursor-pointer"
              title="Close tour"
            >
              <X size={13} />
            </button>
          </div>

          {/* Body Content */}
          <div className="text-left">
            <h4 className="text-xs font-black text-app-text uppercase tracking-wider leading-snug">
              {currentStep.title}
            </h4>
            <p className="text-[10.5px] text-app-text-muted leading-relaxed font-medium mt-1.5">
              {currentStep.content}
            </p>
          </div>

          {/* Progress bar line */}
          <div className="w-full bg-app-border/45 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-amber-500 h-full transition-all duration-300 rounded-full"
              style={{ width: `${((currentStepIndex + 1) / totalSteps) * 100}%` }}
            />
          </div>

          {/* Actions Footer */}
          <div className="flex justify-between items-center mt-1.5 gap-2">
            <button
              onClick={onClose}
              className="px-2.5 py-1.5 text-[9px] font-bold text-app-text-muted hover:text-app-text uppercase tracking-wider transition cursor-pointer"
            >
              Skip
            </button>
            <div className="flex gap-1.5">
              {!isFirstStep && (
                <button
                  onClick={handlePrev}
                  className="px-3 py-1.5 bg-app-bg hover:bg-app-border border border-app-border text-app-text font-bold rounded-xl text-[9px] uppercase tracking-wider transition cursor-pointer flex items-center gap-1"
                >
                  <ChevronLeft size={11} />
                  <span>Prev</span>
                </button>
              )}
              <button
                onClick={handleNext}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-[9px] uppercase tracking-wider transition cursor-pointer flex items-center gap-1 shadow-sm"
              >
                <span>{isLastStep ? "Finish" : "Next"}</span>
                <ChevronRight size={11} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
