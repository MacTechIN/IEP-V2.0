import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';

type Status = 'pending' | 'processing' | 'completed' | 'error';

interface CardProps {
  title: string;
  subtitle?: string;
  status?: Status;
  children: React.ReactNode;
  onPress?: () => void;
  actionable?: boolean;
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginLeft: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  content: {
    marginTop: 8,
  },
});

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  status,
  children,
  onPress,
  actionable = false,
}) => {
  const cardStyle: ViewStyle[] = [styles.card];

  const content = (
    <View>
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
        {status && (
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusColorMap[status] },
            ]}
          >
            <Text style={styles.statusText}>{statusLabelMap[status]}</Text>
          </View>
        )}
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );

  if (actionable && onPress) {
    return (
      <TouchableOpacity
        style={cardStyle}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{content}</View>;
};
