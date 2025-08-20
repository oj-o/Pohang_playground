// 게임 상태 상수
const GAME_STATE_WAITING = 'waiting';
const GAME_STATE_COUNTDOWN = 'countdown';
const GAME_STATE_PLAYING = 'playing';
const GAME_STATE_GAME_OVER = 'game_over';

// 게임 설정
const DEBUG_VERBOSE = false; // 과도한 콘솔 로그 억제
const GAME_DURATION_SECONDS = 20;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
// 설정값(현장 보정용)
const CONFIG = {
    cameraScale: 1.0,           // 카메라 표시 배율 (2배로 크게)
    pixelsPerMeter: 150,        // 1m에 해당하는 픽셀 수
    matchRadiusPx: 100,         // 트랙 매칭 반경(px)
    emaAlpha: 0.35,             // 트랙 스무딩 가중치(0~1)
    trackTimeoutMs: 1200,       // 미검출 시 트랙 보존 시간(ms)
    maxPeople: 6,               // 최대 인원
    minFaceConfidence: 0.3,     // 얼굴 검출 임계값
    showCalibrationOverlay: false, // 1m 눈금 표시
    flipCamera: false           // 좌우 반전
};

// 시뮬레이션 강제 비활성화 플래그 (true이면 항상 카메라 모드 유지)
const FORCE_CAMERA_MODE = true;

// 모드별 전역 설정 (여러 함수에서 참조하므로 전역에 선언)
// 모드 1: 심리적 안정 1.2m, 모드 2: 혼잡상태 0.6m
const targetDistances = [1.2, 0.6];
const playerCounts = [1, 2];

// DOM 요소들
let canvas, ctx, video;
let modeSelection, gameInfo, gameOver, cameraError, cameraStatus, cameraStatusText;

// 게임 상태
let gameState = GAME_STATE_WAITING;
let currentMode = null;
let countdownStartTime = null;
let gameStartTime = null;
let score = 0;
let stream = null;

// MediaPipe Pose
let pose;
let camera;
let faceDetector;
let handsDetector; // 손 검출기
let human; // 최종 폴백(머리/얼굴 검출)

// 다중 인물 추적
let tracks = [];
let nextTrackId = 1;

// 플레이어 위치 (MediaPipe로 감지된 실제 위치)
let playerPositions = [];
let isSimulationMode = false; // 시뮬레이션 모드 여부 (기본적으로 카메라 모드)

// 일시정지 상태
let isPaused = false;
let pausedAt = null; // 일시정지 시작 시각(ms)



// 라이다 WebSocket 연결 초기화
function initLidarWebSocket() {
    const WS_URL = `ws://localhost:8765`; // lidar_server.py의 WebSocket 주소
    let ws;

    function connect() {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            console.log('라이다 WebSocket 연결됨');
            updateCameraStatus('라이다 연결됨! 📡');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'lidar_player_positions') {
                    // 라이다에서 감지된 플레이어 위치 배열 수신
                    playerPositions = data.players.map(p => ({
                        x: p.x * CONFIG.pixelsPerMeter + CANVAS_WIDTH / 2, // 미터 단위를 픽셀로 변환 및 캔버스 중앙으로 이동
                        y: p.y * CONFIG.pixelsPerMeter + CANVAS_HEIGHT / 2,
                        id: Date.now() + Math.random() // 고유 ID 부여
                    }));
                    updatePlayerCount(playerPositions.length);
                    updatePlayerPositionsDisplay(); // Call new function to update UI
                    if (DEBUG_VERBOSE) console.log('라이다 플레이어 위치 수신:', playerPositions);
                } else if (data.type === 'error') {
                    console.error('라이다 서버 오류:', data.message);
                    updateCameraStatus(`라이다 오류: ${data.message}`);
                }
            } catch (e) {
                console.error('라이다 WebSocket 메시지 파싱 오류:', e);
            }
        };

        ws.onclose = () => {
            console.warn('라이다 WebSocket 연결 끊김. 5초 후 재연결 시도...');
            updateCameraStatus('라이다 연결 끊김 💔');
            setTimeout(connect, 5000); // 5초 후 재연결 시도
        };

        ws.onerror = (error) => {
            console.error('라이다 WebSocket 오류:', error);
            updateCameraStatus('라이다 오류 발생 🚨');
            ws.close(); // 오류 발생 시 연결 종료 후 재연결 시도
        };
    }

    connect(); // 초기 연결 시도
}





// 일시정지 버튼 라벨 동기화
function setPauseButtonsText(text) {
    const btn1 = document.getElementById('pauseButton');
    const btn2 = document.getElementById('pauseButtonTop');
    if (btn1) btn1.textContent = text;
    if (btn2) btn2.textContent = text;
}

// 일시정지 토글
function togglePause() {
    if (gameState !== GAME_STATE_COUNTDOWN && gameState !== GAME_STATE_PLAYING) return;
    if (!isPaused) {
        pauseGame();
    } else {
        resumeGame();
    }
}

function pauseGame() {
    if (isPaused) return;
    isPaused = true;
    pausedAt = Date.now();
    setPauseButtonsText('▶ 재개 (P)');
}

function resumeGame() {
    if (!isPaused) return;
    const now = Date.now();
    const pausedDuration = Math.max(0, now - (pausedAt || now));
    // 시작 시각 보정: 일시정지 시간만큼 뒤로 이동
    if (countdownStartTime) countdownStartTime += pausedDuration;
    if (gameStartTime) gameStartTime += pausedDuration;
    isPaused = false;
    pausedAt = null;
    setPauseButtonsText('⏸ 일시정지 (P)');
}

// 경과 시간 계산(일시정지 고려)
function getElapsedMs(startTime) {
    if (!startTime) return 0;
    const now = isPaused && pausedAt ? pausedAt : Date.now();
    return Math.max(0, now - startTime);
}

// 초기화
async function initGame() {
    try {
    if (DEBUG_VERBOSE) console.log('=== 게임 초기화 시작 ===');
        
        // DOM이 완전히 로드될 때까지 대기
        if (document.readyState !== 'complete') {
            if (DEBUG_VERBOSE) console.log('DOM 로딩 대기 중...');
            await new Promise(resolve => {
                window.addEventListener('load', resolve, { once: true });
            });
        }
        
        // 캔버스와 컨텍스트 가져오기
        canvas = document.getElementById('gameCanvas');
        if (!canvas) {
            console.error('게임 캔버스를 찾을 수 없습니다!');
            return;
        }
        if (DEBUG_VERBOSE) console.log('캔버스 찾음:', canvas);
        
        ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error('캔버스 컨텍스트를 가져올 수 없습니다!');
            return;
        }
        if (DEBUG_VERBOSE) console.log('캔버스 컨텍스트 찾음:', ctx);
        
        // DOM 요소들 확인
        modeSelection = document.getElementById('mode-selection');
        gameInfo = document.getElementById('game-info');
        gameOver = document.getElementById('game-over');
        cameraError = document.getElementById('camera-error');
        cameraStatus = document.getElementById('camera-status');
        cameraStatusText = document.getElementById('cameraStatusText');
        
        if (DEBUG_VERBOSE) {
            console.log('DOM 요소 상태:');
            console.log('- mode-selection:', modeSelection);
            console.log('- game-info:', gameInfo);
            console.log('- game-over:', gameOver);
            console.log('- camera-error:', cameraError);
            console.log('- camera-status:', cameraStatus);
            console.log('- cameraStatusText:', cameraStatusText);
        }
        
        // 필수 DOM 요소 확인
        if (!modeSelection || !gameInfo || !gameOver) {
            console.error('필수 DOM 요소를 찾을 수 없습니다. 페이지를 새로고침해주세요.');
            return;
        }
        
        // 이벤트 리스너 설정
        setupEventListeners();
        
        // 라이다 WebSocket 연결 초기화
        initLidarWebSocket();

        // 초기 화면 렌더링
        if (DEBUG_VERBOSE) console.log('초기 화면 렌더링 시작...');
        renderWaitingScreen();
        
        // 게임 루프 시작
        if (DEBUG_VERBOSE) console.log('게임 루프 시작...');
        gameLoop();
        
        // // 카메라 요청 (즉시 시작) - 라이다 전용 모드에서는 사용 안 함
        // if (DEBUG_VERBOSE) console.log('카메라 요청 시작...');
        // requestCamera().catch(error => {
        //     console.log('카메라 요청 실패:', error);
        //     // 시뮬레이션 모드는 게임 시작 후에만 활성화
        //     console.log('카메라 없이도 게임을 시작할 수 있습니다.');
        // });
        
        if (DEBUG_VERBOSE) console.log('=== 게임 초기화 완료 ===');
        
    } catch (error) {
        console.error('게임 초기화 중 오류 발생:', error);
        // 오류 발생 시에도 기본 화면은 표시
        if (ctx) {
            try {
                renderWaitingScreen();
            } catch (renderError) {
                console.error('렌더링 오류:', renderError);
            }
        }
    }
}

// 이벤트 리스너 설정
function setupEventListeners() {
    if (DEBUG_VERBOSE) console.log('이벤트 리스너 설정 시작...');
    
    // 모드 선택 버튼들
    const modeButtons = document.querySelectorAll('.mode-button');
    if (DEBUG_VERBOSE) console.log('찾은 모드 버튼 수:', modeButtons.length);
    
    modeButtons.forEach((button, index) => {
        if (DEBUG_VERBOSE) console.log(`모드 버튼 ${index + 1} 설정:`, button);
        button.addEventListener('click', (e) => {
            e.preventDefault();
            if (DEBUG_VERBOSE) console.log('모드 버튼 클릭됨:', button.dataset.mode);
            const mode = parseInt(button.dataset.mode);
            selectMode(mode);
        });
    });
    
    // 버튼 클릭 테스트를 위한 더블클릭 이벤트도 추가
    modeButtons.forEach((button, index) => {
        button.addEventListener('dblclick', (e) => {
            e.preventDefault();
            if (DEBUG_VERBOSE) console.log('모드 버튼 더블클릭됨:', button.dataset.mode);
            const mode = parseInt(button.dataset.mode);
            selectMode(mode);
        });
    });
    
    // 키보드(P)로 일시정지 토글
    window.addEventListener('keydown', (e) => {
        if (e.key === 'p' || e.key === 'P') {
            e.preventDefault();
            togglePause();
        }
    });

    if (DEBUG_VERBOSE) console.log('이벤트 리스너 설정 완료');
}

// 모드 선택
function selectMode(mode) {
    try {
        if (DEBUG_VERBOSE) console.log(`모드 ${mode} 선택됨`);
        
        if (!mode || mode < 1 || mode > 2) {
            console.error('잘못된 모드:', mode);
            return;
        }
        
        currentMode = mode;
        gameState = GAME_STATE_COUNTDOWN;
        countdownStartTime = Date.now();
        
        // 모드별 설정 (전역 상수 사용)
        
        const targetDistanceElement = document.getElementById('targetDistance');
        const playerCountElement = document.getElementById('playerCount');
        
        if (targetDistanceElement) {
            targetDistanceElement.textContent = targetDistances[mode - 1];
        }
        if (playerCountElement) {
            playerCountElement.textContent = playerCounts[mode - 1];
        }
        
        // UI 업데이트
        if (modeSelection) {
            modeSelection.style.display = 'none';
            if (DEBUG_VERBOSE) console.log('모드 선택 화면 숨김');
        } else {
            console.error('modeSelection 요소를 찾을 수 없습니다!');
        }
        
        if (gameInfo) {
            gameInfo.style.display = 'block';
            if (DEBUG_VERBOSE) console.log('게임 정보 화면 표시');
            
            // 게임 정보 내용도 업데이트
            const timeLeftElement = document.getElementById('timeLeft');
            const targetDistanceElement = document.getElementById('targetDistance');
            const playerCountElement = document.getElementById('playerCount');
            
            if (timeLeftElement) timeLeftElement.textContent = '20';
            if (targetDistanceElement) targetDistanceElement.textContent = targetDistances[mode - 1];
            if (playerCountElement) playerCountElement.textContent = '0';
            
        } else {
            console.error('gameInfo 요소를 찾을 수 없습니다!');
        }
        
        // 플레이어 위치/트랙 초기화
        playerPositions = [];
        tracks = [];
        nextTrackId = 1;
        
        // 카메라 상태 확인 및 모드 결정
        if (DEBUG_VERBOSE) {
            console.log('카메라 상태 확인 중...');
            console.log('- stream:', stream ? '존재' : '없음');
            console.log('- video:', video ? '존재' : '없음');
            console.log('- video.readyState:', video ? video.readyState : 'N/A');
            console.log('- window.cameraReady:', window.cameraReady);
            console.log('- isSimulationMode:', isSimulationMode);
        }
        
        if (!stream || !video || video.readyState < 2 || !window.cameraReady) {
            if (FORCE_CAMERA_MODE) {
                if (DEBUG_VERBOSE) console.log('카메라가 아직 준비되지 않았지만 시뮬레이션은 비활성화합니다. 카메라 로딩 화면을 표시합니다.');
                isSimulationMode = false;
                // 카메라 재시도
                requestCamera().catch(() => {});
            } else {
                if (DEBUG_VERBOSE) console.log('카메라가 준비되지 않아 시뮬레이션 모드로 전환합니다.');
                isSimulationMode = true;
                startSimulationMode();
            }
        } else {
            if (DEBUG_VERBOSE) console.log('실제 카메라 모드로 실행합니다.');
            isSimulationMode = false;
            // MediaPipe 부재 시에도 카메라 영상만 표시하며 진행
            if (typeof window.Pose === 'undefined' || typeof window.Camera === 'undefined') {
                if (DEBUG_VERBOSE) console.log('MediaPipe 라이브러리가 없어도 카메라 영상만 표시하여 진행합니다.');
            }
        }
        
        if (DEBUG_VERBOSE) console.log(`게임 시작: 모드 ${mode}, 목표 거리: ${targetDistances[mode - 1]}m, 플레이어: ${playerCounts[mode - 1]}명`);
        
        // 카운트다운 시작
        if (DEBUG_VERBOSE) console.log('카운트다운 시작');
        isPaused = false; pausedAt = null;
        setPauseButtonsText('⏸ 일시정지 (P)');
        
        // 게임 상태 변경 완료
        if (DEBUG_VERBOSE) {
            console.log('게임 상태 변경 완료 - gameState:', gameState);
            console.log('현재 모드:', currentMode);
            console.log('카운트다운 시작 시간:', countdownStartTime);
        }
        
    } catch (error) {
        console.error('모드 선택 중 오류 발생:', error);
    }
}

// 카메라 요청
async function requestCamera() {
    if (DEBUG_VERBOSE) console.log('카메라 요청 중...');
    
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('카메라를 지원하지 않는 브라우저입니다.');
        }
        
        // 카메라 권한 확인
        try {
            const permissions = await navigator.permissions.query({ name: 'camera' });
            if (DEBUG_VERBOSE) console.log('카메라 권한 상태:', permissions.state);
            if (permissions.state === 'denied') {
                throw new Error('카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라 권한을 허용해주세요.');
            }
        } catch (permissionError) {
            if (DEBUG_VERBOSE) console.log('권한 확인 실패, 직접 카메라 요청 시도:', permissionError.message);
            // 권한 확인이 실패해도 직접 카메라 요청 시도
        }
        
        // 비디오 요소 생성
        if (!video) {
            video = document.createElement('video');
            video.style.display = 'none';
            video.id = 'cameraVideo';
            document.body.appendChild(video);
        }
        
        // 카메라 스트림 요청 (더 간단한 설정)
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640, max: 1280 },
                height: { ideal: 480, max: 720 },
                facingMode: 'user'
            }
        });
        
        video.srcObject = stream;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        
        // 비디오 로드 및 재생 준비 대기
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('비디오 로드 시간 초과'));
            }, 12000);

            const onReady = () => {
                clearTimeout(timeout);
                resolve();
            };

            video.addEventListener('loadedmetadata', () => {
                try { video.play().catch(() => {}); } catch (e) {}
            }, { once: true });
            video.addEventListener('canplay', onReady, { once: true });
            video.addEventListener('error', (e) => {
                clearTimeout(timeout);
                reject(new Error(`비디오 로드 오류: ${e.message}`));
            }, { once: true });
        });
        
        // 성공 상태 표시
        if (cameraError) cameraError.style.display = 'none';
        if (cameraStatus) cameraStatus.style.display = 'block';
        if (cameraStatusText) cameraStatusText.textContent = '카메라가 준비되었습니다! 🎉';
        
        if (DEBUG_VERBOSE) {
            console.log('카메라 초기화 완료');
            console.log('- stream 생성됨:', !!stream);
            console.log('- video 요소 준비됨:', !!video);
            console.log('- video.readyState:', video.readyState);
            console.log('- video size:', video.videoWidth, 'x', video.videoHeight);
            console.log('- 카메라 모드 활성화 가능');
        }
        
        // 카메라 상태를 명확하게 설정
        window.cameraReady = true;
        if (DEBUG_VERBOSE) console.log('window.cameraReady = true로 설정됨');
        
        // MediaPipe 초기화 시도
        setTimeout(() => {
            initMediaPipe();
        }, 1000);
        // 얼굴 검출은 즉시 병행 시작 (다중 인물 최대 6명)
        setTimeout(() => {
            try { initFaceDetectionFallback(); } catch (e) { console.error('얼굴 검출 시작 실패:', e); }
        }, 500);
        // Human 폴백 초기화 (머리/얼굴 검출)
        setTimeout(() => {
            try { initHumanFallback(); } catch (e) { console.error('Human 폴백 시작 실패:', e); }
        }, 1500);
        
    } catch (error) {
        console.error('카메라 오류:', error);
        
        // 오류 상태 표시
        if (cameraError) {
            cameraError.style.display = 'block';
            const errorText = cameraError.querySelector('p');
            if (errorText) {
                errorText.textContent = `카메라 오류: ${error.message}`;
            }
        }
        if (cameraStatus) cameraStatus.style.display = 'none';
        
        // 오류 발생 시 시뮬레이션 모드로 전환하지 않음
        console.log('카메라 오류가 발생했지만 게임은 계속 진행할 수 있습니다.');
        console.log('게임 모드를 선택하면 시뮬레이션 모드로 실행됩니다.');
    }
}

// MediaPipe 초기화
async function initMediaPipe() {
    try {
        if (DEBUG_VERBOSE) console.log('=== MediaPipe 초기화 시작 ===');
        
        // MediaPipe 라이브러리 로드 대기
        let retryCount = 0;
        const maxRetries = 10;
        
        while (retryCount < maxRetries) {
            if (typeof window.Pose !== 'undefined') {
                break;
            }
            if (DEBUG_VERBOSE) console.log(`MediaPipe 라이브러리 로드 대기 중... (${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 500));
            retryCount++;
        }
        
        const PoseNS = window.Pose;
        const PoseClass = PoseNS?.Pose || PoseNS;
        const CameraNS = window.Camera;
        const CameraClass = CameraNS?.Camera || CameraNS;
        if (!PoseClass) {
            console.error('MediaPipe Pose 클래스를 찾을 수 없습니다.');
            console.log('MediaPipe Pose가 로드되지 않아 카메라 모드로 실행할 수 없습니다.');
            return;
        }
        
        if (DEBUG_VERBOSE) console.log('MediaPipe 라이브러리 로드 완료');
        
        // Pose 객체 생성 (네임스페이스 호환)
        pose = new PoseClass({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
        });
        
        if (DEBUG_VERBOSE) console.log('MediaPipe Pose 옵션 설정 중...');
        pose.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            smoothSegmentation: true,
            minDetectionConfidence: 0.15, // 인식률 향상 위해 낮춤
            minTrackingConfidence: 0.15, // 인식률 향상 위해 낮춤
            selfieMode: true,
        });
        
        if (DEBUG_VERBOSE) console.log('MediaPipe Pose 결과 콜백 설정 중...');
        pose.onResults(onPoseResults);
        
        if (CameraClass) {
            if (DEBUG_VERBOSE) console.log('MediaPipe Camera 초기화 중...');
            camera = new CameraClass(video, {
                onFrame: async () => {
                    if (video.readyState >= 2) {
                        try {
                            await pose.send({ image: video });
                        } catch (error) {
                            console.error('MediaPipe Pose 처리 중 오류:', error);
                        }
                    }
                },
                width: 640,
                height: 480
            });
            if (DEBUG_VERBOSE) console.log('MediaPipe Camera 시작 중...');
            await camera.start();
            if (DEBUG_VERBOSE) console.log('MediaPipe 초기화 완료 - 카메라 시작됨');
        } else {
            console.warn('Camera 유틸이 없어 수동 루프로 Pose를 실행합니다.');
            const runPoseLoop = async () => {
                if (video && video.readyState >= 2) {
                    try { await pose.send({ image: video }); } catch (e) { console.error('Pose 수동 루프 오류:', e); }
                }
                if (gameState !== GAME_STATE_GAME_OVER) requestAnimationFrame(runPoseLoop);
            };
            runPoseLoop();
            if (DEBUG_VERBOSE) console.log('MediaPipe 초기화 완료 - 수동 루프 실행');
        }
        
        // MediaPipe 모드 활성화 표시
        isSimulationMode = false;
        if (typeof updateCameraStatus === 'function') {
            updateCameraStatus('MediaPipe 모드로 실행 중');
        }
        
        // 실제 사람 감지 확인을 위한 테스트
        setTimeout(() => {
            if (playerPositions.length === 0) {
                if (DEBUG_VERBOSE) console.log('5초 후에도 사람이 감지되지 않아 얼굴 검출로 폴백합니다.');
                try { initFaceDetectionFallback(); } catch (e) { console.error('얼굴 검출 폴백 실패:', e); }
            }
        }, 5000);
        
    } catch (error) {
        console.error('MediaPipe 초기화 실패:', error);
        if (DEBUG_VERBOSE) {
            console.log('MediaPipe 초기화에 실패했지만 카메라는 작동할 수 있습니다.');
            console.log('게임 모드를 선택하면 시뮬레이션 모드로 실행됩니다.');
        }
    }
}

// MediaPipe 라이브러리 수동 로딩
async function loadMediaPipeLibraries() {
    try {
        if (DEBUG_VERBOSE) console.log('MediaPipe 라이브러리 수동 로딩 시작...');
        
        // Pose 라이브러리 로드
        const poseScript = document.createElement('script');
        poseScript.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469408/pose.js';
        poseScript.onload = () => {
            if (DEBUG_VERBOSE) console.log('MediaPipe Pose 라이브러리 로드 완료');
            // Camera 유틸리티 로드
            const cameraScript = document.createElement('script');
            cameraScript.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675466862/camera_utils.js';
            cameraScript.onload = () => {
                if (DEBUG_VERBOSE) console.log('MediaPipe Camera 유틸리티 로드 완료');
                // 라이브러리 로드 완료 후 MediaPipe 초기화 재시도
                setTimeout(() => {
                    initMediaPipe();
                }, 1000);
            };
            cameraScript.onerror = (error) => {
                console.error('MediaPipe Camera 유틸리티 로드 실패:', error);
                startSimulationMode();
            };
            document.head.appendChild(cameraScript);
        };
        poseScript.onerror = (error) => {
            console.error('MediaPipe Pose 라이브러리 로드 실패:', error);
            startSimulationMode();
        };
        document.head.appendChild(poseScript);
        
    } catch (error) {
        console.error('MediaPipe 라이브러리 로드 중 오류:', error);
        startSimulationMode();
    }
}

// 시뮬레이션 모드 시작
function startSimulationMode() {
    if (DEBUG_VERBOSE) console.log('시뮬레이션 모드로 전환');
    isSimulationMode = true;
    
    // 초기 플레이어 생성
    const mode = currentMode || 1;
    const playerCount = Math.min(mode, 4);
    
    playerPositions = [];
    for (let i = 0; i < playerCount; i++) {
        const x = 150 + i * 150 + Math.random() * 100;
        const y = 200 + Math.random() * 200;
        playerPositions.push({ x, y, id: Date.now() + i });
    }
    
    if (DEBUG_VERBOSE) console.log(`${playerCount}명의 시뮬레이션 플레이어 생성됨:`, playerPositions);
    
    // UI에 시뮬레이션 모드 표시
    if (typeof updateCameraStatus === 'function') {
        updateCameraStatus('시뮬레이션 모드로 실행 중');
    }
    updatePlayerCount(playerPositions.length);
    
    // 플레이어 움직임 시뮬레이션 (게임이 진행 중일 때만)
    const simulationInterval = setInterval(() => {
        if (gameState === GAME_STATE_PLAYING && !isPaused && playerPositions.length > 0) {
            playerPositions.forEach(player => {
                player.x += (Math.random() - 0.5) * 2;
                player.y += (Math.random() - 0.5) * 2;
                player.x = Math.max(50, Math.min(CANVAS_WIDTH - 50, player.x));
                player.y = Math.max(50, Math.min(CANVAS_HEIGHT - 50, player.y));
            });
        } else if (gameState === GAME_STATE_WAITING || gameState === GAME_STATE_COUNTDOWN) {
            // 게임이 시작되지 않았으면 시뮬레이션 중지
            clearInterval(simulationInterval);
        }
    }, 100);
    
    if (DEBUG_VERBOSE) console.log('시뮬레이션 모드 설정 완료');
}

// MediaPipe Pose 결과 처리 함수
function onPoseResults(results) {
    try {
        if (DEBUG_VERBOSE) console.log('[Pose] 결과:', results);
        // Pose(Web)는 기본적으로 단일 인물만 반환하지만, 추후 멀티 인물 지원 시 확장 대비
        const lm = results && results.poseLandmarks;
        const newPlayers = [];
        // MediaPipe Pose는 단일 인물 landmarks 배열(33개)을 반환함
        if (Array.isArray(lm) && lm.length >= 1) {
            const nose = lm[0]; // 코(인덱스 0)
            if (nose && typeof nose.x === 'number' && typeof nose.y === 'number') {
                const { x: camX, y: camY, width: camW, height: camH } = getCameraDrawRect();
                const px = camX + Math.max(0, Math.min(1, nose.x)) * camW;
                const py = camY + Math.max(0, Math.min(1, nose.y)) * camH;
                newPlayers.push({ x: px, y: py, id: Date.now(), confidence: nose.visibility ?? 1 });
            }
        }
        if (newPlayers.length > 0) {
            updateTracks(newPlayers);
        } else {
            // 결과 없을 때 트랙 시간초과 로직만 유지하여 유령 포인트 제거
            const now = Date.now();
            tracks = tracks.filter(t => now - t.lastSeen < CONFIG.trackTimeoutMs);
            playerPositions = tracks.map(t => ({ x: t.x, y: t.y, id: t.id }));
        }
        updatePlayerCount(playerPositions.length);
    } catch (error) {
        console.error('onPoseResults 처리 중 오류:', error);
    }
}

// 얼굴 검출 폴백 초기화
async function initFaceDetectionFallback() {
    try {
        if (DEBUG_VERBOSE) console.log('=== FaceDetection 초기화 시작 ===');
        const FDNS = window.FaceDetection;
        const FDClass = FDNS?.FaceDetection || FDNS;
        if (!FDClass) {
            console.warn('FaceDetection 라이브러리가 로드되지 않았습니다.');
            return;
        }
        faceDetector = new FDClass({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`,
        });
        faceDetector.setOptions({
            model: 'short',
            minDetectionConfidence: 0.15, // 인식률 향상 위해 낮춤
            selfieMode: true,
        });
        faceDetector.onResults(onFaceResults);

        // 카메라 프레임에서 주기적으로 얼굴 검출 수행
        const run = async () => {
            if (video && video.readyState >= 2) {
                try { await faceDetector.send({ image: video }); } catch (e) { console.error(e); }
            }
            if (gameState !== GAME_STATE_GAME_OVER) requestAnimationFrame(run);
        };
        run();
        console.log('얼굴 검출 폴백 시작');
    } catch (error) {
        console.error('initFaceDetectionFallback 오류:', error);
    }
}

// 손 검출(Hands) 폴백 초기화
async function initHandsFallback() {
    try {
        if (DEBUG_VERBOSE) console.log('=== Hands 초기화 시작 ===');
        const HandsNS = window.Hands;
        const HandsClass = HandsNS?.Hands || HandsNS;
        if (!HandsClass) {
            console.warn('Hands 라이브러리가 로드되지 않았습니다.');
            return;
        }
        handsDetector = new HandsClass({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });
        handsDetector.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.15, // 인식률 향상 위해 낮춤
            minTrackingConfidence: 0.15, // 인식률 향상 위해 낮춤
        });
        handsDetector.onResults(onHandsResults);

        const run = async () => {
            if (video && video.readyState >= 2) {
                try { await handsDetector.send({ image: video }); } catch (e) { console.error(e); }
            }
            if (gameState !== GAME_STATE_GAME_OVER) requestAnimationFrame(run);
        };
        run();
        console.log('손 검출 폴백 시작');
    } catch (error) {
        console.error('initHandsFallback 오류:', error);
    }
}

function onHandsResults(results) {
    try {
        if (DEBUG_VERBOSE) console.log('[Hands] 결과:', results);
        const multi = Array.isArray(results?.multiHandLandmarks) ? results.multiHandLandmarks : [];
        if (multi.length === 0) return;
        const { x: camX, y: camY, width: camW, height: camH } = getCameraDrawRect();
        const newPlayers = [];
        for (let i = 0; i < multi.length; i++) {
            const lm = multi[i];
            // 중심점 계산 (모든 랜드마크 평균)
            let sx = 0, sy = 0;
            for (let k = 0; k < lm.length; k++) { sx += lm[k].x; sy += lm[k].y; }
            const cx = sx / lm.length; const cy = sy / lm.length;
            const px = camX + Math.max(0, Math.min(1, cx)) * camW;
            const py = camY + Math.max(0, Math.min(1, cy)) * camH;
            newPlayers.push({ x: px, y: py, id: Date.now() + i, confidence: 1 });
        }
        if (newPlayers.length > 0) {
            updateTracks(newPlayers);
        }
        updatePlayerCount(playerPositions.length);
    } catch (error) {
        console.error('onHandsResults 오류:', error);
    }
}

function onFaceResults(results) {
    try {
        if (DEBUG_VERBOSE) console.log('[FaceDetection] 결과:', results);
        const detections = Array.isArray(results?.detections) ? results.detections : [];
        // console.log(`FaceDetection 결과 수: ${detections.length}`);
        const newPlayers = [];
        for (let i = 0; i < Math.min(6, detections.length); i++) {
            const ld = detections[i].locationData || {};
            const bbox = ld.relativeBoundingBox || ld.boundingBox || {};
            const { x: camX, y: camY, width: camW, height: camH } = getCameraDrawRect();
            const bx = typeof bbox.xCenter === 'number' ? bbox.xCenter : (bbox.xMin ?? 0);
            const by = typeof bbox.yCenter === 'number' ? bbox.yCenter : (bbox.yMin ?? 0);
            const bw = bbox.width ?? 0;
            const bh = bbox.height ?? 0;
            const centerX = camX + Math.max(0, Math.min(1, (typeof bbox.xCenter === 'number' ? bx : (bx + bw / 2)))) * camW;
            const centerY = camY + Math.max(0, Math.min(1, (typeof bbox.yCenter === 'number' ? by : (by + bh / 2)))) * camH;
            newPlayers.push({ x: centerX, y: centerY, id: Date.now() + i, confidence: 1 });
        }
        if (newPlayers.length > 0) {
            updateTracks(newPlayers);
        } else {
            // 얼굴이 없으면 오래된 포인트를 시간초과 기준으로만 유지
            const now = Date.now();
            tracks = tracks.filter(t => now - t.lastSeen < CONFIG.trackTimeoutMs);
            playerPositions = tracks.map(t => ({ x: t.x, y: t.y, id: t.id }));
        }
        updatePlayerCount(playerPositions.length);
    } catch (error) {
        console.error('onFaceResults 오류:', error);
    }
}

// Human.js 기반 최종 폴백 (머리/얼굴 검출)
async function initHumanFallback() {
    if (DEBUG_VERBOSE) console.log('=== Human.js 폴백 초기화 시작 ===');
    if (typeof window.Human === 'undefined') return;
    human = new window.Human.Human({
        modelBasePath: 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.7.3/models',
        face: { enabled: true, detector: { rotation: true, minConfidence: 0.3 } },
        body: { enabled: false },
        hand: { enabled: false },
        gesture: { enabled: false }
    });
    await human.load();
    console.log('Human 모델 로딩 완료');

    const loop = async () => {
        if (video && video.readyState >= 2) {
            const res = await human.detect(video);
            const newPlayers = [];
            const faces = Array.isArray(res.face) ? res.face : [];
            for (let i = 0; i < Math.min(CONFIG.maxPeople, faces.length); i++) {
                const f = faces[i];
                const box = f.box; // {x,y,width,height}
                const { x: camX, y: camY, width: camW, height: camH } = getCameraDrawRect();
                const cx = camX + (box.x + box.width / 2) * (camW / video.videoWidth);
                const cy = camY + (box.y + box.height / 2) * (camH / video.videoHeight);
                newPlayers.push({ x: cx, y: cy, id: Date.now() + i, confidence: f.prob });
            }
            if (newPlayers.length > 0) updateTracks(newPlayers);
            else {
                const nowTs = Date.now();
                tracks = tracks.filter(t => nowTs - t.lastSeen < CONFIG.trackTimeoutMs);
                playerPositions = tracks.map(t => ({ x: t.x, y: t.y, id: t.id }));
            }
            updatePlayerCount(playerPositions.length);
        }
        if (gameState !== GAME_STATE_GAME_OVER) requestAnimationFrame(loop);
    };
    loop();
}

// 기존/신규 플레이어 병합 (최대 maxCount)
function mergePlayers(existing, incoming, maxCount = 6) {
    const merged = [];
    const usedIncoming = new Set();
    // 1) 들어온 것부터 추가
    incoming.forEach((p, idx) => {
        merged.push(p);
        usedIncoming.add(idx);
    });
    // 2) 기존 플레이어 중 멀리 떨어진 것 유지
    existing.forEach((oldP) => {
        let isFar = true;
        incoming.forEach((newP, idx) => {
            const dx = oldP.x - newP.x;
            const dy = oldP.y - newP.y;
            if (Math.sqrt(dx * dx + dy * dy) < 80) {
                isFar = false;
            }
        });
        if (isFar) merged.push(oldP);
    });
    return merged.slice(0, maxCount);
}

// 감지되지 않을 때 점진적 감소
function decayPlayers(existing) {
    // 간단히 최근 좌표를 약간씩 화면 중앙 쪽으로 수축시키다 0명으로 수렴
    return existing.map(p => ({
        ...p,
        x: p.x * 0.98 + CANVAS_WIDTH * 0.01,
        y: p.y * 0.98 + CANVAS_HEIGHT * 0.01,
    })).filter((_, i) => i < 6);
}

// 플레이어 수 UI 업데이트 (실제 DOM 구조에 맞춰 갱신)
function updatePlayerCount(count) {
    const playerCountElement = document.getElementById('playerCount');
    if (playerCountElement) {
        playerCountElement.textContent = count.toString();
    }
    if (DEBUG_VERBOSE) console.log(`플레이어 수 UI 업데이트: ${count}명`);
}

// 플레이어 위치 목록 UI 업데이트
function updatePlayerPositionsDisplay() {
    const playerListElement = document.getElementById('playerList');
    if (playerListElement) {
        playerListElement.innerHTML = ''; // Clear previous list
        if (playerPositions.length === 0) {
            playerListElement.innerHTML = '<li>감지된 플레이어 없음</li>';
        } else {
            playerPositions.forEach((p, index) => {
                const listItem = document.createElement('li');
                listItem.textContent = `플레이어 ${index + 1}: (x: ${p.x.toFixed(1)}, y: ${p.y.toFixed(1)})`;
                playerListElement.appendChild(listItem);
            });
        }
    }
}

// 게임 루프
function gameLoop() {
    try {
        // 게임 상태 업데이트 (일시정지 시 업데이트/렌더 최소화)
        if (!isPaused) {
            updateGame();
        }
        
        // 게임 화면 렌더링 (상태별로 로깅)
        if (!isPaused) {
            if (gameState !== 'waiting' && DEBUG_VERBOSE) {
                console.log('게임 루프 - 현재 상태:', gameState, '모드:', currentMode);
            }
            renderGame();
        } else {
            // 일시정지 오버레이 렌더
            renderPauseOverlay();
        }
        
        // 다음 프레임 요청
        requestAnimationFrame(gameLoop);
        
    } catch (error) {
        console.error('게임 루프에서 오류 발생:', error);
        // 오류가 발생해도 게임 루프는 계속 실행
        setTimeout(() => {
            try {
                requestAnimationFrame(gameLoop);
            } catch (loopError) {
                console.error('게임 루프 재시작 실패:', loopError);
                // 강제로 게임 루프 재시작
                setTimeout(gameLoop, 100);
            }
        }, 100);
    }
}

// 게임 업데이트
function updateGame() {
    try {
        switch (gameState) {
            case GAME_STATE_WAITING:
                // 대기 상태에서는 아무것도 하지 않음
                break;
                
            case GAME_STATE_COUNTDOWN:
                if (countdownStartTime) {
                    const elapsed = getElapsedMs(countdownStartTime) / 1000;
                    const remaining = Math.max(0, 3 - elapsed);
                    
                    // 시간 표시 업데이트
                    const timeLeftElement = document.getElementById('timeLeft');
                    if (timeLeftElement) {
                        timeLeftElement.textContent = Math.ceil(remaining);
                    }
                    
                    if (elapsed >= 3) {
                        console.log('카운트다운 완료, 게임 시작');
                        gameState = GAME_STATE_PLAYING;
                        gameStartTime = Date.now();
                        score = 0;
                        
                        // 게임 정보 화면에서 시간 표시 업데이트
                        if (timeLeftElement) {
                            timeLeftElement.textContent = GAME_DURATION_SECONDS;
                        }
                        
                        console.log('게임 상태가 PLAYING으로 변경됨');
                    }
                }
                break;
                
            case GAME_STATE_PLAYING:
                if (gameStartTime) {
                    const elapsed = getElapsedMs(gameStartTime) / 1000;
                    const remaining = GAME_DURATION_SECONDS - elapsed;
                    
                    // 시간 표시 업데이트
                    const timeLeftElement = document.getElementById('timeLeft');
                    if (timeLeftElement) {
                        timeLeftElement.textContent = Math.max(0, Math.ceil(remaining));
                    }
                    
                    if (elapsed >= GAME_DURATION_SECONDS) {
                        console.log('게임 시간 종료');
                        endGame();
                    }
                }
                break;
                
            case GAME_STATE_GAME_OVER:
                // 게임 오버 상태에서는 업데이트 불필요
                break;
                
            default:
                console.warn('알 수 없는 게임 상태:', gameState);
                break;
        }
    } catch (error) {
        console.error('게임 업데이트 중 오류:', error);
    }
}

// 점수 계산
function calculateScore() {
    if (playerPositions.length < 2) return 0;

    // 모든 쌍 거리(픽셀)
    const pairDistances = [];
    for (let i = 0; i < playerPositions.length; i++) {
        for (let j = i + 1; j < playerPositions.length; j++) {
            const dx = playerPositions[i].x - playerPositions[j].x;
            const dy = playerPositions[i].y - playerPositions[j].y;
            pairDistances.push(Math.hypot(dx, dy));
        }
    }

    if (pairDistances.length === 0) return 0;

    // 중앙값 거리 사용(노이즈에 강함)
    const sorted = pairDistances.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // 목표 거리(px)
    const targetMeters = currentMode ? targetDistances[currentMode - 1] : 1.2;
    const targetPx = targetMeters * CONFIG.pixelsPerMeter;

    // 목표에 가까울수록 좋음, 0~100 스코어
    const error = Math.abs(median - targetPx);
    const tolerance = targetPx * 0.5; // 목표의 ±50% 구간을 가변 허용
    const normalized = Math.max(0, 1 - error / (tolerance || 1));
    score = Math.round(normalized * 100);
    score = Math.max(0, Math.min(100, score)); // Keep score between 0 and 100
    return score;
}

// LLM 응답 시뮬레이션 함수
function getLLMResponseForDistance(score) {
    let message = '';
    if (score >= 80) {
        message = '✨ 훌륭합니다! 사회적 거리두기를 완벽하게 실천하셨습니다. 이대로 계속 유지해주세요!';
    } else if (score >= 50) {
        message = '👍 잘하셨습니다! 대부분의 시간 동안 적절한 거리를 유지했습니다. 조금 더 노력하면 완벽해질 거예요.';
    } else if (score >= 20) {
        message = '⚠️ 주의가 필요합니다. 때때로 거리가 너무 가까워졌습니다. 다음번에는 2미터 이상 거리를 유지하도록 더 신경 써주세요.';
    } else {
        message = '🚨 위험합니다! 사회적 거리두기가 거의 지켜지지 않았습니다. 건강과 안전을 위해 다른 사람들과 충분한 거리를 두는 것이 매우 중요합니다.';
    }
    return message;
}

function endGame() {
    console.log('게임 종료');
    gameState = GAME_STATE_GAME_OVER;
    
    // 최종 점수 계산
    const finalScore = calculateScore();
    
    // LLM 메시지 생성
    const llmMessageText = getLLMResponseForDistance(finalScore);
    
    // 게임 오버 화면 표시
    const gameOver = document.getElementById('game-over');
    if (gameOver) {
        const scoreDisplayById = document.getElementById('finalScore');
        if (scoreDisplayById) scoreDisplayById.textContent = String(finalScore);
        
        const llmMessageDiv = document.getElementById('llmMessage');
        if (llmMessageDiv) {
            llmMessageDiv.textContent = llmMessageText;
        }
        
        gameOver.style.display = 'block';
    }
    
    console.log(`게임 종료 - 최종 점수: ${finalScore}, LLM 메시지: ${llmMessageText}`);
}

// 게임 재시작
function restartGame() {
    console.log('게임 재시작');
    
    // 게임 상태 초기화
    gameState = GAME_STATE_WAITING;
    currentMode = null;
    countdownStartTime = null;
    gameStartTime = null;
    score = 0;
    playerPositions = [];
    isSimulationMode = false;
    
    // UI 초기화
    document.querySelectorAll('.mode-button').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    const gameInfo = document.getElementById('game-info');
    if (gameInfo) {
        gameInfo.style.display = 'none';
    }
    
    const gameOver = document.getElementById('game-over');
    if (gameOver) {
        gameOver.style.display = 'none';
    }
    
    // 대기 화면으로 돌아가기
    renderWaitingScreen();
    
    console.log('게임 재시작 완료');

    // 일시정지 상태 초기화
    isPaused = false; pausedAt = null;
    setPauseButtonsText('⏸ 일시정지 (P)');
}

// 게임 렌더링
function renderGame() {
    try {
        if (!ctx) {
            console.warn('컨텍스트가 없어 렌더링을 건너뜁니다.');
            return;
        }
        
        if (DEBUG_VERBOSE) console.log('renderGame 호출됨 - 현재 상태:', gameState);
        
        switch (gameState) {
            case GAME_STATE_WAITING:
                if (DEBUG_VERBOSE) console.log('대기 화면 렌더링');
                renderWaitingScreen();
                break;
                
            case GAME_STATE_COUNTDOWN:
                if (DEBUG_VERBOSE) console.log('카운트다운 화면 렌더링');
                renderCountdown();
                break;
                
            case GAME_STATE_PLAYING:
                if (DEBUG_VERBOSE) console.log('게임 진행 화면 렌더링');
                renderPlayingScreen();
                if (isPaused) renderPauseOverlay();
                break;
                
            case GAME_STATE_GAME_OVER:
                console.log('게임 오버 상태 - HTML로 처리됨');
                // 게임 오버 화면은 HTML로 처리되므로 여기서는 아무것도 하지 않음
                break;
                
            default:
                console.warn('알 수 없는 게임 상태:', gameState);
                renderWaitingScreen();
                break;
        }
        
    } catch (error) {
        console.error('게임 화면 렌더링 중 오류:', error);
        // 오류 발생 시 대기 화면으로 폴백
        try {
            if (ctx) {
                renderWaitingScreen();
            }
        } catch (fallbackError) {
            console.error('폴백 렌더링도 실패:', fallbackError);
        }
    }
}

// 대기 화면 렌더링
function renderWaitingScreen() {
    try {
        if (DEBUG_VERBOSE) console.log('=== 대기 화면 렌더링 시작 ===');
        
        if (!ctx) {
            console.error('컨텍스트가 없어 대기 화면을 렌더링할 수 없습니다.');
            return;
        }
        
        if (!canvas) {
            console.error('캔버스가 없어 대기 화면을 렌더링할 수 없습니다.');
            return;
        }
        
        if (DEBUG_VERBOSE) {
            console.log('캔버스 크기:', canvas.width, 'x', canvas.height);
            console.log('컨텍스트 상태:', ctx);
        }
        
        // 캔버스 클리어
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 배경 그라데이션
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#4a90e2');
        gradient.addColorStop(1, '#357abd');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // 제목
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px "Baloo 2", "Jua", "Comic Sans MS"';
        ctx.textAlign = 'center';
        ctx.fillText('🎮 세이프 디스턴스 게임 🎮', canvas.width / 2, 120);
        
        // 부제목
        ctx.font = '24px Comic Sans MS';
        ctx.fillStyle = '#f0f0f0';
        ctx.fillText('게임 모드를 선택하세요!', canvas.width / 2, 180);
        
        // 장식 요소들
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        for (let i = 0; i < 5; i++) {
            const x = 100 + i * 150;
            const y = 250 + Math.sin(Date.now() / 1000 + i) * 20;
            ctx.beginPath();
            ctx.arc(x, y, 30, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // 하단 안내 메시지
        ctx.font = '18px Comic Sans MS';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('카메라 권한을 허용하면 실제 사람을 인식할 수 있습니다!', canvas.width / 2, canvas.height - 80);
        ctx.fillText('권한이 없거나 카메라가 작동하지 않으면 시뮬레이션 모드로 실행됩니다.', canvas.width / 2, canvas.height - 50);
        
        if (DEBUG_VERBOSE) console.log('=== 대기 화면 렌더링 완료 ===');
        
    } catch (error) {
        console.error('대기 화면 렌더링 중 오류:', error);
        // 오류 발생 시 간단한 텍스트라도 표시
        try {
            if (ctx && canvas) {
                ctx.fillStyle = '#ff0000';
                ctx.font = '20px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('화면 렌더링 오류', canvas.width / 2, canvas.height / 2);
                ctx.fillText('개발자 도구 콘솔을 확인하세요', canvas.width / 2, canvas.height / 2 + 30);
            }
        } catch (fallbackError) {
            console.error('폴백 렌더링도 실패:', fallbackError);
        }
    }
}

// 카운트다운 화면 렌더링
function renderCountdown() {
    try {
        if (!ctx || !canvas) {
            console.warn('컨텍스트나 캔버스가 없어 카운트다운을 렌더링할 수 없습니다.');
            return;
        }
        
        // 캔버스 클리어
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 배경
        ctx.fillStyle = '#2d2d2d';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        if (countdownStartTime) {
            const elapsed = getElapsedMs(countdownStartTime) / 1000;
            const remaining = Math.max(0, 3 - elapsed);
            
            if (remaining > 0) {
                // 카운트다운 숫자
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 120px Comic Sans MS';
                ctx.textAlign = 'center';
                ctx.fillText(Math.ceil(remaining).toString(), canvas.width / 2, canvas.height / 2);
                
                // "준비!" 메시지
                ctx.font = '36px Comic Sans MS';
                ctx.fillStyle = '#4CAF50';
                ctx.fillText('준비!', canvas.width / 2, canvas.height / 2 + 80);
                
                if (DEBUG_VERBOSE) console.log(`카운트다운: ${Math.ceil(remaining)}초`);
            } else {
                // 카운트다운 완료 - updateGame에서 상태 변경 처리
                console.log('카운트다운 완료 대기 중...');
            }
        }
        
    } catch (error) {
        console.error('카운트다운 렌더링 중 오류:', error);
        // 오류 발생 시 대기 화면으로 폴백
        try {
            if (ctx) {
                renderWaitingScreen();
            }
        } catch (fallbackError) {
            console.error('카운트다운 폴백 렌더링도 실패:', fallbackError);
        }
    }
}

// 게임 플레이 화면 렌더링
function renderPlayingScreen() {
    if (!ctx) return;
    
    // 캔버스 클리어
    ctx.fillStyle = '#2d2d2d';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 상단 타이틀
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px "Baloo 2", "Jua", "Comic Sans MS"';
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = 'rgba(255, 182, 193, 0.6)';
    ctx.shadowBlur = 12;
    ctx.fillText('🎮 세이프 디스턴스 게임', CANVAS_WIDTH / 2, 46);
    ctx.restore();
    
    // 카메라 피드 그리기 (1/2 크기)
    if (video && video.readyState >= 2 && !isSimulationMode) { // metadata 로드 이후도 허용
        const { width: drawWidth, height: drawHeight, x: drawX, y: drawY } = getCameraDrawRect();
        
        if (CONFIG.flipCamera) {
            ctx.save();
            ctx.translate(drawX + drawWidth, drawY);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, drawWidth, drawHeight);
            ctx.restore();
        } else {
            ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
        }
        
        // 카메라 테두리
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 3;
        ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);

        if (CONFIG.showCalibrationOverlay) {
            // 1m 눈금선 표시
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.setLineDash([6, 6]);
            const meterPx = CONFIG.pixelsPerMeter;
            for (let k = 1; k * meterPx < Math.min(drawWidth, drawHeight); k++) {
                ctx.beginPath();
                ctx.moveTo(drawX + k * meterPx, drawY);
                ctx.lineTo(drawX + k * meterPx, drawY + drawHeight);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(drawX, drawY + k * meterPx);
                ctx.lineTo(drawX + drawWidth, drawY + k * meterPx);
                ctx.stroke();
            }
            ctx.restore();
        }
        
        if (DEBUG_VERBOSE) console.log('카메라 화면 렌더링됨 (MediaPipe 모드)');
    } else {
        // 시뮬레이션 모드일 때 중앙에 메시지 표시
        ctx.fillStyle = '#666';
        ctx.font = '24px Comic Sans MS';
        ctx.textAlign = 'center';
        
        if (isSimulationMode) {
            ctx.fillText('시뮬레이션 모드', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 50);
            ctx.fillText('(테스트용)', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
            if (DEBUG_VERBOSE) console.log('시뮬레이션 모드 화면 표시');
        } else {
            ctx.fillText('카메라 화면', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 50);
            ctx.fillText('(로딩 중...)', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
            if (DEBUG_VERBOSE) console.log('카메라 로딩 중 화면 표시');
        }
    }
    
    // 게임 정보 표시
    if (currentMode) {
        const mode = currentMode;
        const targetDistanceVal = targetDistances[mode - 1];
        const playerCountVal = playerCounts[mode - 1];
        
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px "Baloo 2", "Jua", "Comic Sans MS", cursive';
        ctx.textAlign = 'left';
        
        ctx.fillText(`목표 거리: ${targetDistanceVal}m`, 20, 30);
        ctx.fillText(`모드: ${mode === 1 ? '심리적 안정' : '혼잡상태'}`, 20, 55);
        ctx.fillText(`감지된 사람: ${playerPositions.length}명`, 20, 80);
        
        if (isSimulationMode) {
            ctx.fillStyle = '#FFD166';
            ctx.fillText('🧪 시뮬레이션 모드', 20, 105);
        } else {
            ctx.fillStyle = '#A0E7E5';
            ctx.fillText('📷 카메라 모드', 20, 105);
        }
        
        // 게임 시간 표시
        if (gameStartTime) {
            const elapsed = Math.floor(getElapsedMs(gameStartTime) / 1000);
            const remaining = GAME_DURATION_SECONDS - elapsed;
            ctx.fillStyle = remaining <= 5 ? '#ff4444' : '#fff';
            ctx.fillText(`남은 시간: ${remaining}초`, 20, 130);
        }
    }
    
    // 플레이어 렌더링
    renderPlayers();
    
    if (DEBUG_VERBOSE) console.log(`게임 화면 렌더링 완료 - 플레이어 수: ${playerPositions.length}, 시뮬레이션: ${isSimulationMode}`);
}

// 일시정지 오버레이
function renderPauseOverlay() {
    if (!ctx || !canvas) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 60px "Baloo 2", "Jua", "Comic Sans MS"';
    ctx.textAlign = 'center';
    ctx.fillText('⏸ 일시정지', canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '22px Comic Sans MS';
    ctx.fillText('P 키 또는 버튼으로 재개', canvas.width / 2, canvas.height / 2 + 30);
    ctx.restore();
}

// 플레이어 렌더링 (어린이 얼굴 모양)
function renderPlayers() {
    if (DEBUG_VERBOSE) console.log(`플레이어 렌더링 시작 - ${playerPositions.length}명`);
    
    if (playerPositions.length === 0) {
        if (DEBUG_VERBOSE) console.log('렌더링할 플레이어가 없습니다.');
        return;
    }
    
    playerPositions.forEach((player, index) => {
        if (DEBUG_VERBOSE) console.log(`플레이어 ${index + 1} 렌더링: x=${player.x}, y=${player.y}`);
        
        // 어린이 아이콘 그리기 (얼굴 인식 위치에 매핑)
        drawChildFace(player.x, player.y, index);
        
        // 플레이어 간 거리 표시
        if (index < playerPositions.length - 1) {
            for (let j = index + 1; j < playerPositions.length; j++) {
                const otherPlayer = playerPositions[j];
                const distance = Math.sqrt(
                    (player.x - otherPlayer.x) ** 2 + (player.y - otherPlayer.y) ** 2
                );
                
                // 거리 선 그리기
                ctx.strokeStyle = `hsl(${index * 90}, 70%, 60%)`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(player.x, player.y);
                ctx.lineTo(otherPlayer.x, otherPlayer.y);
                ctx.stroke();
                
                // 거리 텍스트
                const midX = (player.x + otherPlayer.x) / 2;
                const midY = (player.y + otherPlayer.y) / 2;
                const distanceInMeters = (distance / (CONFIG.pixelsPerMeter || 100)).toFixed(1);
                
                ctx.fillStyle = '#fff';
                ctx.font = '16px Comic Sans MS';
                ctx.textAlign = 'center';
                ctx.fillText(`${distanceInMeters}m`, midX, midY - 10);
            }
        }
    });
    
    if (DEBUG_VERBOSE) console.log('플레이어 렌더링 완료');
}

// 카메라 표시 영역 계산(좌표 매핑용)
function getCameraDrawRect() {
    const width = CANVAS_WIDTH * CONFIG.cameraScale;
    const height = CANVAS_HEIGHT * CONFIG.cameraScale;
    const x = (CANVAS_WIDTH - width) / 2;
    const y = (CANVAS_HEIGHT - height) / 2;
    return { x, y, width, height };
}

// 다중 인물 추적 업데이트(근접 매칭 + EMA 스무딩)
function updateTracks(incomingPoints) {
    const now = Date.now();
    const matchRadius = CONFIG.matchRadiusPx; // px
    const alpha = CONFIG.emaAlpha; // EMA 가중치

    // 각 포인트를 가장 가까운 트랙에 매칭
    incomingPoints.forEach((p) => {
        let bestIdx = -1;
        let bestDist = Infinity;
        tracks.forEach((t, idx) => {
            const dx = t.x - p.x; const dy = t.y - p.y;
            const d = Math.hypot(dx, dy);
            if (d < bestDist) { bestDist = d; bestIdx = idx; }
        });
        if (bestDist <= matchRadius && bestIdx >= 0) {
            const t = tracks[bestIdx];
            t.x = t.x * (1 - alpha) + p.x * alpha;
            t.y = t.y * (1 - alpha) + p.y * alpha;
            t.lastSeen = now;
        } else {
            tracks.push({ id: nextTrackId++, x: p.x, y: p.y, lastSeen: now });
        }
    });

    // 오래된 트랙 제거 및 최대 6명으로 제한
    tracks = tracks
        .filter(t => now - t.lastSeen < CONFIG.trackTimeoutMs)
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, CONFIG.maxPeople);

    playerPositions = tracks.map(t => ({ x: t.x, y: t.y, id: t.id }));
}

// 어린이 얼굴 그리기
function drawChildFace(x, y, playerIndex) {
    const faceSize = 40;
    const colors = [
        '#FFB6C1', // 연한 분홍
        '#87CEEB', // 하늘색
        '#98FB98', // 연한 초록
        '#DDA0DD'  // 연한 보라
    ];
    
    // 얼굴 배경 (원)
    ctx.fillStyle = colors[playerIndex % colors.length];
    ctx.beginPath();
    ctx.arc(x, y, faceSize, 0, 2 * Math.PI);
    ctx.fill();
    
    // 얼굴 테두리
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // 눈 (둥근 원)
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(x - 12, y - 8, 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 12, y - 8, 4, 0, 2 * Math.PI);
    ctx.fill();
    
    // 눈동자 (작은 원)
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - 12, y - 8, 1.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 12, y - 8, 1.5, 0, 2 * Math.PI);
    ctx.fill();
    
    // 입 (웃는 모양)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y + 5, 8, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
    
    // 볼 (분홍색)
    ctx.fillStyle = '#FF69B4';
    ctx.beginPath();
    ctx.arc(x - 15, y + 2, 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 15, y + 2, 6, 0, 2 * Math.PI);
    ctx.fill();
    
    // 플레이어 번호
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px Comic Sans MS';
    ctx.textAlign = 'center';
    ctx.fillText((playerIndex + 1).toString(), x, y + faceSize + 20);
}

// 카메라 테스트
function testCamera() {
    if (!video) {
        console.log('비디오 요소가 없습니다');
        return;
    }
    
    console.log('카메라 테스트 중...');
    console.log('비디오 요소:', video);
    console.log('비디오 크기:', video.videoWidth, 'x', video.videoHeight);
    console.log('비디오 준비 상태:', video.readyState);
    console.log('비디오 일시정지:', video.paused);
    console.log('비디오 종료:', video.ended);
    console.log('비디오 오류:', video.error);
    console.log('비디오 소스:', video.srcObject);
    
    if (video.videoWidth > 0 && video.videoHeight > 0) {
        alert(`카메라가 작동합니다! 비디오 크기: ${video.videoWidth}x${video.videoHeight}`);
    } else {
        alert('카메라가 아직 준비되지 않았습니다. 잠시 기다린 후 다시 시도해주세요.');
    }
}

// 카메라 새로고침
function refreshCamera() {
    console.log('카메라 새로고침 시작');
    
    // 기존 MediaPipe 정리
    if (camera) {
        try {
            camera.stop();
            console.log('기존 MediaPipe 카메라 정지됨');
        } catch (error) {
            console.error('MediaPipe 카메라 정지 중 오류:', error);
        }
        camera = null;
    }
    
    if (pose) {
        try {
            pose.close();
            console.log('기존 MediaPipe Pose 정리됨');
        } catch (error) {
            console.error('MediaPipe Pose 정리 중 오류:', error);
        }
        pose = null;
    }
    
    // 플레이어 위치 초기화
    playerPositions = [];
    isSimulationMode = false;
    
    // 카메라 상태 업데이트
    updateCameraStatus('카메라 재시작 중...');
    
    // MediaPipe 재초기화 시도
    setTimeout(async () => {
        try {
            await initMediaPipe();
        } catch (error) {
            console.error('MediaPipe 재초기화 실패:', error);
            startSimulationMode();
        }
    }, 1000);
    
    console.log('카메라 새로고침 완료');
}

// 카메라 권한 확인
async function checkCameraPermissions() {
    if (!navigator.permissions) {
        console.log('권한 API를 지원하지 않습니다');
        return;
    }
    
    try {
        const permission = await navigator.permissions.query({ name: 'camera' });
        console.log('카메라 권한 상태:', permission.state);
        
        permission.onchange = () => {
            console.log('카메라 권한 변경됨:', permission.state);
            if (permission.state === 'granted') {
                requestCamera();
            }
        };
        
        if (permission.state === 'granted') {
            console.log('카메라 권한이 이미 허용되었습니다');
        } else if (permission.state === 'denied') {
            console.log('카메라 권한이 거부되었습니다');
            cameraError.style.display = 'block';
            const errorText = document.querySelector('#cameraError p');
            if (errorText) {
                errorText.textContent = '카메라 접근이 거부되었습니다. 브라우저 설정에서 카메라 권한을 활성화해주세요.';
            }
        }
    } catch (error) {
        console.log('권한 확인 오류:', error);
    }
}

// 카메라 상태 업데이트
function updateCameraStatus(status) {
    const cameraStatus = document.getElementById('camera-status');
    if (cameraStatus) {
        cameraStatus.innerHTML = `
            <div class="status-info">
                <span class="status-icon">📹</span>
                <span class="status-text">${status}</span>
            </div>
        `;
    }
}

// 페이지 로드 시 게임 초기화
window.addEventListener('load', initGame);

// 디버깅용 테스트 함수
function testGame() {
    console.log('=== 게임 테스트 시작 ===');
    
    // DOM 요소 상태 확인
    console.log('DOM 요소 상태:');
    console.log('- modeSelection:', modeSelection);
    console.log('- gameInfo:', gameInfo);
    console.log('- gameOver:', gameOver);
    console.log('- cameraError:', cameraError);
    console.log('- cameraStatus:', cameraStatus);
    console.log('- canvas:', canvas);
    console.log('- ctx:', ctx);
    
    // 게임 상태 확인
    console.log('게임 상태:');
    console.log('- gameState:', gameState);
    console.log('- currentMode:', currentMode);
    console.log('- score:', score);
    console.log('- playerPositions:', playerPositions);
    
    // 이벤트 리스너 테스트
    console.log('이벤트 리스너 테스트:');
    const modeButtons = document.querySelectorAll('.mode-button');
    console.log('찾은 모드 버튼 수:', modeButtons.length);
    
    modeButtons.forEach((button, index) => {
        console.log(`버튼 ${index + 1}:`, button);
        console.log(`- data-mode:`, button.dataset.mode);
        console.log(`- onclick:`, button.onclick);
        // getEventListeners는 크롬 DevTools 콘솔 전용 API라 런타임 오류 방지
        try { console.log(`- listeners:`, button.getEventListeners ? button.getEventListeners() : 'N/A'); } catch (_) {}
    });
    
    // 수동으로 모드 1 선택 시도
    console.log('수동으로 모드 1 선택 시도...');
    selectMode(1);
    
    console.log('=== 게임 테스트 완료 ===');
}