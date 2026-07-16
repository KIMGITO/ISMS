import { useState, useEffect, useRef } from "react";

export function useScrollDirection() {
  const [showNav, setShowNav] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target || !target.classList) return;

      // Monitor scroll of elements with overflow-y-auto
      const isScrollable =
        target.classList.contains("overflow-y-auto") ||
        target.tagName === "MAIN";

      if (!isScrollable) return;

      const currentScrollY = target.scrollTop;

      // Scrolling down -> hide nav, scrolling up -> show nav
      if (currentScrollY > lastScrollY.current + 15 && currentScrollY > 60) {
        setShowNav(false);
      } else if (currentScrollY < lastScrollY.current - 15) {
        setShowNav(true);
      }

      // Near bottom or top -> force show nav
      const isNearBottom =
        target.scrollHeight - target.scrollTop <= target.clientHeight + 60;
      if (isNearBottom || currentScrollY < 15) {
        setShowNav(true);
      }

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, []);

  return { showNav, setShowNav };
}
