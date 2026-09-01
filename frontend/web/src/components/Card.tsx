import React from 'react';
import {
  Card as MuiCard,
  CardContent,
  CardHeader,
  CardActions,
  Chip,
  Box,
  Typography,
} from '@mui/material';

interface CardProps {
  title: string;
  subtitle?: string;
  status?: 'pending' | 'processing' | 'completed' | 'error';
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  actionable?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  elevation?: 'low' | 'medium' | 'high';
}

const statusColorMap = {
  pending: '#6B7280',
  processing: '#F59E0B',
  completed: '#16A34A',
  error: '#EF4444',
};

const statusLabelMap = {
  pending: '대기 중',
  processing: '진행 중',
  completed: '완료',
  error: '오류',
};

const elevationMap = {
  low: 1,
  medium: 2,
  high: 4,
};

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  status,
  icon,
  badge,
  actionable = false,
  onClick,
  children,
  actions,
  elevation = 'medium',
}) => {
  return (
    <MuiCard
      elevation={elevationMap[elevation]}
      sx={{
        borderRadius: '8px',
        cursor: actionable ? 'pointer' : 'default',
        transition: 'all 0.2s ease-in-out',
        '&:hover': actionable ? {
          transform: 'translateY(-4px)',
          boxShadow: 6,
        } : {},
      }}
      onClick={actionable ? onClick : undefined}
    >
      <CardHeader
        avatar={icon}
        title={
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Typography variant="h6">{title}</Typography>
            {status && (
              <Chip
                label={statusLabelMap[status]}
                size="small"
                sx={{
                  backgroundColor: statusColorMap[status],
                  color: '#fff',
                }}
              />
            )}
            {badge}
          </Box>
        }
        subheader={subtitle}
        sx={{ pb: 0 }}
      />

      <CardContent sx={{ pt: 1 }}>
        {children}
      </CardContent>

      {actions && (
        <CardActions sx={{ justifyContent: 'flex-end', gap: 1 }}>
          {actions}
        </CardActions>
      )}
    </MuiCard>
  );
};
