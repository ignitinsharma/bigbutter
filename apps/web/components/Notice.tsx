"use client";

type Props = { text: string; onDismiss: () => void };

export default function Notice({ text, onDismiss }: Props) {
  return (
    <div className="anim-enter mb-4 px-3 py-2 text-[13px] rounded border flex justify-between gap-3"
      style={{ background: "#F6EBD2", borderColor: "#E0CDA0" }}>
      <span>{text}</span>
      <button onClick={onDismiss} className="text-accent text-[13px] shrink-0">Dismiss</button>
    </div>
  );
}
