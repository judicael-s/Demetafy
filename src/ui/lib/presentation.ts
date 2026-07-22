export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ControlSize = "sm" | "md";

const baseClasses =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium leading-5 tracking-[0.01em] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus transition-[background-color,border-color,color,box-shadow] duration-150 motion-reduce:transition-none";

const sizeClasses: Record<ControlSize, string> = {
  sm: "min-h-8 px-3 text-xs",
  md: "min-h-10",
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "btn-brand text-accent-ink shadow-sm hover:brightness-105 active:brightness-95",
  secondary: "border border-border bg-surface text-ink shadow-sm hover:bg-surface-2",
  ghost: "text-ink hover:bg-surface-2",
  danger: "bg-danger text-danger-ink shadow-sm hover:bg-danger-hover",
};

export function buttonClasses(variant: ButtonVariant, size: ControlSize): string {
  return [baseClasses, sizeClasses[size], variantClasses[variant]].join(" ");
}
