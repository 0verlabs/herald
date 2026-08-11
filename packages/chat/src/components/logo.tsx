import type { VariantProps } from "class-variance-authority";
import { cn } from "@hrld/ui/lib/utils";
import { cva } from "class-variance-authority";

const logoVariants = cva(
  "rounded-md transition-opacity group-data-[collapsible=icon]:group-hover/logo:opacity-0",
  {
    variants: {
      size: {
        xs: "size-5",
        sm: "size-6",
        default: "size-7",
        lg: "size-8",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

type LogoProps = React.ComponentProps<"img"> & VariantProps<typeof logoVariants>;

function Logo({ className, size, ...props }: LogoProps) {
  return (
    <img src="/logo.svg" alt="" className={cn(logoVariants({ size, className }))} {...props} />
  );
}

export { Logo, logoVariants };
