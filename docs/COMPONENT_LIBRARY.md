# UI 컴포넌트 라이브러리 (Component Library)

**버전:** 1.0  
**최종 수정:** 2026-08-06  
**기술:** React (웹) + React Native (모바일)  
**디자인 시스템:** Material Design 3 기반 커스터마이징  

---

## 📦 컴포넌트 구조

```
components/
├── atoms/           (기본 요소)
│   ├── Button.tsx
│   ├── Badge.tsx
│   ├── Icon.tsx
│   ├── Text.tsx
│   └── Input.tsx
├── molecules/       (조합 요소)
│   ├── Card.tsx
│   ├── ListItem.tsx
│   ├── FormField.tsx
│   └── SearchBar.tsx
├── organisms/       (복잡한 요소)
│   ├── TabNavigation.tsx
│   ├── MeetingCard.tsx
│   ├── ActionList.tsx
│   └── ScoreDisplay.tsx
└── templates/       (페이지 레이아웃)
    ├── DashboardLayout.tsx
    └── MobileLayout.tsx
```

---

## 🔵 Atoms (기본 요소)

### **Button**

**사용:**
```tsx
<Button 
  variant="primary" 
  size="medium"
  onClick={handleClick}
  disabled={false}
>
  클릭하기
</Button>
```

**Props:**
```tsx
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'tertiary' | 'danger';
  size: 'small' | 'medium' | 'large';
  isLoading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  onClick: () => void;
  children: ReactNode;
}
```

**스타일:**
- **Primary**: 배경 #0066CC, 텍스트 흰색
- **Secondary**: 배경 투명, 테두리 #0066CC
- **Tertiary**: 텍스트만 #0066CC
- **Danger**: 배경 #EF4444

**크기:**
- **small**: 36px 높이, 12px 패딩
- **medium**: 44px 높이, 16px 패딩 (모바일 기본)
- **large**: 56px 높이, 20px 패딩

---

### **Badge**

**사용:**
```tsx
<Badge 
  label="완료" 
  variant="success"
  size="small"
  icon={<CheckIcon />}
/>
```

**Props:**
```tsx
interface BadgeProps {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  size: 'small' | 'medium';
  icon?: ReactNode;
  removable?: boolean;
  onRemove?: () => void;
}
```

**색상:**
- **success**: 배경 #D1FAE5, 텍스트 #065F46
- **warning**: 배경 #FEF3C7, 텍스트 #92400E
- **danger**: 배경 #FEE2E2, 텍스트 #991B1B
- **info**: 배경 #CFFAFE, 텍스트 #164E63

---

### **Icon**

**사용:**
```tsx
<Icon 
  name="check" 
  size={24} 
  color="#0066CC"
/>
```

**지원 아이콘:**
```
check, x, chevron-right, chevron-left
plus, minus, edit, trash, copy
star, heart, share, download, upload
clock, calendar, map, phone, mail
home, menu, search, filter, settings
```

---

### **Text**

**사용:**
```tsx
<Text 
  variant="body" 
  weight="400"
  color="#333"
>
  본문 텍스트
</Text>
```

**Variants:**
```tsx
type TextVariant = 
  | 'h1'      // 32px, 700
  | 'h2'      // 28px, 700
  | 'h3'      // 24px, 700
  | 'h4'      // 20px, 700
  | 'body'    // 16px, 400
  | 'caption' // 12px, 400
  | 'label'   // 14px, 500
```

---

### **Input**

**사용:**
```tsx
<Input 
  type="text"
  placeholder="이름을 입력하세요"
  value={value}
  onChange={handleChange}
  error="필수 필드입니다"
  disabled={false}
/>
```

**Props:**
```tsx
interface InputProps {
  type: 'text' | 'email' | 'password' | 'number';
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  disabled?: boolean;
  icon?: ReactNode;
  clearable?: boolean;
}
```

---

## 🟡 Molecules (조합 요소)

### **Card**

**사용:**
```tsx
<Card 
  title="고객 니즈 파악"
  status="completed"
  onClick={handleCardClick}
  actionable={true}
>
  <CardContent>
    <Text>• 핵심 니즈: 3개</Text>
    <Text>• 우선순위: Top 5</Text>
  </CardContent>
</Card>
```

**Props:**
```tsx
interface CardProps {
  title: string;
  subtitle?: string;
  status?: 'pending' | 'processing' | 'completed' | 'error';
  icon?: ReactNode;
  badge?: ReactNode;
  actionable?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  elevation?: 'low' | 'medium' | 'high';
}
```

**구조:**
```
┌─ 제목 + 아이콘 + 상태 배지 ─┐
│                           │
│      카드 콘텐츠            │
│                           │
│   [액션] [더보기] 버튼      │
└───────────────────────────┘
```

---

### **ListItem**

**사용:**
```tsx
<ListItem
  avatar={<Avatar src="..." />}
  title="김영희 (대표)"
  subtitle="ABC Corp"
  meta="14:00"
  status="completed"
  onPress={handlePress}
  actionable={true}
/>
```

**Props:**
```tsx
interface ListItemProps {
  avatar?: ReactNode;
  title: string;
  subtitle?: string;
  meta?: string;
  status?: 'pending' | 'completed' | 'error';
  actionable?: boolean;
  divider?: boolean;
  onPress?: () => void;
  children?: ReactNode;
}
```

---

### **FormField**

**사용:**
```tsx
<FormField
  label="고객사명"
  error="필수 필드입니다"
  required={true}
>
  <Input 
    placeholder="예: ABC Corp"
    value={value}
    onChange={setValue}
  />
</FormField>
```

**Props:**
```tsx
interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}
```

---

### **SearchBar**

**사용:**
```tsx
<SearchBar
  placeholder="미팅 검색..."
  value={searchText}
  onChange={setSearchText}
  onSearch={handleSearch}
  clearable={true}
/>
```

---

## 🟠 Organisms (복잡한 요소)

### **TabNavigation**

**사용:**
```tsx
<TabNavigation
  tabs={[
    { id: 'home', label: '홈', icon: <HomeIcon /> },
    { id: 'list', label: '목록', icon: <ListIcon /> },
    { id: 'score', label: '점수', icon: <ScoreIcon /> },
  ]}
  activeTab={activeTab}
  onTabChange={setActiveTab}
  variant="bottom"  // mobile: bottom, desktop: top
/>
```

**Props:**
```tsx
interface TabNavigationProps {
  tabs: Array<{
    id: string;
    label: string;
    icon?: ReactNode;
    badge?: number;
  }>;
  activeTab: string;
  onTabChange: (tabId: string) => void;
  variant: 'top' | 'bottom';
  animated?: boolean;
}
```

**동작:**
- 모바일: 하단 탭 (고정)
- 데스크톱: 상단 탭 (스크롤 가능)
- 탭 전환 애니메이션: 200ms 슬라이드

---

### **MeetingCard**

**사용:**
```tsx
<MeetingCard
  meeting={{
    id: 'meet-789',
    title: 'ABC Corp 미팅',
    customerName: '김영희',
    time: '2026-08-06T14:00:00Z',
    duration: 45,
    score: 82,
  }}
  onPress={handlePress}
  onAnalysisClick={handleAnalysis}
/>
```

**표시 정보:**
- 시간, 고객명, 회사명
- 미팅 점수
- 분석 진행률
- 액션 아이콘 (상세, 공유, 삭제)

---

### **ActionList**

**사용:**
```tsx
<ActionList
  actions={[
    { id: 'a1', text: '기술검토 일정', status: 'pending', dueDate: '2026-08-10' },
    { id: 'a2', text: 'ROI 분석', status: 'in_progress', dueDate: '2026-08-09' },
  ]}
  onItemCheck={handleCheck}
  onItemPress={handlePress}
  editable={true}
/>
```

**스타일:**
- 각 액션은 체크박스 + 텍스트 + 기한 표시
- 드래그 가능한 순서 변경 (모바일)
- 슬라이드 삭제 (모바일)

---

### **ScoreDisplay**

**사용:**
```tsx
<ScoreDisplay
  score={82}
  teamAverage={75}
  metrics={{
    customerUnderstanding: 88,
    problemSolving: 85,
    proposalPersuasion: 78,
    followUp: 76,
    teamCollaboration: 80,
  }}
  showComparison={true}
  showTrendChart={true}
/>
```

**표시:**
- 핵심 점수 (큰 숫자)
- 팀 평균 비교 바
- 세부 지표별 점수 차트
- 주간 추이 그래프

---

## 🟣 Templates (페이지 레이아웃)

### **DashboardLayout (웹)**

**구조:**
```
┌─────────────────────────────────────┐
│ 헤더 (사용자, 알림, 설정)            │
├─────────────────────────────────────┤
│ 컨텍스트 (뒤로, 미팅명, 날짜)       │
├─────────────────────────────────────┤
│ [탭1] [탭2] [탭3] [탭4] [탭5]        │
├──────────────────┬──────────────────┤
│                  │                  │
│   좌측 (50%)     │   우측 (50%)     │
│                  │                  │
│                  │                  │
└──────────────────┴──────────────────┘
```

---

### **MobileLayout**

**구조:**
```
┌──────────────────┐
│ 상태바           │
├──────────────────┤
│ 콘텐츠 영역      │
│ (스크롤 가능)    │
├──────────────────┤
│ 하단 탭 네비게이션 │ (고정)
└──────────────────┘
```

---

## 🎨 그리드 & 스페이싱

### **스페이싱 시스템 (4px 기본 단위)**

```tsx
const spacing = {
  xs: 4,      // 4px
  sm: 8,      // 8px
  md: 12,     // 12px
  lg: 16,     // 16px
  xl: 20,     // 20px
  xxl: 24,    // 24px
  xxxl: 32,   // 32px
};
```

### **브레이크포인트**

```tsx
const breakpoints = {
  mobile: 320,     // 320px - 768px
  tablet: 768,     // 768px - 1024px
  desktop: 1024,   // 1024px+
};
```

### **반응형 그리드**

```tsx
// 모바일: 1칼럼
// 태블릿: 2칼럼
// 데스크톱: 3칼럼

<Grid 
  columns={{ mobile: 1, tablet: 2, desktop: 3 }}
  gap={16}
>
  {items.map(item => <GridItem key={item.id}>{item}</GridItem>)}
</Grid>
```

---

## 🎬 애니메이션 & 트랜지션

### **진입 애니메이션**

```tsx
const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.3 },
};

const slideUp = {
  initial: { y: 20, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  transition: { duration: 0.3, delay: 0.1 },
};

const scaleIn = {
  initial: { scale: 0.95, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  transition: { duration: 0.2 },
};
```

### **상호작용 애니메이션**

```tsx
// 버튼 클릭
const buttonTap = {
  whileTap: { scale: 0.95 },
  transition: { duration: 0.1 },
};

// 리스트 항목 호버
const listItemHover = {
  whileHover: { backgroundColor: '#F3F4F6' },
  transition: { duration: 0.15 },
};
```

---

## 🔗 테마 & 색상

### **컬러 팔레트**

```tsx
const colors = {
  // Primary
  primary: {
    50: '#EEF7FF',
    100: '#D1E7FF',
    500: '#0066CC',  // 기본
    600: '#0052A3',
    700: '#003D7A',
    900: '#001A33',
  },
  
  // Semantic
  success: '#16A34A',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#06B6D4',
  
  // Gray
  gray: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
  },
  
  // Background
  bg: '#FFFFFF',
  bgSecondary: '#F9FAFB',
  
  // Text
  text: '#111827',
  textSecondary: '#6B7280',
  textDisabled: '#D1D5DB',
};
```

---

## ✅ 개발 체크리스트

### **Atoms 완성**
- [ ] Button (모든 variant)
- [ ] Badge (모든 color)
- [ ] Icon (모든 아이콘)
- [ ] Text (모든 variant)
- [ ] Input (모든 type)
- [ ] Checkbox, Radio, Toggle

### **Molecules 완성**
- [ ] Card
- [ ] ListItem
- [ ] FormField
- [ ] SearchBar
- [ ] Modal, Dialog
- [ ] Tooltip, Popover

### **Organisms 완성**
- [ ] TabNavigation
- [ ] MeetingCard
- [ ] ActionList
- [ ] ScoreDisplay
- [ ] MeetingList
- [ ] CustomerCard

### **리소스**
- [ ] 아이콘 세트 (SVG)
- [ ] 폰트 파일 (Plus Jakarta Sans, Noto Sans KR, Inter)
- [ ] 색상 토큰 (CSS/JS)
- [ ] 그리드 시스템

### **문서화**
- [ ] Storybook 구성
- [ ] 컴포넌트별 사용 가이드
- [ ] 접근성 (a11y) 체크
- [ ] 반응형 테스트 가이드

### **성능 & QA**
- [ ] 크기 최적화 (Tree-shaking)
- [ ] 크로스 브라우저 테스트
- [ ] 모바일 렌더링 테스트
- [ ] 접근성 감사 (WCAG 2.1)

---

## 📱 React Native 특이사항

```tsx
// 웹
import { Button } from '@sep/components-web';

// 모바일 (React Native)
import { Button } from '@sep/components-native';

// 공유 인터페이스
interface IButtonProps {
  variant: 'primary' | 'secondary';
  size: 'small' | 'medium' | 'large';
  onPress: () => void;
  disabled?: boolean;
  children: string;
}
```

**주의:**
- React Native는 CSS 불가 → StyleSheet 사용
- 단위: 'px' 없음, 숫자만 사용
- 폰트: 네이티브 폰트만 지원
- 터치 영역 최소: 48x48pt

---

## 🔄 버전 관리

**컴포넌트 배포:**
```bash
npm publish @sep/components@1.0.0
```

**변경 로그:**
- 버전: MAJOR.MINOR.PATCH
- Breaking change → MAJOR 증가
- 새 기능 → MINOR 증가
- 버그 수정 → PATCH 증가

---

**다음 단계:** Storybook 구성 및 컴포넌트 구현 시작

