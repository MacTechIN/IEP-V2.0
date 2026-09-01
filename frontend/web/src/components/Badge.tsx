import React from 'react';
import { Chip, ChipProps } from '@mui/material';

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type Size = 'small' | 'medium';

interface BadgeProps extends Omit<ChipProps, 'variant' | 'size' | 'icon'> {
  label: string;
  variant?: Variant;
  size?: Size;
  removable?: boolean;
  onRemove?: () => void;
}

const colorMap = {
  success: { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  warning: { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  danger: { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
  info: { bg: '#CFFAFE', text: '#164E63', border: '#67E8F9' },
  neutral: { bg: '#F3F4F6', text: '#374151', border: '#D1D5DB' },
};

const sizeMap = {
  small: { height: '24px', fontSize: '12px' },
  medium: { height: '32px', fontSize: '14px' },
};

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'neutral',
  size = 'medium',
  removable = false,
  onRemove,
  ...props
}) => {
  const colors = colorMap[variant];
  const sizeStyles = sizeMap[size];

  return (
    <Chip
      label={label}
      onDelete={removable ? onRemove : undefined}
      sx={{
        ...sizeStyles,
        backgroundColor: colors.bg,
        color: colors.text,
        borderColor: colors.border,
        border: `1px solid ${colors.border}`,
        fontWeight: 500,
      }}
      variant="outlined"
      {...props}
    />
  );
};
