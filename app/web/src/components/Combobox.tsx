import { useEffect, useMemo, useRef, useState } from 'react';

export interface Option {
  code: string;
  label: string; // full name shown in the list
  sub?: string; // city / secondary line
}

interface ComboboxProps {
  label: string;
  options: Option[];
  value: string | null;
  onChange: (code: string) => void;
  placeholder?: string;
}

export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder = 'Search…',
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.code === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 80);
    return options
      .filter(
        (o) =>
          o.code.toLowerCase().includes(q) ||
          o.label.toLowerCase().includes(q) ||
          (o.sub?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 80);
  }, [options, query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && filtered[active]) {
      e.preventDefault();
      pick(filtered[active].code);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </label>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setActive(0);
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-hairline bg-panel-2 px-3 py-2 text-left transition hover:border-accent/50"
      >
        <span className="min-w-0">
          {selected ? (
            <span className="flex items-baseline gap-2">
              <span className="tnum text-xs font-bold text-accent">
                {selected.code}
              </span>
              <span className="truncate text-[13px] text-ink">
                {selected.label}
              </span>
            </span>
          ) : (
            <span className="text-[13px] text-ink-faint">{placeholder}</span>
          )}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          className="shrink-0 text-ink-faint"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="m3.5 5 3.5 3.5L10.5 5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-hairline bg-panel shadow-panel">
          <div className="border-b border-hairline/70 p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              placeholder={placeholder}
              className="w-full rounded-md bg-panel-2 px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:ring-1 focus:ring-accent/60"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-center text-xs text-ink-faint">
                No matches
              </li>
            )}
            {filtered.map((o, i) => (
              <li key={o.code}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(o.code)}
                  className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${
                    i === active ? 'bg-accent/12' : ''
                  }`}
                >
                  <span className="tnum w-9 shrink-0 text-[11px] font-bold text-accent">
                    {o.code}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">
                      {o.label}
                    </span>
                    {o.sub && (
                      <span className="block truncate text-[11px] text-ink-faint">
                        {o.sub}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
