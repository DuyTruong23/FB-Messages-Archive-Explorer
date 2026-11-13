import { CircleAlert, FileX } from 'lucide-react';

interface UnavailableAttachmentProps {
  label: string;
  /** Visible text under the icon; the label alone is only announced. */
  caption?: string;
  failedDownload?: boolean;
  className?: string;
  onActivate?: () => void;
}

/** A fixed-size icon; its surrounding slot retains the attachment's geometry. */
export function UnavailableAttachment({ label, caption, failedDownload = false, className = '', onActivate }: UnavailableAttachmentProps) {
  const Icon = failedDownload ? CircleAlert : FileX;
  const classes = `unavailable-attachment ${className}`;
  const icon = caption
    ? <><Icon size={24} aria-hidden="true" /><span className="unavailable-attachment-caption" aria-hidden="true">{caption}</span></>
    : <Icon size={24} aria-hidden="true" />;
  return onActivate ? (
    <button type="button" className={classes} aria-label={label} title={label} onClick={onActivate}>
      {icon}
    </button>
  ) : (
    <span className={classes} role="img" aria-label={label} title={label}>
      {icon}
    </span>
  );
}
