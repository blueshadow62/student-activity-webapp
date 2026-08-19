# AI 에이전트 배포 가이드

이 문서는 Claude Code, Codex 등 AI 코딩 에이전트가 이 저장소를 다른 학교에
설치할 때 따라야 하는 절차이다.

기술 스택, 코드 규칙, 파일 구조는 [CLAUDE.md](CLAUDE.md) 참조.
수동 설치 절차는 [INSTALL.md](INSTALL.md) 참조.

## 에이전트가 할 수 있는 일

1. 저장소 클론
2. 로컬 검증 실행 (`node verify-v8.4.js` 등)
3. `clasp login` 실행 (사람이 브라우저에서 승인)
4. `clasp create` 또는 `clasp clone`으로 프로젝트 연결
5. `clasp push`로 코드 업로드
6. `clasp deploy -i <deploymentId>`로 배포 갱신
7. 사용자에게 관리자 포털에서 JSON 파일 업로드를 안내

## 사람이 직접 해야 하는 일

아래 네 가지는 에이전트가 대신할 수 없다.

| # | 할 일 | 위치 |
|---|---|---|
| 1 | Apps Script API 켜기 | script.google.com/home/usersettings |
| 2 | `clasp login` 브라우저 승인 | Google 로그인 창 |
| 3 | `registerInitialSchoolAdministrator` 실행 | Apps Script 편집기 실행 버튼 |
| 4 | 권한 동의 화면 승인 | 3번 실행 시 뜨는 창 |

에이전트는 이 단계에서 사용자에게 안내하고 완료를 기다려야 한다.

## 새 학교 설치 절차

### 1단계: 프로젝트 생성 및 코드 업로드

```bash
git clone https://github.com/blueshadow62/student-activity-webapp.git
cd student-activity-webapp

# 로컬 검증
node verify-v8.4.js
node verify-v8.4-cp5.js
node verify-v8.4-runtime.js

# clasp 로그인 (사람이 브라우저에서 승인)
clasp login

# 새 Apps Script 프로젝트 생성
clasp create --type webapp --title "학생 활동 기록"

# 코드 업로드 (StandardsData 번들 포함 — 초기 설치에 필요)
clasp push
```

이 시점에서 `.claspignore`는 StandardsData 번들을 포함하는 기본 상태여야 한다.
주석 처리되어 있는지 확인:

```
# StandardsData_elementary.gs
# StandardsData_middle.gs
# StandardsData_high.gs
```

### 2단계: 관리자 등록 및 학교 설정

사용자에게 안내:
1. Apps Script 편집기를 연다 (`clasp open`)
2. `registerInitialSchoolAdministrator` 함수를 실행한다
3. 권한 동의 화면을 승인한다

```bash
# 웹앱 배포
clasp deploy -d "초기 배포"
```

배포 후 출력되는 deployment ID를 기록한다. 이후 갱신에 필요하다.

사용자에게 `/exec` URL을 안내하고, 웹앱에서 학교 설정을 완료하도록 한다:
- 학교명·학교급 입력
- "새 중앙 자료 만들기" 선택

### 3단계: 과목·성취기준 데이터 등록

성취기준 데이터는 `.gs` 번들에 포함되지 않는다. 관리자가 웹앱에서 JSON 파일을
업로드해야 한다.

저장소의 `data/` 디렉터리에 학교급·계열·교육과정별 JSON 파일이 준비되어 있다:

| 파일 | 내용 |
|---|---|
| `elementary.json` | 초등학교 전 과목 |
| `middle.json` | 중학교 전 과목 |
| `high-보통교과-2022.json` | 고등학교 보통교과 (2022 개정) |
| `high-보통교과-2015.json` | 고등학교 보통교과 (2015 개정) |
| `high-전문교과-{계열}-2022.json` | 전문교과 계열별 (2022) |
| `high-전문교과-{계열}-2015.json` | 전문교과 계열별 (2015) |

사용자에게 안내:
1. 관리자 포털을 연다
2. "JSON 파일로 과목·성취기준을 등록" 영역에서 필요한 파일을 선택한다
3. 여러 파일을 한꺼번에 올릴 수 있다
4. 업로드 결과(과목 수, 성취기준 수, 중복 건너뜀)를 확인한다

**필수 파일**: 해당 학교급 파일 (초등: `elementary.json`, 중등: `middle.json`,
고등: `high-보통교과-*.json` 중 하나 이상)

**선택 파일**: 전문교과 계열 파일은 해당 계열이 있는 학교만 올리면 된다.

성취기준 데이터 없이도 웹앱은 정상 작동한다. 과목명 직접 입력이 가능하고,
성취기준 검색만 비활성화된다.

## 코드 수정 후 배포

```bash
# 검증
node verify-v8.4.js
node verify-v8.4-cp5.js
node verify-v8.4-runtime.js

# 업로드 및 기존 배포 갱신
clasp push
clasp deploy -i <deploymentId>
```

**주의**: `clasp deploy` (ID 없이)는 새 배포를 생성한다. 기존 URL을 유지하려면
반드시 `-i <deploymentId>`를 사용하라.

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `clasp push` 타임아웃 | StandardsData_high.gs가 40MB | 타임아웃을 10분으로 늘리거나 최적화 단계 적용 |
| 빨간 스키마 배너가 안 사라짐 | 중앙 DB에 필수 시트 부재 | 관리자 포털에서 "중앙 시트 점검·생성" 실행 |
| 과목·성취기준이 검색 안 됨 | JSON 파일 미업로드 | 관리자 포털에서 `data/` 디렉터리의 JSON 파일 업로드 |
| "The service is currently unavailable" | Google 서버 일시 오류 | 잠시 후 재시도 |
