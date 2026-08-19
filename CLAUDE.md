# 학생 활동 기록 웹앱 — Claude Code / AI 에이전트 가이드

Google Apps Script 웹앱이다. 교사가 학생 활동을 기록하고, 관리자가 학생 명단과
사진을 중앙 관리한다.

## 기술 스택

- **런타임**: Google Apps Script (V8)
- **UI**: `Index.html` 단일 파일 (HTML + CSS + JS, `google.script.run` 호출)
- **서버**: `.gs` 파일들 (CommonJS도 ES Module도 아닌 Apps Script 전역 스코프)
- **배포**: `clasp push` + `clasp deploy -i <deploymentId>`
- **설치 도우미**: Electron (CommonJS, `installer/` 디렉터리)
- **테스트**: Node.js 기반 로컬 검증 (`verify-v8.4*.js`), 프레임워크 없음

## 프로젝트 구조

```
*.gs, Index.html     — Apps Script 런타임 파일 (clasp push 대상)
appsscript.json      — Apps Script 매니페스트
.claspignore         — clasp push 제외 목록
StandardsData*.gs    — 성취기준 번들 (초·중·고교 분리)
installer/           — Windows 설치 도우미 (Electron)
scripts/             — 빌드/변환 스크립트 (배포 안 됨)
verify-v8.4*.js      — 로컬 회귀 검사기
docs/                — 내부 문서 (배포 안 됨)
```

## 코드 수정 시 규칙

### Apps Script 제약
- `import`/`export` 불가. 모든 `.gs` 파일은 전역 스코프로 합쳐진다.
- 선언되지 않은 전역 변수 접근은 `ReferenceError`. `typeof VAR !== 'undefined'`로 확인해야 한다.
- V8은 배포 시 **모든 `.gs` 파일을 파싱**한다. 큰 파일 = 느린 부팅.
- `const`/`let`은 전역에 쓸 수 있지만, 같은 이름이 두 파일에 있으면 충돌.
- 공개 함수(클라이언트에서 호출)와 내부 함수(`_` 접미사)를 구분한다.

### 네이밍 컨벤션
- 공개 함수: `camelCase` (예: `getAppBootstrapState`)
- 내부 함수: `camelCase_` (끝에 밑줄, 예: `getCentralConnectionContext_`)
- 상수: `UPPER_SNAKE_CASE` (예: `CENTRAL_CONFIG`, `APP_CONFIG`)
- 설정 객체: `Object.freeze()`로 불변 처리

### 변경 후 검증
```bash
node verify-v8.4.js           # 구문·구조 검사
node verify-v8.4-cp5.js       # 87개 시나리오 (cp2.5 + cp2.6 포함)
node verify-v8.4-runtime.js   # 67개 런타임 호출 검사
```
세 검사기 모두 통과해야 한다. Google 계정 없이 로컬에서 실행 가능.

## 배포

### clasp 배포 (개발자/AI 에이전트)
```bash
clasp push              # .claspignore에 따라 파일 업로드
clasp deploy -i <ID>    # 기존 배포 갱신 (새 배포 생성 아님!)
```
- `clasp deploy` (ID 없이)는 **새 배포를 생성**한다. 기존 URL이 바뀌므로 주의.
- `.claspignore`는 기본적으로 StandardsData 번들을 포함한다. 초기 설치 후 성능 최적화를 위해 주석을 해제하면 제외된다.

### 2-phase 배포 전략
1. **초기 설치**: StandardsData 번들 포함 → `clasp push` → 관리자가 "성취기준 데이터 설정" 실행
2. **최적화**: `.claspignore`에서 StandardsData 줄 주석 해제 → `clasp push` → `clasp deploy -i <ID>`

이렇게 하면 초기 설치 때 성취기준 데이터가 스프레드시트에 기록되고,
이후에는 번들 없이 스프레드시트에서 직접 읽어 부팅 속도가 빨라진다.

### Windows 설치 도우미 배포
`installer/` 디렉터리 참조. `npm run build`로 exe 생성.
설치 도우미가 2-phase 배포를 자동 처리한다 (설치 → "성능 최적화" 버튼).

## 주요 파일 역할

| 파일 | 역할 |
|---|---|
| `Code.gs` | `doGet()`, 부트스트랩, 공통 기록 기능 |
| `CentralData.gs` | 중앙 DB 접근, 스키마 관리, 성취기준 처리 |
| `AdminPortal.gs` | 관리자 전용 기능 (학생·사진·담당 관리) |
| `AssignmentRequests.gs` | 교사 담당 신청·승인·거부 |
| `PersonalRouting.gs` | 교사별 개인 DB 라우팅 |
| `PersonalStorage.gs` | 개인 DB 생성·검증·저장 |
| `SchoolSetup.gs` | 학교 초기 설정, CSV 파싱 |
| `CourseGroups.gs` | 수강 그룹 편성 |
| `InstallationSetup.gs` | 최초 관리자 등록, 설치 상태 판정 |
| `StandardsData.gs` | 과목 카탈로그 (STANDARDS_SUBJECTS) |
| `StandardsData_*.gs` | 학교급별 성취기준 상세 번들 |
| `Index.html` | 전체 UI (단일 파일) |

## 커밋 컨벤션

```
type(scope): 한국어 또는 영어 설명

type: feat, fix, perf, chore, docs, refactor, test
scope: admin, installer, curriculum, ...
```

## 보안 주의사항

- Script Properties에 실제 이메일, 파일 ID 등 민감 정보가 들어간다. 로그나 커밋에 포함하지 마라.
- 중앙 자료는 비공개 유지. 링크 공유나 도메인 공유 설정하지 마라.
- `executeAs: USER_ACCESSING` — 웹앱은 접속한 사용자 권한으로 실행된다.
