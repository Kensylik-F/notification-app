import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './styles.module.css';

export const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).join(' ');

const ICON_PATHS = {
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z M10 20.5a2 2 0 0 0 4 0',
  close: 'M6 6l12 12 M18 6L6 18',
  checkAll: 'M3 12.5l4 4 8-9 M12 16.5l1 1 8-9',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5.5 M12 7.6h.01',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, small }: { name: IconName; small?: boolean }) {
  return (
    <svg
      className={cx(styles.icon, small && styles.iconSmall)}
      viewBox='0 0 24 24'
      aria-hidden='true'
      focusable='false'
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost';
  icon?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'outline',
      icon,
      className,
      children,
      type = 'button',
      ...rest
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          styles.button,
          variant === 'primary' && styles.buttonPrimary,
          variant === 'outline' && styles.buttonOutline,
          variant === 'ghost' && styles.buttonGhost,
          className
        )}
        {...rest}
      >
        {icon && <Icon name={icon} small />}
        {children}
      </button>
    );
  }
);

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** An icon-only button has no text, so the label is mandatory. */
  label: string;
  small?: boolean;
  children?: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon, label, small, className, children, type = 'button', ...rest },
    ref
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(styles.iconButton, className)}
        aria-label={label}
        title={label}
        {...rest}
      >
        <Icon name={icon} small={small} />
        {children}
      </button>
    );
  }
);

export function Spinner({ label }: { label?: string }) {
  return <span className={styles.spinner} role='status' aria-label={label} />;
}

export function StateBlock({
  title,
  note,
  action,
}: {
  title: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.state}>
      <span className={styles.stateTitle}>{title}</span>
      {note && <span className={styles.stateNote}>{note}</span>}
      {action}
    </div>
  );
}
