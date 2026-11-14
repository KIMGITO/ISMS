import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../hooks/useOverlay";
import { Search, ChevronDown, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface DropdownItem {
  id: string;
  label: string;
  sublabel?: string;
}

interface SearchableDropdownProps {
  items: DropdownItem[];
  selectedValue: string;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
}

export default function SearchableDropdown({
  items,
  selectedValue,
  onChange,
  placeholder,
  searchPlaceholder = "Search...",
  className = "",
  disabled = false
}: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [openUp, setOpenUp] = useState(false);
  // Where the open list sits on the window. It is drawn on the top layer of the page,
  // so no card, sheet or scroll area can clip it or cover it.
  const [panelPos, setPanelPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const showSearch = items.length > 6;

  const close = useCallback(() => {
    setIsOpen(false);
    setSearchQuery("");
  }, []);

  // Android back and Escape close the list before anything else.
  useOverlay(isOpen, close, "dropdown");

  // Open upwards when the space left below (above the keyboard, if it is up) is too small.
  const placePanel = useCallback(() => {
    const el = dropdownRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const gap = 6;
    const margin = 8;
    const below = viewportHeight - rect.bottom;
    const above = rect.top;
    const up = below < 280 && above > below;
    setOpenUp(up);
    const width = Math.min(rect.width, viewportWidth - margin * 2);
    const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
    const room = (up ? above : below) - gap - margin;
    setPanelPos({
      left,
      width,
      maxHeight: Math.max(120, Math.min(240, room)),
      ...(up ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
    });
  }, []);

  useLayoutEffect(() => {
    if (isOpen) placePanel();
  }, [isOpen, placePanel]);

  useEffect(() => {
    if (!isOpen) return;
    // Focus the search box so typing starts straight away, and keep the list in view
    // once the keyboard has finished opening.
    const focusTimer = setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 60);
    const keepInView = () => {
      placePanel();
      dropdownRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", keepInView);
    // Follow the box when anything around it scrolls or the window changes size.
    window.addEventListener("scroll", placePanel, true);
    window.addEventListener("resize", placePanel);
    const settleTimer = setTimeout(keepInView, 350);
    // Show the chosen item rather than the top of a long list.
    const selectedFrame = requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }));
    return () => {
      cancelAnimationFrame(selectedFrame);
      clearTimeout(focusTimer);
      clearTimeout(settleTimer);
      viewport?.removeEventListener("resize", keepInView);
      window.removeEventListener("scroll", placePanel, true);
      window.removeEventListener("resize", placePanel);
    };
  }, [isOpen, placePanel]);

  const selectedItem = items.find(item => item.id === selectedValue);

  const filteredItems = items.filter(item =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.sublabel && item.sublabel.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  useEffect(() => {
    function handleClickOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    }
    document.addEventListener("pointerdown", handleClickOutside);
    return () => document.removeEventListener("pointerdown", handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} className={`relative w-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen(!isOpen);
          setSearchQuery("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && isOpen) {
            e.preventDefault();
            close();
          }
        }}
        className={`w-full flex items-center justify-between bg-app-bg border border-app-border p-2.5 rounded-xl text-xs text-app-text transition focus:outline-none focus:ring-1 focus:ring-amber-500 text-left ${
          disabled 
            ? "opacity-50 cursor-not-allowed border-app-border/40" 
            : "hover:border-amber-500/50 cursor-pointer"
        }`}
      >
        <span className={selectedItem ? "text-app-text font-bold truncate" : "text-app-text-muted font-medium "}>
          {selectedItem ? selectedItem.label : placeholder}
        </span>
        <ChevronDown size={14} className={`text-app-text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown Panel */}
      {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {isOpen && panelPos && (
          <motion.div
            ref={panelRef}
            style={{
              position: "fixed",
              left: panelPos.left,
              width: panelPos.width,
              top: panelPos.top,
              bottom: panelPos.bottom,
              maxHeight: panelPos.maxHeight,
              zIndex: 100000,
            }}
            initial={{ opacity: 0, y: openUp ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: openUp ? 4 : -4 }}
            transition={{ duration: 0.15 }}
            className={`bg-app-card text-app-text border border-app-border rounded-xl shadow-2xl overflow-hidden flex ${
              openUp ? "flex-col-reverse" : "flex-col"
            }`}
          >
            {/* Short lists don't need searching. */}
            {showSearch && (
            <div className="p-2 border-b border-app-border/40 flex items-center gap-2 bg-app-bg/50 shrink-0">
              <Search size={13} className="text-app-text-muted shrink-0" />
              <input
                ref={searchRef}
                type="search"
                enterKeyHint="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); close(); }
                  // Enter picks the only match, so a quick search needs no extra tap.
                  if (e.key === "Enter" && filteredItems.length === 1) {
                    e.preventDefault();
                    onChange(filteredItems[0].id);
                    close();
                  }
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full bg-transparent text-sm text-app-text placeholder-app-text-muted focus:outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            )}

            {/* Scrollable List */}
            <div ref={listRef} role="listbox" className="flex-1 min-h-0 overflow-y-auto py-1 overscroll-contain">
              {filteredItems.length === 0 ? (
                <div className="p-3 text-[11px] text-app-text-muted text-center font-medium">
                  No matches found
                </div>
              ) : (
                filteredItems.map((item) => {
                  const isSelected = item.id === selectedValue;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChange(item.id);
                        setIsOpen(false);
                        setSearchQuery("");
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs transition text-left hover:bg-amber-500/10 cursor-pointer ${
                        isSelected ? "bg-amber-500/5 text-amber-500 font-bold" : "text-app-text hover:text-app-text"
                      }`}
                    >
                      <div className="truncate pr-4">
                        <span className="block font-bold truncate">{item.label}</span>
                        {item.sublabel && (
                          <span className="block text-[9.5px] text-app-text-muted font-normal mt-0.5 truncate">
                            {item.sublabel}
                          </span>
                        )}
                      </div>
                      {isSelected && <Check size={12} className="text-amber-500 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
      )}
    </div>
  );
}
