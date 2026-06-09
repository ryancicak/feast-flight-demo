import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  eyebrow?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, eyebrow, right, children, className = '' }: PanelProps) {
  return (
    <section
      className={`rounded-2xl border border-hairline bg-panel/90 shadow-panel backdrop-blur-md ${className}`}
    >
      {(title || eyebrow || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-hairline/70 px-4 py-3">
          <div>
            {eyebrow && (
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                {eyebrow}
              </div>
            )}
            {title && (
              <h2 className="text-[13px] font-semibold tracking-tight text-ink">
                {title}
              </h2>
            )}
          </div>
          {right}
        </header>
      )}
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}
