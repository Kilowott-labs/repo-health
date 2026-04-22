import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';   // which edge of the trigger to align the popover to
  className?: string;         // applied to popover panel
  maxHeight?: number;
}

// Portal-rendered popover — escapes any clipping `overflow: hidden`
// / `z-index` stacking context of ancestors. Position is computed
// from the trigger's getBoundingClientRect and recomputed on
// window resize/scroll while open.
export function Popover({ trigger, children, align = 'left', className = '', maxHeight = 320 }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const toggle = () => setOpen(v => !v);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // 4px gap below the trigger
    const top = rect.bottom + 4;
    const left = align === 'right' ? rect.right : rect.left;
    setPos({ top, left, width: rect.width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <div ref={triggerRef} className="inline-block">
        {trigger({ open, toggle })}
      </div>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          className={`fixed z-50 min-w-[180px] max-w-xs border border-border bg-bg-secondary rounded-sm py-1 shadow-lg ${className}`}
          style={{
            top: pos.top,
            ...(align === 'right'
              ? { left: pos.left, transform: 'translateX(-100%)' }
              : { left: pos.left }),
            maxHeight,
            overflowY: 'auto',
          }}
          role="dialog"
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
