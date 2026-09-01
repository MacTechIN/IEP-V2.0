import React from 'react';
import {
  Button as MuiButton,
  ButtonProps as MuiButtonProps,
  CircularProgress,
} from '@mui/material';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'danger';
type Size = 'small' | 'medium' | 'large';

interface ButtonProps extends Omit<MuiButtonProps, 'variant' | 'size'> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const variantMap = {
  primary: 'contained',
  secondary: 'outlined',
  tertiary: 'text',
  danger: 'contained',
} as const;

const colorMap = {
  primary: 'primary',
  secondary: 'primary',
  tertiary: 'primary',
  danger: 'error',
} as const;

const sizeMap = {
  small: { height: '36px', padding: '8px 12px', fontSize: '12px' },
  medium: { height: '44px', padding: '12px 16px', fontSize: '14px' },
  large: { height: '56px', padding: '16px 20px', fontSize: '16px' },
} as const;

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  isLoading = false,
  icon,
  iconPosition = 'left',
  children,
  disabled,
  ...props
}) => {
  const muiVariant = variantMap[variant];
  const color = colorMap[variant];
  const sizeStyles = sizeMap[size];

  return (
    <MuiButton
      variant={muiVariant as any}
      color={color as any}
      sx={{
        ...sizeStyles,
        textTransform: 'none',
        fontWeight: 500,
        borderRadius: '8px',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          transform: 'scale(1.02)',
        },
        '&:active': {
          transform: 'scale(0.98)',
        },
      }}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <CircularProgress size={16} sx={{ mr: 1 }} />
      ) : icon && iconPosition === 'left' ? (
        <>
          {icon}
          {children && <span style={{ marginLeft: '8px' }}>{children}</span>}
        </>
      ) : icon && iconPosition === 'right' ? (
        <>
          {children && <span style={{ marginRight: '8px' }}>{children}</span>}
          {icon}
        </>
      ) : (
        children
      )}
    </MuiButton>
  );
};
