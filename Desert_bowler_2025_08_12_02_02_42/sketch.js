/*
안전 거리 시뮬레이션 - p5.js 구현
4명의 귀여운 어린이 캐릭터가 좁은 공간에서 자동으로 움직이며
모드 기준 거리 이내로 가까워지면 혼잡 경고, 충돌 시 위험 경고를 표시합니다.
모드:
  1: 심리적 안정 (1.2m) - 파랑
  2: 혼잡 상태 (0.6m) - 주황
  3: 감염 방지 (2m) - 빨강
*/

let participants = [];
let activeMode = 1;
const modes = {
  1: {label: '심리적 안정 (1.2m)', dist: 120, color: [100, 150, 255]},
  2: {label: '혼잡 상태 (0.6m)', dist: 60, color: [255, 200, 100]},
  3: {label: '감염 방지 (2m)', dist: 200, color: [255, 100, 100]}
};
let buttons = [];
const ICON_SIZE = 40;
const AREA_SIZE = 400;

function setup() {
  createCanvas(AREA_SIZE, AREA_SIZE);
  for (let i = 0; i < 4; i++) {
    participants.push(new Participant(random(ICON_SIZE, width - ICON_SIZE), random(ICON_SIZE, height - ICON_SIZE)));
  }
  let x = 10;
  for (let m in modes) {
    let b = createButton(modes[m].label);
    b.position(x, height + 20);
    b.mousePressed(() => activeMode = int(m));
    buttons.push(b);
    x += 140;
  }
}

function draw() {
  background(240);
  stroke(0);
  noFill();
  rect(0, 0, width, height);

  // 상태 체크
  let congested = false;
  let dangerous = false;
  participants.forEach(p => p.update());

  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      let p1 = participants[i];
      let p2 = participants[j];
      let d = p5.Vector.dist(p1.pos, p2.pos);
      if (d < ICON_SIZE) {
        dangerous = true;
        p1.bounce(p2);
      } else if (d < modes[activeMode].dist) {
        congested = true;
      }
    }
  }

  participants.forEach(p => p.display());

  // 메시지 출력
  noStroke();
  textSize(18);
  textAlign(CENTER, CENTER);
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
    let c = modes[activeMode].color;
    push();
    translate(this.pos.x, this.pos.y);
    // 귀여운 머리
    fill(255, 220, 180);
    ellipse(0, -10, ICON_SIZE*0.5, ICON_SIZE*0.5);
    // 머리카락
    fill(c[0], c[1], c[2]);
    arc(0, -12, ICON_SIZE*0.6, ICON_SIZE*0.6, PI, TWO_PI);
    // 표정
    fill(0);
    ellipse(-6, -14, 4, 4);
    ellipse(6, -14, 4, 4);
    noFill();
    stroke(0);
    strokeWeight(2);
    arc(0, -8, 12, 8, 0, PI);
    // 몸통
    noStroke();
    fill(c[0], c[1], c[2]);
    ellipse(0, 10, ICON_SIZE*0.7, ICON_SIZE);
    // 팔
    stroke(c[0], c[1], c[2]);
    strokeWeight(4);
    line(-15, 4, 15, 4);
    // 다리
    line(-8, 30, -8, 40);
    line(8, 30, 8, 40);
    pop();
  }
}
