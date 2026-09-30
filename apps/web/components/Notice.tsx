"use client";

type Props = { text: string; onDismiss: () => void };

export default function Notice({ text, onDismiss }: Props) {
  return (
    <div role="status" className="anim-enter mb-4 pl-4 pr-2 py-2 text-[13px] text-soft rounded-xl border border-primary-100 bg-primary-50 flex items-center justify-between gap-3">
      <span>{text}</span>
      <button onClick={onDismiss} className="btn shrink-0 h-7 px-2.5 text-[13px] text-primary hover:bg-primary-100">Dismiss</button>
    </div>
  );
}
