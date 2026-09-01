import React, { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Text, Card, ProgressBar } from 'react-native-paper';
import { useAppDispatch } from '../store';
import { apiClient } from '../services/api';
import type { UserScore } from '../types';

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
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    color: '#1F2937',
  },
  scoreDisplay: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  scoreNumber: {
    fontSize: 48,
    fontWeight: '700',
    color: '#0066CC',
  },
  scoreLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  componentRow: {
    marginBottom: 16,
  },
  componentLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
    color: '#1F2937',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
});

export default function PerformanceScreen() {
  const [score, setScore] = useState<UserScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScore = async () => {
      try {
        const response = await apiClient.getDashboard();
        if (response.success) {
          setScore(response.data);
        }
      } catch (error) {
        Alert.alert('오류', '성과 정보를 불러올 수 없습니다');
      } finally {
        setLoading(false);
      }
    };

    fetchScore();
  }, []);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#0066CC" />
      </View>
    );
  }

  if (!score) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text>성과 정보를 불러올 수 없습니다</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.scrollContent}>
        <Card style={styles.card}>
          <View style={styles.cardContent}>
            <View style={styles.scoreDisplay}>
              <Text style={styles.scoreNumber}>{score.currentScore}</Text>
              <Text style={styles.scoreLabel}>현재 점수</Text>
            </View>
          </View>
        </Card>

        <Card style={styles.card}>
          <View style={styles.cardContent}>
            <Text style={styles.title}>역량 분석</Text>
            {Object.entries(score.scoreComponents).map(([key, value]) => (
              <View key={key} style={styles.componentRow}>
                <Text style={styles.componentLabel}>
                  {key === 'customerUnderstanding'
                    ? '고객 이해도'
                    : key === 'problemSolving'
                      ? '문제 해결력'
                      : key === 'proposalPersuasion'
                        ? '제안 설득력'
                        : key === 'followUp'
                          ? '후속 액션'
                          : '팀 협업'}
                  : {value}
                </Text>
                <ProgressBar progress={value / 100} color="#0066CC" />
              </View>
            ))}
          </View>
        </Card>

        <Card style={styles.card}>
          <View style={styles.cardContent}>
            <Text style={styles.title}>주간 통계</Text>
            <Text style={{ marginBottom: 8, color: '#6B7280' }}>
              미팅: {score.metrics.meetingsThisWeek}건
            </Text>
            <Text style={{ marginBottom: 8, color: '#6B7280' }}>
              액션 완료율: {Math.round(score.metrics.actionCompletionRate * 100)}%
            </Text>
            <Text style={{ color: '#6B7280' }}>
              고객 만족도: {score.metrics.customerSatisfaction.toFixed(1)}/10
            </Text>
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}
