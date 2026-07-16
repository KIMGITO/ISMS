import { useState, useEffect } from "react";

/**
 * Reusable hook to detect if the virtual keyboard is open/visible.
 * Supports Android, iOS, and Web.
 */
export function useKeyboardVisible() {
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Track the maximum height seen for each orientation (portrait/landscape)
    // to handle orientation changes gracefully without layout jumping.
    const maxHeights: { portrait: number; landscape: number } = {
      portrait: 0,
      landscape: 0,
    };

    const getOrientation = (): "portrait" | "landscape" => {
      if (window.screen && window.screen.orientation) {
        return window.screen.orientation.type.includes("portrait") ? "portrait" : "landscape";
      }
      return window.innerWidth < window.innerHeight ? "portrait" : "landscape";
    };

    const updateMaxHeight = (height: number) => {
      const orient = getOrientation();
      if (!maxHeights[orient] || height > maxHeights[orient]) {
        maxHeights[orient] = height;
      }
    };

    // Initialize with current viewport height or innerHeight
    const initialHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    updateMaxHeight(initialHeight);

    const checkKeyboard = () => {
      const orient = getOrientation();
      const currentHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      
      // Update max height if we find a larger height for this orientation
      updateMaxHeight(currentHeight);
      
      const maxForOrient = maxHeights[orient] || currentHeight;
      const diff = maxForOrient - currentHeight;

      // On mobile devices, keyboards typically take up > 150px and > 15% of the screen height.
      const isVisible = diff > 150 && diff > maxForOrient * 0.15;
      setIsKeyboardVisible(isVisible);
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", checkKeyboard);
    } else {
      window.addEventListener("resize", checkKeyboard);
    }

    // Handle orientation change
    window.addEventListener("orientationchange", checkKeyboard);

    // Initial check
    checkKeyboard();

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", checkKeyboard);
      } else {
        window.removeEventListener("resize", checkKeyboard);
      }
      window.removeEventListener("orientationchange", checkKeyboard);
    };
  }, []);

  return isKeyboardVisible;
}
