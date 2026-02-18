"use client";

import type { ComponentProps, HTMLAttributes, ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface AttachmentData {
  id: string;
  type: "file";
  url: string;
  mediaType?: string;
  filename?: string;
}

interface AttachmentsContextType {
  attachments: AttachmentData[];
  removeAttachment: (id: string) => void;
}

const AttachmentsContext = createContext<AttachmentsContextType | null>(null);

const useAttachmentsContext = () => {
  const context = useContext(AttachmentsContext);
  if (!context) {
    throw new Error(
      "Attachment components must be used within Attachments component"
    );
  }
  return context;
};

export type AttachmentsProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactElement[];
  variant?: "grid" | "list";
};

export const Attachments = ({
  children,
  className,
  variant = "grid",
  ...props
}: AttachmentsProps) => {
  const [attachments, setAttachments] = useState<AttachmentData[]>([]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const contextValue = useMemo<AttachmentsContextType>(
    () => ({ attachments, removeAttachment }),
    [attachments, removeAttachment]
  );

  return (
    <AttachmentsContext.Provider value={contextValue}>
      <div
        className={cn(
          variant === "grid"
            ? "grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4"
            : "flex flex-col gap-2",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </AttachmentsContext.Provider>
  );
};

export type AttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: AttachmentData;
  children: ReactElement[];
};

export const Attachment = ({
  data,
  className,
  children,
  ...props
}: AttachmentProps) => {
  const { removeAttachment } = useAttachmentsContext();

  const isImage =
    data.mediaType?.startsWith("image/") || data.filename?.match(/\.(jpg|jpeg|png|gif|webp)$/i);

  return (
    <div
      className={cn(
        "relative group overflow-hidden rounded-lg border border-white/10 bg-white/5 transition-all hover:bg-white/10",
        className
      )}
      {...props}
    >
      {isImage && data.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.url}
          alt={data.filename || "attachment"}
          className="h-32 w-full object-cover"
        />
      )}
      <div className="flex flex-col gap-2 p-2">
        {children}
      </div>
      <button
        onClick={() => removeAttachment(data.id)}
        className="absolute right-1 top-1 hidden rounded-md bg-black/50 p-1 hover:bg-black/70 group-hover:block"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export type AttachmentPreviewProps = HTMLAttributes<HTMLDivElement>;

export const AttachmentPreview = ({
  className,
  ...props
}: AttachmentPreviewProps) => {
  const { attachments } = useAttachmentsContext();

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={cn("text-xs text-muted-foreground", className)} {...props}>
      {attachments.map((attachment) => (
        <div key={attachment.id} className="truncate">
          {attachment.filename || "File"}
        </div>
      ))}
    </div>
  );
};

export type AttachmentRemoveProps = ComponentProps<typeof Button>;

export const AttachmentRemove = (props: AttachmentRemoveProps) => {
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      className="absolute right-1 top-1 opacity-0 group-hover:opacity-100"
      {...props}
    >
      <X className="h-3 w-3" />
    </Button>
  );
};
