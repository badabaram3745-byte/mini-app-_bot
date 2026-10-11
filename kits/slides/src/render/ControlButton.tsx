import type { ButtonHTMLAttributes } from "react";

type ControlButtonVariant = "ghost" | "menu" | "primary";

interface ControlButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  iconOnly?: boolean;
  variant?: ControlButtonVariant;
}

export function ControlButton({
  className,
  iconOnly = false,
  type = "button",
  variant = "ghost",
  ...props
}: ControlButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`slide-kit-button ${className ?? ""}`.trim()}
      data-icon-only={iconOnly ? "true" : undefined}
      data-variant={variant}
    />
  );
}
