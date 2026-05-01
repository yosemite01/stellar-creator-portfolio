import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85 hover:shadow-lg hover:shadow-primary/25 active:scale-95 dark:hover:bg-primary/75',
        destructive:
          'bg-destructive text-white hover:bg-destructive/85 hover:shadow-lg hover:shadow-destructive/25 active:scale-95 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border border-border/60 bg-background shadow-sm hover:bg-secondary/50 hover:border-accent/60 hover:shadow-md active:scale-95 dark:bg-input/20 dark:border-input/40 dark:hover:bg-input/40',
        secondary:
          'bg-secondary/80 text-secondary-foreground hover:bg-secondary hover:shadow-md active:scale-95 dark:hover:bg-secondary/70',
        ghost:
          'hover:bg-accent/10 hover:text-accent active:scale-95 dark:hover:bg-accent/20',
        link: 'text-primary underline-offset-4 hover:text-primary/80 hover:underline active:scale-95',
      },
      size: {
        default: 'h-10 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-lg gap-1.5 px-3 has-[>svg]:px-2.5 text-xs',
        lg: 'h-11 rounded-lg px-6 has-[>svg]:px-4 text-base',
        icon: 'size-10 rounded-lg',
        'icon-sm': 'size-8 rounded-lg',
        'icon-lg': 'size-11 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
