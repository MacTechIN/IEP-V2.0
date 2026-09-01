import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text } from 'react-native';
import { HomeScreen } from '../screens/HomeScreen';
import { MeetingListScreen } from '../screens/MeetingListScreen';
import PerformanceScreen from '../screens/PerformanceScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 8,
    paddingBottom: 8,
    height: 60,
  },
});

interface TabIconProps {
  focused: boolean;
  color: string;
  size: number;
}

const HomeIcon: React.FC<TabIconProps> = ({ focused }) => (
  <Text style={{ fontSize: 24, color: focused ? '#0066CC' : '#6B7280' }}>
    🏠
  </Text>
);

const MeetingIcon: React.FC<TabIconProps> = ({ focused }) => (
  <Text style={{ fontSize: 24, color: focused ? '#0066CC' : '#6B7280' }}>
    📋
  </Text>
);

const PerformanceIcon: React.FC<TabIconProps> = ({ focused }) => (
  <Text style={{ fontSize: 24, color: focused ? '#0066CC' : '#6B7280' }}>
    📊
  </Text>
);

const ProfileIcon: React.FC<TabIconProps> = ({ focused }) => (
  <Text style={{ fontSize: 24, color: focused ? '#0066CC' : '#6B7280' }}>
    👤
  </Text>
);

export const BottomTabNavigator: React.FC = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#0066CC',
        tabBarInactiveTintColor: '#6B7280',
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
          marginTop: 4,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: '홈',
          tabBarIcon: HomeIcon,
        }}
      />
      <Tab.Screen
        name="Meetings"
        component={MeetingListScreen}
        options={{
          title: '미팅',
          tabBarIcon: MeetingIcon,
        }}
      />
      <Tab.Screen
        name="Performance"
        component={PerformanceScreen}
        options={{
          title: '성과',
          tabBarIcon: PerformanceIcon,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: '설정',
          tabBarIcon: ProfileIcon,
        }}
      />
    </Tab.Navigator>
  );
};

export default BottomTabNavigator;
