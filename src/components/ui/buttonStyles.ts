import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'inverse' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
}

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  block,
  className,
}: ButtonStyleProps): string {
  return [
    styles.button,
    styles[variant],
    size !== 'md' && styles[size],
    block && styles.block,
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

export const buttonIconClass = styles.icon;
export const buttonSpinnerClass = styles.spinner;
