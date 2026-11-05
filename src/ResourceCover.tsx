import { BookOpen, ClipboardCheck, FileText } from "lucide-react";

type ResourceCoverProps = {
  variant: "book" | "exam" | "document";
  title: string;
  imageUrl?: string;
  className?: string;
};

export function ResourceCover({ variant, title, imageUrl, className = "" }: ResourceCoverProps) {
  const Icon = variant === "book" ? BookOpen : variant === "exam" ? ClipboardCheck : FileText;
  return <div className={`resource-cover resource-cover-${variant} ${className}`} role="img" aria-label={`${title} cover`}>
    {imageUrl ? <img src={imageUrl} alt={`${title} cover`} loading="lazy" />
      : <><span className="resource-cover-mark"><Icon size={variant === "book" ? 27 : 25} strokeWidth={1.6} /></span><strong>{title || (variant === "exam" ? "Exam sheet" : "Learning resource")}</strong><small>{variant === "exam" ? "EXAM PAPER" : variant === "book" ? "LIBRARY EDITION" : "PDF RESOURCE"}</small></>}
  </div>;
}
