# 변경 기록 — IEP (Investigate Enablement Platform)

이 제품은 [유의적 버전](https://semver.org/lang/ko/)을 따른다.
규칙과 배포 절차는 [CLAUDE.md](CLAUDE.md), 개발 계획은 [docs/2026-09-01-개발계획.md](docs/2026-09-01-개발계획.md).

무엇이 고장나 있었고 무엇이 고쳐진 것을 증명하는지를 적는다. 실측값이 있으면 넣는다.

---

## [0.1.0] — 2026-09-01 — 프로젝트 착수 (S0)

LEP v2.1 에서 갈라져 경찰 수사 지원 플랫폼으로 시작. **SEP·LEP 와 완전 독립.**

- LEP 소스 복제(worker·frontend·stream·database·docs). `node_modules`·전과 폴더·`.git` 제외
- 인프라 이름 전부 iep- 로 치환 (`iep-api`·`iep-web`·`iep-uploads`·`iep-analysis`·`iep-transcribe`)
- LEP Cloud Run 스트림 주소 제거 — IEP 스트림은 S5 에서 구축, 그전까지 자막 비활성
- `check-bundle` 자막 검사를 S5 까지 보류 (아직 없는 주소를 요구하면 배포가 막힌다)
- CLAUDE.md 를 IEP 대전제 다섯으로 새로 씀 — 거짓말 탐지 금지·참고자료 원칙·호칭 구분·
  피해자 보호·고지 동의. LEP 의 검증된 규율(배포·게이트·백업)은 이어받음
- 버전 0.1.0 초기화, git 저장소 MacTechIN/IEP-V2.0 연결

**아직 코드 동작은 LEP 그대로다.** 도메인 치환(변호사→수사관, 소장→조서)과 새 서비스
(진술분석·절차점검·코칭요약)는 S1 이후. 이 커밋은 「독립된 빈 골격」이다.
