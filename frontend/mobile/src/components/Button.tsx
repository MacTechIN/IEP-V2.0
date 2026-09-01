import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'danger';
type Size = 'small' | 'medium' | 'large';

interface ButtonProps {
  label: string;
  variant?: Variant;
  size?: Size;
  onPress: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

const styles = StyleSheet.create({
  small: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  medium: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  large: {
    height: 56,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  primary: {
    backgroundColor: '#0066CC',
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#0066CC',
  },
  tertiary: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: '#EF4444',
  },
  text: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  secondaryText: {
    color: '#0066CC',
  },
  tertiaryText: {
    color: '#0066CC',
  },
  disabled: {
    opacity: 0.6,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export const Button: React.FC<ButtonProps> = ({
  label,
  variant = 'primary',
  size = 'medium',
  onPress,
  disabled = false,
  isLoading = false,
  fullWidth = false,
  icon,
}) => {
  const sizeStyle = styles[size];
  const variantStyle = styles[variant];
  const textColor = variant === 'primary' || variant === 'danger' ? styles.text :
                    variant === 'secondary' ? styles.secondaryText : styles.tertiaryText;

  const containerStyle: ViewStyle[] = [
    sizeStyle,
    variantStyle,
    disabled && styles.disabled,
    fullWidth && styles.fullWidth,
  ];

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={onPress}
      disabled={disabled || isLoading}
      activeOpacity={0.7}
    >
      {isLoading ? (
        <ActivityIndicator
          color={variant === 'primary' || variant === 'danger' ? '#fff' : '#0066CC'}
          size="small"
        />
      ) : (
        <Text style={[textColor, { fontSize: size === 'small' ? 12 : size === 'medium' ? 14 : 16 }]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
};
