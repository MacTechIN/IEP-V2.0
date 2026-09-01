import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { RootState, AppDispatch } from '../store';
import { apiClient } from '../services/api';
import { setCurrentMeeting } from '../store/slices/meetingSlice';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  scrollContent: {
    padding: 16,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  date: {
    fontSize: 12,
    color: '#6B7280',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 24,
    textAlign: 'center',
  },
  cardContent: {
    marginTop: 8,
  },
  textBold: {
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  textSecondary: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  scoreValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0066CC',
  },
  scoreLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  actionButton: {
    marginTop: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export const HomeScreen: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { currentMeeting, isLoading, error } = useSelector(
    (state: RootState) => state.meeting,
  );
  const { user } = useSelector((state: RootState) => state.auth);

  const [analysis, setAnalysis] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  const loadLatestMeeting = async () => {
    try {
      const response = await apiClient.getMeetings({ limit: 1 });
      if (response.success && response.data?.length > 0) {
        dispatch(setCurrentMeeting(response.data[0]));
      }
    } catch (err) {
      console.error('Failed to load meeting:', err);
    }
  };

  useEffect(() => {
    loadLatestMeeting();
  }, [dispatch]);

  useEffect(() => {
    const loadAnalysis = async () => {
      if (!currentMeeting?.id) return;

      setLoadingAnalysis(true);
      try {
        const response = await apiClient.getAnalysis(currentMeeting.id);
        if (response.success) {
          setAnalysis(response.data);
        }
      } catch (err) {
        console.error('Failed to load analysis:', err);
      } finally {
        setLoadingAnalysis(false);
      }
    };

    loadAnalysis();
  }, [currentMeeting?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLatestMeeting();
    setRefreshing(false);
  };

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  if (isLoading && !currentMeeting) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0066CC" />
        </View>
      </SafeAreaView>
    );
  }

  if (!currentMeeting) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.centerContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          <Text style={styles.emptyText}>아직 미팅이 없습니다</Text>
          <Text style={styles.emptySubtext}>
            새로운 미팅을 기록하시면 분석 결과를 볼 수 있습니다.
          </Text>
          <View style={{ width: '100%' }}>
            <Button
              label="미팅 기록하기"
              size="large"
              fullWidth
              onPress={() => console.log('Upload meeting')}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* 헤더 */}
        <View style={styles.header}>
          <Text style={styles.greeting}>안녕하세요, {user?.name}님!</Text>
          <Text style={styles.date}>{today}</Text>
        </View>

        {/* 카드 1: 고객 니즈 파악 */}
        <Card
          title="고객 니즈 파악"
          status={analysis ? 'completed' : 'pending'}
        >
          {loadingAnalysis ? (
            <ActivityIndicator size="small" color="#0066CC" />
          ) : analysis ? (
            <View style={styles.cardContent}>
              <Text style={styles.textBold}>
                {analysis.customerNeeds.primary}
              </Text>
              <Text style={styles.textSecondary}>
                우선순위: {analysis.customerNeeds.secondary.length}개
              </Text>
              <View style={styles.actionButton}>
                <Button
                  label="자세히 보기"
                  variant="secondary"
                  size="small"
                  onPress={() => console.log('View details')}
                />
              </View>
            </View>
          ) : (
            <Text style={styles.textSecondary}>분석 중입니다...</Text>
          )}
        </Card>

        {/* 카드 2: 거래 신호 */}
        <Card
          title="거래 신호 감지"
          status={analysis ? 'completed' : 'pending'}
        >
          {loadingAnalysis ? (
            <ActivityIndicator size="small" color="#0066CC" />
          ) : analysis ? (
            <View style={styles.cardContent}>
              <Text style={styles.textBold}>
                신호 강도: {analysis.dealSignals.strength.toFixed(1)}/10
              </Text>
              <Text style={styles.textSecondary}>
                계약 확률: {(analysis.dealSignals.closingProbability * 100).toFixed(0)}%
              </Text>
              <Text style={[styles.textSecondary, { marginTop: 8 }]}>
                {analysis.dealSignals.nextSteps}
              </Text>
            </View>
          ) : (
            <Text style={styles.textSecondary}>분석 중입니다...</Text>
          )}
        </Card>

        {/* 카드 3: 다음 액션 */}
        <Card title="다음 액션" status="pending">
          <View style={styles.cardContent}>
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.textBold}>☐ 기술검토 일정 잡기</Text>
              <Text style={styles.textSecondary}>기한: 2026-08-10</Text>
            </View>
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.textBold}>☐ ROI 분석 자료 준비</Text>
              <Text style={styles.textSecondary}>기한: 2026-08-09</Text>
            </View>
            <Button
              label="모든 액션 보기"
              variant="secondary"
              size="small"
              onPress={() => console.log('View all actions')}
            />
          </View>
        </Card>

        {/* 카드 4: 내 점수 */}
        <Card title="이번 미팅 점수" status="completed">
          {loadingAnalysis ? (
            <ActivityIndicator size="small" color="#0066CC" />
          ) : analysis ? (
            <View style={styles.cardContent}>
              <Text style={styles.scoreValue}>{analysis.scores.overall}</Text>
              <Text style={styles.scoreLabel}>/ 100</Text>
              <Text style={[styles.textSecondary, { marginTop: 12 }]}>
                좋은 성과입니다! 💪
              </Text>
            </View>
          ) : (
            <Text style={styles.textSecondary}>점수 계산 중...</Text>
          )}
        </Card>

        {/* 카드 5: 개선 영역 */}
        <Card title="개선 영역" status="completed">
          {loadingAnalysis ? (
            <ActivityIndicator size="small" color="#0066CC" />
          ) : analysis ? (
            <View style={styles.cardContent}>
              <Text style={styles.textSecondary}>
                다음 개선이 도움이 될 것 같습니다:
              </Text>
              <Text style={[styles.textBold, { marginTop: 8 }]}>
                • 고객 접촉 빈도 증가
              </Text>
              <Text style={[styles.textBold, { marginTop: 4 }]}>
                • 제안서 작성 속도 개선
              </Text>
            </View>
          ) : (
            <Text style={styles.textSecondary}>분석 중입니다...</Text>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};
