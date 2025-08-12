# Social Distancing Game - Web Version

이 프로젝트는 Python OpenCV 기반의 소셜 디스턴싱 게임을 웹 브라우저에서 실행할 수 있도록 변환한 것입니다.

## 🎮 게임 설명

소셜 디스턴싱 게임은 플레이어들이 서로 간의 거리를 유지하면서 점수를 얻는 게임입니다. 각 게임 모드마다 다른 최소 거리 요구사항이 있습니다.

### 게임 모드
1. **Psychological Stability** (1.2m) - 심리적 안정
2. **Crowd Survival** (0.6m) - 군중 속 생존
3. **Disease Prevention** (2.0m) - 감염병 예방
4. **Extreme Proximity** (0.3m) - 극단적 근접
5. **Social Gathering** (0.9m) - 사교 모임

## 🚀 실행 방법

### 1. 웹 서버 시작
```bash
cd web_game
python server.py
```

### 2. 브라우저에서 게임 열기
서버가 시작되면 자동으로 브라우저가 열립니다. 수동으로 열려면:
```
http://localhost:8000
```

## 📁 파일 구조

```
web_game/
├── index.html          # 메인 HTML 파일
├── game.js             # 게임 로직 JavaScript
├── server.py           # Python 웹 서버
└── README.md           # 이 파일
```

## 🎯 게임 플레이

1. **모드 선택**: 5가지 게임 모드 중 하나를 선택합니다
2. **카운트다운**: 선택한 모드가 시작되기 전 5초 카운트다운
3. **게임 플레이**: 15초 동안 다른 플레이어와 거리를 유지
4. **점수 시스템**: 
   - 거리 위반 시 점수 차감
   - 거리 유지 시 점수 획득
5. **게임 종료**: 최종 점수 표시 및 재시작 옵션

## 🔧 기술적 특징

- **HTML5 Canvas**: 게임 그래픽 렌더링
- **WebRTC**: 카메라 접근 (현재는 시뮬레이션된 플레이어 위치 사용)
- **JavaScript**: 게임 로직 및 상태 관리
- **Python HTTP Server**: 로컬 웹 서버

## 🌐 웹 호스팅

이 게임은 정적 웹사이트로 배포할 수 있습니다:

1. **GitHub Pages**: `index.html`, `game.js` 파일을 GitHub 저장소에 업로드
2. **Netlify**: 드래그 앤 드롭으로 배포
3. **Vercel**: GitHub 저장소 연결하여 자동 배포
4. **기타 정적 호스팅 서비스**: AWS S3, Firebase Hosting 등

## 🔮 향후 개선 사항

- **실제 카메라 기반 플레이어 감지**: MediaPipe.js 또는 TensorFlow.js 사용
- **멀티플레이어 지원**: WebRTC를 통한 실시간 통신
- **사운드 효과**: Web Audio API를 사용한 게임 사운드
- **모바일 최적화**: 터치 컨트롤 및 반응형 디자인
- **점수 저장**: 로컬 스토리지 또는 온라인 리더보드

## 🐛 문제 해결

### 카메라 접근 오류
- 브라우저에서 카메라 권한을 허용했는지 확인
- HTTPS 환경에서 실행 (로컬호스트는 예외)

### 게임이 실행되지 않음
- 브라우저 콘솔에서 JavaScript 오류 확인
- 최신 브라우저 사용 권장 (Chrome, Firefox, Safari, Edge)

## 📝 라이선스

이 프로젝트는 교육 및 개인 사용 목적으로 제작되었습니다.

## 🤝 기여

버그 리포트, 기능 제안, 코드 개선 등 모든 기여를 환영합니다!
