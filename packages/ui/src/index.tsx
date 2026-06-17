import type {
  ButtonHTMLAttributes,
  ComponentPropsWithoutRef,
  ElementType,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export const uiPackageName = "@zara/ui";

type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "default" | "sm" | "lg" | "icon";

const buttonVariants: Record<Variant, string> = {
  default: "zara-ui-button--default",
  secondary: "zara-ui-button--secondary",
  outline: "zara-ui-button--outline",
  ghost: "zara-ui-button--ghost",
  destructive: "zara-ui-button--destructive",
};

const buttonSizes: Record<Size, string> = {
  default: "zara-ui-button--size-default",
  sm: "zara-ui-button--size-sm",
  lg: "zara-ui-button--size-lg",
  icon: "zara-ui-button--size-icon",
};

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn("zara-ui-button", buttonVariants[variant], buttonSizes[size], className)}
      type={type}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("zara-ui-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("zara-ui-card-header", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("zara-ui-card-title", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("zara-ui-card-description", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("zara-ui-card-content", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("zara-ui-card-footer", className)} {...props} />;
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "outline" | "destructive";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return <span className={cn("zara-ui-badge", `zara-ui-badge--${variant}`, className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("zara-ui-input", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("zara-ui-input zara-ui-textarea", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("zara-ui-input zara-ui-select", className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("zara-ui-label", className)} {...props} />;
}

export function FieldGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("zara-ui-field-group", className)} {...props} />;
}

export function Field({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("zara-ui-field", className)} {...props} />;
}

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <Label className={cn("zara-ui-field-label", className)} {...props} />;
}

export function FieldDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("zara-ui-field-description", className)} {...props} />;
}

export function Separator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("zara-ui-separator", className)} role="separator" {...props} />;
}

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("zara-ui-alert", className)} role="status" {...props} />;
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("zara-ui-alert-title", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("zara-ui-alert-description", className)} {...props} />;
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("zara-ui-table", className)} {...props} />;
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("zara-ui-table-header", className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("zara-ui-table-body", className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("zara-ui-table-row", className)} {...props} />;
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("zara-ui-table-head", className)} {...props} />;
}

export function TableCell({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("zara-ui-table-cell", className)} {...props} />;
}

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  value?: string;
}

export function Tabs({ className, ...props }: TabsProps) {
  return <div className={cn("zara-ui-tabs", className)} {...props} />;
}

export function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("zara-ui-tabs-list", className)} role="tablist" {...props} />;
}

export interface TabsTriggerProps extends ButtonProps {
  active?: boolean;
}

export function TabsTrigger({ active = false, className, ...props }: TabsTriggerProps) {
  return (
    <Button
      aria-selected={active}
      className={cn("zara-ui-tabs-trigger", active && "zara-ui-tabs-trigger--active", className)}
      role="tab"
      variant="ghost"
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("zara-ui-tabs-content", className)} role="tabpanel" {...props} />;
}

export interface EmptyProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: string;
  description?: string;
}

export function Empty({ className, icon, title, description, children, ...props }: EmptyProps) {
  return (
    <div className={cn("zara-ui-empty", className)} {...props}>
      {icon === undefined ? null : <div className="zara-ui-empty-icon">{icon}</div>}
      <h3 className="zara-ui-empty-title">{title}</h3>
      {description === undefined ? null : <p className="zara-ui-empty-description">{description}</p>}
      {children}
    </div>
  );
}

export interface AsProps<T extends ElementType> {
  as?: T;
  className?: string | undefined;
}

export function Surface<T extends ElementType = "div">({
  as,
  className,
  ...props
}: AsProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof AsProps<T>>) {
  const Component = as ?? "div";
  return <Component className={cn("zara-ui-surface", className)} {...props} />;
}
