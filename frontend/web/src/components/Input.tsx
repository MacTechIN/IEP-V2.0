import React from 'react';
import {
  TextField,
  TextFieldProps,
  InputAdornment,
  IconButton,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

interface InputProps extends Omit<TextFieldProps, 'variant'> {
  icon?: React.ReactNode;
  clearable?: boolean;
  onClear?: () => void;
}

export const Input: React.FC<InputProps> = ({
  icon,
  clearable = false,
  onClear,
  value,
  onChange,
  error,
  helperText,
  ...props
}) => {
  const [isFilled, setIsFilled] = React.useState(Boolean(value));

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setIsFilled(Boolean(event.target.value));
    onChange?.(event);
  };

  const handleClear = () => {
    setIsFilled(false);
    onClear?.();
  };

  return (
    <TextField
      variant="outlined"
      value={value}
      onChange={handleChange}
      error={error}
      helperText={helperText}
      sx={{
        '& .MuiOutlinedInput-root': {
          borderRadius: '8px',
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            backgroundColor: '#F9FAFB',
          },
          '&.Mui-focused': {
            backgroundColor: '#fff',
            boxShadow: '0 0 0 3px rgba(0, 102, 204, 0.1)',
          },
        },
      }}
      InputProps={{
        startAdornment: icon ? (
          <InputAdornment position="start">{icon}</InputAdornment>
        ) : undefined,
        endAdornment: clearable && isFilled ? (
          <InputAdornment position="end">
            <IconButton
              size="small"
              onClick={handleClear}
              edge="end"
              sx={{ mr: -1 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </InputAdornment>
        ) : undefined,
      }}
      {...props}
    />
  );
};
