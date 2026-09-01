import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Text, Card, Button } from 'react-native-paper';
import { useAppDispatch } from '../store';
import { logout } from '../store/slices/authSlice';
import { apiClient } from '../services/api';
import type { User } from '../types';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  scrollContent: {
    padding: 16,
  },
  card: {
    marginBottom: 16,
    borderRadius: 12,
  },
  cardContent: {
    padding: 16,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#0066CC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#6B7280',
  },
  infoRow: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 14,
    color: '#1F2937',
    fontWeight: '500',
  },
  logoutButton: {
    marginTop: 20,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
});

export default function ProfileScreen() {
  const dispatch = useAppDispatch();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await apiClient.getMe();
        if (response.success) {
          setUser(response.data);
        }
      } catch (error) {
        Alert.alert('오류', '사용자 정보를 불러올 수 없습니다');
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, []);

  const handleLogout = () => {
    Alert.alert('로그아웃', '정말 로그아웃하시겠습니까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: () => {
          dispatch(logout());
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#0066CC" />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text>사용자 정보를 불러올 수 없습니다</Text>
      </View>
    );
  }

  const initials = (user.name || user.email)
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.scrollContent}>
        <Card style={styles.card}>
          <View style={styles.cardContent}>
            <View style={styles.profileHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
              <Text style={styles.name}>{user.name}</Text>
              <Text style={styles.email}>{user.email}</Text>
            </View>
          </View>
        </Card>

        <Card style={styles.card}>
          <View style={styles.cardContent}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>역할</Text>
              <Text style={styles.infoValue}>{user.role === 'admin' ? '관리자' : '영업사원'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>가입일</Text>
              <Text style={styles.infoValue}>
                {new Date(user.createdAt).toLocaleDateString('ko-KR')}
              </Text>
            </View>
            <View>
              <Text style={styles.infoLabel}>마지막 업데이트</Text>
              <Text style={styles.infoValue}>
                {new Date(user.updatedAt).toLocaleDateString('ko-KR')}
              </Text>
            </View>
          </View>
        </Card>

        <Button
          mode="contained"
          onPress={handleLogout}
          buttonColor="#DC2626"
          textColor="#FFFFFF"
          style={styles.logoutButton}
        >
          로그아웃
        </Button>
      </View>
    </ScrollView>
  );
}
