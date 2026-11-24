"use client";

import { ChevronDown, CircleAlert, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Button({ variant = "secondary", className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "icon";
}) {
  return <button type={type} className={cn("button", `button--${variant}`, className)} {...props} />;
}

export function SelectField({ label, className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const labelId = `${id}-label`;
  return (
    <label className={`field ${className}`} htmlFor={id}>
      <span id={labelId}>{label}</span>
      <span className="select-control"><select {...props} id={id} aria-labelledby={props["aria-labelledby"] ?? labelId}>{children}</select><ChevronDown size={14} aria-hidden="true" /></span>
    </label>
  );
}

export function Segment<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string; icon?: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const indicator = useId();
  return <div className="segment" role="group" aria-label={label}>
    {options.map(option => <button type="button" key={option.value} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
      {option.icon}{option.label}
      {option.value === value && <motion.span className="segment-indicator" aria-hidden="true" layoutId={indicator} initial={false} transition={{ type: "spring", stiffness: 620, damping: 48, bounce: 0 }} />}
    </button>)}
  </div>;
}

export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "warning" | "positive"; children: ReactNode; title?: string }) {
  return <span className={`badge badge--${tone}`} title={title}>{children}</span>;
}

export function PageHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <header className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{children}</header>;
}

export function PanelHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return <header className="panel-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{children}</header>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><CircleAlert size={20} aria-hidden="true" /><strong>{title}</strong><div>{children}</div></div>;
}

export function Dialog({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return <dialog ref={dialogRef} className="detail-dialog" aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.currentTarget === event.target) onClose(); }}>
    <div className="dialog-content">
      <header className="panel-header"><div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div><Button variant="icon" onClick={onClose} aria-label="Close dialog"><X size={20} /></Button></header>
      {children}
    </div>
  </dialog>;
}
