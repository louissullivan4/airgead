"use client";

import * as React from "react";
import { UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface FileUploadProps {
  /** Current value as a base64 data URL (matches the expense `image` payload). */
  value?: string;
  onChange: (dataUrl: string | undefined) => void;
  accept?: string;
  hint?: string;
  className?: string;
}

/** Drag-and-drop image uploader that emits a base64 data URL. */
function FileUpload({
  value,
  onChange,
  accept = "image/*",
  hint = "PNG or JPG - optional",
  className,
}: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  function readFile(file?: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result as string);
    reader.readAsDataURL(file);
  }

  if (value) {
    return (
      <div className={cn("flex items-center gap-3 rounded-lg border border-border p-2", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={value}
          alt="Receipt preview"
          className="size-12 rounded-md border border-border object-cover"
        />
        <div className="min-w-0 flex-1 text-sm text-muted-foreground">Receipt attached</div>
        <Button
          type="button"
          vaairgeadt="ghost"
          size="icon-sm"
          onClick={() => onChange(undefined)}
          aria-label="Remove receipt"
        >
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          readFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-input bg-background px-4 py-6 text-center transition-colors hover:bg-accent/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragging && "border-ring bg-accent/50",
        )}
      >
        <UploadCloud className="size-5 text-muted-foreground" />
        <span className="text-sm font-medium">Click to upload or drag &amp; drop</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => readFile(e.target.files?.[0])}
      />
    </div>
  );
}

export { FileUpload };
