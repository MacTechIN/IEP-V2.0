import React from 'react';
import {
  ListItem as MuiListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Box,
  Divider,
  Typography,
} from '@mui/material';

interface ListItemProps {
  avatar?: React.ReactNode;
  title: string;
  subtitle?: string;
  meta?: string;
  status?: 'pending' | 'completed' | 'error';
  actionable?: boolean;
  divider?: boolean;
  onPress?: () => void;
  children?: React.ReactNode;
}

const statusColorMap = {
  pending: '#6B7280',
  completed: '#16A34A',
  error: '#EF4444',
};

export const ListItem: React.FC<ListItemProps> = ({
  avatar,
  title,
  subtitle,
  meta,
  status,
  actionable = false,
  divider = true,
  onPress,
  children,
}) => {
  return (
    <>
      <MuiListItem
        sx={{
          cursor: actionable ? 'pointer' : 'default',
          transition: 'all 0.2s ease-in-out',
          '&:hover': actionable ? {
            backgroundColor: '#F9FAFB',
            transform: 'translateX(4px)',
          } : {},
        }}
        onClick={actionable ? onPress : undefined}
      >
        {avatar && (
          <ListItemAvatar>
            {typeof avatar === 'string' ? (
              <Avatar src={avatar} />
            ) : (
              avatar
            )}
          </ListItemAvatar>
        )}

        <ListItemText
          primary={
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {title}
              </Typography>
              {status && (
                <Box
                  sx={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: statusColorMap[status],
                  }}
                />
              )}
            </Box>
          }
          secondary={
            <Box sx={{ mt: 0.5 }}>
              {subtitle && (
                <Typography variant="caption" color="textSecondary">
                  {subtitle}
                </Typography>
              )}
              {meta && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.25 }}>
                  {meta}
                </Typography>
              )}
            </Box>
          }
        />
      </MuiListItem>
      {divider && <Divider />}
      {children}
    </>
  );
};
