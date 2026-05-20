import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Tailwind v4 preflight resets the default button cursor — add it back so
  // every Button gets `cursor-pointer`. `active:scale-[0.98]` gives a
  // subtle press feel that telegraphs interactivity on hover/click.
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all active:scale-[0.98] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:bg-primary/85 hover:shadow-md',
        destructive:
          'bg-red-600 text-white shadow-sm hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600',
        // Slice 10 polish: emerald `success` variant for affirmative
        // actions (Start loop, Save, etc.). Pairs visually with
        // destructive (red Stop loop) so green/red telegraph the toggle.
        success:
          'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground hover:border-ring',
        secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/70',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
