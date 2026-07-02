"use client";

import { useRef, useState } from "react";
import { Camera, FileText } from "lucide-react";
import { toast } from "sonner";
import { api, type ReceiptProcessResult } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface ReceiptCaptureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after the captured image is cleaned + stored. */
  onCaptured: (result: ReceiptProcessResult) => void;
  /** Fired when the user chooses to enter a transaction without a photo. */
  onSkip: () => void;
}

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * Camera-first entry point for adding a transaction. Uses the native capture
 * input (`capture="environment"` opens the OS camera on mobile, falls back to a
 * file picker on desktop). On capture the image is cleaned + stored server-side,
 * then the form opens. "Skip photo" jumps straight to the manual form.
 *
 * This component isolates the capture handler so a future swap (live getUserMedia
 * preview, or OCR auto-fill) is a localised change.
 */
function ReceiptCaptureDialog({
  open,
  onOpenChange,
  onCaptured,
  onSkip,
}: ReceiptCaptureDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  async function handleFile(file?: File | null) {
    if (!file) return;
    setProcessing(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const result = await api.receipts.process(dataUrl);
      onCaptured(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't process that photo");
    } finally {
      setProcessing(false);
      // Allow re-selecting the same file after an error.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !processing && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add transaction</DialogTitle>
        </DialogHeader>

        {processing ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Spinner />
            <p className="text-sm text-muted-foreground">Cleaning up receipt…</p>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-background px-4 py-8 text-center transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Camera className="size-6 text-primary" />
              <span className="text-sm font-medium">Take a photo of your receipt</span>
              <span className="text-xs text-muted-foreground">
                We&apos;ll clean it up and attach it for you
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onSkip} disabled={processing}>
            <FileText />
            Skip photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ReceiptCaptureDialog };
