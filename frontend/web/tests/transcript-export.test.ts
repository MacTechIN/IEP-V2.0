// 화자별 대화 내려받기 — 형식·파일명 회귀 (2026-08-18)
//
// 여기서 지키려는 것은 셋이다.
//
//  1. **화자 이름이 발화마다 반복되지 않는다.** 404개를 그대로 펼치면 `[영업대표]` 가
//     404번 나오는 문서가 되고, 그건 아무도 읽지 않는다.
//  2. **범위는 언제나 전체다.** 화면 필터를 반영하기 시작하면 받은 파일이 전부인지
//     일부인지 알 수 없어진다. 이 결정을 말이 아니라 숫자로 못 박는다.
//  3. **남의 컴퓨터에서 열린다.** 메모장의 CRLF, 엑셀의 BOM, Windows 의 금칙 문자 —
//     전부 "내 컴퓨터에서는 되던" 것이 깨지는 자리다.
//
// 실행: npm run test:export
//
// **시간대를 못 박는다.** 미팅 시각은 일부러 브라우저 시간대로 그린다 — 사용자가 화면에서 본
// 값과 파일의 값이 달라지면 안 되기 때문이다. 그래서 이 테스트는 시간대에 따라 결과가
// 달라지고, 개발자 노트북(KST)에서는 통과하다 CI(UTC)에서만 깨진다. 여기서 고정한다.
process.env.TZ = 'Asia/Seoul'

import { describe, it, expect } from 'vitest'
import {
  BOM, UNKNOWN_SPEAKER,
  buildTranscriptDoc, safeFileName, toPlainText, toPrintHtml,
  PRIVILEGE_NOTICE,
  type ExportSegment,
} from '../src/lib/transcriptExport'

const NOW = new Date('2026-08-18T21:03:00+09:00')
const MEETING = {
  title: '위바이K 해외구매대행플렛폼 개발 기획논의',
  startTime: '2026-08-14T14:00:00+09:00',
  customerName: '(주)위바이케이',
}

const seg = (speakerLabel: string, content: string): ExportSegment => ({ speakerLabel, content })

describe('화자 덩어리', () => {
  it('같은 화자가 연달아 말하면 한 덩어리다', () => {
    const doc = buildTranscriptDoc(MEETING, [
      seg('영업대표', '안녕하세요'),
      seg('영업대표', '오늘 시간 내주셔서 감사합니다'),
      seg('영업대표', '바로 시작하겠습니다'),
    ], NOW)
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0].lines).toHaveLength(3)
  })

  it('화자가 바뀌면 덩어리가 갈린다 — 과하게 묶지 않는다', () => {
    const doc = buildTranscriptDoc(MEETING, [
      seg('영업대표', '안녕하세요'),
      seg('고객', '네 반갑습니다'),
      seg('영업대표', '시작하겠습니다'),
    ], NOW)
    expect(doc.blocks.map((b) => b.speaker)).toEqual(['영업대표', '고객', '영업대표'])
  })

  it('화자 이름이 비면 화면과 같은 이름으로 떨어진다', () => {
    const doc = buildTranscriptDoc(MEETING, [
      { speakerLabel: '', content: '어…' },
      { speakerLabel: '   ', content: '그러니까' },
      { speakerLabel: null, content: '네' },
    ], NOW)
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0].speaker).toBe(UNKNOWN_SPEAKER)
  })

  it('빈 발화는 문서에 넣지 않는다 — 이름만 남는 자리가 생긴다', () => {
    const doc = buildTranscriptDoc(MEETING, [
      seg('고객', '  '),
      seg('고객', '네'),
      { speakerLabel: '고객', content: null },
    ], NOW)
    expect(doc.blocks[0].lines).toEqual(['네'])
    expect(doc.meta.find((m) => m.label === '발화')?.value).toBe('1개 · 화자 1명')
  })
})

describe('범위는 항상 전체다', () => {
  // 화면이 걸러 놓은 목록이 아니라 원본을 넘긴다는 약속을 숫자로 고정한다.
  const all: ExportSegment[] = [
    seg('영업대표', '해외 구매대행 쪽부터 보겠습니다'),
    seg('고객', '넵'),                       // 짧은 발화 — 화면에서는 기본으로 접힌다
    seg('고객', '수수료 구조가 궁금합니다'),
    seg('알 수 없음', '어!'),                 // 화자 필터를 걸면 화면에서 사라진다
  ]

  it('화면에서 걸러지는 줄까지 전부 들어간다', () => {
    const doc = buildTranscriptDoc(MEETING, all, NOW)
    const lines = doc.blocks.flatMap((b) => b.lines)
    expect(lines).toHaveLength(all.length)
    expect(lines).toContain('넵')     // "짧은 발화 접기" 대상
    expect(lines).toContain('어!')    // 화자 필터 대상
    expect(doc.meta.find((m) => m.label === '발화')?.value).toBe('4개 · 화자 3명')
  })

  it('걸러진 목록을 넘기면 결과가 달라진다 — 그래서 원본을 넘겨야 한다', () => {
    const filtered = all.filter((s) => (s.content || '').length > 10)
    const whole = buildTranscriptDoc(MEETING, all, NOW)
    const part = buildTranscriptDoc(MEETING, filtered, NOW)
    expect(part.blocks.flatMap((b) => b.lines).length)
      .toBeLessThan(whole.blocks.flatMap((b) => b.lines).length)
  })
})

describe('머리말', () => {
  it('일시·의뢰인·발화·내려받은 때가 들어간다', () => {
    const doc = buildTranscriptDoc(MEETING, [seg('고객', '네')], NOW)
    expect(doc.meta.map((m) => m.label))
      .toEqual(['일시', '의뢰인', '발화', '내려받은 때'])
    expect(doc.meta[0].value).toBe('2026-08-14 14:00')
  })

  it('의뢰인가 없으면 그 줄을 만들지 않는다 — 빈 값을 보여 주지 않는다', () => {
    const doc = buildTranscriptDoc({ title: '내부 회의' }, [seg('나', '시작')], NOW)
    expect(doc.meta.map((m) => m.label)).toEqual(['발화', '내려받은 때'])
  })

  it('제목이 비면 미팅으로 떨어진다', () => {
    expect(buildTranscriptDoc({ title: '   ' }, [], NOW).title).toBe('미팅')
    expect(buildTranscriptDoc({}, [], NOW).title).toBe('미팅')
  })
})

describe('텍스트', () => {
  const doc = buildTranscriptDoc(MEETING, [
    seg('영업대표', '안녕하세요'),
    seg('영업대표', '시작하겠습니다'),
    seg('고객', '네'),
  ], NOW)
  const txt = toPlainText(doc)

  it('BOM 으로 시작한다 — 없으면 엑셀·구형 메모장이 한글을 깨뜨린다', () => {
    expect(txt.startsWith(BOM)).toBe(true)
    expect(BOM).toBe('\uFEFF')
  })

  it('줄바꿈이 CRLF 다 — LF 만 있으면 메모장이 전체를 한 줄로 뭉갠다', () => {
    expect(txt).toContain('\r\n')
    // 짝 없는 LF 가 하나도 없어야 한다
    expect(/(?<!\r)\n/.test(txt)).toBe(false)
  })

  it('화자 이름은 덩어리마다 한 번만 나온다', () => {
    expect(txt.split('[영업대표]').length - 1).toBe(1)
    expect(txt.split('[고객]').length - 1).toBe(1)
  })

  it('본문 전체가 그대로 담긴다', () => {
    for (const line of ['안녕하세요', '시작하겠습니다', '네']) expect(txt).toContain(line)
  })
})

describe('인쇄 HTML', () => {
  it('화자와 발화가 한 덩어리(.block) 안에 묶여 페이지가 갈리지 않는다', () => {
    const html = toPrintHtml(buildTranscriptDoc(MEETING, [
      seg('영업대표', '안녕하세요'), seg('고객', '네'),
    ], NOW))
    expect(html.split('class="block"').length - 1).toBe(2)
    expect(html).toContain('break-after: avoid')      // 이름만 페이지 끝에 남는 것을 막는다
    expect(html).toContain('break-inside: avoid')
  })

  it('발화에 든 홑화살괄호가 태그로 새지 않는다', () => {
    const html = toPrintHtml(buildTranscriptDoc(
      { title: '<script>alert(1)</script>' },
      [seg('고객', 'a < b & "c"')], NOW,
    ))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('a &lt; b &amp; &quot;c&quot;')
  })
})

describe('파일 이름', () => {
  it('실제 미팅 제목이 그대로 살아 있다', () => {
    expect(safeFileName(MEETING.title, '2026-08-14', 'txt'))
      .toBe('위바이K 해외구매대행플렛폼 개발 기획논의_화자별대화_2026-08-14.txt')
  })

  it('Windows 금칙 문자를 전부 바꾼다 — 안 그러면 저장 자체가 실패한다', () => {
    const name = safeFileName('보고: 3/4분기 <초안> "확정"? | a\\b*c', '2026-08-14', 'docx')
    expect(name).toBe('보고_ 3_4분기 _초안_ _확정__ _ a_b_c_화자별대화_2026-08-14.docx')
    expect(/[\\/:*?"<>|]/.test(name.replace(/_화자별대화_.*$/, ''))).toBe(false)
  })

  it('제어문자도 바꾼다', () => {
    expect(safeFileName('줄\n바꿈\t탭', '2026-08-14', 'txt'))
      .toBe('줄_바꿈_탭_화자별대화_2026-08-14.txt')
  })

  it('제목이 아무리 길어도 120자에서 자른다', () => {
    const name = safeFileName('가'.repeat(200), '2026-08-14', 'txt')
    expect(name.replace(/_화자별대화_.*$/, '')).toHaveLength(120)
  })

  it('제목이 비거나 점·공백뿐이면 미팅으로 떨어진다', () => {
    expect(safeFileName('', '2026-08-14', 'txt')).toBe('미팅_화자별대화_2026-08-14.txt')
    expect(safeFileName('  ... ', '2026-08-14', 'txt')).toBe('미팅_화자별대화_2026-08-14.txt')
  })

  it('날짜는 미팅 날짜다 — 같은 미팅을 두 번 받아도 이름이 같아야 한다', () => {
    const a = buildTranscriptDoc(MEETING, [], new Date('2026-08-18T21:03:00+09:00'))
    const b = buildTranscriptDoc(MEETING, [], new Date('2026-09-01T09:00:00+09:00'))
    expect(a.dateKey).toBe(b.dateKey)
    expect(a.dateKey).toBe('2026-08-14')
  })
})

// ── 비닉권 고지 (021) ─────────────────────────────────────────
//
// 표시를 DB 에만 두면 소용이 없다. **파일은 사무소 밖으로 나가고**, 받은 사람이
// 이것이 무엇인지 알아야 한다. 그래서 세 형식 모두의 **맨 위에** 박히는지 본다.
describe('비닉권 고지', () => {
  const seg = (speaker: string, content: string) =>
    ({ speakerLabel: speaker, content, sortOrder: 0 } as any);

  it('비닉권 문서는 txt 맨 위에 고지가 박힌다', () => {
    const doc = buildTranscriptDoc(
      { title: '상담', startTime: '2026-08-26T01:00:00Z', privileged: true } as any,
      [seg('의뢰인', '내용')], new Date('2026-08-26T02:00:00Z'));
    const txt = toPlainText(doc);
    // BOM 다음이 곧바로 고지여야 한다 — 아래에 두면 읽지 않는다
    expect(txt.indexOf(PRIVILEGE_NOTICE)).toBeLessThan(txt.indexOf('상담'));
  });

  it('비닉권 문서는 인쇄본 맨 위에 고지가 박힌다', () => {
    const doc = buildTranscriptDoc(
      { title: '상담', startTime: '2026-08-26T01:00:00Z', privileged: true } as any,
      [seg('의뢰인', '내용')], new Date('2026-08-26T02:00:00Z'));
    const html = toPrintHtml(doc);
    expect(html).toContain('class="privilege"');
    expect(html.indexOf('privilege')).toBeLessThan(html.indexOf('<h1>'));
  });

  it('**비닉권이 아니면 고지가 없다** — 아무 문서에나 붙이면 의미가 닳는다', () => {
    const doc = buildTranscriptDoc(
      { title: '일반 회의', startTime: '2026-08-26T01:00:00Z' } as any,
      [seg('참석자', '내용')], new Date('2026-08-26T02:00:00Z'));
    expect(toPlainText(doc)).not.toContain(PRIVILEGE_NOTICE);
    expect(toPrintHtml(doc)).not.toContain('class="privilege"');
  });
});

/**
 * 작성자 표시 (026) — 이 문서는 사무소 밖으로 나간다.
 * **비어 있으면 그 줄을 아예 넣지 않는다.** 「작성자: 」 가 빈 채로 찍히는 것이
 * 안 적힌 것보다 나쁘다.
 */
describe('작성자 표시 (026)', () => {
  const segs = [seg('변호사', '안녕하세요')];

  it('프로필이 채워져 있으면 머리말에 작성자가 들어간다', () => {
    const doc = buildTranscriptDoc({
      title: '상담', startTime: '2026-08-26T09:00:00Z', customerName: '홍길동',
      author: { name: '김변호', position: '대표변호사', firmName: '법무법인 가나',
                barNo: '12345', officePhone: '02-000-0000' },
    } as any, segs as any, NOW);
    const line = doc.meta.find((m: any) => m.label === '작성자');
    expect(line).toBeTruthy();
    expect(line!.value).toContain('법무법인 가나');
    expect(line!.value).toContain('김변호 대표변호사');
    expect(line!.value).toContain('변호사등록번호 12345');
    expect(line!.value).toContain('02-000-0000');
  });

  it('사무장처럼 등록번호가 없어도 나머지는 들어간다', () => {
    const doc = buildTranscriptDoc({
      title: '상담', author: { name: '박사무', position: '사무장', firmName: '법무법인 가나' },
    } as any, segs as any, NOW);
    const line = doc.meta.find((m: any) => m.label === '작성자');
    expect(line!.value).toContain('박사무 사무장');
    expect(line!.value).not.toContain('변호사등록번호');
  });

  it('프로필이 비어 있으면 작성자 줄이 아예 없다', () => {
    for (const author of [null, undefined, {}]) {
      const doc = buildTranscriptDoc({ title: '상담', author } as any, segs as any, NOW);
      expect(doc.meta.find((m: any) => m.label === '작성자')).toBeUndefined();
    }
  });
});
