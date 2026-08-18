# Windows 설치 도우미

`학생활동기록-설치도우미.exe`는 기존 Google Apps Script 구조를 바꾸지 않고 학교별
프로젝트 생성, 코드 업로드, 배포를 안내·자동화한다. Node.js, Git, AI 도구는 사용자
PC에 따로 설치하지 않는다.

## 자동화 범위

- 학교 전용 Apps Script 프로젝트 생성
- 허용 목록에 있는 런타임 파일 12개 업로드
- Apps Script 편집기 열기
- 웹앱 배포 및 `/exec` 주소 생성
- 바탕화면 바로가기 생성
- 실패 후 같은 프로젝트에서 재시도

다음 단계는 Google 보안 및 앱의 관리자 등록 계약 때문에 사용자가 직접 수행한다.

1. Apps Script API 활성화
2. Google 로그인 및 clasp 권한 승인
3. 편집기에서 `registerInitialSchoolAdministrator` 실행
4. Drive·Sheets·메일 권한 승인
5. 웹앱에서 학교명·학교급과 중앙 자료 설정

## 개발

Node.js 22 이상이 설치된 개발 환경에서 실행한다.

```powershell
cd installer
npm ci
npm test
npm start
```

개발 모드는 저장소 루트에서 런타임 파일을 읽되 명시된 허용 목록만 복사한다. 실제
학교 프로젝트와 연결된 루트 `.clasp.json`은 읽거나 복사하지 않는다.

## EXE 빌드

```powershell
cd installer
npm ci
npm run dist
```

결과는 `installer/dist/`에 생성된다. GitHub Release를 발행하면
`.github/workflows/build-installer.yml`이 Windows x64 휴대용 EXE와
`SHA256SUMS.txt`를 Release 자산으로 첨부한다.

## 제한 및 보안

- v0.1은 새 학교 설치만 지원한다. 기존 프로젝트 업데이트는 원격 편집 내용을 덮을
  위험이 있어 제공하지 않는다.
- OAuth 인증과 학교별 프로젝트 연결 상태는 현재 Windows 사용자의 Electron
  `userData` 폴더에 저장한다.
- 설치 실패 시 생성한 Google 프로젝트를 자동 삭제하지 않는다. 재실행하면 저장된
  프로젝트에서 이어서 진행한다.
- 인증서로 서명하지 않은 EXE는 Windows SmartScreen 경고가 표시될 수 있다.
- 배포 후 Google Workspace 도메인 제한 또는 `ALLOWED_TEACHER_EMAILS` 설정을
  학교 정책에 맞게 확인해야 한다.
- clasp 3.3.0의 Google API 의존성은 현재 `uuid` 관련 중간 등급 npm 보안 경고를
  보고한다. 자동 수정은 clasp를 2.5.0으로 낮추므로 적용하지 않았으며, 정식 릴리스
  전에 상위 패키지의 수정 여부를 다시 확인해야 한다.

## 롤백

EXE 배포 자체를 되돌리려면 GitHub Release에서 해당 EXE와 체크섬을 제거한다. 이미
만들어진 Apps Script 프로젝트는 자동으로 삭제하지 않으며, 소유자가 Google Drive와
Apps Script 관리 화면에서 확인한 뒤 직접 처리한다.
