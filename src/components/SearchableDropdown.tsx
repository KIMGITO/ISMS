import React, { useState, useRef, useEffect } from "react";
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
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedItem = items.find(item => item.id === selectedValue);

  const filteredItems = items.filter(item =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.sublabel && item.sublabel.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} className={`relative w-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setIsOpen(!isOpen);
          setSearchQuery("");
        }}
        className={`w-full flex items-center justify-between bg-app-bg border border-app-border p-2.5 rounded-xl text-xs text-app-text transition focus:outline-none focus:ring-1 focus:ring-amber-500 text-left ${
          disabled 
            ? "opacity-50 cursor-not-allowed border-app-border/40" 
            : "hover:border-amber-500/50 cursor-pointer"
        }`}
      >
        <span className={selectedItem ? "text-app-text font-bold" : "text-app-text-muted font-medium"}>
          {selectedItem ? selectedItem.label : placeholder}
        </span>
        <ChevronDown size={14} className={`text-app-text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-[100] mt-1.5 w-full bg-app-card border border-app-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-60"
          >
            {/* Search Input Box */}
            <div className="p-2 border-b border-app-border/40 flex items-center gap-2 bg-app-bg/50 shrink-0">
              <Search size={13} className="text-app-text-muted shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-xs text-app-text placeholder-app-text-muted focus:outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Scrollable List */}
            <div className="flex-1 overflow-y-auto max-h-48 py-1">
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
      </AnimatePresence>
    </div>
  );
}
