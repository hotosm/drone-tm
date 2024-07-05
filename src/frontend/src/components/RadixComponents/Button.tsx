/* eslint-disable react/prop-types */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { VariantProps, cva } from 'class-variance-authority';
import { cn } from '@Utils/index';
import Icon from '@Components/common/Icon';
import Spinner from '@Components/common/Spinner';

const buttonVariants = cva(
  `naxatw-inline-flex naxatw-items-center naxatw-justify-center naxatw-rounded-md naxatw-text-sm
  naxatw-font-bold naxatw-transition-colors focus-visible:naxatw-outline-none focus-visible:naxatw-ring-2
  focus-visible:ring-ring focus-visible:naxatw-ring-offset-2 disabled:naxatw-opacity-50 disabled:naxatw-pointer-events-none`,
  {
    variants: {
      variant: {
        default:
          'naxatw-bg-primary-400 naxatw-text-white hover:naxatw-shadow-top hover:naxatw-shadow-primary-400',
        destructive:
          'naxatw-bg-red-500 naxatw-text-white hover:naxatw-shadow-top hover:naxatw-shadow-red-500',
        outline: `naxatw-border naxatw-text-primary-400 naxatw-border-primary-400 naxatw-border-input
        hover:naxatw-shadow-top naxatw-bg-white`,
        secondary:
          'naxatw-bg-white naxatw-text-primary-400 naxatw-border naxatw-border-primary-400 hover:naxatw-shadow-top',
        ghost:
          'naxatw-text-primary-400 naxatw-font-bold disabled:naxatw-text-grey-600 hover:naxatw-text-primary-500',
        link: `naxatw-text-primary-400 naxatw-font-bold naxatw-underline-offset-4 naxatw-underline hover:naxatw-no-underline
         naxatw-text-primarycolor hover:naxatw-shadow hover:naxatw-shadow-primary-400`,
      },
      size: {
        default: 'naxatw-h-9 naxatw-py-2 naxatw-px-3',
        sm: 'naxatw-h-7 naxatw-px-2 naxatw-rounded-lg',
        lg: 'naxatw-h-11 naxatw-px-8 naxatw-rounded-md',
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

const ButtonContent = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
ButtonContent.displayName = 'Button';

interface IButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  name?: string;
  leftIcon?: string;
  rightIcon?: string;
  iconClassname?: string;
  withLoader?: boolean;
  className?: string;
  isLoading?: boolean;
}

function Button({
  leftIcon,
  rightIcon,
  children,
  iconClassname,
  withLoader,
  isLoading,
  className,
  ...rest
}: IButtonProps) {
  return (
    <ButtonContent
      {...rest}
      className={`naxatw-flex naxatw-items-center naxatw-gap-1 ${className}`}
    >
      {leftIcon && (
        <Icon
          className={`${iconClassname} !naxatw-text-icon-sm`}
          name={leftIcon}
        />
      )}
      {children}
      {rightIcon && (
        <Icon
          className={`${iconClassname} !naxatw-text-icon-sm`}
          name={rightIcon}
        />
      )}
      {withLoader && isLoading && (
        <Spinner className="naxatw-fill-primary-500" />
      )}
    </ButtonContent>
  );
}

export { Button, buttonVariants };
