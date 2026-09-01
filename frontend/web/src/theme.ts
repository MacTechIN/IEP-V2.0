import { createTheme, responsiveFontSizes } from '@mui/material/styles';

/**
 * 화면 폭에 따라 **저절로 맞는다.**
 *
 * ── 규칙 (2026-08-26) ──
 *
 * **기능도 배치 순서도 바꾸지 않는다.** 좁은 화면에서 무엇을 감추거나 자리를 옮기지 않는다 —
 * 폰에서 본 화면과 PC 에서 본 화면이 **같은 것을 같은 순서로** 보여 줘야 한다.
 * 바뀌는 것은 **글자 크기·여백·표의 스크롤 방식**뿐이다.
 *
 * 여기(테마)에 모아 둔 이유: 화면마다 따로 걸면 새 화면을 만들 때마다 빠뜨린다.
 * `sm`(600px) 이상에서는 **지금 값 그대로**다 — PC 화면은 한 픽셀도 달라지지 않는다.
 */

const base = createTheme({
  palette: {
    primary: {
      main: '#0066CC',
      light: '#4D9BFF',
      dark: '#0052A3',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#667085',
      light: '#98A2B3',
      dark: '#475569',
    },
    success: {
      main: '#059669',
      light: '#10B981',
      dark: '#047857',
    },
    warning: {
      main: '#D97706',
      light: '#F59E0B',
      dark: '#B45309',
    },
    error: {
      main: '#DC2626',
      light: '#EF4444',
      dark: '#B91C1C',
    },
    info: {
      main: '#0284C7',
      light: '#0EA5E9',
      dark: '#0369A1',
    },
    background: {
      default: '#F9FAFB',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1F2937',
      secondary: '#6B7280',
      disabled: '#D1D5DB',
    },
  },
  typography: {
    fontFamily: '"Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", sans-serif',
    h1: { fontSize: '2.5rem', fontWeight: 700 },
    h2: { fontSize: '2rem', fontWeight: 700 },
    h3: { fontSize: '1.5rem', fontWeight: 600 },
    h4: { fontSize: '1.25rem', fontWeight: 600 },
    h5: { fontSize: '1rem', fontWeight: 600 },
    h6: { fontSize: '0.875rem', fontWeight: 600 },
    body1: { fontSize: '1rem', fontWeight: 400 },
    body2: { fontSize: '0.875rem', fontWeight: 400 },
    caption: { fontSize: '0.75rem', fontWeight: 400 },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: {
          // 폰을 가로로 돌렸다 세울 때 글자가 제멋대로 커지는 것을 막는다
          WebkitTextSizeAdjust: '100%',
        },
        body: {
          /**
           * **긴 토큰 하나가 화면 폭을 밀어내는 것을 막는다.**
           * 이메일·해시·URL 처럼 띄어쓰기 없는 문자열이 좁은 화면에서 가로 스크롤을 만든다.
           * 감추는 대신(`overflow-x: hidden`) 줄바꿈을 허용한다 — 감추면 내용이 잘린다.
           */
          overflowWrap: 'anywhere',
        },
        // 표는 화면을 밀어내지 말고 **자기 안에서** 옆으로 움직인다
        '.MuiTableContainer-root': { overflowX: 'auto' },
      },
    },
    MuiContainer: {
      styleOverrides: {
        root: ({ theme }) => ({
          [theme.breakpoints.down('sm')]: {
            paddingLeft: 12,
            paddingRight: 12,
          },
        }),
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({
          [theme.breakpoints.down('sm')]: {
            paddingLeft: 8,
            paddingRight: 8,
          },
        }),
      },
    },
    MuiInputBase: {
      styleOverrides: {
        input: ({ theme }) => ({
          /**
           * **iOS Safari 는 글자가 16px 보다 작은 입력칸을 누르면 화면을 확대한다.**
           * 확대되면 레이아웃이 통째로 어긋나고, 사용자가 손으로 되돌려야 한다.
           * 폰에서만 16px 로 올린다 — PC 는 그대로다.
           */
          [theme.breakpoints.down('sm')]: { fontSize: 16 },
        }),
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }) => ({
          // 좁은 화면에서 창이 화면 밖으로 나가지 않게. 내용과 순서는 그대로다.
          [theme.breakpoints.down('sm')]: {
            margin: 12,
            width: 'calc(100% - 24px)',
            maxHeight: 'calc(100% - 24px)',
          },
        }),
      },
    },
    MuiTabs: {
      // 탭이 많아도 **감추지 않는다** — 옆으로 밀어서 전부 닿을 수 있게 한다.
      // 폰에서 「사실관계」 탭이 잘려 안 보이면 그 화면의 값어치가 사라진다.
      defaultProps: {
        variant: 'scrollable',
        scrollButtons: 'auto',
        allowScrollButtonsMobile: true,
      },
      styleOverrides: { root: { minHeight: 44 } },
    },
  },
});

/**
 * 제목 글자 크기를 화면 폭에 맞춘다.
 * `h1` 2.5rem 은 360px 폰에서 두 줄로 넘어가 카드 안을 밀어낸다.
 * **자리를 옮기는 것이 아니라 글자만 줄인다.**
 */
export const theme = responsiveFontSizes(base, { factor: 2.2 });
