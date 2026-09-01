import React, { useEffect, useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  SafeAreaView,
  RefreshControl,
  Text,
  TouchableOpacity,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../store';
import { setCurrentMeeting } from '../store/slices/meetingSlice';
import { apiClient } from '../services/api';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  item: {
    backgroundColor: '#fff',
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  date: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
    color: '#16A34A',
  },
});

export const MeetingListScreen: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const [meetings, setMeetings] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadMeetings = async () => {
    try {
      const response = await apiClient.getMeetings({ limit: 20 });
      if (response.success) {
        setMeetings(response.data);
      }
    } catch (err) {
      console.error('Failed to load meetings:', err);
    }
  };

  useEffect(() => {
    loadMeetings();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMeetings();
    setRefreshing(false);
  };

  const handleSelectMeeting = (meeting: any) => {
    dispatch(setCurrentMeeting(meeting));
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.item}
      onPress={() => handleSelectMeeting(item)}
      activeOpacity={0.7}
    >
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.date}>
        {new Date(item.createdAt).toLocaleDateString('ko-KR')}
      </Text>
      <Text style={styles.status}>
        {item.analysisStatus === 'completed' ? '✓ 분석 완료' : '진행 중...'}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={meetings}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
            <Text style={styles.title}>미팅이 없습니다</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};
