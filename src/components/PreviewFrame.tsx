import React from "react";

interface PreviewFrameProps {
  children: React.ReactNode;
}

export default function PreviewFrame({ children }: PreviewFrameProps) {
  return (
    <div className="w-full h-screen bg-app-bg text-app-text relative overflow-hidden flex flex-col">
      <div className="flex-1 w-full relative overflow-hidden">
        {children}
      </div>
    </div>
  );
}
