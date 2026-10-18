export interface Toast { id: number; text: string; kind: 'info' | 'error' }

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  return (
    <div className="toasts" data-testid="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => onDismiss(t.id)}>{t.text}</div>
      ))}
    </div>
  );
}
