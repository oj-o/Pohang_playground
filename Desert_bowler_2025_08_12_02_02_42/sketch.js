/*
안전 거리 시뮬레이션 - p5.js 구현
요구사항 반영:
- 아이콘을 더 귀엽게
- 시작 버튼을 눌러 20초 데모 시작
- 일시정지/재개 버튼 추가
- 남은 시간 표시 및 종료 처리
*/

let participants = [];
let activeMode = 1;
const modes = {
  1: {label: '심리적 안정 (1.2m)', dist: 120, color: [100, 150, 255]},
  2: {label: '혼잡 상태 (0.6m)', dist: 60, color: [255, 200, 100]}
};
let buttons = [];
const ICON_SIZE = 42;
const AREA_SIZE = 400;

// 게임 상태 및 UI
let startButton, pauseButton, timerDiv;
let isRunning = false;
let isPaused = false;
let isGameOver = false;
const GAME_DURATION_MS = 20000;
let remainingMs = GAME_DURATION_MS;

function initializeParticipants() {
  participants = [];
  for (let i = 0; i < 4; i++) {
    participants.push(new Participant(
      random(ICON_SIZE, width - ICON_SIZE),
      random(ICON_SIZE, height - ICON_SIZE)
    ));
  }
}

function createControls() {
  // 시작 버튼
  startButton = createButton('▶️ 시작');
  startButton.addClass('control');
  startButton.position(10, height + 20);
  startButton.mousePressed(startGame);

  // 일시정지/재개 버튼
  pauseButton = createButton('⏸️ 일시정지');
  pauseButton.addClass('control');
  pauseButton.position(100, height + 20);
  pauseButton.mousePressed(togglePause);
  pauseButton.attribute('disabled', '');

  // 타이머 표시
  timerDiv = createDiv('남은 시간: 20.0s');
  timerDiv.addClass('timer');
  timerDiv.position(200, height + 22);
}

function refreshControls() {
  if (!isRunning && !isGameOver) {
    startButton.html('▶️ 시작');
    startButton.removeAttribute('disabled');
    pauseButton.html('⏸️ 일시정지');
    pauseButton.attribute('disabled', '');
  } else if (isRunning && !isPaused) {
    startButton.attribute('disabled', '');
    pauseButton.removeAttribute('disabled');
    pauseButton.html('⏸️ 일시정지');
  } else if (isRunning && isPaused) {
    startButton.attribute('disabled', '');
    pauseButton.removeAttribute('disabled');
    pauseButton.html('▶️ 재개');
  } else if (!isRunning && isGameOver) {
    startButton.html('⟲ 다시 시작');
    startButton.removeAttribute('disabled');
    pauseButton.html('⏸️ 일시정지');
    pauseButton.attribute('disabled', '');
  }
}

function startGame() {
  isRunning = true;
  isPaused = false;
  isGameOver = false;
  remainingMs = GAME_DURATION_MS;
  initializeParticipants();
  refreshControls();
}

function togglePause() {
  if (!isRunning) return;
  isPaused = !isPaused;
  refreshControls();
}

function endGame() {
  isRunning = false;
  isPaused = false;
  isGameOver = true;
  refreshControls();
}

function setup() {
  createCanvas(AREA_SIZE, AREA_SIZE);
  initializeParticipants();
  createControls();

  // 모드 버튼들
  let x = 10;
  for (let m in modes) {
    let b = createButton(modes[m].label);
    b.addClass('control');
    b.position(x, height + 60);
    b.mousePressed(() => {
      activeMode = int(m);
    });
    buttons.push(b);
    x += 160;
  }

  refreshControls();
}

function draw() {
  background(245);
  stroke(220);
  noFill();
  rect(0, 0, width, height);

  // 타이머 갱신
  if (isRunning && !isPaused && !isGameOver) {
    remainingMs = max(0, remainingMs - deltaTime);
    if (remainingMs <= 0) {
      endGame();
    }
  }
  const secondsLeft = (remainingMs / 1000).toFixed(1);
  if (timerDiv) timerDiv.html(`남은 시간: ${secondsLeft}s`);

  // 상태 체크
  let congested = false;
  let dangerous = false;

  if (isRunning && !isPaused && !isGameOver) {
    participants.forEach(p => p.update());
  }

  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      let p1 = participants[i];
      let p2 = participants[j];
      let d = p5.Vector.dist(p1.pos, p2.pos);
      if (d < ICON_SIZE) {
        dangerous = true;
        if (isRunning && !isPaused && !isGameOver) {
          p1.bounce(p2);
        }
      } else if (d < modes[activeMode].dist) {
        congested = true;
      }
    }
  }

  participants.forEach(p => p.display());

  // 상태/오버레이 메시지
  noStroke();
  textSize(16);
  textAlign(CENTER, CENTER);
  if (!isRunning && !isGameOver) {
    fill(0, 0, 0, 120);
    rect(0, 0, width, height);
    fill(255);
    text('▶ 시작을 눌러 데모를 시작하세요\n제한 시간 20초', width/2, height/2);
  } else if (isPaused) {
    fill(0, 0, 0, 120);
    rect(0, 0, width, height);
    fill(255);
    text('⏸ 일시정지', width/2, height/2);
  } else if (isGameOver) {
    fill(0, 0, 0, 120);
    rect(0, 0, width, height);
    fill(255);
    text('⏱ 시간 종료! 다시 시작을 누르세요', width/2, height/2);
  } else {
    if (dangerous) {
      fill('red');
      text('🚨 위험! 충돌 발생', width/2, 20);
    } else if (congested) {
      fill('orange');
      text('⚠️ 혼잡 상태: 거리 유지 필요', width/2, 20);
    } else {
      fill('green');
      text('✅ 안전 거리 확보', width/2, 20);
    }
  }
}

class Participant {
  constructor(x, y) {
    this.pos = createVector(x, y);
    this.vel = p5.Vector.random2D().mult(random(1, 2));
  }

  update() {
    this.pos.add(this.vel);
    if (this.pos.x < ICON_SIZE/2 || this.pos.x > width - ICON_SIZE/2) this.vel.x *= -1;
    if (this.pos.y < ICON_SIZE/2 || this.pos.y > height - ICON_SIZE/2) this.vel.y *= -1;
    this.pos.x = constrain(this.pos.x, ICON_SIZE/2, width - ICON_SIZE/2);
    this.pos.y = constrain(this.pos.y, ICON_SIZE/2, height - ICON_SIZE/2);
  }

  bounce(other) {
    let normal = p5.Vector.sub(this.pos, other.pos).normalize();
    this.vel.reflect(normal);
    other.vel.reflect(p5.Vector.mult(normal, -1));
    let overlap = ICON_SIZE - p5.Vector.dist(this.pos, other.pos);
    this.pos.add(normal.mult(overlap/2));
    other.pos.add(normal.mult(-overlap/2));
  }

  display() {
    const modeColor = modes[activeMode].color;
    push();
    translate(this.pos.x, this.pos.y);

    // 살짝 통통 튀는 느낌
    const bob = sin(frameCount * 0.1 + this.pos.x * 0.01) * 1.5;
    translate(0, bob);

    // 아웃라인 색상
    const outline = color(50, 50, 50, 60);

    // 몸통 (파스텔, 드롭섀도)
    noStroke();
    drawingContext.shadowColor = 'rgba(0,0,0,0.15)';
    drawingContext.shadowBlur = 6;
    drawingContext.shadowOffsetY = 3;
    fill(modeColor[0], modeColor[1], modeColor[2]);
    ellipse(0, 16, ICON_SIZE * 0.78, ICON_SIZE * 1.05);

    // 머리
    drawingContext.shadowBlur = 0;
    stroke(outline);
    strokeWeight(1);
    fill(255, 232, 206);
    ellipse(0, -6, ICON_SIZE * 0.74, ICON_SIZE * 0.74);

    // 머리카락/모자 느낌
    noStroke();
    fill(modeColor[0], modeColor[1], modeColor[2]);
    arc(0, -18, ICON_SIZE * 0.9, ICON_SIZE * 0.6, PI, TWO_PI);

    // 눈 (크고 반짝이는 하이라이트)
    noStroke();
    fill(0);
    ellipse(-7, -11, 7, 9);
    ellipse(7, -11, 7, 9);
    fill(255);
    ellipse(-9, -13, 2.2, 3.2);
    ellipse(5.5, -13, 2.2, 3.2);

    // 볼터치
    fill(255, 140, 170, 180);
    ellipse(-12, -2, 6, 4);
    ellipse(12, -2, 6, 4);

    // 입 (살짝 미소)
    noFill();
    stroke(120, 60, 60);
    strokeWeight(2);
    arc(0, -1, 12, 7, 0, PI);

    // 팔
    stroke(modeColor[0], modeColor[1], modeColor[2]);
    strokeWeight(4);
    line(-16, 8, 16, 8);

    // 다리
    line(-8, 30, -6, 40);
    line(8, 30, 6, 40);

    pop();
  }
}
